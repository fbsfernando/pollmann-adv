import Link from "next/link"
import { cn } from "@/lib/utils"
import { PERIODOS, type Periodo } from "../periodo"

/**
 * Cards de período com contagem de pendentes (padrão da tela de Atualizações
 * do Expedit). Cada card é um link que aplica o filtro `periodo` preservando
 * os demais parâmetros passados em `baseParams`.
 */
export function PeriodoCards({
  counts,
  active,
  basePath,
  baseParams,
}: {
  counts: Record<Periodo, number>
  active: Periodo
  basePath: string
  baseParams?: Record<string, string | undefined>
}) {
  const hrefFor = (periodo: Periodo) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(baseParams ?? {})) {
      if (v) qs.set(k, v)
    }
    if (periodo !== "todos") qs.set("periodo", periodo)
    const s = qs.toString()
    return s ? `${basePath}?${s}` : basePath
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {PERIODOS.map((p) => {
        const isActive = active === p.value
        const count = counts[p.value]
        return (
          <Link
            key={p.value}
            href={hrefFor(p.value)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "rounded-xl border px-3 py-2.5 transition-colors",
              isActive
                ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card hover:bg-muted/40"
            )}
          >
            <p
              className={cn(
                "text-xl font-semibold leading-none tabular-nums",
                isActive ? "text-primary" : "text-foreground",
                count === 0 && !isActive && "text-muted-foreground/40"
              )}
            >
              {count}
            </p>
            <p className="text-[0.65rem] text-muted-foreground mt-1 leading-tight">
              {p.label}
            </p>
          </Link>
        )
      })}
    </div>
  )
}
