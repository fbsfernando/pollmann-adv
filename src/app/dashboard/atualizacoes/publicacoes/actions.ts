"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireGestao } from "@/lib/auth/guards"
import { notificarTarefaDirecionada } from "@/lib/notificacoes"
import {
  espelharPublicacaoTratada,
  espelharPublicacaoDescartada,
} from "@/lib/expedit/expedit-writeback"
import { PublicacaoStatus, Role, TarefaStatus, Prisma } from "@prisma/client"
import { periodoRange, toIsoDay, PERIODOS, type Periodo } from "../periodo"
import { PUBLICACOES_PAGE_SIZE } from "./constants"

export type PublicacoesFilters = {
  status?: string
  diario?: string
  search?: string
  periodo?: Periodo
  /** Dia da edição ("YYYY-MM-DD") — usado no drill-down por diário. */
  dia?: string
  page?: number
}

const parseDia = (dia?: string): { gte: Date; lt: Date } | null => {
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null
  const gte = new Date(`${dia}T00:00:00.000Z`)
  if (Number.isNaN(gte.getTime())) return null
  const lt = new Date(gte)
  lt.setUTCDate(lt.getUTCDate() + 1)
  return { gte, lt }
}

const buildWhere = (filters?: PublicacoesFilters): Prisma.PublicacaoWhereInput => {
  const where: Prisma.PublicacaoWhereInput = {}

  // Default: mostra apenas pendentes quando nenhum status é informado.
  if (filters?.status) {
    if (filters.status !== "TODAS") where.status = filters.status as PublicacaoStatus
  } else {
    where.status = PublicacaoStatus.PENDENTE
  }

  if (filters?.diario) where.siglaDiario = filters.diario

  const dia = parseDia(filters?.dia)
  const range = dia ?? (filters?.periodo ? periodoRange(filters.periodo) : null)
  if (range) where.dataPublicacao = range

  if (filters?.search) {
    const search = filters.search.slice(0, 100)
    where.OR = [
      { numProcesso: { contains: search, mode: "insensitive" } },
      { conteudo: { contains: search, mode: "insensitive" } },
    ]
  }

  return where
}

export async function getPublicacoes(filters?: PublicacoesFilters) {
  await requireGestao()

  const where = buildWhere(filters)
  const page = Math.max(1, filters?.page ?? 1)

  const [items, total] = await Promise.all([
    prisma.publicacao.findMany({
      where,
      skip: (page - 1) * PUBLICACOES_PAGE_SIZE,
      take: PUBLICACOES_PAGE_SIZE,
      orderBy: { dataPublicacao: "desc" },
      include: {
        processo: { select: { id: true, numero: true, cliente: { select: { nome: true } } } },
      },
    }),
    prisma.publicacao.count({ where }),
  ])

  return { items, total, page, pageSize: PUBLICACOES_PAGE_SIZE }
}

/** Contagem de PENDENTES por período (cards de período, padrão Expedit). */
export async function getPeriodoCounts(): Promise<Record<Periodo, number>> {
  await requireGestao()
  const counts = await Promise.all(
    PERIODOS.map((p) => {
      const range = periodoRange(p.value)
      return prisma.publicacao.count({
        where: {
          status: PublicacaoStatus.PENDENTE,
          ...(range ? { dataPublicacao: range } : {}),
        },
      })
    })
  )
  return Object.fromEntries(PERIODOS.map((p, i) => [p.value, counts[i]])) as Record<
    Periodo,
    number
  >
}

export type Edicao = {
  dia: string // "YYYY-MM-DD"
  siglaDiario: string | null
  nomeDiario: string | null
  uf: string | null
  total: number
  pendentes: number
  tratadas: number
  descartadas: number
}

/**
 * Edições de diário (dia de publicação + diário) com progresso de tratamento —
 * a visão principal do Expedit ("TJRS 09/07 — Pendente 0/5").
 */
export async function getEdicoes(periodo?: Periodo): Promise<Edicao[]> {
  await requireGestao()

  const range = periodo ? periodoRange(periodo) : null
  const rows = await prisma.publicacao.findMany({
    where: range ? { dataPublicacao: range } : {},
    select: {
      siglaDiario: true,
      nomeDiario: true,
      uf: true,
      dataPublicacao: true,
      status: true,
    },
    orderBy: { dataPublicacao: "desc" },
    take: 5000,
  })

  const map = new Map<string, Edicao>()
  for (const r of rows) {
    const dia = toIsoDay(r.dataPublicacao)
    const key = `${dia}|${r.siglaDiario ?? ""}`
    let e = map.get(key)
    if (!e) {
      e = {
        dia,
        siglaDiario: r.siglaDiario,
        nomeDiario: r.nomeDiario,
        uf: r.uf,
        total: 0,
        pendentes: 0,
        tratadas: 0,
        descartadas: 0,
      }
      map.set(key, e)
    }
    e.total += 1
    if (r.status === PublicacaoStatus.PENDENTE) e.pendentes += 1
    else if (r.status === PublicacaoStatus.TRATADA) e.tratadas += 1
    else e.descartadas += 1
  }

  return Array.from(map.values()).sort(
    (a, b) => b.dia.localeCompare(a.dia) || (a.siglaDiario ?? "").localeCompare(b.siglaDiario ?? "")
  )
}

/** Diários distintos presentes nas publicações, para popular o filtro. */
export async function getDiarios(): Promise<string[]> {
  await requireGestao()
  const rows = await prisma.publicacao.findMany({
    where: { siglaDiario: { not: null } },
    distinct: ["siglaDiario"],
    select: { siglaDiario: true },
    orderBy: { siglaDiario: "asc" },
  })
  return rows.map((r) => r.siglaDiario).filter((s): s is string => !!s)
}

export async function getAdvogados() {
  await requireGestao()
  return prisma.user.findMany({
    where: { role: Role.ADVOGADO, ativo: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  })
}

const tratarSchema = z.object({
  publicacaoId: z.string().min(1, "Publicação inválida"),
  tipo: z.string().min(1, "Tipo é obrigatório"),
  responsavelId: z.string().min(1, "Responsável é obrigatório"),
  dataInicio: z.string().optional().nullable(),
  prazoDias: z.coerce.number().int().min(0).max(3650).optional(),
  observacao: z.string().optional().nullable(),
})

export async function tratarPublicacao(formData: FormData) {
  const session = await requireGestao()

  const parsed = tratarSchema.safeParse({
    publicacaoId: formData.get("publicacaoId"),
    tipo: formData.get("tipo"),
    responsavelId: formData.get("responsavelId"),
    dataInicio: (formData.get("dataInicio") as string) || null,
    prazoDias: formData.get("prazoDias") || undefined,
    observacao: (formData.get("observacao") as string) || null,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  const { publicacaoId, tipo, responsavelId, dataInicio, prazoDias, observacao } = parsed.data

  const publicacao = await prisma.publicacao.findUnique({
    where: { id: publicacaoId },
    select: { id: true, numProcesso: true, processoId: true, status: true, expeditRef: true },
  })
  if (!publicacao) return { error: "Publicação não encontrada" }

  // Confirma que o responsável é um advogado válido.
  const responsavel = await prisma.user.findFirst({
    where: { id: responsavelId, role: Role.ADVOGADO },
    select: { id: true },
  })
  if (!responsavel) return { error: "Responsável inválido" }

  const inicio = dataInicio ? new Date(dataInicio) : null
  const base = inicio && !Number.isNaN(inicio.getTime()) ? inicio : new Date()
  const prazoData =
    typeof prazoDias === "number"
      ? new Date(base.getTime() + prazoDias * 24 * 60 * 60 * 1000)
      : null

  try {
    const novaTarefa = await prisma.$transaction(async (tx) => {
      const t = await tx.tarefa.create({
        data: {
          tipo,
          titulo: `${tipo} — processo ${publicacao.numProcesso}`,
          descricao: observacao,
          dataInicio: inicio && !Number.isNaN(inicio.getTime()) ? inicio : null,
          prazoData,
          status: TarefaStatus.PENDENTE,
          processoId: publicacao.processoId,
          publicacaoId: publicacao.id,
          responsavelId,
          criadoPorId: session.user.id,
        },
        select: { id: true, titulo: true },
      })

      await tx.publicacao.update({
        where: { id: publicacao.id },
        data: { status: PublicacaoStatus.TRATADA },
      })

      return t
    })

    // Notifica o advogado responsável (já validado como ADVOGADO acima).
    await notificarTarefaDirecionada(prisma, {
      responsavelId,
      tarefaId: novaTarefa.id,
      titulo: novaTarefa.titulo,
      processoNumero: publicacao.numProcesso,
    })

    // Espelha no Expedit (best-effort; não bloqueia a triagem local).
    await espelharPublicacaoTratada(publicacao.expeditRef)

    revalidatePath("/dashboard/atualizacoes/publicacoes")
    revalidatePath("/dashboard/agenda")
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown-error"
    console.error("[tratarPublicacao] failed", { publicacaoId, error: msg })
    return { error: "Erro ao tratar publicação" }
  }
}

/** Triagem rápida: marca como tratada SEM criar tarefa (padrão Expedit). */
export async function marcarTratada(id: string) {
  await requireGestao()
  const publicacaoId = id.trim()
  if (!publicacaoId) return { error: "Publicação inválida" }

  try {
    const publicacao = await prisma.publicacao.update({
      where: { id: publicacaoId },
      data: { status: PublicacaoStatus.TRATADA },
      select: { expeditRef: true },
    })
    await espelharPublicacaoTratada(publicacao.expeditRef)
    revalidatePath("/dashboard/atualizacoes/publicacoes")
    return { success: true }
  } catch {
    return { error: "Erro ao marcar como tratada" }
  }
}

export async function descartarPublicacao(id: string) {
  await requireGestao()
  const publicacaoId = id.trim()
  if (!publicacaoId) return { error: "Publicação inválida" }

  try {
    const publicacao = await prisma.publicacao.update({
      where: { id: publicacaoId },
      data: { status: PublicacaoStatus.DESCARTADA },
      select: { expeditRef: true },
    })
    await espelharPublicacaoDescartada(publicacao.expeditRef)
    revalidatePath("/dashboard/atualizacoes/publicacoes")
    return { success: true }
  } catch {
    return { error: "Erro ao descartar publicação" }
  }
}
