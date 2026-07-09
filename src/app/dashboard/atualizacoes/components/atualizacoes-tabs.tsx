import Link from "next/link"
import { Newspaper, BellRing } from "lucide-react"
import { cn } from "@/lib/utils"

/** Abas do módulo Atualizações (padrão do Expedit: Publicações | Intimações). */
export function AtualizacoesTabs({
  active,
  pendentes,
}: {
  active: "publicacoes" | "intimacoes"
  pendentes: { publicacoes: number; intimacoes: number }
}) {
  const tabs = [
    {
      key: "publicacoes" as const,
      label: "Publicações",
      href: "/dashboard/atualizacoes/publicacoes",
      icon: Newspaper,
      count: pendentes.publicacoes,
    },
    {
      key: "intimacoes" as const,
      label: "Intimações",
      href: "/dashboard/atualizacoes/intimacoes",
      icon: BellRing,
      count: pendentes.intimacoes,
    },
  ]

  return (
    <div className="flex gap-1 border-b border-border" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.key === active
        return (
          <Link
            key={tab.key}
            href={tab.href}
            role="tab"
            aria-selected={isActive}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {tab.count > 0 && (
              <span
                className={cn(
                  "inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[0.65rem] font-semibold tabular-nums",
                  isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}
              >
                {tab.count > 99 ? "99+" : tab.count}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}
