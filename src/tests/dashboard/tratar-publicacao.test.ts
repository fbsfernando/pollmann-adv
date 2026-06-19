import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = vi.fn()
const mockRedirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`)
})

const db = vi.hoisted(() => {
  const d = {
    publicacao: { findUnique: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
    tarefa: { create: vi.fn() },
    $transaction: vi.fn(),
  }
  d.$transaction.mockImplementation(async (cb: (tx: typeof d) => Promise<unknown>) => cb(d))
  return d
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (p: string) => mockRedirect(p) }))
vi.mock('@/auth', () => ({ auth: () => mockAuth() }))
vi.mock('@/lib/db', () => ({ prisma: db }))

import { tratarPublicacao } from '@/app/dashboard/atualizacoes/publicacoes/actions'

const toFormData = (obj: Record<string, string>): FormData => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('tratarPublicacao', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cria tarefa direcionada e marca publicação como TRATADA', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN' } })
    db.publicacao.findUnique.mockResolvedValueOnce({
      id: 'pub1',
      numProcesso: '0001',
      processoId: 'p1',
      status: 'PENDENTE',
    })
    db.user.findFirst.mockResolvedValueOnce({ id: 'adv1' })
    db.tarefa.create.mockResolvedValueOnce({ id: 't1' })
    db.publicacao.update.mockResolvedValueOnce({ id: 'pub1' })

    const result = await tratarPublicacao(
      toFormData({ publicacaoId: 'pub1', tipo: 'Intimação', responsavelId: 'adv1', prazoDias: '15' })
    )

    expect(result).toMatchObject({ success: true })

    const createArg = db.tarefa.create.mock.calls[0][0] as {
      data: { responsavelId: string; criadoPorId: string; publicacaoId: string; processoId: string; prazoData: Date | null }
    }
    expect(createArg.data.responsavelId).toBe('adv1')
    expect(createArg.data.criadoPorId).toBe('admin1')
    expect(createArg.data.publicacaoId).toBe('pub1')
    expect(createArg.data.processoId).toBe('p1')
    expect(createArg.data.prazoData).toBeInstanceOf(Date)

    const updArg = db.publicacao.update.mock.calls[0][0] as { data: { status: string } }
    expect(updArg.data.status).toBe('TRATADA')
  })

  it('rejeita responsável que não é advogado', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN' } })
    db.publicacao.findUnique.mockResolvedValueOnce({
      id: 'pub1',
      numProcesso: '0001',
      processoId: null,
      status: 'PENDENTE',
    })
    db.user.findFirst.mockResolvedValueOnce(null)

    const result = await tratarPublicacao(
      toFormData({ publicacaoId: 'pub1', tipo: 'Intimação', responsavelId: 'x' })
    )

    expect(result).toMatchObject({ error: 'Responsável inválido' })
    expect(db.tarefa.create).not.toHaveBeenCalled()
  })

  it('redireciona quando o usuário não é ADMIN (requireGestao)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'adv1', role: 'ADVOGADO' } })

    await expect(
      tratarPublicacao(toFormData({ publicacaoId: 'pub1', tipo: 'Intimação', responsavelId: 'adv1' }))
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard')
  })
})
