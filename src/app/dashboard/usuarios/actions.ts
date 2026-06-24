"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { requireGestao } from "@/lib/auth/guards"
import { Role } from "@prisma/client"

export async function getUsuarios() {
  await requireGestao()
  return prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      ativo: true,
      createdAt: true,
      _count: { select: { tarefasResponsavel: true } },
    },
  })
}

/** Garante que não fiquemos sem nenhum administrador ativo. */
async function ehUltimoAdminAtivo(userId: string): Promise<boolean> {
  const alvo = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, ativo: true },
  })
  if (!alvo || alvo.role !== Role.ADMIN || !alvo.ativo) return false
  const adminsAtivos = await prisma.user.count({
    where: { role: Role.ADMIN, ativo: true },
  })
  return adminsAtivos <= 1
}

const usuarioSchema = z.object({
  name: z.string().min(2, "Nome é obrigatório"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "A senha deve ter ao menos 6 caracteres"),
  role: z.nativeEnum(Role).optional(),
})

export async function criarUsuario(formData: FormData) {
  await requireGestao()

  const parsed = usuarioSchema.safeParse({
    name: formData.get("name"),
    email: ((formData.get("email") as string) ?? "").trim().toLowerCase(),
    password: formData.get("password"),
    role: (formData.get("role") as string) || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  const { name, email, password, role } = parsed.data

  try {
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: bcrypt.hashSync(password, 10),
        role: role ?? Role.ADVOGADO,
      },
    })
    revalidatePath("/dashboard/usuarios")
    return { success: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("Unique constraint") && msg.includes("email")) {
      return { error: "E-mail já cadastrado" }
    }
    return { error: "Erro ao criar usuário" }
  }
}

const editarSchema = z.object({
  id: z.string().min(1, "Usuário inválido"),
  name: z.string().min(2, "Nome é obrigatório"),
  email: z.string().email("E-mail inválido"),
  role: z.nativeEnum(Role),
})

export async function editarUsuario(formData: FormData) {
  await requireGestao()

  const parsed = editarSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    email: ((formData.get("email") as string) ?? "").trim().toLowerCase(),
    role: (formData.get("role") as string) || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  const { id, name, email, role } = parsed.data

  // Impede rebaixar o último administrador ativo.
  if (role !== Role.ADMIN && (await ehUltimoAdminAtivo(id))) {
    return { error: "Não é possível rebaixar o último administrador ativo" }
  }

  try {
    await prisma.user.update({ where: { id }, data: { name, email, role } })
    revalidatePath("/dashboard/usuarios")
    return { success: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("Unique constraint") && msg.includes("email")) {
      return { error: "E-mail já cadastrado" }
    }
    return { error: "Erro ao editar usuário" }
  }
}

const senhaSchema = z.object({
  id: z.string().min(1, "Usuário inválido"),
  password: z.string().min(6, "A senha deve ter ao menos 6 caracteres"),
})

export async function redefinirSenha(formData: FormData) {
  await requireGestao()

  const parsed = senhaSchema.safeParse({
    id: formData.get("id"),
    password: formData.get("password"),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  try {
    await prisma.user.update({
      where: { id: parsed.data.id },
      data: { passwordHash: bcrypt.hashSync(parsed.data.password, 10) },
    })
    revalidatePath("/dashboard/usuarios")
    return { success: true }
  } catch {
    return { error: "Erro ao redefinir senha" }
  }
}

export async function alternarAtivo(id: string) {
  const session = await requireGestao()
  const userId = id.trim()
  if (!userId) return { error: "Usuário inválido" }

  const alvo = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, ativo: true },
  })
  if (!alvo) return { error: "Usuário não encontrado" }

  if (alvo.id === session.user.id) {
    return { error: "Você não pode desativar a si mesmo" }
  }
  // Só bloqueia ao DESativar o último admin ativo (reativar é sempre permitido).
  if (alvo.ativo && (await ehUltimoAdminAtivo(userId))) {
    return { error: "Não é possível desativar o último administrador ativo" }
  }

  try {
    await prisma.user.update({ where: { id: userId }, data: { ativo: !alvo.ativo } })
    revalidatePath("/dashboard/usuarios")
    return { success: true, ativo: !alvo.ativo }
  } catch {
    return { error: "Erro ao alterar status do usuário" }
  }
}
