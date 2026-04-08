import type { PrismaClient } from '@prisma/client'

import { normalizeExternalAndamento } from '@/lib/scraper/eproc-client'
import type { DiffResult, ExternalAndamentoInput, InvalidExternalItem, NormalizedAndamento } from '@/lib/pipeline/types'

const getInvalidReason = (item: ExternalAndamentoInput): InvalidExternalItem['reason'] => {
  const externalId = String(item.externalId ?? '').trim()
  const processoNumero = String(item.processoNumero ?? '').trim()
  const descricao = String(item.descricao ?? '').trim()
  const data = new Date(item.dataIso)

  if (!externalId) return 'missing-external-id'
  if (!processoNumero) return 'missing-processo-numero'
  if (!descricao) return 'missing-descricao'
  if (Number.isNaN(data.getTime())) return 'invalid-date'

  return 'invalid-date'
}

export const detectNewItems = async (
  prisma: PrismaClient,
  items: ExternalAndamentoInput[]
): Promise<DiffResult> => {
  const invalid: InvalidExternalItem[] = []
  const valid: NormalizedAndamento[] = []

  for (const item of items) {
    const normalized = normalizeExternalAndamento(item)
    if (!normalized) {
      invalid.push({ item, reason: getInvalidReason(item) })
      continue
    }
    valid.push(normalized)
  }

  const processosNumeros = [...new Set(valid.map((item) => item.processoNumero))]
  const andamentoExternalIds = [...new Set(valid.map((item) => item.externalId))]

  const [processos, existingAndamentos] = await Promise.all([
    prisma.processo.findMany({
      where: { numero: { in: processosNumeros } },
      select: { id: true, numero: true },
    }),
    prisma.andamento.findMany({
      where: { externalId: { in: andamentoExternalIds } },
      select: { externalId: true },
    }),
  ])

  const processoByNumero = new Map(processos.map((p) => [p.numero, p.id]))
  const existingIds = new Set(existingAndamentos.map((a) => a.externalId))

  const candidates = [] as DiffResult['candidates']
  let skippedUnknownProcesso = 0

  for (const andamento of valid) {
    if (existingIds.has(andamento.externalId)) continue

    const processoId = processoByNumero.get(andamento.processoNumero)
    if (!processoId) {
      skippedUnknownProcesso += 1
      continue
    }

    candidates.push({ processoId, andamento })
  }

  return {
    candidates,
    skippedUnknownProcesso,
    skippedInvalid: invalid,
  }
}
