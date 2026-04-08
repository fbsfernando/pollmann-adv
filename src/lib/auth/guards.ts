import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Role } from "@prisma/client"

/**
 * Require authenticated session in server actions/components.
 * Redirects to /login if not authenticated.
 */
export async function requireAuth() {
  try {
    const session = await auth()
    if (!session?.user?.id || !session.user.role) {
      redirect("/login")
    }
    return session
  } catch {
    redirect("/login")
  }
}

/**
 * Require gestao role in server actions/components.
 * Redirects to /dashboard if not gestao.
 */
export async function requireGestao() {
  const session = await requireAuth()
  if (session.user.role !== Role.ADMIN) {
    redirect("/dashboard")
  }
  return session
}
