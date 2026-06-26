/**
 * Cliente da API REST oficial do Expedit (`api.expedit.com.br`).
 *
 * Autentica via `POST /api/token` ({username, password}) → JWT, e usa o token no
 * header `Authorization` em todas as chamadas. O token é cacheado e reemitido
 * automaticamente em caso de 401. Substitui a integração via sessão PHP do
 * app-v2 (frágil e expirável) pela API contratual (Swagger).
 *
 * É orientada a processo: andamentos/documentos/audiências/partes/agenda são
 * listados POR `processoId` (o `id` numérico do ProcessoDTO).
 */
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici'

import type {
  AndamentosDTO,
  AudienciaDTO,
  CustomTokenResponse,
  DadosBasicosDTO,
  DocumentosDTO,
  PaginatedItemsDTO,
  PartesDto,
  ProcessoAgendaDTO,
  ProcessoDTO,
  ProcessoAssuntoQuantidadeDTO,
  ProcessoMarcadorQuantidadeDTO,
  ProcessoFinanceiroGrupoDTO,
  ProcessoFinanceiroCategoriaTotalDTO,
  ProcessoDuracaoPorEstadoResponseDTO,
} from '@/lib/expedit/expedit-api-types'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface ExpeditApiConfig {
  /** Base URL da API (ex.: https://api.expedit.com.br). */
  baseUrl: string
  username: string
  password: string
  timeout?: number
  proxyUrl?: string
}

export type ExpeditDocumentoDownload = {
  content: Buffer
  contentType: string
  filename: string
}

export interface ExpeditApiClient {
  listProcessos(pagina: number, tamanho: number): Promise<PaginatedItemsDTO<ProcessoDTO>>
  listAllProcessos(opts?: { tamanho?: number; maxPaginas?: number }): Promise<ProcessoDTO[]>
  listarAndamentos(processoId: number): Promise<AndamentosDTO[]>
  listarDocumentos(processoId: number): Promise<DocumentosDTO[]>
  listarAudiencias(processoId: number): Promise<AudienciaDTO[]>
  listarPartes(processoId: number): Promise<PartesDto[]>
  getAgenda(processoId: number): Promise<ProcessoAgendaDTO | null>
  getDadosBasicos(processoId: number): Promise<DadosBasicosDTO[]>
  downloadDocumento(url: string): Promise<ExpeditDocumentoDownload | null>
  // Indicadores (dashboards prontos).
  getIndicadorAssuntos(): Promise<ProcessoAssuntoQuantidadeDTO[]>
  getIndicadorMarcadores(): Promise<ProcessoMarcadorQuantidadeDTO[]>
  getIndicadorFinanceiro(): Promise<ProcessoFinanceiroGrupoDTO[]>
  getIndicadorFinanceiroCategorias(): Promise<ProcessoFinanceiroCategoriaTotalDTO[]>
  getIndicadorDuracao(): Promise<ProcessoDuracaoPorEstadoResponseDTO | null>
}

export const createExpeditApiClient = (config: ExpeditApiConfig): ExpeditApiClient => {
  const timeout = config.timeout ?? 45000
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const dispatcher = config.proxyUrl ? new ProxyAgent(config.proxyUrl) : undefined

  let token: string | null = null

  const doFetch = (url: string, init: RequestInit & { dispatcher?: Dispatcher } = {}): Promise<Response> => {
    const opts: RequestInit & { dispatcher?: Dispatcher } = {
      ...init,
      headers: { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string>) },
      signal: AbortSignal.timeout(timeout),
    }
    if (dispatcher) opts.dispatcher = dispatcher
    return dispatcher
      ? (undiciFetch(url, opts as never) as unknown as Promise<Response>)
      : fetch(url, opts)
  }

  /** Normaliza o header Authorization (o accessToken já costuma vir com "bearer "). */
  const authHeader = (raw: string): string =>
    /^bearer\s/i.test(raw) ? raw : `Bearer ${raw}`

  const authenticate = async (): Promise<string> => {
    const res = await doFetch(`${baseUrl}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: config.username, password: config.password }),
    })
    if (!res.ok) {
      throw new Error(`Expedit API: falha no login (HTTP ${res.status})`)
    }
    const data = (await res.json()) as CustomTokenResponse
    if (!data.accessToken) throw new Error('Expedit API: token ausente na resposta')
    token = authHeader(data.accessToken)
    return token
  }

  /** GET autenticado com retry único em 401 (token expirado). */
  const getJson = async <T>(path: string): Promise<T> => {
    if (!token) await authenticate()
    const url = `${baseUrl}${path}`
    let res = await doFetch(url, { headers: { Authorization: token!, Accept: 'application/json' } })
    if (res.status === 401) {
      await authenticate()
      res = await doFetch(url, { headers: { Authorization: token!, Accept: 'application/json' } })
    }
    if (!res.ok) throw new Error(`Expedit API: GET ${path} → HTTP ${res.status}`)
    return (await res.json()) as T
  }

  const getArray = async <T>(path: string): Promise<T[]> => {
    const data = await getJson<T[] | null>(path)
    return Array.isArray(data) ? data : []
  }

  return {
    listProcessos(pagina, tamanho) {
      const qs = new URLSearchParams({ pagina: String(pagina), tamanho: String(tamanho) })
      return getJson<PaginatedItemsDTO<ProcessoDTO>>(`/api/processos/listarProcessos?${qs.toString()}`)
    },

    async listAllProcessos(opts = {}) {
      const tamanho = opts.tamanho ?? 100
      const maxPaginas = opts.maxPaginas ?? 1000
      const all: ProcessoDTO[] = []
      let pagina = 0
      let totalPages = 1
      do {
        const res = await this.listProcessos(pagina, tamanho)
        all.push(...(res.content ?? []))
        totalPages = res.totalPages ?? 1
        pagina += 1
      } while (pagina < totalPages && pagina < maxPaginas)
      return all
    },

    listarAndamentos(processoId) {
      return getArray<AndamentosDTO>(`/api/andamentos/listarAndamentosDoProcesso/${processoId}`)
    },
    listarDocumentos(processoId) {
      return getArray<DocumentosDTO>(`/api/documentos/listarDocumentosDoProcesso/${processoId}`)
    },
    listarAudiencias(processoId) {
      return getArray<AudienciaDTO>(`/api/audiencia/listarAudienciasDoProcesso/${processoId}`)
    },
    listarPartes(processoId) {
      return getArray<PartesDto>(`/api/partes/listarPartesDoProcesso/${processoId}`)
    },
    getDadosBasicos(processoId) {
      return getArray<DadosBasicosDTO>(`/api/dados-basicos/listarDadosBasicosDoProcesso/${processoId}`)
    },
    async getAgenda(processoId) {
      try {
        return await getJson<ProcessoAgendaDTO>(`/api/processos/${processoId}/agenda`)
      } catch {
        return null
      }
    },

    async downloadDocumento(url) {
      if (!url) return null
      const absolute = url.startsWith('http') ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`
      // Tenta sem auth (CDN público) e, se barrado, com o JWT.
      const tryFetch = async (withAuth: boolean): Promise<Response> => {
        const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
        if (withAuth) {
          if (!token) await authenticate()
          headers.Authorization = token!
        }
        return doFetch(absolute, { headers, redirect: 'follow' })
      }
      try {
        let res = await tryFetch(false)
        if (res.status === 401 || res.status === 403) res = await tryFetch(true)
        if (!res.ok) return null
        const content = Buffer.from(await res.arrayBuffer())
        if (content.byteLength < 100) return null
        const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
        const disposition = res.headers.get('content-disposition') ?? ''
        const m = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        const filename = m ? decodeURIComponent(m[1].replace(/['"]/g, '')) : 'documento.pdf'
        return { content, contentType, filename }
      } catch {
        return null
      }
    },

    getIndicadorAssuntos() {
      return getArray<ProcessoAssuntoQuantidadeDTO>('/api/processos/indicadores/assuntos')
    },
    getIndicadorMarcadores() {
      return getArray<ProcessoMarcadorQuantidadeDTO>('/api/processos/indicadores/marcadores')
    },
    getIndicadorFinanceiro() {
      return getArray<ProcessoFinanceiroGrupoDTO>('/api/processos/indicadores/financeiro')
    },
    getIndicadorFinanceiroCategorias() {
      return getArray<ProcessoFinanceiroCategoriaTotalDTO>('/api/processos/indicadores/financeiro/categorias')
    },
    async getIndicadorDuracao() {
      try {
        return await getJson<ProcessoDuracaoPorEstadoResponseDTO>('/api/processos/indicadores/duracao-por-estado')
      } catch {
        return null
      }
    },
  }
}
