"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth/context"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Users,
  FileText,
  Scale,
  X,
  LogOut,
  ChevronRight,
} from "lucide-react"

interface SidebarProps {
  open: boolean
  onClose: () => void
}

const navItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/dashboard/clientes",
    label: "Clientes",
    icon: Users,
    exact: false,
    adminOnly: true,
  },
  {
    href: "/dashboard/processos",
    label: "Processos",
    icon: FileText,
    exact: false,
  },
]

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { isAdmin, name, role, handleSignOut } = useAuth()

  const filteredItems = navItems.filter((item) => {
    if (item.adminOnly && !isAdmin) return false
    return true
  })

  const initials = name
    ? name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "?"

  async function onSignOut() {
    await handleSignOut()
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 flex flex-col",
          "bg-sidebar border-r border-sidebar-border",
          "transition-transform duration-200 ease-out",
          "lg:translate-x-0 lg:static lg:z-auto",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-[60px] px-5 border-b border-sidebar-border shrink-0">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 group"
            onClick={onClose}
          >
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-sidebar-accent-foreground/10 group-hover:bg-sidebar-accent-foreground/15 transition-colors">
              <Scale className="w-3.5 h-3.5 text-sidebar-foreground/80" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-heading text-[0.95rem] font-normal text-sidebar-foreground tracking-tight">
                Pollmann
              </span>
              <span className="text-[0.65rem] text-sidebar-foreground/40 tracking-widest uppercase font-medium">
                Advogados
              </span>
            </div>
          </Link>
          <button
            type="button"
            className="lg:hidden flex items-center justify-center w-7 h-7 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            onClick={onClose}
            aria-label="Fechar menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <p className="px-3 mb-2 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/30">
            Navegação
          </p>
          {filteredItems.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-[0.8rem] font-medium",
                  "transition-all duration-150 group",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground nav-active-indicator"
                    : "text-sidebar-foreground/55 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/90"
                )}
              >
                <item.icon
                  className={cn(
                    "w-4 h-4 shrink-0 transition-colors",
                    isActive
                      ? "text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/40 group-hover:text-sidebar-foreground/70"
                  )}
                />
                <span className="flex-1">{item.label}</span>
                {isActive && (
                  <ChevronRight className="w-3 h-3 text-sidebar-foreground/30" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-sidebar-border shrink-0">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-md">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-sidebar-accent-foreground/10 text-sidebar-foreground/80 text-xs font-semibold shrink-0 select-none">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[0.78rem] font-medium text-sidebar-foreground/90 truncate leading-tight">
                {name ?? "—"}
              </p>
              <p className="text-[0.65rem] text-sidebar-foreground/35 truncate capitalize">
                {role?.toLowerCase() ?? "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="flex items-center justify-center w-7 h-7 rounded-md text-sidebar-foreground/30 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent transition-colors shrink-0"
              aria-label="Sair"
              title="Sair"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
