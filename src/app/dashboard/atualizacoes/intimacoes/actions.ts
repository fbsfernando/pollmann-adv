"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireGestao } from "@/lib/auth/guards"
import { notificarTarefaDirecionada } from "@/lib/notificacoes"
import { espelharTarefaCriada } from "@/lib/expedit/expedit-agenda-writeback"
import { PublicacaoStatus, Role, TarefaStatus, Prisma } from "@prisma/client"
import { periodoRange, PERIODOS, type Periodo } from "../periodo"
import { INTIMACOES_PAGE_SIZE } from "./constants"

export type IntimacoesFilters = {
  status?: string
  search?: string
  periodo?: Periodo
  page?: number
}

const buildWhere = (filters?: IntimacoesFilters): Prisma.IntimacaoWhereInput => {
  const where: Prisma.IntimacaoWhereInput = {}

  // Default: mostra apenas pendentes quando nenhum status é informado.
  if (filters?.status) {
    if (filters.status !== "TODAS") where.status = filters.status as PublicacaoStatus
  } else {
    where.status = PublicacaoStatus.PENDENTE
  }

  // Período por data de ciência (é o que dispara o prazo de manifestação).
  const range = filters?.periodo ? periodoRange(filters.periodo) : null
  if (range) where.dataCiencia = range

  if (filters?.search) {
    const search = filters.search.slice(0, 100)
    where.OR = [
      { numProcesso: { contains: search, mode: "insensitive" } },
      { partes: { contains: search, mode: "insensitive" } },
      { destinatario: { contains: search, mode: "insensitive" } },
      { orgao: { contains: search, mode: "insensitive" } },
    ]
  }

  return where
}

export async function getIntimacoes(filters?: IntimacoesFilters) {
  await requireGestao()

  const where = buildWhere(filters)
  const page = Math.max(1, filters?.page ?? 1)

  const [items, total] = await Promise.all([
    prisma.intimacao.findMany({
      where,
      skip: (page - 1) * INTIMACOES_PAGE_SIZE,
      take: INTIMACOES_PAGE_SIZE,
      // Mais urgente primeiro: prazo limite mais próximo; sem limite vai pro fim.
      orderBy: [{ dataLimite: { sort: "asc", nulls: "last" } }, { dataCiencia: "desc" }],
      include: {
        processo: { select: { id: true, numero: true, cliente: { select: { nome: true } } } },
      },
    }),
    prisma.intimacao.count({ where }),
  ])

  return { items, total, page, pageSize: INTIMACOES_PAGE_SIZE }
}

/** Contagem de PENDENTES por período de ciência (cards de período). */
export async function getPeriodoCountsIntimacoes(): Promise<Record<Periodo, number>> {
  await requireGestao()
  const counts = await Promise.all(
    PERIODOS.map((p) => {
      const range = periodoRange(p.value)
      return prisma.intimacao.count({
        where: {
          status: PublicacaoStatus.PENDENTE,
          ...(range ? { dataCiencia: range } : {}),
        },
      })
    })
  )
  return Object.fromEntries(PERIODOS.map((p, i) => [p.value, counts[i]])) as Record<
    Periodo,
    number
  >
}

const tratarSchema = z.object({
  intimacaoId: z.string().min(1, "Intimação inválida"),
  tipo: z.string().min(1, "Tipo é obrigatório"),
  responsavelId: z.string().min(1, "Responsável é obrigatório"),
  dataInicio: z.string().optional().nullable(),
  prazoData: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
})

const parseDate = (raw?: string | null): Date | null => {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function tratarIntimacao(formData: FormData) {
  const session = await requireGestao()

  const parsed = tratarSchema.safeParse({
    intimacaoId: formData.get("intimacaoId"),
    tipo: formData.get("tipo"),
    responsavelId: formData.get("responsavelId"),
    dataInicio: (formData.get("dataInicio") as string) || null,
    prazoData: (formData.get("prazoData") as string) || null,
    observacao: (formData.get("observacao") as string) || null,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  const { intimacaoId, tipo, responsavelId, dataInicio, prazoData, observacao } = parsed.data

  const intimacao = await prisma.intimacao.findUnique({
    where: { id: intimacaoId },
    select: { id: true, numProcesso: true, processoId: true, dataLimite: true },
  })
  if (!intimacao) return { error: "Intimação não encontrada" }

  const responsavel = await prisma.user.findFirst({
    where: { id: responsavelId, role: Role.ADVOGADO },
    select: { id: true },
  })
  if (!responsavel) return { error: "Responsável inválido" }

  const inicio = parseDate(dataInicio)
  // Prazo: o informado no form; se vazio, cai na data limite da própria intimação.
  const prazo = parseDate(prazoData) ?? intimacao.dataLimite

  try {
    const novaTarefa = await prisma.$transaction(async (tx) => {
      const t = await tx.tarefa.create({
        data: {
          tipo,
          titulo: `${tipo} — processo ${intimacao.numProcesso}`,
          descricao: observacao,
          dataInicio: inicio,
          prazoData: prazo,
          status: TarefaStatus.PENDENTE,
          processoId: intimacao.processoId,
          intimacaoId: intimacao.id,
          responsavelId,
          criadoPorId: session.user.id,
        },
        select: { id: true, titulo: true },
      })

      await tx.intimacao.update({
        where: { id: intimacao.id },
        data: { status: PublicacaoStatus.TRATADA },
      })

      return t
    })

    await notificarTarefaDirecionada(prisma, {
      responsavelId,
      tarefaId: novaTarefa.id,
      titulo: novaTarefa.titulo,
      processoNumero: intimacao.numProcesso,
    })

    // Espelha o prazo como compromisso na agenda do Expedit (best-effort).
    if (prazo) await espelharTarefaCriada(prisma, novaTarefa.id)

    revalidatePath("/dashboard/atualizacoes/intimacoes")
    revalidatePath("/dashboard/agenda")
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown-error"
    console.error("[tratarIntimacao] failed", { intimacaoId, error: msg })
    return { error: "Erro ao tratar intimação" }
  }
}

/** Triagem rápida: marca como tratada SEM criar tarefa. */
export async function marcarIntimacaoTratada(id: string) {
  await requireGestao()
  const intimacaoId = id.trim()
  if (!intimacaoId) return { error: "Intimação inválida" }

  try {
    await prisma.intimacao.update({
      where: { id: intimacaoId },
      data: { status: PublicacaoStatus.TRATADA },
    })
    revalidatePath("/dashboard/atualizacoes/intimacoes")
    return { success: true }
  } catch {
    return { error: "Erro ao marcar como tratada" }
  }
}

export async function descartarIntimacao(id: string) {
  await requireGestao()
  const intimacaoId = id.trim()
  if (!intimacaoId) return { error: "Intimação inválida" }

  try {
    await prisma.intimacao.update({
      where: { id: intimacaoId },
      data: { status: PublicacaoStatus.DESCARTADA },
    })
    revalidatePath("/dashboard/atualizacoes/intimacoes")
    return { success: true }
  } catch {
    return { error: "Erro ao descartar intimação" }
  }
}
