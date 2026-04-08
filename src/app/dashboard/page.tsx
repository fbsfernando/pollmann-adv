import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth/guards"
import { FileText, Users, Clock, Zap } from "lucide-react"
import { Role, StatusProcesso } from "@prisma/client"
import Link from "next/link"
import { StatusBadge } from "@/components/status-badge"

async function getDashboardStats(userId: string, role: Role) {
  const processoFilter =
    role === Role.ADVOGADO ? { advogadoId: userId } : {}

  const seteDiasAtras = new Date()
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 7)

  const [
    totalProcessos,
    processosAtivos,
    totalClientes,
    andamentosRecentes,
    andamentosScraperCount,
  ] = await Promise.all([
    prisma.processo.count({ where: processoFilter }),
    prisma.processo.count({
      where: { ...processoFilter, status: StatusProcesso.ATIVO },
    }),
    role === Role.ADVOGADO
      ? prisma.cliente.count({
          where: { processos: { some: { advogadoId: userId } } },
        })
      : prisma.cliente.count(),
    prisma.andamento.count({
      where: {
        processo: processoFilter,
        data: { gte: seteDiasAtras },
      },
    }),
    prisma.andamento.count({
      where: { processo: processoFilter, fonte: "SCRAPER" },
    }),
  ])

  return {
    totalProcessos,
    processosAtivos,
    totalClientes,
    andamentosRecentes,
    andamentosScraperCount,
  }
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

function formatDateFull(date: Date | string) {
  return new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

const stats_config = [
  {
    key: "processosAtivos",
    label: "Processos ativos",
    icon: FileText,
    subKey: "totalProcessos",
    subLabel: (v: number) => `de ${v} totais`,
    color: "text-blue-600",
    bg: "bg-blue-500/8",
  },
  {
    key: "totalClientes",
    label: "Clientes",
    icon: Users,
    subLabel: () => "cadastrados",
    color: "text-violet-600",
    bg: "bg-violet-500/8",
  },
  {
    key: "andamentosRecentes",
    label: "Andamentos (7 dias)",
    icon: Clock,
    subLabel: () => "movimentações recentes",
    color: "text-amber-600",
    bg: "bg-amber-500/8",
  },
  {
    key: "andamentosScraperCount",
    label: "Via scraper",
    icon: Zap,
    subLabel: () => "coletados automaticamente",
    color: "text-emerald-600",
    bg: "bg-emerald-500/8",
  },
]

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

  const statValues: Record<string, number> = {
    processosAtivos: stats.processosAtivos,
    totalClientes: stats.totalClientes,
    andamentosRecentes: stats.andamentosRecentes,
    andamentosScraperCount: stats.andamentosScraperCount,
    totalProcessos: stats.totalProcessos,
  }

  return (
    <div className="space-y-10">
      {/* Greeting */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="font-heading text-3xl text-foreground">
          Bom dia, {firstName}.
        </h1>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats_config.map((s) => {
          const Icon = s.icon
          const value = statValues[s.key]
          const subValue = s.subKey ? statValues[s.subKey] : undefined

          return (
            <div
              key={s.key}
              className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow duration-200"
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
                  {value}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  {s.subLabel(subValue ?? value)}
                </p>
              </div>
            </div>
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
