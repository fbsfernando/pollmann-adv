import { getClientes } from "./actions"
import { ClienteForm, EditClienteButton } from "./components/cliente-form"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import Link from "next/link"
import { Search, Users } from "lucide-react"

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const clientes = await getClientes(q)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-foreground">Clientes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {clientes.length === 0
              ? "Nenhum cliente"
              : `${clientes.length} cliente${clientes.length !== 1 ? "s" : ""} cadastrado${clientes.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <ClienteForm />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 p-3 rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <Search className="w-3.5 h-3.5 text-muted-foreground/50 ml-1 shrink-0" />
        <form className="flex-1 flex items-center gap-2">
          <input
            name="q"
            placeholder="Buscar por nome ou CPF/CNPJ..."
            defaultValue={q ?? ""}
            className="flex-1 h-8 px-3 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow max-w-sm"
          />
          <button
            type="submit"
            className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Buscar
          </button>
          {q && (
            <Link
              href="/dashboard/clientes"
              className="h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground flex items-center hover:bg-muted hover:text-foreground transition-colors"
            >
              Limpar
            </Link>
          )}
        </form>
      </div>

      {/* Table */}
      {clientes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Users className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {q ? "Nenhum resultado" : "Nenhum cliente cadastrado"}
          </p>
          {q ? (
            <Link href="/dashboard/clientes" className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors">
              Limpar busca
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground/60">Crie o primeiro cliente usando o botão acima</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/80 hover:bg-transparent">
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Nome</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">CPF/CNPJ</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Telefone</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10 text-center">Processos</TableHead>
                <TableHead className="w-10 h-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientes.map((c) => (
                <TableRow
                  key={c.id}
                  className="hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0"
                >
                  <TableCell className="py-3">
                    <Link
                      href={`/dashboard/clientes/${c.id}`}
                      className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
                    >
                      {c.nome}
                    </Link>
                    {c.email && (
                      <p className="text-xs text-muted-foreground/50 mt-0.5">
                        {c.email}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="text-sm font-mono text-muted-foreground">
                      {c.cpfCnpj ?? <span className="text-muted-foreground/30">—</span>}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">
                    {c.telefone ?? <span className="text-muted-foreground/30">—</span>}
                  </TableCell>
                  <TableCell className="py-3 text-center">
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md tabular-nums">
                      {c._count.processos}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    <EditClienteButton cliente={c} />
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
