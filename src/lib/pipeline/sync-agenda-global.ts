/**
 * Sincronização da agenda GLOBAL do Expedit (app-v2 `/agenda/agenda`) → Tarefa.
 *
 * Diferente do `sync-compromissos-expedit` (API oficial, 1 request POR processo,
 * janela de EXPEDIT_DETALHES_MAX), este endpoint traz a agenda inteira do
 * escritório em 1 request — é a base do sync rápido (minuto a minuto).
 *
 * Ids são os mesmos da API oficial (verificado E2E), então os externalIds
 * `expedit-comp:{id}` / `expedit-aud:{id}` deduplicam automaticamente com o
 * sync de 6h. EXPEDIENTEs são pulados aqui: viram intimações pelo
 * sync-intimacoes (item a item) e Tarefas de prazo pelo sync de 6h.
 */
import { randomUUID } from 'node:crypto'

import { TarefaStatus, type PrismaClient } from '@prisma/client'

import { notificarTarefaDirecionada } from '@/lib/notificacoes'
import { createResponsavelResolver } from '@/lib/pipeline/responsavel-matching'
import type { ExpeditClient } from '@/lib/expedit/expedit-client'

export type AgendaGlobalSyncCounters = {
  coletados: number
  compromissos: number
  audiencias: number
  tarefasCriadas: number
  tarefasAtualizadas: number
  semProcesso: number
}

export type AgendaGlobalSyncResult = {
  runId: string
  phase: AgendaGlobalSyncCounters
}

const parseDate = (raw?: string | null): Date | null => {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

const mapSituacao = (situacao?: string, concluido?: number | boolean): TarefaStatus => {
  if (concluido) return TarefaStatus.CONCLUIDO
  const v = String(situacao ?? '').toLowerCase()
  if (v.includes('cancel')) return TarefaStatus.CANCELADO
  if (v.includes('conclu') || v.includes('realiz')) return TarefaStatus.CONCLUIDO
  if (v.includes('andamento')) return TarefaStatus.EM_ANDAMENTO
  return TarefaStatus.PENDENTE
}

export const syncAgendaGlobal = async (
  prisma: PrismaClient,
  client: ExpeditClient,
  opts?: { start?: Date; end?: Date }
): Promise<AgendaGlobalSyncResult> => {
  const runId = randomUUID()
  const start = opts?.start ?? (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 60); return d })()
  const end = opts?.end ?? (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 180); return d })()

  let compromissos = 0
  let audiencias = 0
  let tarefasCriadas = 0
  let tarefasAtualizadas = 0
  let semProcesso = 0

  const itens = await client.listAgendaGlobal(start, end)
  const resolver = await createResponsavelResolver(prisma)
  if (!resolver.admin) {
    return {
      runId,
      phase: { coletados: itens.length, compromissos, audiencias, tarefasCriadas, tarefasAtualizadas, semProcesso },
    }
  }
  const admin = resolver.admin

  // Cache expeditId → processoId local.
  const processoCache = new Map<string, string | null>()
  const resolveProcesso = async (expeditId?: number): Promise<string | null> => {
    if (expeditId == null) return null
    const key = String(expeditId)
    if (processoCache.has(key)) return processoCache.get(key)!
    const found = await prisma.processo.findUnique({
      where: { expeditId: key },
      select: { id: true },
    })
    processoCache.set(key, found?.id ?? null)
    return found?.id ?? null
  }

  for (const item of itens) {
    if (item.tipo !== 'COMPROMISSO' && item.tipo !== 'AUDIENCIA') continue

    const isAudiencia = item.tipo === 'AUDIENCIA'
    const aud = isAudiencia ? item.audiencia?.[0] : null
    const rawId = isAudiencia ? (aud?.id ?? item.id) : item.id
    if (rawId == null) continue
    const externalId = isAudiencia ? `expedit-aud:${rawId}` : `expedit-comp:${rawId}`

    if (isAudiencia) audiencias += 1
    else compromissos += 1

    const processoId = await resolveProcesso(item.processo?.id)
    if (!processoId) semProcesso += 1

    const titulo = isAudiencia
      ? `${aud?.tipo_audiencia || item.titulo || 'Audiência'}${aud?.sala ? ` — Sala ${aud.sala}` : ''}`
      : String(item.titulo ?? 'Compromisso').trim() || 'Compromisso'
    const descricao = isAudiencia
      ? (aud?.status ? String(aud.status) : null)
      : (item.compromisso?.descricao ? String(item.compromisso.descricao) : null) ||
        (item.observacao ? String(item.observacao) : null)

    const texto = `${titulo} ${descricao ?? ''}`
    const resolved = resolver.resolve(texto, item.responsaveis)

    const dataInicio = parseDate(item.data_inicio)
    const prazoData = isAudiencia
      ? (parseDate(aud?.data_prevista) ?? dataInicio)
      : (parseDate(item.data_fatal) ?? parseDate(item.data_fim) ?? dataInicio)
    const status = isAudiencia
      ? mapSituacao(aud?.status, item.concluido ? 1 : 0)
      : mapSituacao(item.compromisso?.situacao, item.concluido ? 1 : 0)

    const tipo = isAudiencia
      ? 'Audiência'
      : String(
          (typeof item.tipo_compromisso === 'object' && item.tipo_compromisso?.nome) || 'Compromisso'
        )

    const existing = await prisma.tarefa.findUnique({
      where: { expeditId: externalId },
      select: { id: true, responsavelId: true },
    })

    const fields = {
      tipo,
      titulo: titulo.trim(),
      descricao,
      dataInicio,
      prazoData,
      status,
      processoId,
      concluidoEm: status === TarefaStatus.CONCLUIDO ? (prazoData ?? new Date()) : null,
    }

    const tarefa = await prisma.tarefa.upsert({
      where: { expeditId: externalId },
      create: {
        expeditId: externalId,
        criadoPorId: admin.id,
        responsavelId: resolved.id,
        semResponsavel: resolved.fallback,
        ...fields,
      },
      update: {
        ...fields,
        // Mesma regra do sync de 6h: só re-direciona com match explícito no
        // texto; preserva reatribuição manual; marca a fila de pré-triagem.
        ...(resolved.byTexto
          ? { responsavelId: resolved.byTexto, semResponsavel: false }
          : resolved.fallback && existing?.responsavelId === admin.id
            ? { semResponsavel: true }
            : {}),
      },
      select: { id: true },
    })

    if (existing) {
      tarefasAtualizadas += 1
    } else {
      tarefasCriadas += 1
      if (resolver.advogadoIds.has(resolved.id)) {
        await notificarTarefaDirecionada(prisma, {
          responsavelId: resolved.id,
          tarefaId: tarefa.id,
          titulo: fields.titulo,
          processoNumero: item.processo?.numero_processo ?? null,
        })
      }
    }
  }

  return {
    runId,
    phase: {
      coletados: itens.length,
      compromissos,
      audiencias,
      tarefasCriadas,
      tarefasAtualizadas,
      semProcesso,
    },
  }
}
