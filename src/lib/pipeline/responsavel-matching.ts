/**
 * Resolução de responsável para eventos importados do Expedit.
 *
 * A convenção do escritório: o Richard escreve o nome do advogado parceiro no
 * título/descrição do compromisso (a conta Expedit dele só tem 1 usuário, então
 * `responsaveis[]` de lá quase nunca aponta um usuário nosso).
 *
 * Ordem de resolução: nome no texto → responsaveis[].nome → admin (fallback,
 * marcado como `fallback: true` → alimenta a fila de pré-triagem).
 */
import { Role, type PrismaClient } from '@prisma/client'

export type ResponsavelResolver = {
  admin: { id: string } | null
  advogadoIds: Set<string>
  resolve(
    texto: string,
    responsaveis?: { nome?: string }[] | null
  ): { id: string; byTexto: string | null; fallback: boolean }
}

const norm = (s?: string): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export const createResponsavelResolver = async (
  prisma: PrismaClient
): Promise<ResponsavelResolver> => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true, ativo: true },
  })
  const userByNome = new Map<string, string>()
  for (const u of users) if (u.name) userByNome.set(norm(u.name), u.id)
  const admin = users.find((u) => u.role === Role.ADMIN) ?? users[0] ?? null

  const advogados = users
    .filter((u) => u.role === Role.ADVOGADO && u.ativo && u.name)
    .map((u) => ({ id: u.id, name: u.name as string }))
  const advogadoIds = new Set(advogados.map((a) => a.id))

  const matchPorTexto = (texto: string): string | null => {
    const t = norm(texto)
    if (!t) return null
    for (const a of advogados) if (t.includes(norm(a.name))) return a.id
    for (const a of advogados) {
      const first = norm(a.name).split(/\s+/)[0]
      if (first.length >= 3 && new RegExp(`(^|[^a-z])${first}([^a-z]|$)`).test(t)) return a.id
    }
    return null
  }

  return {
    admin,
    advogadoIds,
    resolve(texto, responsaveis) {
      const byTexto = matchPorTexto(texto)
      if (byTexto) return { id: byTexto, byTexto, fallback: false }
      for (const r of responsaveis ?? []) {
        const id = userByNome.get(norm(r.nome))
        if (id) return { id, byTexto: null, fallback: false }
      }
      return { id: admin?.id ?? '', byTexto: null, fallback: true }
    },
  }
}
