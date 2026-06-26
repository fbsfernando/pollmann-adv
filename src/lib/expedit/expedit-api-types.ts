/**
 * Tipos da API REST oficial do Expedit (`api.expedit.com.br`, Swagger 2.0).
 *
 * Diferente dos endpoints internos do app-v2, esta é a API contratual: auth via
 * JWT (`POST /api/token`) e DTOs documentados. É orientada a processo (andamentos,
 * documentos, audiências, partes etc. são listados POR processo).
 */

export type CustomTokenResponse = {
  accessToken: string
  tokenType: string
}

export type PaginatedItemsDTO<T> = {
  content: T[]
  pageNumber: number
  pageSize: number
  totalElements: number
  totalPages: number
}

export type TribunaisDTO = {
  id?: number
  descricao?: string
  descricao2?: string
  estado?: string
  uf?: string
  grau?: string
  tribunal?: string
  codigoTribunalCNJ?: string
  codigoRamoJusticaCNJ?: string
}

export type NomesDTO = {
  nome?: string
  [key: string]: unknown
}

export type ProcessoAssuntoDTO = { id?: number; nome?: string; [key: string]: unknown }
export type ProcessoMarcadorDTO = { id?: number; nome?: string; cor?: string; [key: string]: unknown }

/** Item de `GET /api/processos/listarProcessos`. */
export type ProcessoDTO = {
  id: number
  numeroProcesso?: string
  tribunal?: TribunaisDTO
  nome?: NomesDTO
  fase?: string
  isEncerrado?: number
  segredoJustica?: number
  monitoramento?: number
  possivelBaixa?: number
  processoNaoEncontrado?: number
  ultimaMovimentacao?: string
  descricaoUltimaMovimentacao?: string
  dtCreated?: string
  dtUpdate?: string
  assuntos?: ProcessoAssuntoDTO[]
  marcadores?: ProcessoMarcadorDTO[]
  resultados?: string
  [key: string]: unknown
}

/** Item de `GET /api/andamentos/listarAndamentosDoProcesso/{id}`. */
export type AndamentosDTO = {
  id: number
  processoId: number
  andamento?: string
  dataAndamento?: string
  tipoAndamento?: string
  deleted?: number
}

/** Item de `GET /api/documentos/listarDocumentosDoProcesso/{id}`. */
export type DocumentosDTO = {
  id: number
  processoId: number
  documento?: string
  idDocumento?: string
  /** URL de download do documento (CDN do Expedit). */
  linkDocumento?: string
  hash?: string
  tipoDocumento?: string
  origem?: string
  juntadoPor?: string
  dataJuntado?: string
  dtCreated?: string
}

export type ResponsavelDTO = { id?: number; nome?: string; [key: string]: unknown }

/** Item de `GET /api/audiencia/listarAudienciasDoProcesso/{id}`. */
export type AudienciaDTO = {
  id: number
  tipoAudiencia?: string
  dataInicio?: string
  dataFim?: string
  horaInicio?: string
  sala?: string
  status?: string
  responsaveis?: ResponsavelDTO[]
}

/** Expediente (prazo/intimação) de um processo. */
export type ExpedienteDTO = {
  id: number
  titulo?: string
  dataInicio?: string
  dataFim?: string
  dataCiencia?: string
  prazo?: string
  tipoLimite?: string
  destinatario?: string
  quemCiencia?: string
  linkExpediente?: string
  responsaveis?: ResponsavelDTO[]
}

export type CompromissoDTO = {
  id: number
  titulo?: string
  descricao?: string
  dataInicio?: string
  dataFim?: string
  horaInicio?: string
  horaFim?: string
  local?: string
  situacao?: string
  concluido?: boolean
  responsaveis?: ResponsavelDTO[]
  tipoTarefa?: { id?: number; nome?: string; titulo?: string; [key: string]: unknown }
}

/** `GET /api/processos/{id}/agenda`. */
export type ProcessoAgendaDTO = {
  audiencias?: AudienciaDTO[]
  compromissos?: CompromissoDTO[]
  expedientes?: ExpedienteDTO[]
}

export type PartesDto = {
  id: number
  parte?: string
  polo?: string
  tipo?: string
  dtCreated?: string
}

// ── Indicadores (dashboards prontos do Expedit) ───────────────────────────
export type ProcessoAssuntoQuantidadeDTO = { id?: number; nome?: string; quantidadeProcessos?: number }
export type ProcessoMarcadorQuantidadeDTO = {
  id?: number
  nome?: string
  cor?: string
  quantidadeProcessos?: number
}
export type ProcessoFinanceiroGrupoDTO = {
  grupoId?: string
  grupoNome?: string
  quantidadeProcessos?: number
  valorCausaTotal?: number
  valorCondenacaoTotal?: number
  valorContratoTotal?: number
  garantiaTotal?: number
  proveitoEconomicoTotal?: number
}
export type ProcessoFinanceiroCategoriaTotalDTO = {
  categoriaId?: number
  categoriaNome?: string
  quantidadeLancamentos?: number
  total?: number
}
export type ProcessoDuracaoEstadoDTO = { estado?: string; duracaoMediaMeses?: number; quantidade?: number }
export type ProcessoDuracaoPorEstadoResponseDTO = {
  ativos?: ProcessoDuracaoEstadoDTO[]
  encerrados?: ProcessoDuracaoEstadoDTO[]
}

/** `GET /api/dados-basicos/listarDadosBasicosDoProcesso/{id}`. */
export type DadosBasicosDTO = {
  id?: number
  processoId?: number
  classe?: string
  assunto?: string
  orgao?: string
  julgador?: string
  fase?: string
  partes?: string
  valorCausa?: string
  valorFinal?: string
  dataAutuacao?: string
  dataDistribuicao?: string
}
