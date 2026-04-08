import { describe, it, expect, beforeEach, vi } from 'vitest'

import { syncAndamentos } from '@/lib/pipeline/sync-andamentos'

const db = {
  processo: { findMany: vi.fn(), findUnique: vi.fn() },
  andamento: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  documento: { upsert: vi.fn() },
  $transaction: vi.fn(async (cb: (tx: typeof db) => Promise<void>) => cb(db)),
}

describe('syncAndamentos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists novidade on first run', async () => {
    db.processo.findMany.mockResolvedValueOnce([{ id: 'p1', numero: '0001' }])
    db.andamento.findMany.mockResolvedValueOnce([])
    db.andamento.create.mockResolvedValueOnce({ id: 'a1' })
    db.documento.upsert.mockResolvedValueOnce({ id: 'd1' })
    db.processo.findUnique.mockResolvedValueOnce({
      id: 'p1',
      numero: '0001',
      cliente: { nome: 'Cliente Teste' },
    })

    const client = {
      collectSnapshot: vi.fn().mockResolvedValue({
        source: 'eproc',
        collectedAtIso: new Date().toISOString(),
        andamentos: [
          {
            externalId: 'ext-1',
            processoNumero: '0001',
            dataIso: '2026-03-31T12:00:00.000Z',
            tipo: 'MOV',
            descricao: 'Andamento novo',
            documentos: [{ externalId: 'doc-1', nome: 'peticao.pdf' }],
          },
        ],
      }),
    }

    const result = await syncAndamentos(db as never, client)

    expect(result.runId).toBeTruthy()
    expect(result.phase.newItems).toBe(1)
    expect(result.phase.persistedAndamentos).toBe(1)
    expect(result.phase.persistedDocumentos).toBe(1)
  })

  it('is idempotent on second run with existing external id', async () => {
    db.processo.findMany.mockResolvedValueOnce([{ id: 'p1', numero: '0001' }])
    db.andamento.findMany.mockResolvedValueOnce([{ externalId: 'ext-1' }])

    const client = {
      collectSnapshot: vi.fn().mockResolvedValue({
        source: 'eproc',
        collectedAtIso: new Date().toISOString(),
        andamentos: [
          {
            externalId: 'ext-1',
            processoNumero: '0001',
            dataIso: '2026-03-31T12:00:00.000Z',
            tipo: 'MOV',
            descricao: 'Andamento repetido',
            documentos: [],
          },
        ],
      }),
    }

    const result = await syncAndamentos(db as never, client)

    expect(result.phase.newItems).toBe(0)
    expect(result.phase.persistedAndamentos).toBe(0)
    expect(db.andamento.create).not.toHaveBeenCalled()
  })

  it('skips unknown processo and invalid input without breaking the run', async () => {
    db.processo.findMany.mockResolvedValueOnce([])
    db.andamento.findMany.mockResolvedValueOnce([])

    const client = {
      collectSnapshot: vi.fn().mockResolvedValue({
        source: 'eproc',
        collectedAtIso: new Date().toISOString(),
        andamentos: [
          {
            externalId: 'ext-unknown-proc',
            processoNumero: '9999',
            dataIso: '2026-03-31T12:00:00.000Z',
            tipo: 'MOV',
            descricao: 'Processo inexistente',
            documentos: [],
          },
          {
            externalId: '',
            processoNumero: '0001',
            dataIso: 'invalid-date',
            tipo: 'MOV',
            descricao: '',
            documentos: [],
          },
        ],
      }),
    }

    const result = await syncAndamentos(db as never, client)

    expect(result.phase.invalid).toBe(1)
    expect(result.phase.skippedUnknownProcesso).toBe(1)
    expect(result.phase.persistedAndamentos).toBe(0)
  })
})
