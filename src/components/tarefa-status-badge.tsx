/** Status display config para Tarefa (Agenda). */
export const tarefaStatusConfig: Record<string, { label: string; className: string }> = {
  PENDENTE: {
    label: "Pendente",
    className: "bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400",
  },
  EM_ANDAMENTO: {
    label: "Em andamento",
    className: "bg-blue-500/10 text-blue-700 ring-1 ring-blue-500/20 dark:text-blue-400",
  },
  CONCLUIDO: {
    label: "Concluído",
    className: "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400 dark:ring-emerald-400/20",
  },
  CANCELADO: {
    label: "Cancelado",
    className: "bg-zinc-500/10 text-zinc-600 ring-1 ring-zinc-500/15 dark:text-zinc-400",
  },
}

export function TarefaStatusBadge({ status }: { status: string }) {
  const config = tarefaStatusConfig[status]
  if (!config) return <span className="text-xs text-muted-foreground">{status}</span>
  return (
    <span
      className={`inline-flex items-center text-[0.68rem] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap tracking-wide ${config.className}`}
    >
      {config.label}
    </span>
  )
}
