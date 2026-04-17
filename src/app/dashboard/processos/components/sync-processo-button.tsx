"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { RefreshCw } from "lucide-react"
import { syncProcessoAgora } from "../actions"

export function SyncProcessoButton({ processoId }: { processoId: string }) {
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await syncProcessoAgora(processoId)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      if (result.newAndamentos === 0) {
        toast.success("Sincronizado — nenhum andamento novo")
      } else {
        toast.success(
          `Sincronizado — ${result.newAndamentos} novo(s) andamento(s), ${result.newDocumentos} documento(s)`
        )
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title="Consultar E-PROC agora"
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Sincronizando..." : "Sincronizar"}
    </button>
  )
}
