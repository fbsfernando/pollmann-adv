import { getPublicacoes, getAdvogados, getDiarios } from "./actions"
import { TratarPublicacaoForm } from "./components/tratar-publicacao-form"
import { PublicacaoStatusBadge } from "@/components/publicacao-status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import Link from "next/link"
import { Search, SlidersHorizontal, Bell, ExternalLink, Sparkles } from "lucide-react"

const STATUS_LIST = [
  { value: "PENDENTE", label: "Pendentes" },
  { value: "TRATADA", label: "Tratadas" },
  { value: "DESCARTADA", label: "Descartadas" },
  { value: "TODAS", label: "Todas" },
]

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d)

export default async function PublicacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; diario?: string; status?: string }>
}) {
  const { q, diario, status } = await searchParams
  const [publicacoes, advogados, diarios] = await Promise.all([
    getPublicacoes({ search: q, diario, status }),
    getAdvogados(),
    getDiarios(),
  ])
  const hasFilters = !!(q || diario || status)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-foreground">Atualizações</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {publicacoes.length === 0
              ? "Nenhuma publicação"
              : `${publicacoes.length} publicaç${publicacoes.length !== 1 ? "ões" : "ão"}`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-2 items-center p-3 rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 ml-1" />
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            name="q"
            aria-label="Buscar por número do processo ou conteúdo"
            placeholder="Número do processo ou conteúdo..."
            defaultValue={q ?? ""}
            className="w-full h-8 pl-8 pr-3 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
          />
        </div>
        <select
          name="status"
          aria-label="Filtrar por status"
          defaultValue={status || "PENDENTE"}
          className="h-8 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow cursor-pointer"
        >
          {STATUS_LIST.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {diarios.length > 0 && (
          <select
            name="diario"
            aria-label="Filtrar por diário"
            defaultValue={diario ?? ""}
            className="h-8 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow cursor-pointer"
          >
            <option value="">Diário</option>
            {diarios.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Filtrar
        </button>
        {hasFilters && (
          <Link
            href="/dashboard/atualizacoes/publicacoes"
            className="h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground flex items-center hover:bg-muted hover:text-foreground transition-colors"
          >
            Limpar
          </Link>
        )}
      </form>

      {publicacoes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Bell className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {hasFilters ? "Nenhum resultado" : "Nenhuma publicação pendente"}
          </p>
          <p className="text-xs text-muted-foreground/60">
            As publicações são importadas do Expedit pela sincronização.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/80 hover:bg-transparent">
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Data</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Processo</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Diário</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Tipo</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Conteúdo</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Status</TableHead>
                <TableHead className="w-20 h-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {publicacoes.map((p) => (
                <TableRow
                  key={p.id}
                  className="hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0 align-top"
                >
                  <TableCell className="py-3 text-sm text-muted-foreground whitespace-nowrap">
                    {fmtDate(p.dataPublicacao)}
                  </TableCell>
                  <TableCell className="py-3">
                    {p.processo ? (
                      <Link
                        href={`/dashboard/processos/${p.processo.id}`}
                        className="font-mono text-[0.78rem] text-foreground/80 hover:text-foreground font-medium transition-colors"
                      >
                        {p.numProcesso}
                      </Link>
                    ) : (
                      <span className="font-mono text-[0.78rem] text-muted-foreground/70" title="Processo não cadastrado">
                        {p.numProcesso}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground whitespace-nowrap">
                    {p.siglaDiario ?? <span className="text-muted-foreground/30">—</span>}
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground whitespace-nowrap">
                    {p.tipoComunicacao ?? <span className="text-muted-foreground/30">—</span>}
                  </TableCell>
                  <TableCell className="py-3 text-sm text-foreground/80 max-w-md">
                    {p.insightIa && (
                      <p className="flex items-start gap-1.5 text-xs text-violet-800 bg-violet-500/8 border border-violet-500/15 rounded-md px-2 py-1.5 mb-1.5">
                        <Sparkles className="w-3 h-3 shrink-0 mt-0.5 text-violet-600" />
                        <span>{p.insightIa}</span>
                      </p>
                    )}
                    <details className="group">
                      <summary className="line-clamp-2 group-open:line-clamp-none cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:text-foreground transition-colors">
                        {p.conteudo}
                      </summary>
                    </details>
                    {p.inteiroTeorUrl && (
                      <a
                        href={p.inteiroTeorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                      >
                        Inteiro teor <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <PublicacaoStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="py-3">
                    {p.status === "PENDENTE" && (
                      <TratarPublicacaoForm
                        publicacao={{ id: p.id, numProcesso: p.numProcesso }}
                        advogados={advogados}
                      />
                    )}
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
