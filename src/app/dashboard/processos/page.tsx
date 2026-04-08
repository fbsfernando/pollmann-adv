import { getProcessos } from "./actions"
import { ProcessoForm, EditProcessoButton } from "./components/processo-form"
import { StatusBadge } from "@/components/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import Link from "next/link"
import { Search, Plus, SlidersHorizontal, FileText } from "lucide-react"

const TRIBUNAIS = ["TJSC", "TJRS", "TJPR", "TJSP", "TJRJ", "TJMG", "TJGO", "TJPA", "OUTRO"]
const STATUS_LIST = [
  { value: "ATIVO", label: "Ativo" },
  { value: "ARQUIVADO", label: "Arquivado" },
  { value: "SUSPENSO", label: "Suspenso" },
  { value: "ENCERRADO", label: "Encerrado" },
]

export default async function ProcessosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tribunal?: string; status?: string }>
}) {
  const { q, tribunal, status } = await searchParams
  const processos = await getProcessos({ search: q, tribunal, status })
  const hasFilters = !!(q || tribunal || status)

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-foreground">Processos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {processos.length === 0
              ? "Nenhum processo"
              : `${processos.length} processo${processos.length !== 1 ? "s" : ""}${hasFilters ? " encontrado" + (processos.length !== 1 ? "s" : "") : ""}`}
          </p>
        </div>
        <ProcessoForm />
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-2 items-center p-3 rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 ml-1" />

        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            name="q"
            placeholder="Número ou cliente..."
            defaultValue={q ?? ""}
            className="w-full h-8 pl-8 pr-3 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
          />
        </div>

        <select
          name="tribunal"
          defaultValue={tribunal ?? ""}
          className="h-8 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow cursor-pointer"
        >
          <option value="">Tribunal</option>
          {TRIBUNAIS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-8 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow cursor-pointer"
        >
          <option value="">Status</option>
          {STATUS_LIST.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <button
          type="submit"
          className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Filtrar
        </button>

        {hasFilters && (
          <Link
            href="/dashboard/processos"
            className="h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground flex items-center hover:bg-muted hover:text-foreground transition-colors"
          >
            Limpar
          </Link>
        )}
      </form>

      {/* Table */}
      {processos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <FileText className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {hasFilters ? "Nenhum resultado" : "Nenhum processo cadastrado"}
          </p>
          {hasFilters ? (
            <Link href="/dashboard/processos" className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors">
              Limpar filtros
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground/60">Crie o primeiro processo usando o botão acima</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/80 hover:bg-transparent">
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Número</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Cliente</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Tribunal</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Área</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Advogado</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10 text-center">Movim.</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Status</TableHead>
                <TableHead className="w-10 h-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {processos.map((p) => (
                <TableRow
                  key={p.id}
                  className="hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0"
                >
                  <TableCell className="py-3">
                    <Link
                      href={`/dashboard/processos/${p.id}`}
                      className="font-mono text-[0.78rem] text-foreground/80 hover:text-foreground font-medium transition-colors"
                    >
                      {p.numero}
                    </Link>
                  </TableCell>
                  <TableCell className="py-3">
                    <Link
                      href={`/dashboard/clientes/${p.clienteId}`}
                      className="text-sm text-foreground/80 hover:text-foreground transition-colors"
                    >
                      {p.cliente.nome}
                    </Link>
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="text-xs font-medium text-muted-foreground/70 bg-muted px-2 py-0.5 rounded-md">
                      {p.tribunal}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">
                    {p.area ?? <span className="text-muted-foreground/30">—</span>}
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">
                    {p.advogado?.name ?? <span className="text-muted-foreground/30">—</span>}
                  </TableCell>
                  <TableCell className="py-3 text-center">
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md tabular-nums">
                      {p._count.andamentos}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="py-3">
                    <EditProcessoButton processo={p} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
