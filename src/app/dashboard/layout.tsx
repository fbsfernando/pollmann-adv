import { AuthProvider } from "@/lib/auth/context"
import { AppShell } from "@/components/layout/app-shell"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth/guards"
import { Role, TarefaStatus, PublicacaoStatus } from "@prisma/client"

/**
 * Contagens de urgência exibidas como badge na sidebar, indexadas pela rota do
 * item de navegação. Escopo por papel: ADMIN vê tudo; ADVOGADO só o que é seu.
 */
async function getSidebarCounts(): Promise<Record<string, number>> {
  const session = await requireAuth()
  const isAdmin = session.user.role === Role.ADMIN

  const inicioHoje = new Date()
  inicioHoje.setHours(0, 0, 0, 0)

  const [publicacoesPendentes, intimacoesPendentes, tarefasAtrasadas] = await Promise.all([
    isAdmin
      ? prisma.publicacao.count({ where: { status: PublicacaoStatus.PENDENTE } })
      : Promise.resolve(0),
    isAdmin
      ? prisma.intimacao.count({ where: { status: PublicacaoStatus.PENDENTE } })
      : Promise.resolve(0),
    prisma.tarefa.count({
      where: {
        status: { in: [TarefaStatus.PENDENTE, TarefaStatus.EM_ANDAMENTO] },
        prazoData: { lt: inicioHoje },
        ...(isAdmin ? {} : { responsavelId: session.user.id }),
      },
    }),
  ])

  return {
    // Badge única do módulo Atualizações: publicações + intimações pendentes.
    "/dashboard/atualizacoes/publicacoes": publicacoesPendentes + intimacoesPendentes,
    "/dashboard/agenda": tarefasAtrasadas,
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const counts = await getSidebarCounts()

  return (
    <AuthProvider>
      <AppShell counts={counts}>{children}</AppShell>
    </AuthProvider>
  )
}
