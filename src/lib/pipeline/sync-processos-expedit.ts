/**
 * Importação de processos do Expedit.
 *
 * Pagina a listagem de processos do Expedit e, para cada um, garante o Cliente
 * (derivado dos nomes retornados; fallback "Não classificado") e faz upsert do
 * Processo. A idempotência usa `expeditId` quando disponível e cai para o número
 * CNJ (`numero`, único no schema) — assim um processo já cadastrado por outra
 * fonte (E-PROC) é vinculado em vez de duplicado.
 */
import type { PrismaClient } from '@prisma/client'

import type { ExpeditClient } from '@/lib/expedit/expedit-client'
import type { ExpeditProcesso } from '@/lib/expedit/expedit-types'

export type ProcessosSyncCounters = {
  collected: number
  clientesCriados: number
  processosCriados: number
  processosAtualizados: number
  ignorados: number
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
  String(p.numeroCNJ ?? p.numero_cnj ?? p.numero ?? '').trim()

const pickExpeditId = (p: ExpeditProcesso): string | null => {
  const id = p.id
  if (id === undefined || id === null || id === '') return null
  return String(id)
}

const pickClienteNome = (p: ExpeditProcesso): string => {
  const raw = String(p.nomeClientes ?? p.nome_clientes ?? p.parte_principal ?? '').trim()
  if (!raw) return CLIENTE_FALLBACK
  // Pode vir uma lista separada por vírgula/";" — usa o primeiro nome.
  const first = raw.split(/\s*[;,]\s*/)[0]?.trim()
  return first || CLIENTE_FALLBACK
}

const pickEsfera = (p: ExpeditProcesso): string | null => {
  const e = String(p.esfera ?? p.esfera_diario ?? '').trim()
  return e || null
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
    const tribunal = normalizeTribunal(String(p.tribunal ?? p.origem ?? ''))
    const esfera = pickEsfera(p)
    const vara = (typeof p.vara === 'string' && p.vara.trim()) || null
    const area = (typeof p.area === 'string' && p.area.trim()) || null

    const existing = await prisma.processo.findUnique({
      where: { numero },
      select: { id: true },
    })

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
      processosAtualizados += 1
      continue
    }

    const clienteId = await ensureCliente(pickClienteNome(p))
    await prisma.processo.create({
      data: {
        numero,
        expeditId,
        tribunal,
        esfera,
        vara,
        area,
        clienteId,
      },
    })
    processosCriados += 1
  }

  return {
    phase: {
      collected: processos.length,
      clientesCriados,
      processosCriados,
      processosAtualizados,
      ignorados,
    },
  }
}
