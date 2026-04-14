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

/** Parte do processo (Autor ou Réu) extraída da página de detalhes do E-PROC */
export type ExternalPartePessoa = {
  nome: string
  cpfCnpj?: string
  tipoPessoa?: 'FISICA' | 'JURIDICA'
  polo: 'AUTOR' | 'REU'
  /** Códigos OAB dos advogados representantes (ex: ['SC037270']) */
  advogadosOab?: string[]
}

/** Metadados do processo raspados da capa e partes */
export type ExternalProcessoMetadata = {
  numero: string
  /** Classe da ação (ex: "CUMPRIMENTO DE SENTENÇA") */
  classe?: string
  /** Competência (ex: "Civil - Bancário") */
  area?: string
  /** Órgão julgador / vara */
  vara?: string
  /** Situação atual (ex: "MOVIMENTO-AGUARDA SENTENÇA") */
  situacao?: string
  /** Partes do processo */
  partes: ExternalPartePessoa[]
}

export type ScraperSnapshot = {
  source: 'eproc'
  collectedAtIso: string
  andamentos: ExternalAndamentoInput[]
  /** Metadados por processo (chave = número CNJ). Opcional para compat. */
  processosMetadata?: Record<string, ExternalProcessoMetadata>
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
