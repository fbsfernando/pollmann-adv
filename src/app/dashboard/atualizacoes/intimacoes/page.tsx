import Link from "next/link"
import {
  Search,
  SlidersHorizontal,
  BellRing,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

import {
  getIntimacoes,
  getPeriodoCountsIntimacoes,
  tratarIntimacao,
  marcarIntimacaoTratada,
  descartarIntimacao,
} from "./actions"
import { getAdvogados } from "../publicacoes/actions"
import { getPendentesPorAba } from "../counts"
import { isPeriodo, type Periodo } from "../periodo"
import { AtualizacoesTabs } from "../components/atualizacoes-tabs"
import { PeriodoCards } from "../components/periodo-cards"
import { TratarForm } from "../components/tratar-form"
import { QuickActions } from "../components/quick-actions"
import { PublicacaoStatusBadge } from "@/components/publicacao-status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

const STATUS_LIST = [
  { value: "PENDENTE", label: "Pendentes" },
  { value: "TRATADA", label: "Tratadas" },
  { value: "DESCARTADA", label: "Descartadas" },
  { value: "TODAS", label: "Todas" },
]

const BASE_PATH = "/dashboard/atualizacoes/intimacoes"
const DIA_MS = 24 * 60 * 60 * 1000

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)

const buildHref = (params: Record<string, string | undefined>) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `${BASE_PATH}?${s}` : BASE_PATH
}

/** Data limite com urgência: vencida (vermelho), ≤3 dias (âmbar). */
function DataLimite({ data }: { data: Date | null }) {
  if (!data) return <span className="text-muted-foreground/30">—</span>
  const hoje = new Date()
  hoje.setUTCHours(0, 0, 0, 0)
  const dias = Math.floor((data.getTime() - hoje.getTime()) / DIA_MS)
  const cls =
    dias < 0
      ? "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400"
      : dias <= 3
        ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
        : "bg-muted text-muted-foreground ring-border"
  const hint = dias < 0 ? "Vencida" : dias === 0 ? "Hoje" : `${dias}d`
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[0.7rem] font-semibold px-2 py-0.5 rounded-full ring-1 whitespace-nowrap tabular-nums",
        cls
      )}
    >
      {fmtDate(data)}
      <span className="font-normal opacity-70">{hint}</span>
    </span>
  )
}

/** "YYYY-MM-DD" (UTC) para pré-preencher o prazo no form de tratar. */
const toIsoDay = (d: Date | null): string | undefined =>
  d ? d.toISOString().slice(0, 10) : undefined

export default async function IntimacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; periodo?: string; page?: string }>
}) {
  const sp = await searchParams
  const periodo: Periodo = isPeriodo(sp.periodo) ? sp.periodo : "todos"
  const page = Math.max(1, Number(sp.page) || 1)
  const hasFilters = !!(sp.q || sp.status)

  const [pendentesAba, periodoCounts, { items, total, pageSize }, advogados] =
    await Promise.all([
      getPendentesPorAba(),
      getPeriodoCountsIntimacoes(),
      getIntimacoes({
        search: sp.q,
        status: sp.status,
        periodo: periodo !== "todos" ? periodo : undefined,
        page,
      }),
      getAdvogados(),
    ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentParams = {
    q: sp.q,
    status: sp.status,
    periodo: periodo !== "todos" ? periodo : undefined,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-foreground">Atualizações</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Intimações eletrônicas dos sistemas dos tribunais, importadas do Expedit
          </p>
        </div>
      </div>

      <AtualizacoesTabs active="intimacoes" pendentes={pendentesAba} />

      <PeriodoCards
        counts={periodoCounts}
        active={periodo}
        basePath={BASE_PATH}
        baseParams={{ q: sp.q, status: sp.status }}
      />

      {/* Filters */}
      <form className="flex flex-wrap gap-2 items-center p-3 rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 ml-1" />
        {periodo !== "todos" && <input type="hidden" name="periodo" value={periodo} />}
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            name="q"
            aria-label="Buscar por processo, partes, destinatário ou órgão"
            placeholder="Processo, partes, destinatário ou órgão..."
            defaultValue={sp.q ?? ""}
            className="w-full h-8 pl-8 pr-3 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
          />
        </div>
        <select
          name="status"
          aria-label="Filtrar por status"
          defaultValue={sp.status || "PENDENTE"}
          className="h-8 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow cursor-pointer"
        >
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
            href={buildHref({ periodo: currentParams.periodo })}
            className="h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground flex items-center hover:bg-muted hover:text-foreground transition-colors"
          >
            Limpar
          </Link>
        )}
      </form>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <BellRing className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {hasFilters ? "Nenhum resultado" : "Nenhuma intimação pendente"}
          </p>
          <p className="text-xs text-muted-foreground/60">
            As intimações eletrônicas são importadas do Expedit pela sincronização.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/80 hover:bg-transparent">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Processo</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Evento</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Órgão</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Destinatário</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Ciência</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Prazo limite</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Status</TableHead>
                  <TableHead className="w-32 h-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow
                    key={i.id}
                    className="hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0 align-top"
                  >
                    <TableCell className="py-3">
                      {i.processo ? (
                        <Link
                          href={`/dashboard/processos/${i.processo.id}`}
                          className="font-mono text-[0.78rem] text-foreground/80 hover:text-foreground font-medium transition-colors"
                        >
                          {i.numProcesso}
                        </Link>
                      ) : (
                        <span className="font-mono text-[0.78rem] text-muted-foreground/70" title="Processo não cadastrado">
                          {i.numProcesso}
                        </span>
                      )}
                      <span className="block text-xs text-muted-foreground/70 truncate max-w-44">
                        {i.processo?.cliente.nome ?? i.partes ?? ""}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 text-sm text-muted-foreground whitespace-nowrap">
                      <span className="block">{i.evento ?? "—"}</span>
                      {i.sistema && (
                        <span className="block text-xs text-muted-foreground/60">{i.sistema}</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 text-sm text-muted-foreground max-w-52">
                      <span className="line-clamp-2">{i.orgao ?? "—"}</span>
                    </TableCell>
                    <TableCell className="py-3 text-sm text-muted-foreground max-w-44">
                      <span className="line-clamp-2">{i.destinatario ?? "—"}</span>
                    </TableCell>
                    <TableCell className="py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {i.dataCiencia ? fmtDate(i.dataCiencia) : "—"}
                    </TableCell>
                    <TableCell className="py-3 whitespace-nowrap">
                      <DataLimite data={i.dataLimite} />
                    </TableCell>
                    <TableCell className="py-3">
                      <PublicacaoStatusBadge status={i.status} />
                      {i.linkExpediente && (
                        <a
                          href={i.linkExpediente}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Expediente <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      {i.status === "PENDENTE" && (
                        <span className="flex items-center gap-1.5">
                          <TratarForm
                            action={tratarIntimacao}
                            idField="intimacaoId"
                            id={i.id}
                            numProcesso={i.numProcesso}
                            advogados={advogados}
                            tipoDefault="Prazo"
                            prazoDataDefault={toIsoDay(i.dataLimite) ?? ""}
                          />
                          <QuickActions
                            id={i.id}
                            marcarTratada={marcarIntimacaoTratada}
                            descartar={descartarIntimacao}
                          />
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Página {page} de {totalPages} · {total} resultado{total !== 1 ? "s" : ""}
              </span>
              <span className="inline-flex gap-2">
                {page > 1 && (
                  <Link
                    href={buildHref({ ...currentParams, page: String(page - 1) })}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={buildHref({ ...currentParams, page: String(page + 1) })}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    Próxima <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                )}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
