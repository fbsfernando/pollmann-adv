"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth/guards"
import { Role, TarefaStatus, Prisma } from "@prisma/client"

export async function getTarefas(filters?: {
  responsavelId?: string
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

  if (!filters?.incluirConcluidas) {
    where.status = { in: [TarefaStatus.PENDENTE, TarefaStatus.EM_ANDAMENTO] }
  }

  return prisma.tarefa.findMany({
    where,
    take: 500,
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
