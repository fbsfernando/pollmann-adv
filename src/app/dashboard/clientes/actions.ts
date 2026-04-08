"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireAuth } from "@/lib/auth/guards"

const clienteSchema = z.object({
  nome: z.string().min(2, "Nome é obrigatório"),
  cpfCnpj: z.string().optional().nullable(),
  email: z.string().email("E-mail inválido").optional().nullable().or(z.literal("")),
  telefone: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
})

export async function getClientes(search?: string) {
  await requireAuth()
  const where = search
    ? {
        OR: [
          { nome: { contains: search, mode: "insensitive" as const } },
          { cpfCnpj: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {}

  return prisma.cliente.findMany({
    where,
    orderBy: { nome: "asc" },
    include: {
      _count: { select: { processos: true } },
    },
  })
}

export async function getCliente(id: string) {
  await requireAuth()
  return prisma.cliente.findUnique({
    where: { id },
    include: {
      processos: {
        include: { advogado: true },
        orderBy: { createdAt: "desc" },
      },
    },
  })
}

export async function createCliente(formData: FormData) {
  await requireAuth()
  const raw = {
    nome: formData.get("nome") as string,
    cpfCnpj: (formData.get("cpfCnpj") as string) || null,
    email: (formData.get("email") as string) || null,
    telefone: (formData.get("telefone") as string) || null,
    observacoes: (formData.get("observacoes") as string) || null,
  }

  const parsed = clienteSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  try {
    await prisma.cliente.create({ data: parsed.data })
    revalidatePath("/dashboard/clientes")
    return { success: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido"
    if (msg.includes("Unique constraint") && msg.includes("cpf_cnpj")) {
      return { error: "CPF/CNPJ já cadastrado" }
    }
    return { error: "Erro ao criar cliente" }
  }
}

export async function updateCliente(id: string, formData: FormData) {
  await requireAuth()
  const raw = {
    nome: formData.get("nome") as string,
    cpfCnpj: (formData.get("cpfCnpj") as string) || null,
    email: (formData.get("email") as string) || null,
    telefone: (formData.get("telefone") as string) || null,
    observacoes: (formData.get("observacoes") as string) || null,
  }

  const parsed = clienteSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  try {
    await prisma.cliente.update({ where: { id }, data: parsed.data })
    revalidatePath("/dashboard/clientes")
    revalidatePath(`/dashboard/clientes/${id}`)
    return { success: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido"
    if (msg.includes("Unique constraint") && msg.includes("cpf_cnpj")) {
      return { error: "CPF/CNPJ já cadastrado" }
    }
    return { error: "Erro ao atualizar cliente" }
  }
}
