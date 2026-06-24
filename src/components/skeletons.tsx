/** Skeletons de carregamento reutilizados pelos loading.tsx das rotas. */

export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-7 w-44 rounded-md bg-muted" />
      <div className="h-14 rounded-xl bg-muted/50" />
      <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/40">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-12 bg-muted/25" />
        ))}
      </div>
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-10 animate-pulse">
      <div className="space-y-2">
        <div className="h-3 w-32 rounded bg-muted/60" />
        <div className="h-8 w-64 rounded-md bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl border border-border bg-muted/30" />
        ))}
      </div>
      <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/40">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 bg-muted/25" />
        ))}
      </div>
    </div>
  )
}
