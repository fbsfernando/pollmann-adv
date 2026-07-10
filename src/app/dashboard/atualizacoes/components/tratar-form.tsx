"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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

const TIPOS = [
  "Intimação",
  "Despacho",
  "Decisão",
  "Sentença",
  "Audiência",
  "Prazo",
  "Diligência",
  "Recurso",
  "Outro",
]

export type TratarResult = { error?: string; success?: boolean }

interface TratarFormProps {
  /** Server action que recebe o FormData e cria a tarefa direcionada. */
  action: (formData: FormData) => Promise<TratarResult>
  /** Nome do campo hidden com o id (ex.: "publicacaoId" | "intimacaoId"). */
  idField: string
  id: string
  numProcesso: string
  advogados: { id: string; name: string | null; email: string }[]
  /** Tipo pré-selecionado (ex.: "Intimação" na aba de intimações). */
  tipoDefault?: string
  /** Pré-preenche o prazo em data absoluta (ex.: data limite da intimação). */
  prazoDataDefault?: string
}

export function TratarForm({
  action,
  idField,
  id,
  numProcesso,
  advogados,
  tipoDefault = "Intimação",
  prazoDataDefault,
}: TratarFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    formData.set(idField, id)
    const result = await action(formData)
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Tratada — tarefa direcionada")
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            Tratar
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tratar — {numProcesso}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo *</Label>
            <Select name="tipo" defaultValue={tipoDefault}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`dataInicio-${id}`}>Data de início</Label>
              <Input id={`dataInicio-${id}`} name="dataInicio" type="date" />
            </div>
            {prazoDataDefault ? (
              <div className="space-y-2">
                <Label htmlFor={`prazoData-${id}`}>Prazo (data limite)</Label>
                <Input
                  id={`prazoData-${id}`}
                  name="prazoData"
                  type="date"
                  defaultValue={prazoDataDefault}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor={`prazoDias-${id}`}>Prazo (dias)</Label>
                <Input
                  id={`prazoDias-${id}`}
                  name="prazoDias"
                  type="number"
                  min={0}
                  placeholder="Ex.: 15"
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Responsável *</Label>
            <Select name="responsavelId" required>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o advogado..." />
              </SelectTrigger>
              <SelectContent>
                {advogados.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name ?? a.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`observacao-${id}`}>Observação</Label>
            <Textarea
              id={`observacao-${id}`}
              name="observacao"
              placeholder="Instruções para o responsável..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Salvando..." : "Direcionar tarefa"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
