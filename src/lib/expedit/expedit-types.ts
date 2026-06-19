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
  /** Número CNJ do processo. */
  numeroCNJ?: string
  numero_cnj?: string
  numero?: string
  /** Tribunal/origem (ex.: "TJSC 1° Grau - Eproc"). */
  tribunal?: string
  origem?: string
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
  /** Idempotência — hash único da publicação. */
  hash_publicacao?: string
  cod_publicacao?: string | number
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

// ─── Resultado do parser de `conteudo_publicacao` ─────────────────────────────

export type PublicacaoConteudoParsed = {
  tipoComunicacao: string | null
  inteiroTeorUrl: string | null
  partes: string[]
  advogados: string[]
  classe: string | null
  textoLimpo: string
}
