/**
 * Sincronização de intimações eletrônicas (módulo Atualizações › Intimações)
 * do Expedit (app-v2).
 *
 * Fonte distinta das publicações de diário: são expedientes capturados dos
 * sistemas dos tribunais (Eproc etc.) e trazem data de ciência e data limite
 * de manifestação. Upsert idempotente por `externalId` (= `expedit-int:{id}`).
 *
 * O vínculo com `Processo` tenta primeiro o `processo_id` do Expedit
 * (Processo.expeditId) e cai para o número CNJ; como nas publicações,
 * intimações de processos não cadastrados são gravadas sem vínculo.
 */
import { randomUUID } from 'node:crypto'

import type { PrismaClient } from '@prisma/client'

import type { ExpeditClient } from '@/lib/expedit/expedit-client'
import { parseExpeditDate } from '@/lib/pipeline/sync-publicacoes-expedit'

export type IntimacoesSyncCounters = {
  collected: number
  intimacoesCriadas: number
  intimacoesAtualizadas: number
  ignoradas: number
  vinculadasAProcesso: number
}

export type IntimacoesSyncResult = {
  runId: string
  phase: IntimacoesSyncCounters
}

export const syncIntimacoesExpedit = async (
  prisma: PrismaClient,
  client: ExpeditClient
): Promise<IntimacoesSyncResult> => {
  const runId = randomUUID()

  let intimacoesCriadas = 0
  let intimacoesAtualizadas = 0
  let ignoradas = 0
  let vinculadasAProcesso = 0

  const itens = await client.listAllIntimacoes()

  // Cache (expeditId | numero) → processoId | null
  const processoCache = new Map<string, string | null>()
  const resolveProcesso = async (
    expeditId: string,
    numero: string
  ): Promise<string | null> => {
    const key = expeditId || numero
    if (!key) return null
    if (processoCache.has(key)) return processoCache.get(key)!
    const found = expeditId
      ? await prisma.processo.findUnique({ where: { expeditId }, select: { id: true } })
      : null
    const byNumero =
      !found && numero
        ? await prisma.processo.findUnique({ where: { numero }, select: { id: true } })
        : null
    const id = found?.id ?? byNumero?.id ?? null
    processoCache.set(key, id)
    return id
  }

  for (const item of itens) {
    const rawId = item.id != null ? String(item.id).trim() : ''
    const numProcesso = String(item.numero_processo ?? '').trim()
    if (!rawId || !numProcesso) {
      ignoradas += 1
      continue
    }
    const externalId = `expedit-int:${rawId}`
    const expeditProcessoId = item.processo_id != null ? String(item.processo_id) : ''
    const processoId = await resolveProcesso(expeditProcessoId, numProcesso)

    const dataFields = {
      processoId,
      numProcesso,
      evento: item.intimacao ? String(item.intimacao).trim() : null,
      orgao: item.orgao ? String(item.orgao).trim() : null,
      partes: item.partes ? String(item.partes).trim() : null,
      destinatario: item.destinatario ? String(item.destinatario).trim() : null,
      sistema: item.descricao ? String(item.descricao).trim() : null,
      dataExpediente: parseExpeditDate(item.data_expediente),
      dataCiencia: parseExpeditDate(item.data_ciencia),
      dataLimite: parseExpeditDate(item.data_limite),
      linkExpediente: item.link_expediente ? String(item.link_expediente).trim() : null,
    }

    const existing = await prisma.intimacao.findUnique({
      where: { externalId },
      select: { id: true },
    })

    // No update NÃO tocamos em `status` (triagem local) — só nos dados de origem.
    await prisma.intimacao.upsert({
      where: { externalId },
      create: { externalId, ...dataFields },
      update: dataFields,
    })

    if (existing) intimacoesAtualizadas += 1
    else intimacoesCriadas += 1
    if (processoId) vinculadasAProcesso += 1
  }

  return {
    runId,
    phase: {
      collected: itens.length,
      intimacoesCriadas,
      intimacoesAtualizadas,
      ignoradas,
      vinculadasAProcesso,
    },
  }
}
