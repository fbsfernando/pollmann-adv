"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireAuth } from "@/lib/auth/guards"
import { Tribunal, StatusProcesso, Role, Prisma } from "@prisma/client"

const processoSchema = z.object({
  numero: z.string().min(5, "Número do processo é obrigatório"),
  tribunal: z.nativeEnum(Tribunal),
  vara: z.string().optional().nullable(),
  area: z.string().optional().nullable(),
  status: z.nativeEnum(StatusProcesso).optional(),
  clienteId: z.string().min(1, "Cliente é obrigatório"),
  advogadoId: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
})

export async function getProcessos(filters?: {
  search?: string
  tribunal?: string
  status?: string
  advogadoId?: string
  clienteId?: string
}) {
  const session = await requireAuth()

  const where: Prisma.ProcessoWhereInput = {}

  if (filters?.search) {
    const search = filters.search.slice(0, 100)
    where.OR = [
      { numero: { contains: search, mode: "insensitive" } },
      { cliente: { nome: { contains: search, mode: "insensitive" } } },
    ]
  }
  if (filters?.tribunal) where.tribunal = filters.tribunal as Tribunal
  if (filters?.status) where.status = filters.status as StatusProcesso

  if (session.user.role === Role.ADVOGADO) {
    where.advogadoId = session.user.id
  } else if (filters?.advogadoId) {
    where.advogadoId = filters.advogadoId
  }

  if (filters?.clienteId) where.clienteId = filters.clienteId

  return prisma.processo.findMany({
    where,
    take: 500,
    orderBy: { updatedAt: "desc" },
    include: {
      cliente: true,
      advogado: true,
      _count: { select: { andamentos: true } },
    },
  })
}

export async function getProcesso(id: string) {
  const session = await requireAuth()

  const processoId = id.trim()
  if (!processoId) {
    throw new Error("Processo inválido")
  }

  const where: Prisma.ProcessoWhereInput = { id: processoId }
  if (session.user.role === Role.ADVOGADO) {
    where.advogadoId = session.user.id
  }

  const processo = await prisma.processo.findFirst({
    where,
    include: {
      cliente: true,
      advogado: true,
      andamentos: {
        orderBy: { data: "desc" },
        take: 50,
        include: {
          documentos: true,
        },
      },
      documentos: true,
      _count: { select: { andamentos: true } },
    },
  })

  if (!processo) {
    throw new Error("Acesso negado ou processo não encontrado")
  }

  return processo
}

export async function getFormOptions() {
  await requireAuth()

  const [clientes, advogados] = await Promise.all([
    prisma.cliente.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ])
  return { clientes, advogados }
}

export async function createProcesso(formData: FormData) {
  await requireAuth()

  const raw = {
    numero: formData.get("numero") as string,
    tribunal: formData.get("tribunal") as string,
    vara: (formData.get("vara") as string) || null,
    area: (formData.get("area") as string) || null,
    status: (formData.get("status") as string) || undefined,
    clienteId: formData.get("clienteId") as string,
    advogadoId: (formData.get("advogadoId") as string) || null,
    observacoes: (formData.get("observacoes") as string) || null,
  }

  const parsed = processoSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  try {
    await prisma.processo.create({ data: parsed.data })
    revalidatePath("/dashboard/processos")
    return { success: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("Unique constraint") && msg.includes("numero")) {
      return { error: "Número de processo já cadastrado" }
    }
    return { error: "Erro ao criar processo" }
  }
}

export async function updateProcesso(id: string, formData: FormData) {
  await requireAuth()

  const raw = {
    numero: formData.get("numero") as string,
    tribunal: formData.get("tribunal") as string,
    vara: (formData.get("vara") as string) || null,
    area: (formData.get("area") as string) || null,
    status: (formData.get("status") as string) || undefined,
    clienteId: formData.get("clienteId") as string,
    advogadoId: (formData.get("advogadoId") as string) || null,
    observacoes: (formData.get("observacoes") as string) || null,
  }

  const parsed = processoSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  try {
    await prisma.processo.update({ where: { id }, data: parsed.data })
    revalidatePath("/dashboard/processos")
    revalidatePath(`/dashboard/processos/${id}`)
    return { success: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("Unique constraint") && msg.includes("numero")) {
      return { error: "Número de processo já cadastrado" }
    }
    return { error: "Erro ao atualizar processo" }
  }
}
