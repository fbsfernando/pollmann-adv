/**
 * Períodos rápidos do módulo Atualizações (espelha os cards do Expedit:
 * Hoje | Ontem | 3 dias | 7 dias | 15 dias | Todos).
 *
 * As datas de publicação/ciência são gravadas como meia-noite UTC (vêm de
 * "YYYY-MM-DD"), então os limites são calculados em dias UTC.
 */
export const PERIODOS = [
  { value: "hoje", label: "Hoje" },
  { value: "ontem", label: "Ontem" },
  { value: "3d", label: "Últimos 3 dias" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "15d", label: "Últimos 15 dias" },
  { value: "todos", label: "Todos" },
] as const

export type Periodo = (typeof PERIODOS)[number]["value"]

const startOfUtcDay = (d: Date, offsetDays = 0): Date => {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  out.setUTCDate(out.getUTCDate() + offsetDays)
  return out
}

/** Intervalo [gte, lt) do período; `null` = sem filtro (todos). */
export const periodoRange = (
  periodo: Periodo,
  now = new Date()
): { gte: Date; lt: Date } | null => {
  const hoje = startOfUtcDay(now)
  const amanha = startOfUtcDay(now, 1)
  switch (periodo) {
    case "hoje":
      return { gte: hoje, lt: amanha }
    case "ontem":
      return { gte: startOfUtcDay(now, -1), lt: hoje }
    case "3d":
      return { gte: startOfUtcDay(now, -2), lt: amanha }
    case "7d":
      return { gte: startOfUtcDay(now, -6), lt: amanha }
    case "15d":
      return { gte: startOfUtcDay(now, -14), lt: amanha }
    case "todos":
      return null
  }
}

export const isPeriodo = (raw?: string): raw is Periodo =>
  PERIODOS.some((p) => p.value === raw)

/** "YYYY-MM-DD" (UTC) de uma data — chave de agrupamento das edições. */
export const toIsoDay = (d: Date): string => d.toISOString().slice(0, 10)
