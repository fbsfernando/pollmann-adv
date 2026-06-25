// Utilidades de calendário — datas normalizadas em UTC (meia-noite) para que o
// bucketing de tarefas por dia seja determinístico, independente do fuso do
// servidor. Compartilhado entre a página (server) e a toolbar (client).

export type ViewMode = "mes" | "semana" | "dia" | "lista"

export const VIEW_MODES: ViewMode[] = ["mes", "semana", "dia", "lista"]
export const VIEW_LABELS: Record<ViewMode, string> = {
  mes: "Mês",
  semana: "Semana",
  dia: "Dia",
  lista: "Lista",
}

const DAY_MS = 86_400_000

export function isViewMode(v: string | undefined): v is ViewMode {
  return !!v && (VIEW_MODES as string[]).includes(v)
}

/** Hoje em UTC (meia-noite). */
export function todayUTC(): Date {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))
}

/** Parseia "YYYY-MM-DD" para UTC midnight; default = hoje. */
export function parseAnchor(s?: string): Date {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) return d
  }
  return todayUTC()
}

/** Chave de dia "YYYY-MM-DD" (UTC). */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS)
}

export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()))
}

/** Início da semana (domingo). */
export function startOfWeek(d: Date): Date {
  return addDays(d, -d.getUTCDay())
}

export type Grid = { from: Date; to: Date; days: Date[] }

/** Grade do mês: 6 semanas (42 dias) a partir do domingo anterior ao dia 1º. */
export function monthGrid(anchor: Date): Grid & { month: number } {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
  const start = startOfWeek(first)
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  return { from: start, to: days[41], days, month: anchor.getUTCMonth() }
}

export function weekGrid(anchor: Date): Grid {
  const start = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return { from: start, to: days[6], days }
}

export function dayGrid(anchor: Date): Grid {
  return { from: anchor, to: anchor, days: [anchor] }
}

/** Limite superior exclusivo para query (fim do último dia da grade). */
export function endExclusive(to: Date): Date {
  return addDays(to, 1)
}

const NOMES_DIA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
export const WEEKDAY_LABELS = NOMES_DIA_CURTO

const fmtMesAno = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
const fmtDiaMes = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" })
const fmtDiaCompleto = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/** Rótulo do período conforme a view (ex.: "junho de 2026", "22–28 jun", "25 de junho..."). */
export function periodLabel(view: ViewMode, anchor: Date): string {
  if (view === "semana") {
    const g = weekGrid(anchor)
    return `${fmtDiaMes.format(g.from)} – ${fmtDiaMes.format(g.to)}`
  }
  if (view === "dia") {
    return fmtDiaCompleto.format(anchor)
  }
  return fmtMesAno.format(anchor)
}
