import Link from "next/link"
import { TarefaStatus } from "@prisma/client"
import { cn } from "@/lib/utils"
import {
  type Grid,
  dateKey,
  todayUTC,
  WEEKDAY_LABELS,
} from "./calendar-utils"

export type CalTarefa = {
  id: string
  titulo: string
  tipo: string
  status: TarefaStatus
  prazoData: Date | null
  dataInicio: Date | null
  processo: { id: string; numero: string } | null
  responsavel: { name: string | null; email: string }
}

const TODAY_KEY = dateKey(todayUTC())

/** Data efetiva da tarefa no calendário: prazo, com fallback no início. */
function taskKey(t: CalTarefa): string | null {
  const d = t.prazoData ?? t.dataInicio
  return d ? dateKey(new Date(d)) : null
}

function bucketByDay(tarefas: CalTarefa[]): Map<string, CalTarefa[]> {
  const map = new Map<string, CalTarefa[]>()
  for (const t of tarefas) {
    const k = taskKey(t)
    if (!k) continue
    const arr = map.get(k)
    if (arr) arr.push(t)
    else map.set(k, [t])
  }
  return map
}

function tone(t: CalTarefa): string {
  const done = t.status === TarefaStatus.CONCLUIDO || t.status === TarefaStatus.CANCELADO
  if (done) return "bg-muted text-muted-foreground/70 border-transparent"
  const k = taskKey(t)
  if (k && k < TODAY_KEY) return "bg-red-500/10 text-red-700 border-red-500/20"
  if (k === TODAY_KEY) return "bg-amber-500/10 text-amber-700 border-amber-500/20"
  return "bg-blue-500/10 text-blue-700 border-blue-500/20"
}

function TaskChip({ t, block }: { t: CalTarefa; block?: boolean }) {
  const inner = (
    <div
      className={cn(
        "truncate rounded border px-1.5 py-0.5 text-[0.68rem] leading-tight transition-colors",
        tone(t),
        block ? "" : "hover:brightness-95"
      )}
      title={`${t.tipo}: ${t.titulo}${t.processo ? ` — ${t.processo.numero}` : ""}`}
    >
      {t.titulo}
    </div>
  )
  if (t.processo) {
    return (
      <Link href={`/dashboard/processos/${t.processo.id}`} className="block">
        {inner}
      </Link>
    )
  }
  return inner
}

const fmtDiaNum = new Intl.DateTimeFormat("pt-BR", { day: "numeric", timeZone: "UTC" })

// ── Mês ───────────────────────────────────────────────────────────────────
export function MonthView({
  tarefas,
  grid,
}: {
  tarefas: CalTarefa[]
  grid: Grid & { month: number }
}) {
  const buckets = bucketByDay(tarefas)
  const MAX = 3

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border/60">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.days.map((day) => {
          const k = dateKey(day)
          const items = buckets.get(k) ?? []
          const isToday = k === TODAY_KEY
          const inMonth = day.getUTCMonth() === grid.month
          return (
            <div
              key={k}
              className={cn(
                "min-h-[7rem] border-b border-r border-border/40 p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-muted/20"
              )}
            >
              <div className="flex justify-end">
                <span
                  className={cn(
                    "inline-flex items-center justify-center text-xs tabular-nums w-5 h-5 rounded-full",
                    isToday ? "bg-primary text-primary-foreground font-semibold" : inMonth ? "text-foreground/70" : "text-muted-foreground/40"
                  )}
                >
                  {fmtDiaNum.format(day)}
                </span>
              </div>
              <div className="mt-1 space-y-1">
                {items.slice(0, MAX).map((t) => (
                  <TaskChip key={t.id} t={t} />
                ))}
                {items.length > MAX && (
                  <p className="text-[0.62rem] text-muted-foreground/60 pl-1">+{items.length - MAX} mais</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Semana ──────────────────────────────────────────────────────────────────
const fmtDiaSemana = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" })

export function WeekView({ tarefas, grid }: { tarefas: CalTarefa[]; grid: Grid }) {
  const buckets = bucketByDay(tarefas)
  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden grid grid-cols-7">
      {grid.days.map((day) => {
        const k = dateKey(day)
        const items = buckets.get(k) ?? []
        const isToday = k === TODAY_KEY
        return (
          <div key={k} className="min-h-[18rem] border-r border-border/40 last:border-r-0">
            <div className={cn("px-2 py-2 border-b border-border/60 text-center", isToday && "bg-primary/5")}>
              <p className="text-[0.6rem] uppercase tracking-wide text-muted-foreground/60 capitalize">{fmtDiaSemana.format(day)}</p>
              <span
                className={cn(
                  "inline-flex items-center justify-center text-sm tabular-nums w-6 h-6 rounded-full mt-0.5",
                  isToday ? "bg-primary text-primary-foreground font-semibold" : "text-foreground/80"
                )}
              >
                {fmtDiaNum.format(day)}
              </span>
            </div>
            <div className="p-1.5 space-y-1">
              {items.length === 0 ? (
                <p className="text-[0.62rem] text-muted-foreground/30 text-center pt-2">—</p>
              ) : (
                items.map((t) => <TaskChip key={t.id} t={t} block />)
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Dia ──────────────────────────────────────────────────────────────────────
export function DayView({ tarefas, anchor }: { tarefas: CalTarefa[]; anchor: Date }) {
  const k = dateKey(anchor)
  const items = bucketByDay(tarefas).get(k) ?? []
  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
      {items.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Nenhuma tarefa neste dia</div>
      ) : (
        <div className="divide-y divide-border/40">
          {items.map((t) => {
            const row = (
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                <span className={cn("w-2 h-2 rounded-full shrink-0", tone(t).split(" ")[0])} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground/90 truncate">{t.titulo}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.tipo}
                    {t.processo && <span className="font-mono"> · {t.processo.numero}</span>}
                    {" · "}
                    {t.responsavel.name ?? t.responsavel.email}
                  </p>
                </div>
              </div>
            )
            return t.processo ? (
              <Link key={t.id} href={`/dashboard/processos/${t.processo.id}`} className="block">
                {row}
              </Link>
            ) : (
              <div key={t.id}>{row}</div>
            )
          })}
        </div>
      )}
    </div>
  )
}
