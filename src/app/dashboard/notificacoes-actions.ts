"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth/guards"

export async function getNotificacoes() {
  const session = await requireAuth()
  const [items, naoLidas] = await Promise.all([
    prisma.notificacao.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notificacao.count({ where: { userId: session.user.id, lida: false } }),
  ])
  return { items, naoLidas }
}

export async function marcarLida(id: string) {
  const session = await requireAuth()
  await prisma.notificacao.updateMany({
    where: { id, userId: session.user.id },
    data: { lida: true },
  })
  return { success: true }
}

export async function marcarTodasLidas() {
  const session = await requireAuth()
  await prisma.notificacao.updateMany({
    where: { userId: session.user.id, lida: false },
    data: { lida: true },
  })
  return { success: true }
}
