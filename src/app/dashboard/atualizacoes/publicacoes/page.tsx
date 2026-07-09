import Link from "next/link"
import {
  Search,
  SlidersHorizontal,
  Bell,
  ExternalLink,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Newspaper,
} from "lucide-react"

import {
  getPublicacoes,
  getAdvogados,
  getDiarios,
  getEdicoes,
  getPeriodoCounts,
  tratarPublicacao,
  marcarTratada,
  descartarPublicacao,
  type Edicao,
} from "./actions"
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

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)

/** "YYYY-MM-DD" → "dd/mm/yyyy" sem passar por Date (evita fuso). */
const fmtDia = (dia: string) => {
  const [y, m, d] = dia.split("-")
  return `${d}/${m}/${y}`
}

const BASE_PATH = "/dashboard/atualizacoes/publicacoes"

type SP = {
  q?: string
  diario?: string
  status?: string
  periodo?: string
  dia?: string
  page?: string
  view?: string
}

const buildHref = (params: Record<string, string | undefined>) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `${BASE_PATH}?${s}` : BASE_PATH
}

/** Progresso de tratamento de uma edição (padrão Expedit: 0/5, Parcial, Concluído). */
function TratamentoBadge({ edicao }: { edicao: Edicao }) {
  const feitas = edicao.total - edicao.pendentes
  const label =
    edicao.pendentes === 0 ? "Concluído" : feitas === 0 ? "Pendente" : "Parcial"
  const cls =
    edicao.pendentes === 0
      ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400"
      : feitas === 0
        ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
        : "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400"
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center text-[0.68rem] font-semibold px-2 py-0.5 rounded-full ring-1 whitespace-nowrap tracking-wide",
          cls
        )}
      >
        {label}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {feitas}/{edicao.total}
      </span>
    </span>
  )
}

function Pagination({
  page,
  total,
  pageSize,
  params,
}: {
  page: number
  total: number
  pageSize: number
  params: Record<string, string | undefined>
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null
  const linkCls =
    "inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Página {page} de {totalPages} · {total} resultado{total !== 1 ? "s" : ""}
      </span>
      <span className="inline-flex gap-2">
        {page > 1 && (
          <Link href={buildHref({ ...params, page: String(page - 1) })} className={linkCls}>
            <ChevronLeft className="w-3.5 h-3.5" /> Anterior
          </Link>
        )}
        {page < totalPages && (
          <Link href={buildHref({ ...params, page: String(page + 1) })} className={linkCls}>
            Próxima <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </span>
    </div>
  )
}

export default async function PublicacoesPage({
  searchParams,
}: {
  searchParams: Promise<SP>
}) {
  const sp = await searchParams
  const periodo: Periodo = isPeriodo(sp.periodo) ? sp.periodo : "todos"
  const dia = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : undefined
  const drill = !!dia
  const flat = !drill && !!(sp.q || sp.status || sp.diario || sp.view === "lista")
  const page = Math.max(1, Number(sp.page) || 1)

  const [pendentesAba, periodoCounts] = await Promise.all([
    getPendentesPorAba(),
    getPeriodoCounts(),
  ])

  const currentParams: Record<string, string | undefined> = {
    q: sp.q,
    diario: sp.diario,
    status: sp.status,
    periodo: periodo !== "todos" ? periodo : undefined,
    dia,
    view: sp.view,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-foreground">Atualizações</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Publicações dos diários oficiais, importadas do Expedit
          </p>
        </div>
      </div>

      <AtualizacoesTabs active="publicacoes" pendentes={pendentesAba} />

      {!drill && (
        <PeriodoCards
          counts={periodoCounts}
          active={periodo}
          basePath={BASE_PATH}
          baseParams={{ view: sp.view, status: sp.status, diario: sp.diario, q: sp.q }}
        />
      )}

      {drill ? (
        <DrillDown dia={dia} sp={sp} page={page} currentParams={currentParams} />
      ) : flat ? (
        <ListaPlana sp={sp} periodo={periodo} page={page} currentParams={currentParams} />
      ) : (
        <Edicoes periodo={periodo} />
      )}
    </div>
  )
}

/** Visão padrão: edições de diário com progresso de tratamento. */
async function Edicoes({ periodo }: { periodo: Periodo }) {
  const edicoes = await getEdicoes(periodo)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {edicoes.length === 0
            ? "Nenhuma edição no período"
            : `${edicoes.length} ediç${edicoes.length !== 1 ? "ões" : "ão"} de diário`}
        </p>
        <Link
          href={buildHref({ view: "lista", ...(periodo !== "todos" ? { periodo } : {}) })}
          className="text-xs text-primary hover:underline"
        >
          Ver como lista →
        </Link>
      </div>

      {edicoes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Newspaper className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm font-medium text-muted-foreground mb-1">Nenhuma publicação</p>
          <p className="text-xs text-muted-foreground/60">
            As publicações são importadas do Expedit pela sincronização.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/80 hover:bg-transparent">
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Publicação</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">UF</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Diário</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10 text-center">Publicações</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Tratamento</TableHead>
                <TableHead className="w-10 h-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {edicoes.map((e) => {
                const href = buildHref({
                  dia: e.dia,
                  diario: e.siglaDiario ?? undefined,
                })
                return (
                  <TableRow
                    key={`${e.dia}|${e.siglaDiario}`}
                    className="hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0"
                  >
                    <TableCell className="py-3 text-sm text-foreground whitespace-nowrap font-medium">
                      <Link href={href} className="block">{fmtDia(e.dia)}</Link>
                    </TableCell>
                    <TableCell className="py-3 text-sm text-muted-foreground whitespace-nowrap">
                      <Link href={href} className="block">{e.uf ?? "—"}</Link>
                    </TableCell>
                    <TableCell className="py-3 max-w-md">
                      <Link href={href} className="block">
                        <span className="text-sm font-medium text-foreground/90">
                          {e.siglaDiario ?? "—"}
                        </span>
                        {e.nomeDiario && (
                          <span className="block text-xs text-muted-foreground truncate">
                            {e.nomeDiario}
                          </span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="py-3 text-sm text-foreground text-center tabular-nums">
                      <Link href={href} className="block">{e.total}</Link>
                    </TableCell>
                    <TableCell className="py-3">
                      <Link href={href} className="block">
                        <TratamentoBadge edicao={e} />
                      </Link>
                    </TableCell>
                    <TableCell className="py-3">
                      <Link href={href} aria-label="Abrir edição" className="block text-muted-foreground/50 hover:text-foreground">
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/** Drill-down: publicações de uma edição, em cards ricos (padrão Expedit). */
async function DrillDown({
  dia,
  sp,
  page,
  currentParams,
}: {
  dia: string
  sp: SP
  page: number
  currentParams: Record<string, string | undefined>
}) {
  const [{ items, total, pageSize }, advogados] = await Promise.all([
    // Dentro da edição mostramos todas por padrão, com badge de status por card.
    getPublicacoes({ dia, diario: sp.diario, status: sp.status ?? "TODAS", page }),
    getAdvogados(),
  ])
  const pendentes = items.filter((p) => p.status === "PENDENTE").length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={buildHref({})}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Diários
          </Link>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {sp.diario ?? "Diário"} · {fmtDia(dia)}
            </h2>
            <p className="text-xs text-muted-foreground">
              {items[0]?.nomeDiario ?? "Edição do diário"} — {total} publicaç
              {total !== 1 ? "ões" : "ão"}
              {pendentes > 0 ? `, ${pendentes} pendente${pendentes !== 1 ? "s" : ""} nesta página` : ""}
            </p>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Bell className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm font-medium text-muted-foreground">Nenhuma publicação nesta edição</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  {p.processo ? (
                    <Link
                      href={`/dashboard/processos/${p.processo.id}`}
                      className="font-mono text-sm text-foreground font-medium hover:text-primary transition-colors"
                    >
                      {p.numProcesso}
                    </Link>
                  ) : (
                    <span
                      className="font-mono text-sm text-muted-foreground"
                      title="Processo não cadastrado"
                    >
                      {p.numProcesso}
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.processo
                      ? p.processo.cliente.nome
                      : "Processo não cadastrado na plataforma"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <PublicacaoStatusBadge status={p.status} />
                  {p.status === "PENDENTE" && (
                    <>
                      <TratarForm
                        action={tratarPublicacao}
                        idField="publicacaoId"
                        id={p.id}
                        numProcesso={p.numProcesso}
                        advogados={advogados}
                      />
                      <QuickActions
                        id={p.id}
                        marcarTratada={marcarTratada}
                        descartar={descartarPublicacao}
                      />
                    </>
                  )}
                </div>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2 text-xs">
                {[
                  ["Tipo", p.tipoComunicacao],
                  ["Vara", p.vara],
                  ["Comarca", p.comarca ? `${p.comarca}${p.uf ? ` / ${p.uf}` : ""}` : p.uf],
                  ["Órgão", p.orgao],
                  ["Publicação", fmtDate(p.dataPublicacao)],
                  ["Disponibilização", p.dataDisponibilizacao ? fmtDate(p.dataDisponibilizacao) : null],
                ]
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <div key={label as string} className="min-w-0">
                      <dt className="text-muted-foreground/60 uppercase tracking-wide text-[0.6rem] font-semibold">
                        {label}
                      </dt>
                      <dd className="text-foreground/80 truncate" title={value as string}>
                        {value}
                      </dd>
                    </div>
                  ))}
              </dl>

              {p.insightIa && (
                <p className="flex items-start gap-1.5 text-xs text-violet-800 bg-violet-500/8 border border-violet-500/15 rounded-md px-2 py-1.5">
                  <Sparkles className="w-3 h-3 shrink-0 mt-0.5 text-violet-600" />
                  <span>{p.insightIa}</span>
                </p>
              )}

              <details className="group text-sm text-foreground/80">
                <summary className="line-clamp-2 group-open:line-clamp-none cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:text-foreground transition-colors whitespace-pre-line">
                  {p.conteudo}
                </summary>
              </details>

              {p.inteiroTeorUrl && (
                <a
                  href={p.inteiroTeorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Inteiro teor <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ))}
          <Pagination page={page} total={total} pageSize={pageSize} params={currentParams} />
        </div>
      )}
    </div>
  )
}

/** Lista plana com busca/filtros/paginação (visão alternativa). */
async function ListaPlana({
  sp,
  periodo,
  page,
  currentParams,
}: {
  sp: SP
  periodo: Periodo
  page: number
  currentParams: Record<string, string | undefined>
}) {
  const [{ items, total, pageSize }, advogados, diarios] = await Promise.all([
    getPublicacoes({
      search: sp.q,
      diario: sp.diario,
      status: sp.status,
      periodo: periodo !== "todos" ? periodo : undefined,
      page,
    }),
    getAdvogados(),
    getDiarios(),
  ])
  const hasFilters = !!(sp.q || sp.diario || sp.status)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <form className="flex flex-wrap gap-2 items-center p-3 rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 ml-1" />
        {periodo !== "todos" && <input type="hidden" name="periodo" value={periodo} />}
        <input type="hidden" name="view" value="lista" />
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            name="q"
            aria-label="Buscar por número do processo ou conteúdo"
            placeholder="Número do processo ou conteúdo..."
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
        {diarios.length > 0 && (
          <select
            name="diario"
            aria-label="Filtrar por diário"
            defaultValue={sp.diario ?? ""}
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
        <Link
          href={buildHref(hasFilters ? {} : { ...(periodo !== "todos" ? { periodo } : {}) })}
          className="h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground flex items-center hover:bg-muted hover:text-foreground transition-colors"
        >
          {hasFilters ? "Limpar" : "Ver por diário"}
        </Link>
      </form>

      {items.length === 0 ? (
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
        <>
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
                  <TableHead className="w-32 h-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
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
                      <span className="block text-xs text-muted-foreground/70 truncate max-w-44">
                        {p.processo?.cliente.nome ?? ""}
                      </span>
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
                        <span className="flex items-center gap-1.5">
                          <TratarForm
                            action={tratarPublicacao}
                            idField="publicacaoId"
                            id={p.id}
                            numProcesso={p.numProcesso}
                            advogados={advogados}
                          />
                          <QuickActions
                            id={p.id}
                            marcarTratada={marcarTratada}
                            descartar={descartarPublicacao}
                          />
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} total={total} pageSize={pageSize} params={currentParams} />
        </>
      )}
    </div>
  )
}
