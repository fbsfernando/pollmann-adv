"use client"

import { useState, useEffect, useTransition, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Bell, Check, CheckCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { getNotificacoes, marcarLida, marcarTodasLidas } from "@/app/dashboard/notificacoes-actions"

type Notificacao = Awaited<ReturnType<typeof getNotificacoes>>["items"][number]

function tempoRelativo(d: Date | string): string {
  const diff = Date.now() - new Date(d).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "agora"
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const dias = Math.floor(h / 24)
  if (dias < 7) return `${dias}d`
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notificacao[]>([])
  const [naoLidas, setNaoLidas] = useState(0)
  const [, start] = useTransition()

  const carregar = useCallback(async () => {
    try {
      const res = await getNotificacoes()
      setItems(res.items)
      setNaoLidas(res.naoLidas)
    } catch {
      // silencioso
    }
  }, [])

  useEffect(() => {
    carregar()
    // Atualiza periodicamente enquanto a aba está aberta.
    const t = setInterval(carregar, 60000)
    return () => clearInterval(t)
  }, [carregar])

  const abrirItem = (n: Notificacao) => {
    setOpen(false)
    start(async () => {
      if (!n.lida) {
        await marcarLida(n.id)
        setNaoLidas((v) => Math.max(0, v - 1))
        setItems((arr) => arr.map((x) => (x.id === n.id ? { ...x, lida: true } : x)))
      }
      if (n.link) router.push(n.link)
    })
  }

  const lerTodas = () => {
    start(async () => {
      await marcarTodasLidas()
      setNaoLidas(0)
      setItems((arr) => arr.map((x) => ({ ...x, lida: true })))
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificações"
        className="relative flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Bell className="w-[18px] h-[18px]" />
        {naoLidas > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[0.6rem] font-semibold tabular-nums">
            {naoLidas > 9 ? "9+" : naoLidas}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 mt-2 w-80 max-w-[90vw] z-50 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60">
              <span className="text-sm font-semibold text-foreground">Notificações</span>
              {naoLidas > 0 && (
                <button
                  type="button"
                  onClick={lerTodas}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Marcar todas
                </button>
              )}
            </div>

            <div className="max-h-[22rem] overflow-y-auto divide-y divide-border/40">
              {items.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell className="w-7 h-7 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground/60">Nenhuma notificação</p>
                </div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => abrirItem(n)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex gap-2.5",
                      !n.lida && "bg-primary/[0.03]"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 w-1.5 h-1.5 rounded-full shrink-0",
                        n.lida ? "bg-transparent" : "bg-red-500"
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground/90 leading-snug">{n.titulo}</p>
                      {n.descricao && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{n.descricao}</p>
                      )}
                      <p className="text-[0.65rem] text-muted-foreground/50 mt-0.5">{tempoRelativo(n.createdAt)}</p>
                    </div>
                    {n.lida && <Check className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0 mt-1" />}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
