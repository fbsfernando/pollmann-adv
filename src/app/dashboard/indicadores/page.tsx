import { requireGestao } from "@/lib/auth/guards"
import { getIndicadores } from "@/lib/expedit/indicadores"
import { BarChart3, DollarSign, Tag, Clock, Layers } from "lucide-react"

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n || 0)
const num = (n: number) => new Intl.NumberFormat("pt-BR").format(n || 0)

const HEX = /^#?[0-9a-fA-F]{3,8}$/
const cor = (c?: string) => (c && HEX.test(c) ? (c.startsWith("#") ? c : `#${c}`) : "var(--muted-foreground)")

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: typeof BarChart3
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-muted-foreground/60" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  )
}

/** Barras horizontais simples (largura proporcional ao máximo). */
function BarList({
  items,
}: {
  items: { label: string; value: number; cor?: string }[]
}) {
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground/60 px-1">Sem dados.</p>
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] divide-y divide-border/40">
      {items.map((i) => (
        <div key={i.label} className="px-4 py-2.5">
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="text-xs text-foreground/80 truncate flex items-center gap-1.5">
              {i.cor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: i.cor }} />}
              {i.label}
            </span>
            <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0">{num(i.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/60"
              style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, backgroundColor: i.cor ?? undefined }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export default async function IndicadoresPage() {
  await requireGestao()
  const d = await getIndicadores()

  if (!d.configured) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl text-foreground">Indicadores</h1>
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <BarChart3 className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm font-medium text-muted-foreground mb-1">Integração do Expedit não configurada</p>
          <p className="text-xs text-muted-foreground/60">
            Defina EXPEDIT_EMAIL e EXPEDIT_PASSWORD no ambiente para carregar os indicadores.
          </p>
        </div>
      </div>
    )
  }

  // Financeiro: soma os grupos para os cards de topo.
  const fin = d.financeiro.reduce(
    (acc, g) => ({
      causa: acc.causa + (g.valorCausaTotal ?? 0),
      condenacao: acc.condenacao + (g.valorCondenacaoTotal ?? 0),
      contrato: acc.contrato + (g.valorContratoTotal ?? 0),
      proveito: acc.proveito + (g.proveitoEconomicoTotal ?? 0),
    }),
    { causa: 0, condenacao: 0, contrato: 0, proveito: 0 }
  )
  const finCards = [
    { label: "Valor da causa", value: fin.causa, color: "text-blue-600", bg: "bg-blue-500/8" },
    { label: "Condenação", value: fin.condenacao, color: "text-red-600", bg: "bg-red-500/8" },
    { label: "Contratos", value: fin.contrato, color: "text-violet-600", bg: "bg-violet-500/8" },
    { label: "Proveito econômico", value: fin.proveito, color: "text-emerald-600", bg: "bg-emerald-500/8" },
  ]

  const assuntos = [...d.assuntos]
    .sort((a, b) => (b.quantidadeProcessos ?? 0) - (a.quantidadeProcessos ?? 0))
    .slice(0, 10)
    .map((a) => ({ label: a.nome ?? "—", value: a.quantidadeProcessos ?? 0 }))

  const marcadores = [...d.marcadores]
    .sort((a, b) => (b.quantidadeProcessos ?? 0) - (a.quantidadeProcessos ?? 0))
    .slice(0, 10)
    .map((m) => ({ label: m.nome ?? "—", value: m.quantidadeProcessos ?? 0, cor: cor(m.cor) }))

  const duracaoAtivos = d.duracao?.ativos ?? []
  const temFinanceiro = finCards.some((c) => c.value > 0)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl text-foreground">Indicadores</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Dados do Expedit · atualizados a cada hora</p>
      </div>

      {/* Financeiro */}
      <Section title="Financeiro" icon={DollarSign}>
        {temFinanceiro ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {finCards.map((c) => (
              <div key={c.label} className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
                <div className="flex items-start justify-between mb-3">
                  <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
                  <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${c.bg}`}>
                    <DollarSign className={`w-4 h-4 ${c.color}`} />
                  </div>
                </div>
                <p className="text-xl font-semibold stat-number text-foreground">{brl(c.value)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/60 px-1">Sem valores financeiros no Expedit.</p>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Processos por assunto" icon={Layers}>
          <BarList items={assuntos} />
        </Section>
        <Section title="Processos por marcador" icon={Tag}>
          <BarList items={marcadores} />
        </Section>
      </div>

      {/* Duração média por estado (processos ativos) */}
      <Section title="Duração média (ativos)" icon={Clock}>
        {duracaoAtivos.length === 0 ? (
          <p className="text-sm text-muted-foreground/60 px-1">Sem dados de duração.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] divide-y divide-border/40">
            {duracaoAtivos.map((e) => (
              <div key={e.estado} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-foreground/80">{e.estado ?? "—"}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {num(e.quantidade ?? 0)} proc. · <span className="font-medium text-foreground/80">{(e.duracaoMediaMeses ?? 0).toFixed(1)} meses</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
