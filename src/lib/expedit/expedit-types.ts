/**
 * Tipos das respostas da API interna do Expedit (app-v2.expedit.com.br).
 *
 * A API é interna (app PHP, sessão PHPSESSID, respostas JSON) e foi mapeada via
 * inspetor de rede. Os campos abaixo refletem o que foi observado; como a API
 * pode mudar sem aviso, a maioria dos campos é opcional e o cliente
 * (`expedit-client.ts`) isola o parsing/normalização.
 */

// ─── Respostas genéricas ──────────────────────────────────────────────────────

/** Envelope paginado padrão (`/processos/dados`). */
export type ExpeditPaginatedResponse<T> = {
  data: T[]
  totalPages?: number
  totalElements?: number
}

// ─── Processos ────────────────────────────────────────────────────────────────

/** Item de `/processos/dados`. */
export type ExpeditProcesso = {
  /** Identificador interno do processo no Expedit (idempotência da importação). */
  id?: string | number
  /** Número CNJ do processo. Na listagem `/processos/dados` o campo é `numeroProcesso`. */
  numeroProcesso?: string
  numeroCNJ?: string
  numero_cnj?: string
  numero?: string
  /** Tribunal/origem. Na listagem vem como objeto `{id, descricao}`; em outras telas pode ser string. */
  tribunal?: string | { id?: number; descricao?: string }
  origem?: string
  /** Órgão julgador / vara (string na listagem). */
  orgao?: string
  /** Partes no formato "Autor x Réu". */
  partes?: string
  /** Última movimentação capturada (timestamp "YYYY-MM-DD HH:mm:ss"). */
  ultimaMovimentacao?: string
  /** Descrição da última movimentação. */
  ultimaMovimentacaoDesc?: string
  /** Esfera (Estadual/Trabalhista/Federal). */
  esfera?: string
  esfera_diario?: string
  /** Nome(s) do(s) cliente(s) associado(s). */
  nomeClientes?: string
  nome_clientes?: string
  parte_principal?: string
  classe?: string
  vara?: string
  comarca?: string
  area?: string
  // Campos adicionais retornados pela API são preservados.
  [key: string]: unknown
}

/** Resposta de `/processos/modal/{base64(numeroCNJ)}`. */
export type ExpeditProcessoDetalheResponse = {
  data: ExpeditProcessoDetalhe[]
}

export type ExpeditProcessoDetalhe = {
  numeroCNJ?: string
  numero?: string
  tribunal?: string
  origem?: string
  esfera?: string
  classe?: string
  vara?: string
  comarca?: string
  area?: string
  nomeClientes?: string
  parte_principal?: string
  clientes?: Array<{ nome?: string } | string>
  partes?: Array<{ nome?: string; polo?: string } | string>
  advogados?: Array<{ nome?: string; oab?: string } | string>
  [key: string]: unknown
}

// ─── Publicações ──────────────────────────────────────────────────────────────

/** Item de `/atualizacao/publicacoes/lista` (grupos por dia/diário). */
export type ExpeditPublicacaoGrupo = {
  /** Data (YYYY-MM-DD ou dd/mm/yyyy). */
  data?: string
  Data?: string
  /** Datas reais retornadas por `/publicacoes/lista` (usadas para consultar os itens do diário). */
  data_publicacao?: string
  data_disponibilizacao?: string
  /** UF do diário. */
  estado?: string
  uf?: string
  /** Sigla do diário (ex.: "DJESC"). */
  sigla_diario?: string
  siglaDiario?: string
  nome_diario?: string
  esfera_diario?: string
  /** Quantidade de itens no grupo. */
  quantidade?: number
  [key: string]: unknown
}

/** Envelope de `/atualizacao/publicacoes/diarios`. */
export type ExpeditPublicacoesDiarioResponse = {
  montaTemplate?: Array<{ dados?: ExpeditPublicacaoItem[] }>
}

/** Item individual do diário (publicação). */
export type ExpeditPublicacaoItem = {
  /** Id interno (Mongo) — é o `ref` usado nos endpoints de triagem (concluir/descartar). */
  _id?: string
  /** Idempotência — hash único da publicação. */
  hash_publicacao?: string
  cod_publicacao?: string | number
  /** Flag de tratamento no Expedit: 1 = tratada/concluída. */
  lido?: number | boolean
  /** Número CNJ do processo referente à publicação. */
  num_processo?: string
  numero_processo?: string
  /** HTML com tipo de comunicação, inteiro-teor, partes, advogados, classe. */
  conteudo_publicacao?: string
  /** Datas. */
  data_publicacao?: string
  data_disponibilizacao?: string
  Data?: string
  /** Origem/diário. */
  sigla_diario?: string
  nome_diario?: string
  esfera_diario?: string
  estado?: string
  uf?: string
  vara?: string
  comarca?: string
  orgao?: string
  /** Insight gerado por IA pelo Expedit. */
  insight_ia?: string
  [key: string]: unknown
}

// ─── Documentos (módulo Atualizações › Documentos) ────────────────────────────

/** Item de `/atualizacao/documentos/lista`. O Expedit já baixou o arquivo e o
 *  hospeda em `doc.expedit.com.br` (CDN S3 público) — download direto, sem auth. */
export type ExpeditDocumentoItem = {
  numero_processo?: string
  processo_id?: string | number
  data_juntado?: string
  /** URL pública de download (doc.expedit.com.br). */
  link_documento?: string
  /** Nome/descrição do documento. */
  documento?: string
  orgao?: string
  /** Tribunal/origem (ex.: "TRT18 - GO - 1° Grau - PJe"). */
  descricao?: string
  partes?: string
  [key: string]: unknown
}

// ─── Intimações (módulo Atualizações › Intimações) ────────────────────────────

/** Item de `/atualizacao/intimacoes/lista` — intimações eletrônicas capturadas
 *  dos sistemas dos tribunais (Eproc etc.), fonte distinta dos diários. */
export type ExpeditIntimacaoItem = {
  id?: string | number
  numero_processo?: string
  processo_id?: string | number
  /** Ex.: "Evento :203". */
  intimacao?: string
  orgao?: string
  partes?: string
  destinatario?: string
  /** Tribunal/sistema de origem (ex.: "TJSC 1° Grau - Eproc"). */
  descricao?: string
  /** "YYYY-MM-DD". */
  data_expediente?: string
  data_ciencia?: string
  data_limite?: string
  /** URL pública do expediente (doc.expedit.com.br). */
  link_expediente?: string
  lido?: boolean
  responsavel?: string
  [key: string]: unknown
}

// ─── Agenda global (calendário do app-v2) ─────────────────────────────────────

/** Item de `/agenda/agenda` — a agenda INTEIRA do escritório em 1 request
 *  (vs. 1 request por processo na API oficial). Ids compatíveis com os da API
 *  oficial (mesmo id de compromisso/audiência — verificado E2E). */
export type ExpeditAgendaGlobalItem = {
  tipo?: 'COMPROMISSO' | 'AUDIENCIA' | 'EXPEDIENTE' | string
  id?: string | number
  data_inicio?: string
  data_fim?: string
  data_fatal?: string | null
  titulo?: string
  observacao?: string
  concluido?: number | boolean
  publicacao_id?: string | null
  responsaveis?: { nome?: string; user_id?: number }[] | null
  tipo_compromisso?: { nome?: string } | string | null
  compromisso?: { situacao?: string; descricao?: string } | null
  audiencia?:
    | { id?: number; sala?: string; status?: string; data_prevista?: string; tipo_audiencia?: string }[]
    | null
  /** Presente quando tipo=EXPEDIENTE — mesmos itens das intimações eletrônicas. */
  expediente?: { id?: number }[] | null
  processo?: { id?: number; numero_processo?: string; partes?: string; tribunal?: string } | null
  [key: string]: unknown
}

export type ExpeditAgendaGlobalResponse = {
  dados?: ExpeditAgendaGlobalItem[]
  [key: string]: unknown
}

// ─── Resultado do parser de `conteudo_publicacao` ─────────────────────────────

export type PublicacaoConteudoParsed = {
  tipoComunicacao: string | null
  inteiroTeorUrl: string | null
  partes: string[]
  advogados: string[]
  classe: string | null
  textoLimpo: string
}
