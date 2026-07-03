"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireGestao } from "@/lib/auth/guards"
import { notificarTarefaDirecionada } from "@/lib/notificacoes"
import { PublicacaoStatus, Role, TarefaStatus, Prisma } from "@prisma/client"

export async function getPublicacoes(filters?: {
  status?: string
  diario?: string
  search?: string
}) {
  await requireGestao()

  const where: Prisma.PublicacaoWhereInput = {}

  // Default: mostra apenas pendentes quando nenhum status é informado.
  if (filters?.status) {
    if (filters.status !== "TODAS") where.status = filters.status as PublicacaoStatus
  } else {
    where.status = PublicacaoStatus.PENDENTE
  }

  if (filters?.diario) where.siglaDiario = filters.diario
  if (filters?.search) {
    const search = filters.search.slice(0, 100)
    where.OR = [
      { numProcesso: { contains: search, mode: "insensitive" } },
      { conteudo: { contains: search, mode: "insensitive" } },
    ]
  }

  return prisma.publicacao.findMany({
    where,
    take: 300,
    orderBy: { dataPublicacao: "desc" },
    include: {
      processo: { select: { id: true, numero: true, cliente: { select: { nome: true } } } },
    },
  })
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
    select: { id: true, numProcesso: true, processoId: true, status: true },
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

    revalidatePath("/dashboard/atualizacoes/publicacoes")
    revalidatePath("/dashboard/agenda")
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown-error"
    console.error("[tratarPublicacao] failed", { publicacaoId, error: msg })
    return { error: "Erro ao tratar publicação" }
  }
}

export async function descartarPublicacao(id: string) {
  await requireGestao()
  const publicacaoId = id.trim()
  if (!publicacaoId) return { error: "Publicação inválida" }

  try {
    await prisma.publicacao.update({
      where: { id: publicacaoId },
      data: { status: PublicacaoStatus.DESCARTADA },
    })
    revalidatePath("/dashboard/atualizacoes/publicacoes")
    return { success: true }
  } catch {
    return { error: "Erro ao descartar publicação" }
  }
}
