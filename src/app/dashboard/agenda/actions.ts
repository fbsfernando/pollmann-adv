"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth/guards"
import { Role, TarefaStatus, Prisma } from "@prisma/client"

export async function getTarefas(filters?: {
  responsavelId?: string
  status?: string
  tipo?: string
  processoNumero?: string
  from?: Date
  to?: Date
  incluirConcluidas?: boolean
}) {
  const session = await requireAuth()

  const where: Prisma.TarefaWhereInput = {}

  // RBAC: ADVOGADO vê apenas as suas; ADMIN vê todas (com filtro opcional).
  if (session.user.role === Role.ADVOGADO) {
    where.responsavelId = session.user.id
  } else if (filters?.responsavelId) {
    where.responsavelId = filters.responsavelId
  }

  // Status específico tem prioridade; senão, abre só não-concluídas (a menos
  // que incluirConcluidas).
  const statusValido =
    !!filters?.status && (Object.values(TarefaStatus) as string[]).includes(filters.status)
  if (statusValido) {
    where.status = filters!.status as TarefaStatus
  } else if (!filters?.incluirConcluidas) {
    where.status = { in: [TarefaStatus.PENDENTE, TarefaStatus.EM_ANDAMENTO] }
  }

  if (filters?.tipo) where.tipo = filters.tipo
  if (filters?.processoNumero) {
    where.processo = { numero: { contains: filters.processoNumero, mode: "insensitive" } }
  }

  // Intervalo de datas (views de calendário): [from, to) por prazoData, com
  // fallback em dataInicio. `to` é exclusivo (fim do último dia da grade).
  if (filters?.from && filters?.to) {
    where.OR = [
      { prazoData: { gte: filters.from, lt: filters.to } },
      { AND: [{ prazoData: null }, { dataInicio: { gte: filters.from, lt: filters.to } }] },
    ]
  }

  return prisma.tarefa.findMany({
    where,
    take: 1000,
    orderBy: [{ prazoData: "asc" }, { createdAt: "desc" }],
    include: {
      processo: { select: { id: true, numero: true } },
      responsavel: { select: { id: true, name: true, email: true } },
      criadoPor: { select: { id: true, name: true } },
    },
  })
}

export async function getAdvogadosFiltro() {
  const session = await requireAuth()
  if (session.user.role !== Role.ADMIN) return []
  return prisma.user.findMany({
    where: { role: Role.ADVOGADO, ativo: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  })
}

/** Tipos de tarefa distintos (para o filtro), com escopo por papel. */
export async function getTiposTarefa(): Promise<string[]> {
  const session = await requireAuth()
  const where: Prisma.TarefaWhereInput = {}
  if (session.user.role === Role.ADVOGADO) where.responsavelId = session.user.id
  const rows = await prisma.tarefa.findMany({
    where,
    distinct: ["tipo"],
    select: { tipo: true },
    orderBy: { tipo: "asc" },
  })
  return rows.map((r) => r.tipo).filter(Boolean)
}

/**
 * Direciona (reatribui) uma tarefa a outro usuário. Só ADMIN (Richard) — é como
 * o trabalho importado do Expedit (sempre dele) é delegado aos advogados parceiros
 * na nossa plataforma. O sync de compromissos não sobrescreve o responsável, então
 * o direcionamento é preservado nos próximos ciclos.
 */
export async function direcionarTarefa(tarefaId: string, responsavelId: string) {
  const session = await requireAuth()
  if (session.user.role !== Role.ADMIN) return { error: "Acesso negado" }

  const id = tarefaId.trim()
  const respId = responsavelId.trim()
  if (!id || !respId) return { error: "Dados inválidos" }

  const responsavel = await prisma.user.findUnique({ where: { id: respId }, select: { id: true } })
  if (!responsavel) return { error: "Responsável inválido" }

  try {
    await prisma.tarefa.update({ where: { id }, data: { responsavelId: respId } })
    revalidatePath("/dashboard/agenda")
    return { success: true }
  } catch {
    return { error: "Erro ao direcionar tarefa" }
  }
}

export async function concluirTarefa(id: string) {
  const session = await requireAuth()
  const tarefaId = id.trim()
  if (!tarefaId) return { error: "Tarefa inválida" }

  const tarefa = await prisma.tarefa.findUnique({
    where: { id: tarefaId },
    select: { id: true, responsavelId: true },
  })
  if (!tarefa) return { error: "Tarefa não encontrada" }

  // ADVOGADO só conclui as próprias; ADMIN conclui qualquer uma.
  if (session.user.role === Role.ADVOGADO && tarefa.responsavelId !== session.user.id) {
    return { error: "Acesso negado" }
  }

  try {
    await prisma.tarefa.update({
      where: { id: tarefaId },
      data: { status: TarefaStatus.CONCLUIDO, concluidoEm: new Date() },
    })
    revalidatePath("/dashboard/agenda")
    return { success: true }
  } catch {
    return { error: "Erro ao concluir tarefa" }
  }
}
