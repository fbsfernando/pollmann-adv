"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type ActionResult = { error?: string; success?: boolean }

/**
 * Ações rápidas de triagem (padrão do Expedit): marcar como tratada sem criar
 * tarefa, e descartar. Recebe as server actions por props para servir tanto a
 * publicações quanto a intimações.
 */
export function QuickActions({
  id,
  marcarTratada,
  descartar,
}: {
  id: string
  marcarTratada: (id: string) => Promise<ActionResult>
  descartar: (id: string) => Promise<ActionResult>
}) {
  const router = useRouter()
  const [loading, setLoading] = useState<"tratar" | "descartar" | null>(null)

  async function run(kind: "tratar" | "descartar") {
    setLoading(kind)
    const result = kind === "tratar" ? await marcarTratada(id) : await descartar(id)
    setLoading(null)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(kind === "tratar" ? "Marcada como tratada" : "Descartada")
    router.refresh()
  }

  const btn =
    "inline-flex items-center justify-center w-7 h-7 rounded-md border border-input bg-background transition-colors disabled:opacity-50"

  return (
    <span className="inline-flex gap-1">
      <button
        type="button"
        title="Marcar como tratada (sem criar tarefa)"
        aria-label="Marcar como tratada"
        disabled={loading !== null}
        onClick={() => run("tratar")}
        className={cn(btn, "text-emerald-600 hover:bg-emerald-500/10 hover:border-emerald-500/30")}
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        title="Descartar"
        aria-label="Descartar"
        disabled={loading !== null}
        onClick={() => run("descartar")}
        className={cn(btn, "text-muted-foreground hover:text-red-600 hover:bg-red-500/10 hover:border-red-500/30")}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </span>
  )
}
