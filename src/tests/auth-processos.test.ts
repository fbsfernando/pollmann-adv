import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuth = vi.fn()
const mockRedirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`)
})

const mockProcessoFindMany = vi.fn()
const mockProcessoFindFirst = vi.fn()
const mockProcessoCreate = vi.fn()
const mockProcessoUpdate = vi.fn()
const mockClienteFindMany = vi.fn()
const mockUserFindMany = vi.fn()

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}))

vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    processo: {
      findMany: (...args: unknown[]) => mockProcessoFindMany(...args),
      findFirst: (...args: unknown[]) => mockProcessoFindFirst(...args),
      create: (...args: unknown[]) => mockProcessoCreate(...args),
      update: (...args: unknown[]) => mockProcessoUpdate(...args),
    },
    cliente: {
      findMany: (...args: unknown[]) => mockClienteFindMany(...args),
    },
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
  },
}))

import { getProcesso, getProcessos } from "@/app/dashboard/processos/actions"
import { requireAuth } from "@/lib/auth/guards"

describe("auth/processos scope contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("redirects to login when session is missing", async () => {
    mockAuth.mockResolvedValueOnce(null)

    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT:/login")
  })

  it("gestao sees all processos", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: "gestao-1", role: "GESTAO" },
    })
    mockProcessoFindMany.mockResolvedValueOnce([])

    await getProcessos({ search: "123" })

    expect(mockProcessoFindMany).toHaveBeenCalledTimes(1)
    const arg = mockProcessoFindMany.mock.calls[0][0] as {
      where: { advogadoId?: string }
    }
    expect(arg.where.advogadoId).toBeUndefined()
  })

  it("advogado sees only assigned processos", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: "adv-1", role: "ADVOGADO" },
    })
    mockProcessoFindMany.mockResolvedValueOnce([])

    await getProcessos({})

    expect(mockProcessoFindMany).toHaveBeenCalledTimes(1)
    const arg = mockProcessoFindMany.mock.calls[0][0] as {
      where: { advogadoId?: string }
    }
    expect(arg.where.advogadoId).toBe("adv-1")
  })

  it("denies direct detail access for unassigned advogado", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: "adv-1", role: "ADVOGADO" },
    })
    mockProcessoFindFirst.mockResolvedValueOnce(null)

    await expect(getProcesso("proc-1")).rejects.toThrow(
      "Acesso negado ou processo não encontrado"
    )

    expect(mockProcessoFindFirst).toHaveBeenCalledTimes(1)
    const arg = mockProcessoFindFirst.mock.calls[0][0] as {
      where: { id: string; advogadoId?: string }
    }
    expect(arg.where).toMatchObject({ id: "proc-1", advogadoId: "adv-1" })
  })

  it("rejects malformed processo id", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: "gestao-1", role: "GESTAO" },
    })

    await expect(getProcesso(" ")).rejects.toThrow("Processo inválido")
    expect(mockProcessoFindFirst).not.toHaveBeenCalled()
  })
})
