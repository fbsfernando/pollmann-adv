import { beforeEach, describe, expect, it, vi } from "vitest"

function toFormData(values: Record<string, string>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value)
  }
  return formData
}

type SessionRole = "GESTAO" | "ADVOGADO"
type SessionUser = { id: string; role: SessionRole }
type Session = { user: SessionUser }
type ProcessoRecord = {
  id: string
  numero: string
  tribunal: string
  vara: string
  area: string
  status: string
  clienteId: string
  advogadoId: string
  observacoes?: string
  cliente: { id: string; nome: string }
  advogado: { id: string; name: string }
  andamentos: unknown[]
  createdAt: Date
  updatedAt: Date
}

const revalidatePathMock = vi.hoisted(() => vi.fn())
const redirectMock = vi.hoisted(() => vi.fn())
const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>())

const prismaState = vi.hoisted(() => {
  const records = new Map<string, ProcessoRecord>()

  return {
    records,
    reset() {
      records.clear()
    },
  }
})

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/auth", () => ({
  auth: authMock,
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    processo: {
      findMany: vi.fn(async ({ where }: { where?: { advogadoId?: string; OR?: Array<{ numero?: { contains?: string }; cliente?: { nome?: { contains?: string } } }> } }) => {
        const values = Array.from(prismaState.records.values())

        return values.filter((item) => {
          if (!where) return true
          if (where.advogadoId && item.advogadoId !== where.advogadoId) return false

          if (where.OR?.length) {
            const matchesOr = where.OR.some((clause) => {
              const numeroContains = clause.numero?.contains
              const clienteNomeContains = clause.cliente?.nome?.contains
              const numeroMatch = numeroContains ? item.numero.includes(numeroContains) : false
              const clienteMatch = clienteNomeContains ? item.cliente.nome.includes(clienteNomeContains) : false
              return numeroMatch || clienteMatch
            })

            if (!matchesOr) return false
          }

          return true
        })
      }),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; advogadoId?: string } }) => {
        const values = Array.from(prismaState.records.values())
        return values.find((item) => {
          if (where.id && item.id !== where.id) return false
          if (where.advogadoId && item.advogadoId !== where.advogadoId) return false
          return true
        }) ?? null
      }),
      create: vi.fn(async ({ data }: { data: Omit<ProcessoRecord, "id" | "cliente" | "advogado" | "andamentos" | "createdAt" | "updatedAt"> }) => {
        for (const item of prismaState.records.values()) {
          if (item.numero === data.numero) {
            throw new Error("Unique constraint failed on the fields: (`numero`)")
          }
        }

        const created = {
          id: `proc-${prismaState.records.size + 1}`,
          ...data,
          cliente: { id: data.clienteId, nome: "Cliente Mock" },
          advogado: { id: data.advogadoId, name: "Advogado Mock" },
          andamentos: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        prismaState.records.set(created.id, created)
        return created
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ProcessoRecord> }) => {
        const current = prismaState.records.get(where.id)
        if (!current) throw new Error("Registro não encontrado")

        if (data.numero) {
          for (const [id, item] of prismaState.records.entries()) {
            if (id !== where.id && item.numero === data.numero) {
              throw new Error("Unique constraint failed on the fields: (`numero`)")
            }
          }
        }

        const updated = { ...current, ...data, updatedAt: new Date() }
        prismaState.records.set(where.id, updated)
        return updated
      }),
    },
  },
}))

import { requireAuth } from "@/lib/auth/guards"
import {
  createProcesso,
  getProcesso,
  getProcessos,
  updateProcesso,
} from "@/app/dashboard/processos/actions"

describe("dashboard CRUD and protected layout contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaState.reset()

    prismaState.records.set("proc-seed", {
      id: "proc-seed",
      numero: "5000001-00.2024.8.24.0001",
      tribunal: "TJSC",
      vara: "1ª Vara Cível",
      area: "Cível",
      status: "ATIVO",
      clienteId: "cli-1",
      advogadoId: "adv-1",
      observacoes: "Inicial",
      cliente: { id: "cli-1", nome: "Cliente Seed" },
      advogado: { id: "adv-1", name: "Advogado Seed" },
      andamentos: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  it("rejects protected area access when session is missing", async () => {
    authMock.mockResolvedValueOnce(null)

    redirectMock.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`)
    })

    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT:/login")
  })

  it("supports list/create/edit/detail flow for GESTAO", async () => {
    authMock.mockResolvedValue({ user: { id: "gestor-1", role: "GESTAO" } })

    const before = await getProcessos({})
    expect(before).toHaveLength(1)

    await createProcesso(
      toFormData({
        numero: "5000002-00.2024.8.24.0001",
        tribunal: "TJSC",
        vara: "2ª Vara Cível",
        area: "Empresarial",
        status: "ATIVO",
        clienteId: "cli-2",
        advogadoId: "adv-2",
        observacoes: "Criado em teste",
      })
    )

    const afterCreate = await getProcessos({ search: "5000002-00.2024.8.24.0001" })
    expect(afterCreate).toHaveLength(1)

    const createdId = afterCreate[0].id

    await updateProcesso(
      createdId,
      toFormData({
        numero: "5000002-00.2024.8.24.0001",
        tribunal: "TJSC",
        vara: "2ª Vara Cível",
        area: "Empresarial",
        status: "SUSPENSO",
        clienteId: "cli-2",
        advogadoId: "adv-2",
        observacoes: "Editado em teste",
      })
    )

    const detail = await getProcesso(createdId)
    expect(detail?.status).toBe("SUSPENSO")
    expect(detail?.observacoes).toBe("Editado em teste")
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/processos")
    expect(revalidatePathMock).toHaveBeenCalledWith(`/dashboard/processos/${createdId}`)
  })

  it("blocks duplicate numero on create (malformed input)", async () => {
    authMock.mockResolvedValue({ user: { id: "gestor-1", role: "GESTAO" } })

    const result = await createProcesso(
      toFormData({
        numero: "5000001-00.2024.8.24.0001",
        tribunal: "TJSC",
        vara: "1ª Vara Cível",
        area: "Cível",
        status: "ATIVO",
        clienteId: "cli-9",
        advogadoId: "adv-9",
      })
    )

    expect(result).toEqual({ error: "Número de processo já cadastrado" })
  })

  it("handles boundary condition with zero processos", async () => {
    authMock.mockResolvedValue({ user: { id: "adv-1", role: "ADVOGADO" } })
    prismaState.reset()

    const result = await getProcessos({})
    expect(result).toEqual([])
  })

  it("returns explicit unauthorized error when advogado tries to open unassigned processo", async () => {
    authMock.mockResolvedValue({ user: { id: "adv-x", role: "ADVOGADO" } })

    await expect(getProcesso("proc-seed")).rejects.toThrow("Acesso negado ou processo não encontrado")
  })
})
