/**
 * Importação de processos via API REST oficial do Expedit (`/api/processos`).
 *
 * Pagina `listarProcessos`, garante o Cliente e faz upsert do Processo (idempotente
 * por `expeditId` = id do ProcessoDTO, com fallback no número CNJ). Registra a
 * última movimentação como Andamento — o histórico completo é sincronizado à parte
 * por `sync-detalhes-expedit` (que usa o endpoint de andamentos por processo).
 *
 * O ProcessoDTO não traz o cliente diretamente (o campo `nome` é o nome de busca,
 * tipicamente o advogado). Para processos NOVOS buscamos `dados-basicos` (campo
 * `partes`) para derivar o cliente; processos já existentes preservam o cliente.
 */
import { FonteAndamento, type PrismaClient } from '@prisma/client'

import type { ExpeditApiClient } from '@/lib/expedit/expedit-api-client'
import type { ProcessoDTO } from '@/lib/expedit/expedit-api-types'

export type ProcessosSyncCounters = {
  collected: number
  clientesCriados: number
  processosCriados: number
  processosAtualizados: number
  ignorados: number
  andamentosRegistrados: number
}

export type ProcessosSyncResult = {
  phase: ProcessosSyncCounters
}

const CLIENTE_FALLBACK = 'Não classificado'

/** Mapeia a descrição do tribunal do Expedit para a sigla usada no app. */
export const normalizeTribunal = (raw?: string): string => {
  if (!raw) return 'OUTRO'
  const m = raw.toUpperCase().match(/\b(TJ[A-Z]{2}|TRT\d{1,2}|TRF\d|JF[A-Z]{2}|STJ|STF|TST)\b/)
  return m?.[1] ?? 'OUTRO'
}

/** Esfera a partir da descrição/ramo do tribunal. */
const inferEsfera = (descricao?: string): string | null => {
  const d = (descricao ?? '').toUpperCase()
  if (/TRT|TST|TRABALH/.test(d)) return 'Justiça do Trabalho'
  if (/TRF|\bJF[A-Z]{2}|FEDERAL/.test(d)) return 'Justiça Federal'
  if (/TJ[A-Z]{2}|ESTADUAL/.test(d)) return 'Justiça Estadual'
  return null
}

/** Primeiro nome de uma string "Autor x Réu" / lista separada por vírgula. */
const primeiroNome = (raw?: string): string => {
  const s = String(raw ?? '').trim()
  if (!s) return CLIENTE_FALLBACK
  return s.split(/\s+x\s+/i)[0]?.split(/\s*[;,]\s*/)[0]?.trim() || CLIENTE_FALLBACK
}

const parseMovDate = (raw?: string): Date | null => {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

export const syncProcessosExpedit = async (
  prisma: PrismaClient,
  client: ExpeditApiClient,
  opts?: { tamanho?: number }
): Promise<ProcessosSyncResult> => {
  const processos = await client.listAllProcessos({ tamanho: opts?.tamanho ?? 100 })

  let clientesCriados = 0
  let processosCriados = 0
  let processosAtualizados = 0
  let ignorados = 0
  let andamentosRegistrados = 0

  const clienteIdByNome = new Map<string, string>()
  const ensureCliente = async (nome: string): Promise<string> => {
    const cached = clienteIdByNome.get(nome)
    if (cached) return cached
    const existing = await prisma.cliente.findFirst({ where: { nome }, select: { id: true } })
    if (existing) {
      clienteIdByNome.set(nome, existing.id)
      return existing.id
    }
    const created = await prisma.cliente.create({ data: { nome }, select: { id: true } })
    clientesCriados += 1
    clienteIdByNome.set(nome, created.id)
    return created.id
  }

  for (const p of processos as ProcessoDTO[]) {
    const numero = String(p.numeroProcesso ?? '').trim()
    if (!numero) {
      ignorados += 1
      continue
    }

    const expeditId = p.id != null ? String(p.id) : null
    const tribunalDesc = p.tribunal?.descricao
    const tribunal = normalizeTribunal(tribunalDesc)
    const esfera = inferEsfera(tribunalDesc)

    // Enriquecimento do ProcessoDTO (fase, flags, assuntos, marcadores).
    const fase = p.fase ? String(p.fase) : null
    const segredoJustica = Number(p.segredoJustica) === 1
    const possivelBaixa = Number(p.possivelBaixa) === 1
    const assuntos = (p.assuntos ?? [])
      .map((a) => String(a?.nome ?? '').trim())
      .filter(Boolean)
    const marcadores = (p.marcadores ?? [])
      .map((m) => ({ nome: String(m?.nome ?? '').trim(), cor: m?.cor ? String(m.cor) : null }))
      .filter((m) => m.nome)
    const marcadorNomes = marcadores.map((m) => m.nome)
    const enriquecimento = { fase, segredoJustica, possivelBaixa, assuntos, marcadores, marcadorNomes }

    const existing = await prisma.processo.findUnique({ where: { numero }, select: { id: true } })

    let processoId: string
    if (existing) {
      await prisma.processo.update({
        where: { id: existing.id },
        data: {
          expeditId: expeditId ?? undefined,
          tribunal,
          esfera: esfera ?? undefined,
          ...enriquecimento,
        },
      })
      processoId = existing.id
      processosAtualizados += 1
    } else {
      // Deriva o cliente das partes (dados-básicos) só para processos novos.
      let clienteNome = CLIENTE_FALLBACK
      if (p.id != null) {
        try {
          const dados = await client.getDadosBasicos(p.id)
          const partes = dados.find((d) => d.partes)?.partes
          if (partes) clienteNome = primeiroNome(partes)
        } catch {
          // mantém fallback
        }
      }
      const clienteId = await ensureCliente(clienteNome)
      const created = await prisma.processo.create({
        data: { numero, expeditId, tribunal, esfera, clienteId, ...enriquecimento },
        select: { id: true },
      })
      processoId = created.id
      processosCriados += 1
    }

    // Última movimentação → Andamento (idempotente por processo+timestamp).
    const movData = parseMovDate(p.ultimaMovimentacao)
    const movDesc = String(p.descricaoUltimaMovimentacao ?? '').trim()
    if (movData && movDesc && (expeditId || numero)) {
      const externalId = `expedit-mov:${expeditId ?? numero}:${movData.toISOString()}`
      await prisma.andamento.upsert({
        where: { externalId },
        create: {
          processoId,
          externalId,
          data: movData,
          tipo: 'Movimentação',
          descricao: movDesc,
          fonte: FonteAndamento.EXPEDIT,
        },
        update: { descricao: movDesc },
      })
      andamentosRegistrados += 1
    }
  }

  return {
    phase: {
      collected: processos.length,
      clientesCriados,
      processosCriados,
      processosAtualizados,
      ignorados,
      andamentosRegistrados,
    },
  }
}
