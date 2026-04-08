import { notFound } from "next/navigation"
import { getCliente } from "../actions"
import { EditClienteButton } from "../components/cliente-form"
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
import { ArrowLeft, Mail, Phone, FileText } from "lucide-react"

export default async function ClienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const cliente = await getCliente(id)

  if (!cliente) notFound()

  const hasContact = cliente.email || cliente.telefone

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/clientes"
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-heading text-2xl text-foreground truncate">
            {cliente.nome}
          </h1>
          {cliente.cpfCnpj && (
            <p className="text-sm font-mono text-muted-foreground mt-0.5">
              {cliente.cpfCnpj}
            </p>
          )}
        </div>
        <EditClienteButton cliente={cliente} />
      </div>

      {/* Info strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border rounded-xl overflow-hidden border border-border shadow-[var(--shadow-card)]">
        {/* Contato */}
        <div className="bg-card px-5 py-4 space-y-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Contato
          </p>
          {hasContact ? (
            <div className="space-y-1.5">
              {cliente.email && (
                <div className="flex items-center gap-2 text-sm text-foreground/80">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  <a href={`mailto:${cliente.email}`} className="hover:text-foreground transition-colors truncate">
                    {cliente.email}
                  </a>
                </div>
              )}
              {cliente.telefone && (
                <div className="flex items-center gap-2 text-sm text-foreground/80">
                  <Phone className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  <a href={`tel:${cliente.telefone}`} className="hover:text-foreground transition-colors">
                    {cliente.telefone}
                  </a>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/50">Sem contato cadastrado</p>
          )}
        </div>

        {/* Processos count */}
        <div className="bg-card px-5 py-4 space-y-1">
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Processos
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold stat-number text-foreground">
              {cliente.processos.length}
            </span>
            <span className="text-sm text-muted-foreground/60">
              processo{cliente.processos.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Observações */}
      {cliente.observacoes && (
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-700/60 mb-1">
            Observações
          </p>
          <p className="text-sm text-foreground/80 leading-relaxed">
            {cliente.observacoes}
          </p>
        </div>
      )}

      {/* Processos table */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-4">
          Processos vinculados
        </h2>

        {cliente.processos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <FileText className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum processo vinculado</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/80 hover:bg-transparent">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Número</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Tribunal</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Área</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Advogado</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cliente.processos.map((p) => (
                  <TableRow
                    key={p.id}
                    className="hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0"
                  >
                    <TableCell className="py-3">
                      <Link
                        href={`/dashboard/processos/${p.id}`}
                        className="font-mono text-[0.78rem] font-medium text-foreground/80 hover:text-foreground transition-colors"
                      >
                        {p.numero}
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
                    <TableCell className="py-3">
                      <StatusBadge status={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
