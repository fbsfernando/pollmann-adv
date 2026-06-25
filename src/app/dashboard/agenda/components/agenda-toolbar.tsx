"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type ViewMode,
  VIEW_MODES,
  VIEW_LABELS,
  addDays,
  addMonths,
  parseAnchor,
  dateKey,
  todayUTC,
  periodLabel,
} from "../calendar-utils"

export function AgendaToolbar({ view, dateStr }: { view: ViewMode; dateStr?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const anchor = parseAnchor(dateStr)

  const push = (next: { view?: ViewMode; date?: string | null }) => {
    const params = new URLSearchParams(sp.toString())
    if (next.view) params.set("view", next.view)
    if (next.date !== undefined) {
      if (next.date) params.set("date", next.date)
      else params.delete("date")
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const shift = (dir: number) => {
    if (view === "mes") return push({ date: dateKey(addMonths(anchor, dir)) })
    if (view === "semana") return push({ date: dateKey(addDays(anchor, 7 * dir)) })
    if (view === "dia") return push({ date: dateKey(addDays(anchor, dir)) })
  }

  const showNav = view !== "lista"

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 min-h-8">
        {showNav && (
          <>
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="Anterior"
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => push({ date: dateKey(todayUTC()) })}
              className="h-8 px-3 rounded-lg border border-input bg-background text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="Próximo"
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="ml-1.5 text-sm font-medium text-foreground capitalize">
              {periodLabel(view, anchor)}
            </span>
          </>
        )}
      </div>

      <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-[var(--shadow-card)]">
        {VIEW_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => push({ view: m })}
            className={cn(
              "px-3 h-7 rounded-md text-xs font-medium transition-colors",
              view === m
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {VIEW_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  )
}
