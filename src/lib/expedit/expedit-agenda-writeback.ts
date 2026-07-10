/**
 * Write-back de AGENDA: espelha no Expedit as tarefas criadas/concluídas na
 * nossa plataforma (Fase B do sincronismo bidirecional).
 *
 * Anti-loop: ao criar um compromisso no Expedit, gravamos o id retornado em
 * `Tarefa.expeditId` (= `expedit-comp:{id}`). O import da agenda (fast-sync e
 * sync de 6h) faz upsert por esse mesmo externalId, então reconhece a tarefa
 * como já existente e NÃO cria duplicata.
 *
 * Best-effort e opt-in (EXPEDIT_EMAIL/EXPEDIT_PASSWORD), como o write-back de
 * triagem — falha nunca bloqueia a ação local.
 */
import type { PrismaClient } from '@prisma/client'

import { createExpeditClient, type ExpeditClient } from './expedit-client'

let cached: ExpeditClient | null | undefined

const getClient = (): ExpeditClient | null => {
  if (cached !== undefined) return cached
  const email = process.env.EXPEDIT_EMAIL
  const senha = process.env.EXPEDIT_PASSWORD
  cached =
    email && senha
      ? createExpeditClient({
          baseUrl: process.env.EXPEDIT_BASE_URL ?? 'https://app-v2.expedit.com.br',
          email,
          senha,
        })
      : null
  return cached
}

/** id numérico do compromisso a partir do externalId `expedit-comp:{id}`. */
const compromissoId = (expeditId: string | null): string | null => {
  if (!expeditId) return null
  const m = expeditId.match(/^expedit-comp:(\d+)$/)
  return m ? m[1] : null
}

/**
 * Cria o compromisso correspondente no Expedit e grava o expeditId na tarefa
 * (idempotente: se a tarefa já veio do Expedit ou já foi espelhada, não faz
 * nada — evita duplicar).
 */
export async function espelharTarefaCriada(
  prisma: PrismaClient,
  tarefaId: string
): Promise<void> {
  const client = getClient()
  if (!client) return

  try {
    const tarefa = await prisma.tarefa.findUnique({
      where: { id: tarefaId },
      select: {
        id: true,
        tipo: true,
        titulo: true,
        descricao: true,
        prazoData: true,
        dataInicio: true,
        expeditId: true,
        processo: { select: { expeditId: true } },
        responsavel: { select: { name: true, email: true } },
      },
    })
    // Já tem expeditId → veio do Expedit (ou já espelhada): não duplica.
    if (!tarefa || tarefa.expeditId) return

    const data = tarefa.prazoData ?? tarefa.dataInicio
    if (!data) return // sem data não há compromisso de agenda

    const responsavel = tarefa.responsavel.name ?? tarefa.responsavel.email
    const id = await client.criarCompromisso({
      titulo: tarefa.titulo,
      data,
      // Nome do responsável na observação → o reimport casa o advogado sozinho.
      observacao: [tarefa.descricao, `Responsável: ${responsavel}`].filter(Boolean).join('\n'),
      processoExpeditId: tarefa.processo?.expeditId ?? null,
      tipo: tarefa.tipo,
    })

    if (id) {
      await prisma.tarefa.update({
        where: { id: tarefa.id },
        data: { expeditId: `expedit-comp:${id}` },
      })
    } else {
      console.warn('[expedit:agenda-wb] criar compromisso não retornou id', { tarefaId })
    }
  } catch (e) {
    console.warn('[expedit:agenda-wb] espelhar criação falhou', {
      tarefaId,
      error: e instanceof Error ? e.message : 'unknown-error',
    })
  }
}

/** Conclui no Expedit o compromisso espelhado desta tarefa (se houver). */
export async function espelharTarefaConcluida(expeditId: string | null): Promise<void> {
  const client = getClient()
  const id = compromissoId(expeditId)
  if (!client || !id) return
  try {
    const ok = await client.concluirCompromisso(id)
    if (!ok) console.warn('[expedit:agenda-wb] concluir compromisso não confirmou', { id })
  } catch (e) {
    console.warn('[expedit:agenda-wb] concluir compromisso falhou', {
      id,
      error: e instanceof Error ? e.message : 'unknown-error',
    })
  }
}
