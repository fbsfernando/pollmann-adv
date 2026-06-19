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
      createdAt: true,
      _count: { select: { tarefasResponsavel: true } },
    },
  })
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
