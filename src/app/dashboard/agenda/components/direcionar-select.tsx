"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { direcionarTarefa } from "../actions"

type Advogado = { id: string; name: string | null; email: string }

/** Seletor de direcionamento (reatribuição) — só renderizado para o admin. */
export function DirecionarSelect({
  tarefaId,
  advogados,
}: {
  tarefaId: string
  advogados: Advogado[]
}) {
  const [pending, start] = useTransition()

  return (
    <select
      defaultValue=""
      disabled={pending}
      onChange={(e) => {
        const responsavelId = e.target.value
        if (!responsavelId) return
        start(async () => {
          const res = await direcionarTarefa(tarefaId, responsavelId)
          if (res?.error) toast.error(res.error)
          else toast.success("Tarefa direcionada")
        })
      }}
      className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer disabled:opacity-50"
      title="Direcionar para um advogado"
    >
      <option value="" disabled>
        Direcionar…
      </option>
      {advogados.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name ?? a.email}
        </option>
      ))}
    </select>
  )
}
