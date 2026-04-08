export type PipelineRunId = string

export type ExternalDocumentoInput = {
  externalId: string
  nome: string
  tipo?: string
  tamanhoBytes?: bigint
  storagePath?: string
  /** Conteúdo binário do documento já baixado durante a sessão do scraper */
  content?: Buffer
}

export type ExternalAndamentoInput = {
  externalId: string
  processoNumero: string
  dataIso: string
  tipo: string
  descricao: string
  documentos?: ExternalDocumentoInput[]
}

export type ScraperSnapshot = {
  source: 'eproc'
  collectedAtIso: string
  andamentos: ExternalAndamentoInput[]
}

export type NormalizedDocumento = {
  externalId: string
  nome: string
  tipo: string | null
  tamanhoBytes: bigint | null
  storagePath: string | null
}

export type NormalizedAndamento = {
  externalId: string
  processoNumero: string
  data: Date
  tipo: string
  descricao: string
  documentos: NormalizedDocumento[]
}

export type InvalidInputReason =
  | 'missing-external-id'
  | 'missing-processo-numero'
  | 'invalid-date'
  | 'missing-descricao'

export type InvalidExternalItem = {
  item: ExternalAndamentoInput
  reason: InvalidInputReason
}

export type NewAndamentoCandidate = {
  processoId: string
  andamento: NormalizedAndamento
}

export type DiffResult = {
  candidates: NewAndamentoCandidate[]
  skippedUnknownProcesso: number
  skippedInvalid: InvalidExternalItem[]
}

export type SyncPhaseCounters = {
  collected: number
  valid: number
  invalid: number
  newItems: number
  skippedUnknownProcesso: number
  persistedAndamentos: number
  persistedDocumentos: number
  archiveFailures: number
  notificationFailures: number
}

export type SyncResult = {
  runId: PipelineRunId
  phase: SyncPhaseCounters
}
