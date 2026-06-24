import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth/guards"
import { FileText, Users, Clock, Bell, AlertTriangle, ListTodo } from "lucide-react"
import { Role, StatusProcesso, TarefaStatus, PublicacaoStatus } from "@prisma/client"
import type { LucideIcon } from "lucide-react"
import Link from "next/link"
import { StatusBadge } from "@/components/status-badge"

async function getDashboardStats(userId: string, role: Role) {
  const isAdmin = role === Role.ADMIN
  const processoFilter = isAdmin ? {} : { advogadoId: userId }
  const tarefaFilter = isAdmin ? {} : { responsavelId: userId }
  const tarefasAbertas = {
    status: { in: [TarefaStatus.PENDENTE, TarefaStatus.EM_ANDAMENTO] },
  }

  const inicioHoje = new Date()
  inicioHoje.setHours(0, 0, 0, 0)

  const [
    totalProcessos,
    processosAtivos,
    totalClientes,
    publicacoesPendentes,
    tarefasPendentes,
    tarefasAtrasadas,
  ] = await Promise.all([
    prisma.processo.count({ where: processoFilter }),
    prisma.processo.count({
      where: { ...processoFilter, status: StatusProcesso.ATIVO },
    }),
    isAdmin
      ? prisma.cliente.count()
      : prisma.cliente.count({
          where: { processos: { some: { advogadoId: userId } } },
        }),
    isAdmin
      ? prisma.publicacao.count({ where: { status: PublicacaoStatus.PENDENTE } })
      : Promise.resolve(0),
    prisma.tarefa.count({ where: { ...tarefaFilter, ...tarefasAbertas } }),
    prisma.tarefa.count({
      where: { ...tarefaFilter, ...tarefasAbertas, prazoData: { lt: inicioHoje } },
    }),
  ])

  return {
    totalProcessos,
    processosAtivos,
    totalClientes,
    publicacoesPendentes,
    tarefasPendentes,
    tarefasAtrasadas,
  }
}

type StatCard = {
  label: string
  value: number
  sub: string
  icon: LucideIcon
  color: string
  bg: string
  href: string
}

/** Cards do topo, orientados à ação e ao papel do usuário. */
function buildStatCards(
  s: Awaited<ReturnType<typeof getDashboardStats>>,
  role: Role
): StatCard[] {
  const processosAtivos: StatCard = {
    label: role === Role.ADMIN ? "Processos ativos" : "Meus processos ativos",
    value: s.processosAtivos,
    sub: `de ${s.totalProcessos} totais`,
    icon: FileText,
    color: "text-blue-600",
    bg: "bg-blue-500/8",
    href: "/dashboard/processos?status=ATIVO",
  }
  const tarefasAtrasadas: StatCard = {
    label: "Tarefas atrasadas",
    value: s.tarefasAtrasadas,
    sub: s.tarefasAtrasadas > 0 ? "requerem ação" : "tudo em dia",
    icon: AlertTriangle,
    color: "text-red-600",
    bg: "bg-red-500/8",
    href: "/dashboard/agenda",
  }

  if (role === Role.ADMIN) {
    return [
      {
        label: "Publicações pendentes",
        value: s.publicacoesPendentes,
        sub: s.publicacoesPendentes > 0 ? "aguardando triagem" : "fila vazia",
        icon: Bell,
        color: "text-amber-600",
        bg: "bg-amber-500/8",
        href: "/dashboard/atualizacoes/publicacoes?status=PENDENTE",
      },
      tarefasAtrasadas,
      processosAtivos,
      {
        label: "Clientes",
        value: s.totalClientes,
        sub: "cadastrados",
        icon: Users,
        color: "text-violet-600",
        bg: "bg-violet-500/8",
        href: "/dashboard/clientes",
      },
    ]
  }

  return [
    {
      label: "Tarefas pendentes",
      value: s.tarefasPendentes,
      sub: "na sua agenda",
      icon: ListTodo,
      color: "text-blue-600",
      bg: "bg-blue-500/8",
      href: "/dashboard/agenda",
    },
    tarefasAtrasadas,
    processosAtivos,
    {
      label: "Clientes",
      value: s.totalClientes,
      sub: "com processo seu",
      icon: Users,
      color: "text-violet-600",
      bg: "bg-violet-500/8",
      href: "/dashboard/processos",
    },
  ]
}

async function getAndamentosRecentes(userId: string, role: Role) {
  const processoFilter =
    role === Role.ADVOGADO ? { advogadoId: userId } : {}

  return prisma.andamento.findMany({
    where: { processo: processoFilter },
    orderBy: { data: "desc" },
    take: 8,
    include: {
      processo: {
        select: {
          numero: true,
          id: true,
          tribunal: true,
          cliente: { select: { nome: true } },
        },
      },
    },
  })
}

function saudacao() {
  const h = new Date().getHours()
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

function formatDate(date: Date | string) {
  const d = new Date(date)
  const today = new Date()
  const diffDays = Math.floor(
    (today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (diffDays === 0) return "Hoje"
  if (diffDays === 1) return "Ontem"
  if (diffDays < 7) return `${diffDays}d atrás`
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

export default async function DashboardPage() {
  const session = await requireAuth()
  const userId = session.user.id
  const role = session.user.role as Role
  const name = session.user.name
  const firstName = name?.split(" ")[0] ?? "usuário"

  const [stats, andamentos] = await Promise.all([
    getDashboardStats(userId, role),
    getAndamentosRecentes(userId, role),
  ])

  const cards = buildStatCards(stats, role)

  return (
    <div className="space-y-10">
      {/* Greeting */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="font-heading text-3xl text-foreground">
          {saudacao()}, {firstName}.
        </h1>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((s) => {
          const Icon = s.icon
          return (
            <Link
              key={s.label}
              href={s.href}
              className="group rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-border/80 transition-all duration-200"
            >
              <div className="flex items-start justify-between mb-4">
                <p className="text-xs font-medium text-muted-foreground leading-tight">
                  {s.label}
                </p>
                <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${s.bg}`}>
                  <Icon className={`w-4 h-4 ${s.color}`} />
                </div>
              </div>
              <div className="space-y-0.5">
                <p className="text-[2rem] font-semibold stat-number text-foreground leading-none">
                  {s.value}
                </p>
                <p className="text-xs text-muted-foreground/70">{s.sub}</p>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Andamentos recentes */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">
            Últimas movimentações
          </h2>
          <Link
            href="/dashboard/processos"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Ver processos →
          </Link>
        </div>

        {andamentos.length === 0 ? (
          <div className="rounded-xl border border-border border-dashed py-12 text-center">
            <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum andamento registrado</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden divide-y divide-border/60">
            {andamentos.map((a, idx) => (
              <Link
                key={a.id}
                href={`/dashboard/processos/${a.processo.id}`}
                className="flex items-start gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors group"
                style={{ animationDelay: `${idx * 30}ms` }}
              >
                {/* Date col */}
                <div className="w-14 shrink-0 text-right">
                  <span className="text-[0.68rem] font-medium text-muted-foreground/50 uppercase tracking-wide whitespace-nowrap">
                    {formatDate(a.data)}
                  </span>
                </div>

                {/* Divider dot */}
                <div className="flex flex-col items-center pt-[7px] shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-border group-hover:bg-accent transition-colors" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[0.8rem] font-mono font-medium text-foreground/80 group-hover:text-foreground transition-colors">
                      {a.processo.numero}
                    </span>
                    <span className="text-[0.7rem] text-muted-foreground/50">
                      {a.processo.cliente.nome}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {a.descricao}
                  </p>
                </div>

                {/* Tribunal */}
                <span className="text-[0.65rem] font-medium text-muted-foreground/40 whitespace-nowrap shrink-0 hidden sm:block">
                  {a.processo.tribunal}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
