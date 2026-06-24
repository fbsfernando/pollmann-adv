import { getUsuarios } from "./actions"
import { UsuarioForm } from "./components/usuario-form"
import { UsuarioActions } from "./components/usuario-actions"
import { requireAuth } from "@/lib/auth/guards"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { UserCog } from "lucide-react"

const roleLabel: Record<string, string> = {
  ADMIN: "Administrador",
  ADVOGADO: "Advogado",
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d)

export default async function UsuariosPage() {
  const [session, usuarios] = await Promise.all([requireAuth(), getUsuarios()])
  const currentUserId = session.user.id

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-foreground">Usuários</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {usuarios.length} usuário{usuarios.length !== 1 ? "s" : ""} · advogados parceiros com login próprio
          </p>
        </div>
        <UsuarioForm />
      </div>

      {usuarios.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <UserCog className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm font-medium text-muted-foreground mb-1">Nenhum usuário</p>
          <p className="text-xs text-muted-foreground/60">Crie o primeiro usando o botão acima</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/80 hover:bg-transparent">
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Nome</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">E-mail</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Perfil</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10 text-center">Tarefas</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Status</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10">Criado em</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 h-10 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuarios.map((u) => (
                <TableRow
                  key={u.id}
                  className="hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0"
                >
                  <TableCell className="py-3 text-sm text-foreground/90">
                    {u.name ?? <span className="text-muted-foreground/30">—</span>}
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">{u.email}</TableCell>
                  <TableCell className="py-3">
                    <span className="text-xs font-medium text-muted-foreground/70 bg-muted px-2 py-0.5 rounded-md">
                      {roleLabel[u.role] ?? u.role}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-center">
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md tabular-nums">
                      {u._count.tarefasResponsavel}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    {u.ativo ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Ativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                        Inativo
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">{fmtDate(u.createdAt)}</TableCell>
                  <TableCell className="py-3">
                    <UsuarioActions usuario={u} isSelf={u.id === currentUserId} />
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
