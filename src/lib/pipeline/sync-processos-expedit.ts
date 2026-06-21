/**
 * Importação de processos do Expedit.
 *
 * Pagina a listagem de processos do Expedit e, para cada um, garante o Cliente
 * (derivado dos nomes retornados; fallback "Não classificado") e faz upsert do
 * Processo. A idempotência usa `expeditId` quando disponível e cai para o número
 * CNJ (`numero`, único no schema) — assim um processo já cadastrado por outra
 * fonte (E-PROC) é vinculado em vez de duplicado.
 */
import { FonteAndamento, type PrismaClient } from '@prisma/client'

import type { ExpeditClient } from '@/lib/expedit/expedit-client'
import type { ExpeditProcesso } from '@/lib/expedit/expedit-types'

export type ProcessosSyncCounters = {
  collected: number
  clientesCriados: number
  processosCriados: number
  processosAtualizados: number
  ignorados: number
  /** Andamentos (última movimentação) registrados/acumulados a partir da listagem. */
  andamentosRegistrados: number
}

export type ProcessosSyncResult = {
  phase: ProcessosSyncCounters
}

const CLIENTE_FALLBACK = 'Não classificado'

/** Mapeia uma origem do Expedit para a sigla de tribunal usada no app. */
export const normalizeTribunal = (raw?: string): string => {
  if (!raw) return 'OUTRO'
  // Ex.: "TJSC 1° Grau - Eproc" → "TJSC"; "TRT12 - PJe" → "TRT12".
  const m = raw.toUpperCase().match(/\b(TJ[A-Z]{2}|TRT\d{1,2}|TRF\d|JF[A-Z]{2}|STJ|STF|TST)\b/)
  return m?.[1] ?? 'OUTRO'
}

const pickNumero = (p: ExpeditProcesso): string =>
  String(p.numeroProcesso ?? p.numeroCNJ ?? p.numero_cnj ?? p.numero ?? '').trim()

/** Tribunal vem como objeto `{id, descricao}` na listagem, ou string em outras telas. */
const pickTribunalRaw = (p: ExpeditProcesso): string => {
  const t = p.tribunal
  if (t && typeof t === 'object') return String(t.descricao ?? '')
  return String(t ?? p.origem ?? '')
}

const pickExpeditId = (p: ExpeditProcesso): string | null => {
  const id = p.id
  if (id === undefined || id === null || id === '') return null
  return String(id)
}

const pickClienteNome = (p: ExpeditProcesso): string => {
  // Listagem `/processos/dados` traz `partes` ("Autor x Réu"); o detalhe traz nomeClientes.
  const raw = String(
    p.nomeClientes ?? p.nome_clientes ?? p.parte_principal ?? p.partes ?? ''
  ).trim()
  if (!raw) return CLIENTE_FALLBACK
  // Usa o primeiro nome: separa por " x " (partes) e por vírgula/";" (listas).
  const first = raw.split(/\s+x\s+/i)[0]?.split(/\s*[;,]\s*/)[0]?.trim()
  return first || CLIENTE_FALLBACK
}

const pickEsfera = (p: ExpeditProcesso): string | null => {
  const e = String(p.esfera ?? p.esfera_diario ?? '').trim()
  return e || null
}

/** Converte "YYYY-MM-DD HH:mm:ss" (ou ISO) em Date; null se inválida/ausente. */
const parseMovDate = (raw?: string): Date | null => {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const iso = s.includes('T') ? s : s.replace(' ', 'T')
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export const syncProcessosExpedit = async (
  prisma: PrismaClient,
  client: ExpeditClient,
  opts?: { status?: string; limit?: number }
): Promise<ProcessosSyncResult> => {
  const processos = await client.listAllProcessos({
    status: opts?.status ?? 'ATIVOS',
    limit: opts?.limit ?? 100,
  })

  let clientesCriados = 0
  let processosCriados = 0
  let processosAtualizados = 0
  let ignorados = 0
  let andamentosRegistrados = 0

  // Cache de clientes por nome dentro da run (Cliente.nome não é único no schema).
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

  for (const p of processos) {
    const numero = pickNumero(p)
    if (!numero) {
      ignorados += 1
      continue
    }

    const expeditId = pickExpeditId(p)
    const tribunal = normalizeTribunal(pickTribunalRaw(p))
    const esfera = pickEsfera(p)
    const vara =
      (typeof p.vara === 'string' && p.vara.trim()) ||
      (typeof p.orgao === 'string' && p.orgao.trim()) ||
      null
    const area = (typeof p.area === 'string' && p.area.trim()) || null

    const existing = await prisma.processo.findUnique({
      where: { numero },
      select: { id: true },
    })

    let processoId: string
    if (existing) {
      await prisma.processo.update({
        where: { id: existing.id },
        data: {
          expeditId: expeditId ?? undefined,
          tribunal,
          esfera: esfera ?? undefined,
          vara: vara ?? undefined,
          area: area ?? undefined,
        },
      })
      processoId = existing.id
      processosAtualizados += 1
    } else {
      const clienteId = await ensureCliente(pickClienteNome(p))
      const created = await prisma.processo.create({
        data: { numero, expeditId, tribunal, esfera, vara, area, clienteId },
        select: { id: true },
      })
      processoId = created.id
      processosCriados += 1
    }

    // Registra a última movimentação como Andamento. O Expedit v2 não expõe a
    // timeline completa por processo (só a última), então o sync periódico
    // ACUMULA novas movimentações ao longo do tempo. Idempotente por externalId
    // (processo + timestamp da movimentação) — repetir o sync não duplica.
    const movData = parseMovDate(p.ultimaMovimentacao)
    const movDesc = String(p.ultimaMovimentacaoDesc ?? '').trim()
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
