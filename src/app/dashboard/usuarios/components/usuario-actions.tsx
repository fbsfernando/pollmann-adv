"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { Pencil, KeyRound, Power } from "lucide-react"
import { editarUsuario, redefinirSenha, alternarAtivo } from "../actions"

type Usuario = {
  id: string
  name: string | null
  email: string
  role: string
  ativo: boolean
}

export function UsuarioActions({ usuario, isSelf }: { usuario: Usuario; isSelf: boolean }) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [senhaOpen, setSenhaOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pending, startTransition] = useTransition()

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    fd.set("id", usuario.id)
    const res = await editarUsuario(fd)
    setLoading(false)
    if ("error" in res && res.error) return toast.error(res.error)
    toast.success("Usuário atualizado")
    setEditOpen(false)
    router.refresh()
  }

  async function handleSenha(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    fd.set("id", usuario.id)
    const res = await redefinirSenha(fd)
    setLoading(false)
    if ("error" in res && res.error) return toast.error(res.error)
    toast.success("Senha redefinida")
    setSenhaOpen(false)
  }

  function handleToggle() {
    startTransition(async () => {
      const res = await alternarAtivo(usuario.id)
      if ("error" in res && res.error) {
        toast.error(res.error)
        return
      }
      toast.success(res.ativo ? "Usuário ativado" : "Usuário desativado")
      router.refresh()
    })
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => setEditOpen(true)}
        aria-label="Editar usuário"
        title="Editar"
      >
        <Pencil className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => setSenhaOpen(true)}
        aria-label="Redefinir senha"
        title="Redefinir senha"
      >
        <KeyRound className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending || isSelf}
        className={`h-8 w-8 ${
          usuario.ativo
            ? "text-muted-foreground hover:text-red-600"
            : "text-emerald-600 hover:text-emerald-700"
        } disabled:opacity-30`}
        onClick={handleToggle}
        aria-label={usuario.ativo ? "Desativar usuário" : "Ativar usuário"}
        title={isSelf ? "Você não pode desativar a si mesmo" : usuario.ativo ? "Desativar" : "Ativar"}
      >
        <Power className="w-3.5 h-3.5" />
      </Button>

      {/* Editar */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`name-${usuario.id}`}>Nome *</Label>
              <Input id={`name-${usuario.id}`} name="name" required defaultValue={usuario.name ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`email-${usuario.id}`}>E-mail *</Label>
              <Input id={`email-${usuario.id}`} name="email" type="email" required defaultValue={usuario.email} />
            </div>
            <div className="space-y-2">
              <Label>Perfil</Label>
              <Select name="role" defaultValue={usuario.role}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADVOGADO">Advogado</SelectItem>
                  <SelectItem value="ADMIN">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Redefinir senha */}
      <Dialog open={senhaOpen} onOpenChange={setSenhaOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redefinir senha — {usuario.name ?? usuario.email}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSenha} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`pwd-${usuario.id}`}>Nova senha *</Label>
              <Input
                id={`pwd-${usuario.id}`}
                name="password"
                type="password"
                required
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSenhaOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Salvando..." : "Redefinir"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
