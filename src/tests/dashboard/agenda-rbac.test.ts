import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = vi.fn()
const mockRedirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`)
})

const db = vi.hoisted(() => ({
  tarefa: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  user: { findMany: vi.fn() },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (p: string) => mockRedirect(p) }))
vi.mock('@/auth', () => ({ auth: () => mockAuth() }))
vi.mock('@/lib/db', () => ({ prisma: db }))

import { getTarefas, concluirTarefa } from '@/app/dashboard/agenda/actions'

describe('agenda RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ADVOGADO vê apenas as próprias tarefas', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'adv1', role: 'ADVOGADO' } })
    db.tarefa.findMany.mockResolvedValueOnce([])

    await getTarefas()

    const arg = db.tarefa.findMany.mock.calls[0][0] as { where: { responsavelId?: string } }
    expect(arg.where.responsavelId).toBe('adv1')
  })

  it('ADMIN vê todas (sem filtro de responsável)', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'admin1', role: 'ADMIN' } })
    db.tarefa.findMany.mockResolvedValueOnce([])

    await getTarefas()

    const arg = db.tarefa.findMany.mock.calls[0][0] as { where: { responsavelId?: string } }
    expect(arg.where.responsavelId).toBeUndefined()
  })

  it('ADVOGADO não conclui tarefa de outro', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'adv1', role: 'ADVOGADO' } })
    db.tarefa.findUnique.mockResolvedValueOnce({ id: 't1', responsavelId: 'adv2' })

    const result = await concluirTarefa('t1')

    expect(result).toMatchObject({ error: 'Acesso negado' })
    expect(db.tarefa.update).not.toHaveBeenCalled()
  })

  it('ADVOGADO conclui a própria tarefa', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'adv1', role: 'ADVOGADO' } })
    db.tarefa.findUnique.mockResolvedValueOnce({ id: 't1', responsavelId: 'adv1' })
    db.tarefa.update.mockResolvedValueOnce({ id: 't1' })

    const result = await concluirTarefa('t1')

    expect(result).toMatchObject({ success: true })
    const arg = db.tarefa.update.mock.calls[0][0] as { data: { status: string; concluidoEm: Date } }
    expect(arg.data.status).toBe('CONCLUIDO')
    expect(arg.data.concluidoEm).toBeInstanceOf(Date)
  })
})
