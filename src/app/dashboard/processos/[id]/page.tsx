import { notFound } from "next/navigation"
import { getProcesso } from "../actions"
import { EditProcessoButton } from "../components/processo-form"
import { StatusBadge } from "@/components/status-badge"
import Link from "next/link"
import {
  ArrowLeft,
  Calendar,
  FileText,
  User,
  MapPin,
  Download,
  ExternalLink,
  Bot,
  Pencil,
} from "lucide-react"

function formatDateTime(date: Date | string) {
  return new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDateShort(date: Date | string) {
  return new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export default async function ProcessoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const processo = await getProcesso(id)

  if (!processo) notFound()

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          href="/dashboard/processos"
          className="mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-mono text-xl font-semibold text-foreground">
              {processo.numero}
            </h1>
            <StatusBadge status={processo.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {[processo.area, processo.vara].filter(Boolean).join(" · ") || "Sem vara/área definida"}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(processo.tribunal === "TJSC" || processo.tribunal === "TJRS") && (
            <a
              href={`/api/processos/${processo.id}/eproc-link`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              E-PROC
            </a>
          )}
          <EditProcessoButton processo={processo} />
        </div>
      </div>

      {/* Info strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border rounded-xl overflow-hidden border border-border shadow-[var(--shadow-card)]">
        {/* Cliente */}
        <div className="bg-card px-5 py-4 space-y-1">
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
            <User className="w-3 h-3" />
            Cliente
          </p>
          <Link
            href={`/dashboard/clientes/${processo.clienteId}`}
            className="text-sm font-medium text-foreground hover:text-accent transition-colors"
          >
            {processo.cliente.nome}
          </Link>
          {processo.cliente.cpfCnpj && (
            <p className="text-xs text-muted-foreground/60 font-mono">
              {processo.cliente.cpfCnpj}
            </p>
          )}
        </div>

        {/* Tribunal */}
        <div className="bg-card px-5 py-4 space-y-1">
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
            <MapPin className="w-3 h-3" />
            Tribunal
          </p>
          <p className="text-sm font-semibold text-foreground">
            {processo.tribunal}
          </p>
          {processo.vara && (
            <p className="text-xs text-muted-foreground/60">{processo.vara}</p>
          )}
        </div>

        {/* Advogado */}
        <div className="bg-card px-5 py-4 space-y-1">
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
            <User className="w-3 h-3" />
            Advogado
          </p>
          <p className="text-sm font-medium text-foreground">
            {processo.advogado?.name ?? (
              <span className="text-muted-foreground/50 font-normal">Não atribuído</span>
            )}
          </p>
        </div>
      </div>

      {/* Observações */}
      {processo.observacoes && (
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-700/60 mb-1">
            Observações
          </p>
          <p className="text-sm text-foreground/80 leading-relaxed">
            {processo.observacoes}
          </p>
        </div>
      )}

      {/* Timeline */}
      <div>
        <div className="flex items-center gap-2 mb-5">
          <Calendar className="w-4 h-4 text-muted-foreground/50" />
          <h2 className="text-sm font-semibold text-foreground">
            Andamentos
          </h2>
          <span className="text-xs text-muted-foreground/50 ml-1">
            {processo._count.andamentos}
            {processo._count.andamentos > 50 && " · exibindo os 50 mais recentes"}
          </span>
        </div>

        {processo.andamentos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <Calendar className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum andamento registrado</p>
          </div>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[7px] top-3 bottom-3 w-px bg-gradient-to-b from-border via-border to-transparent" />

            <div className="space-y-0">
              {processo.andamentos.map((andamento, idx) => (
                <div key={andamento.id} className="flex gap-5 pb-6 last:pb-0">
                  {/* Node */}
                  <div className="relative flex flex-col items-center shrink-0 w-[15px] mt-[6px]">
                    <div className={`w-[15px] h-[15px] rounded-full border-2 bg-background z-10 ${
                      andamento.fonte === "SCRAPER"
                        ? "border-accent"
                        : "border-border"
                    }`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[0.8rem] font-semibold text-foreground">
                          {andamento.tipo}
                        </span>
                        {andamento.fonte === "SCRAPER" && (
                          <span className="inline-flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-wider text-accent/80 bg-accent/8 px-1.5 py-0.5 rounded-md">
                            <Bot className="w-2.5 h-2.5" />
                            Scraper
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground/50 whitespace-nowrap shrink-0">
                        {formatDateShort(andamento.data)}
                      </span>
                    </div>

                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {andamento.descricao}
                    </p>

                    {/* Documentos */}
                    {andamento.documentos.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {andamento.documentos.map((doc) => (
                          <a
                            key={doc.id}
                            href={`/api/documentos/${doc.id}/download`}
                            target="_blank"
                            rel="noreferrer"
                            title="Baixar do E-PROC (pode levar ~30s)"
                            className="flex items-center gap-2.5 text-xs text-muted-foreground bg-muted/50 border border-border/50 px-3 py-2 rounded-lg hover:bg-muted hover:text-foreground hover:border-border transition-all group max-w-sm"
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                            <span className="flex-1 truncate">{doc.nome}</span>
                            <Download className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
