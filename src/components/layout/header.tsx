"use client"

import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Menu } from "lucide-react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"

interface HeaderProps {
  onMenuClick: () => void
}

const breadcrumbLabels: Record<string, string> = {
  dashboard: "Dashboard",
  clientes: "Clientes",
  processos: "Processos",
}

function useBreadcrumbs(pathname: string) {
  const segments = pathname.split("/").filter(Boolean)
  // Build crumbs: skip "dashboard" root as standalone, build meaningful chain
  const crumbs: { label: string; href: string }[] = []
  let path = ""
  for (const seg of segments) {
    path += `/${seg}`
    const label = breadcrumbLabels[seg]
    if (label) {
      crumbs.push({ label, href: path })
    } else if (seg.length === 36 || seg.length === 25) {
      // likely a UUID / cuid — "Detalhes"
      crumbs.push({ label: "Detalhes", href: path })
    }
  }
  return crumbs
}

export function Header({ onMenuClick }: HeaderProps) {
  const pathname = usePathname()
  const crumbs = useBreadcrumbs(pathname)

  return (
    <header className="sticky top-0 z-30 flex items-center h-[60px] px-4 md:px-6 bg-background/90 backdrop-blur-md border-b border-border/60">
      {/* Mobile menu toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden mr-2 h-8 w-8"
        onClick={onMenuClick}
        aria-label="Abrir menu"
      >
        <Menu className="w-4 h-4" />
      </Button>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm" aria-label="Navegação">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <span key={crumb.href} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />}
              {isLast ? (
                <span className="font-medium text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {crumb.label}
                </Link>
              )}
            </span>
          )
        })}
      </nav>
    </header>
  )
}
