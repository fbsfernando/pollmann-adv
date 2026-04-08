import type {
  ExternalAndamentoInput,
  NormalizedAndamento,
  NormalizedDocumento,
  ScraperSnapshot,
} from '@/lib/pipeline/types'

// ─── Normalização de payload externo ────────────────────────────────────────

type ExternalDocumentoItem = NonNullable<ExternalAndamentoInput['documentos']>[number]

const normalizeDocumento = (doc: ExternalDocumentoItem): NormalizedDocumento => ({
  externalId: String(doc.externalId ?? '').trim(),
  nome: String(doc.nome ?? '').trim(),
  tipo: doc.tipo ? String(doc.tipo).trim() : null,
  tamanhoBytes: typeof doc.tamanhoBytes === 'bigint' ? doc.tamanhoBytes : null,
  storagePath: doc.storagePath ? String(doc.storagePath).trim() : null,
})

export const normalizeExternalAndamento = (
  item: ExternalAndamentoInput
): NormalizedAndamento | null => {
  const externalId = String(item.externalId ?? '').trim()
  const processoNumero = String(item.processoNumero ?? '').trim()
  const descricao = String(item.descricao ?? '').trim()
  const tipo = String(item.tipo ?? '').trim()
  const data = new Date(item.dataIso)

  if (!externalId || !processoNumero || !descricao || Number.isNaN(data.getTime())) {
    return null
  }

  return {
    externalId,
    processoNumero,
    descricao,
    tipo,
    data,
    documentos: (item.documentos ?? []).map(normalizeDocumento),
  }
}

// ─── Interface pública do cliente ────────────────────────────────────────────

export interface EprocClient {
  collectSnapshot(): Promise<ScraperSnapshot>
}

export class EprocClientNotConfiguredError extends Error {
  constructor() {
    super('Eproc client is not configured')
  }
}

// ─── Stub (sem config) ───────────────────────────────────────────────────────

export const createEprocClient = (): EprocClient => ({
  async collectSnapshot() {
    throw new EprocClientNotConfiguredError()
  },
})
