/** Status display config */
export const statusConfig: Record<string, { label: string; className: string }> = {
  ATIVO: {
    label: "Ativo",
    className: "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400 dark:ring-emerald-400/20",
  },
  ARQUIVADO: {
    label: "Arquivado",
    className: "bg-zinc-500/10 text-zinc-600 ring-1 ring-zinc-500/15 dark:text-zinc-400",
  },
  SUSPENSO: {
    label: "Suspenso",
    className: "bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400",
  },
  ENCERRADO: {
    label: "Encerrado",
    className: "bg-red-500/8 text-red-700 ring-1 ring-red-500/15 dark:text-red-400",
  },
}

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status]
  if (!config) return <span className="text-xs text-muted-foreground">{status}</span>
  return (
    <span
      className={`inline-flex items-center text-[0.68rem] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap tracking-wide ${config.className}`}
    >
      {config.label}
    </span>
  )
}
