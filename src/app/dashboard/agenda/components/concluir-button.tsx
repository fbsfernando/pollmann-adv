"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { Check } from "lucide-react"
import { concluirTarefa } from "../actions"

export function ConcluirButton({ tarefaId }: { tarefaId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    const result = await concluirTarefa(tarefaId)
    setLoading(false)
    if ("error" in result && result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Tarefa concluída")
    router.refresh()
  }

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={loading}>
      <Check className="w-3.5 h-3.5 mr-1" />
      {loading ? "..." : "Concluir"}
    </Button>
  )
}
