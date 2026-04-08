"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { createCliente, updateCliente } from "../actions"
import { Plus, Pencil } from "lucide-react"

interface ClienteFormProps {
  cliente?: {
    id: string
    nome: string
    cpfCnpj: string | null
    email: string | null
    telefone: string | null
    observacoes: string | null
  }
  trigger?: React.ReactElement
}

export function ClienteForm({ cliente, trigger }: ClienteFormProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const isEditing = !!cliente

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = isEditing
      ? await updateCliente(cliente!.id, formData)
      : await createCliente(formData)

    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success(isEditing ? "Cliente atualizado" : "Cliente criado")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={trigger || (
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Novo Cliente
          </Button>
        )}
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar Cliente" : "Novo Cliente"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome *</Label>
            <Input
              id="nome"
              name="nome"
              defaultValue={cliente?.nome ?? ""}
              required
              placeholder="Nome completo ou razão social"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cpfCnpj">CPF / CNPJ</Label>
            <Input
              id="cpfCnpj"
              name="cpfCnpj"
              defaultValue={cliente?.cpfCnpj ?? ""}
              placeholder="000.000.000-00"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={cliente?.email ?? ""}
                placeholder="email@exemplo.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone</Label>
              <Input
                id="telefone"
                name="telefone"
                defaultValue={cliente?.telefone ?? ""}
                placeholder="(00) 00000-0000"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="observacoes">Observações</Label>
            <Textarea
              id="observacoes"
              name="observacoes"
              defaultValue={cliente?.observacoes ?? ""}
              placeholder="Notas sobre o cliente..."
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Salvando..." : isEditing ? "Salvar" : "Criar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EditClienteButton({ cliente }: { cliente: ClienteFormProps["cliente"] }) {
  return (
    <ClienteForm
      cliente={cliente}
      trigger={
        <button type="button" className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted cursor-pointer">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      }
    />
  )
}
