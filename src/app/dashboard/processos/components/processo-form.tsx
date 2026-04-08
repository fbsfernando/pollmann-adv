"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { createProcesso, updateProcesso, getFormOptions } from "../actions"
import { Plus, Pencil } from "lucide-react"
import { Tribunal, StatusProcesso } from "@prisma/client"

const tribunais: Tribunal[] = ["TJSC", "TJRS", "TJPR", "TJSP", "TJRJ", "TJMG", "TJGO", "TJPA", "OUTRO"]
const statusList: StatusProcesso[] = ["ATIVO", "ARQUIVADO", "SUSPENSO", "ENCERRADO"]
const areas = ["Cível", "Trabalhista", "Imobiliário", "Tributário", "Previdenciário", "Consumidor", "Penal", "Família", "Empresarial"]

interface ProcessoFormProps {
  processo?: {
    id: string
    numero: string
    tribunal: Tribunal
    vara: string | null
    area: string | null
    status: StatusProcesso
    clienteId: string
    advogadoId: string | null
    observacoes: string | null
  }
  trigger?: React.ReactElement
}

export function ProcessoForm({ processo, trigger }: ProcessoFormProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState<{
    clientes: { id: string; nome: string }[]
    advogados: { id: string; name: string | null }[]
  }>({ clientes: [], advogados: [] })

  useEffect(() => {
    if (open) {
      getFormOptions().then(setOptions)
    }
  }, [open])

  const isEditing = !!processo

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = isEditing
      ? await updateProcesso(processo!.id, formData)
      : await createProcesso(formData)

    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success(isEditing ? "Processo atualizado" : "Processo criado")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={trigger || (
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Novo Processo
          </Button>
        )}
      />
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar Processo" : "Novo Processo"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="numero">Número do Processo *</Label>
            <Input
              id="numero"
              name="numero"
              defaultValue={processo?.numero ?? ""}
              required
              placeholder="0000000-00.0000.0.00.0000"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tribunal *</Label>
              <Select name="tribunal" defaultValue={processo?.tribunal ?? "TJSC"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tribunais.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select name="status" defaultValue={processo?.status ?? "ATIVO"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusList.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vara">Vara</Label>
              <Input
                id="vara"
                name="vara"
                defaultValue={processo?.vara ?? ""}
                placeholder="1ª Vara Cível..."
              />
            </div>
            <div className="space-y-2">
              <Label>Área</Label>
              <Select name="area" defaultValue={processo?.area ?? ""}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {areas.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Cliente *</Label>
            <Select name="clienteId" defaultValue={processo?.clienteId ?? ""} required>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o cliente..." />
              </SelectTrigger>
              <SelectContent>
                {options.clientes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Advogado Responsável</Label>
            <Select name="advogadoId" defaultValue={processo?.advogadoId ?? ""}>
              <SelectTrigger>
                <SelectValue placeholder="Não atribuído" />
              </SelectTrigger>
              <SelectContent>
                {options.advogados.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name ?? a.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="observacoes">Observações</Label>
            <Textarea
              id="observacoes"
              name="observacoes"
              defaultValue={processo?.observacoes ?? ""}
              placeholder="Notas sobre o processo..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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

export function EditProcessoButton({ processo }: { processo: ProcessoFormProps["processo"] }) {
  return (
    <ProcessoForm
      processo={processo}
      trigger={
        <button type="button" className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted cursor-pointer">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      }
    />
  )
}
