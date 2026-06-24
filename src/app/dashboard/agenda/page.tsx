import { getTarefas, getAdvogadosFiltro } from "./actions"
import { ConcluirButton } from "./components/concluir-button"
import { DirecionarSelect } from "./components/direcionar-select"
import { TarefaStatusBadge } from "@/components/tarefa-status-badge"
import Link from "next/link"
import { Calendar, CalendarClock, AlertTriangle, CalendarDays, CheckCircle2, SlidersHorizontal } from "lucide-react"
import { TarefaStatus } from "@prisma/client"

type Tarefa = Awaited<ReturnType<typeof getTarefas>>[number]
type Advogado = Awaited<ReturnType<typeof getAdvogadosFiltro>>[number]

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d)

function classify(tarefas: Tarefa[]) {
  const today = startOfToday()
  const in7 = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
  const endToday = new Date(today.getTime() + 24 * 60 * 60 * 1000)

  const atrasadas: Tarefa[] = []
  const hoje: Tarefa[] = []
  const proximos: Tarefa[] = []
  const futuras: Tarefa[] = []
  const semPrazo: Tarefa[] = []
  const concluidas: Tarefa[] = []

  for (const t of tarefas) {
    // Concluídas/canceladas vão para sua própria seção, independente do prazo.
    if (t.status === TarefaStatus.CONCLUIDO || t.status === TarefaStatus.CANCELADO) {
      concluidas.push(t)
      continue
    }
    if (!t.prazoData) {
      semPrazo.push(t)
      continue
    }
    const prazo = new Date(t.prazoData)
    if (prazo < today) atrasadas.push(t)
    else if (prazo < endToday) hoje.push(t)
    else if (prazo < in7) proximos.push(t)
    else futuras.push(t)
  }
  return { atrasadas, hoje, proximos, futuras, semPrazo, concluidas }
}

function TarefaRow({ t, advogados }: { t: Tarefa; advogados: Advogado[] }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground/90">{t.titulo}</span>
          <TarefaStatusBadge status={t.status} />
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          {t.processo && (
            <Link
              href={`/dashboard/processos/${t.processo.id}`}
              className="font-mono hover:text-foreground transition-colors"
            >
              {t.processo.numero}
            </Link>
          )}
          <span>Resp.: {t.responsavel.name ?? t.responsavel.email}</span>
          {t.prazoData && <span>Prazo: {fmtDate(new Date(t.prazoData))}</span>}
        </div>
        {t.descricao && (
          <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-1">{t.descricao}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {advogados.length > 0 && <DirecionarSelect tarefaId={t.id} advogados={advogados} />}
        <ConcluirButton tarefaId={t.id} />
      </div>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  tone,
  tarefas,
  advogados,
}: {
  title: string
  icon: typeof Calendar
  tone: string
  tarefas: Tarefa[]
  advogados: Advogado[]
}) {
  if (tarefas.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <Icon className={`w-4 h-4 ${tone}`} />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md tabular-nums">
          {tarefas.length}
        </span>
      </div>
      <div>
        {tarefas.map((t) => (
          <TarefaRow key={t.id} t={t} advogados={advogados} />
        ))}
      </div>
    </div>
  )
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ responsavel?: string; concluidas?: string }>
}) {
  const { responsavel, concluidas } = await searchParams
  const incluirConcluidas = concluidas === "1"

  const [tarefas, advogados] = await Promise.all([
    getTarefas({ responsavelId: responsavel || undefined, incluirConcluidas }),
    getAdvogadosFiltro(),
  ])
  const { atrasadas, hoje, proximos, futuras, semPrazo, concluidas: feitas } = classify(tarefas)
  const isAdmin = advogados.length > 0
  const hasFilters = !!responsavel || incluirConcluidas
  const abertas = tarefas.length - feitas.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl text-foreground">Agenda</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {abertas === 0
            ? "Nenhuma tarefa em aberto"
            : `${abertas} tarefa${abertas !== 1 ? "s" : ""} em aberto`}
        </p>
      </div>

      {/* Filtros (advogado só para admin; concluídas para todos) */}
      <form className="flex flex-wrap gap-2 items-center p-3 rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 ml-1" />
        {isAdmin && (
          <select
            name="responsavel"
            aria-label="Filtrar por advogado"
            defaultValue={responsavel ?? ""}
            className="h-8 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow cursor-pointer"
          >
            <option value="">Todos os advogados</option>
            {advogados.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? a.email}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            name="concluidas"
            value="1"
            defaultChecked={incluirConcluidas}
            className="accent-primary"
          />
          Incluir concluídas
        </label>
        <button
          type="submit"
          className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Filtrar
        </button>
        {hasFilters && (
          <Link
            href="/dashboard/agenda"
            className="h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground flex items-center hover:bg-muted hover:text-foreground transition-colors"
          >
            Limpar
          </Link>
        )}
      </form>

      {tarefas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Calendar className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {hasFilters ? "Nenhuma tarefa para o filtro" : "Nenhuma tarefa"}
          </p>
          <p className="text-xs text-muted-foreground/60">
            As tarefas aparecem aqui quando publicações são direcionadas a você.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <Section title="Atrasadas" icon={AlertTriangle} tone="text-red-500" tarefas={atrasadas} advogados={advogados} />
          <Section title="Hoje" icon={CalendarClock} tone="text-amber-500" tarefas={hoje} advogados={advogados} />
          <Section title="Próximos 7 dias" icon={Calendar} tone="text-blue-500" tarefas={proximos} advogados={advogados} />
          <Section title="Futuras" icon={CalendarDays} tone="text-muted-foreground" tarefas={futuras} advogados={advogados} />
          <Section title="Sem prazo" icon={CalendarDays} tone="text-muted-foreground" tarefas={semPrazo} advogados={advogados} />
          {incluirConcluidas && (
            <Section title="Concluídas" icon={CheckCircle2} tone="text-emerald-500" tarefas={feitas} advogados={advogados} />
          )}
        </div>
      )}
    </div>
  )
}
