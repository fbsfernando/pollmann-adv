import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { syncAndamentos } from '@/lib/pipeline/sync-andamentos'

const db = {
  processo: { findMany: vi.fn(), findUnique: vi.fn() },
  andamento: { findMany: vi.fn(), create: vi.fn() },
  documento: { upsert: vi.fn() },
  // Executa o callback com o próprio db como client transacional (mock)
  $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(db)),
}

describe('pipeline integration', () => {
  let archiveDir = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    archiveDir = await mkdtemp(path.join(tmpdir(), 'pipeline-archive-'))
  })

  afterEach(async () => {
    await rm(archiveDir, { recursive: true, force: true })
  })

  it('persists standardized archive path and sends notification on success', async () => {
    db.processo.findMany.mockResolvedValueOnce([{ id: 'p1', numero: '0001' }])
    db.andamento.findMany.mockResolvedValueOnce([])
    db.andamento.create.mockResolvedValueOnce({ id: 'a1' })
    db.processo.findUnique.mockResolvedValueOnce({ id: 'p1', cliente: { nome: 'Cliente Demo' } })
    db.documento.upsert.mockResolvedValueOnce({ id: 'd1' })

    const sender = vi.fn().mockResolvedValue({ messageId: 'm1' })

    const result = await syncAndamentos(
      db as never,
      {
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
              documentos: [{ externalId: 'doc-1', nome: 'Petição Inicial.pdf' }],
            },
          ],
        }),
      },
      {
        archiveBaseDir: archiveDir,
        notificationSender: sender,
      }
    )

    expect(result.phase.persistedAndamentos).toBe(1)
    expect(result.phase.persistedDocumentos).toBe(1)
    expect(result.phase.archiveFailures).toBe(0)
    expect(result.phase.notificationFailures).toBe(0)

    const upsertArg = db.documento.upsert.mock.calls[0][0]
    expect(upsertArg.create.storagePath).toContain('cliente-demo/0001/doc-1.pdf')
    expect(sender).toHaveBeenCalledTimes(1)
  })

  it('keeps andamento/documento persisted when notification fails', async () => {
    db.processo.findMany.mockResolvedValueOnce([{ id: 'p1', numero: '0001' }])
    db.andamento.findMany.mockResolvedValueOnce([])
    db.andamento.create.mockResolvedValueOnce({ id: 'a2' })
    db.processo.findUnique.mockResolvedValueOnce({ id: 'p1', cliente: { nome: 'Cliente Demo' } })
    db.documento.upsert.mockResolvedValueOnce({ id: 'd2' })

    const sender = vi.fn().mockRejectedValue(new Error('smtp-down'))

    const result = await syncAndamentos(
      db as never,
      {
        collectSnapshot: vi.fn().mockResolvedValue({
          source: 'eproc',
          collectedAtIso: new Date().toISOString(),
          andamentos: [
            {
              externalId: 'ext-2',
              processoNumero: '0001',
              dataIso: '2026-03-31T12:10:00.000Z',
              tipo: 'MOV',
              descricao: 'Novo despacho',
              documentos: [{ externalId: 'doc-2', nome: 'despacho.pdf' }],
            },
          ],
        }),
      },
      {
        archiveBaseDir: archiveDir,
        notificationSender: sender,
      }
    )

    expect(result.phase.persistedAndamentos).toBe(1)
    expect(result.phase.persistedDocumentos).toBe(1)
    expect(result.phase.notificationFailures).toBe(1)
    expect(db.andamento.create).toHaveBeenCalledTimes(1)
    expect(db.documento.upsert).toHaveBeenCalledTimes(1)
  })
})
