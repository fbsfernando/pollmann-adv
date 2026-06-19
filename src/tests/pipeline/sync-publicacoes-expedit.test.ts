import { describe, it, expect, beforeEach, vi } from 'vitest'

import { syncPublicacoesExpedit } from '@/lib/pipeline/sync-publicacoes-expedit'
import type { ExpeditClient } from '@/lib/expedit/expedit-client'

const db = {
  publicacao: { findUnique: vi.fn(), upsert: vi.fn() },
  processo: { findUnique: vi.fn() },
  documento: { upsert: vi.fn() },
}

const range = { from: new Date('2026-06-18T00:00:00Z'), to: new Date('2026-06-18T00:00:00Z') }

const makeClient = (): ExpeditClient =>
  ({
    listPublicacaoGrupos: vi
      .fn()
      .mockResolvedValue([{ estado: 'SC', sigla_diario: 'DJESC', Data: '2026-06-18' }]),
    listPublicacoesDoDiario: vi.fn().mockResolvedValue([
      {
        hash_publicacao: 'h1',
        num_processo: '0001',
        conteudo_publicacao: '<p>Tipo de comunicação: Intimação</p>',
        data_publicacao: '18/06/2026',
      },
    ]),
    listProcessos: vi.fn(),
    listAllProcessos: vi.fn(),
    getProcessoDetalhe: vi.fn(),
    downloadDocumento: vi.fn(),
  }) as unknown as ExpeditClient

describe('syncPublicacoesExpedit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cria publicação nova e vincula ao processo quando existe', async () => {
    db.processo.findUnique.mockResolvedValueOnce({ id: 'p1', cliente: { nome: 'Cliente Teste' } })
    db.publicacao.findUnique.mockResolvedValueOnce(null)
    db.publicacao.upsert.mockResolvedValueOnce({ id: 'pub1' })

    const result = await syncPublicacoesExpedit(db as never, makeClient(), range)

    expect(result.phase.publicacoesCriadas).toBe(1)
    expect(result.phase.publicacoesAtualizadas).toBe(0)
    expect(result.phase.vinculadasAProcesso).toBe(1)

    const arg = db.publicacao.upsert.mock.calls[0][0] as {
      where: { externalId: string }
      create: { processoId: string | null; tipoComunicacao: string | null }
    }
    expect(arg.where.externalId).toBe('h1')
    expect(arg.create.processoId).toBe('p1')
    expect(arg.create.tipoComunicacao).toBe('Intimação')
  })

  it('é idempotente: publicação já existente conta como atualizada', async () => {
    db.processo.findUnique.mockResolvedValueOnce({ id: 'p1', cliente: { nome: 'Cliente Teste' } })
    db.publicacao.findUnique.mockResolvedValueOnce({ id: 'pub1' })
    db.publicacao.upsert.mockResolvedValueOnce({ id: 'pub1' })

    const result = await syncPublicacoesExpedit(db as never, makeClient(), range)

    expect(result.phase.publicacoesCriadas).toBe(0)
    expect(result.phase.publicacoesAtualizadas).toBe(1)
  })

  it('deixa processoId nulo quando o processo não está cadastrado', async () => {
    db.processo.findUnique.mockResolvedValueOnce(null)
    db.publicacao.findUnique.mockResolvedValueOnce(null)
    db.publicacao.upsert.mockResolvedValueOnce({ id: 'pub1' })

    const result = await syncPublicacoesExpedit(db as never, makeClient(), range)

    expect(result.phase.vinculadasAProcesso).toBe(0)
    expect(result.phase.documentosArquivados).toBe(0)
    const arg = db.publicacao.upsert.mock.calls[0][0] as { create: { processoId: string | null } }
    expect(arg.create.processoId).toBeNull()
    // Sem destino de arquivamento configurado, não baixa documentos.
    expect(db.documento.upsert).not.toHaveBeenCalled()
  })
})
