/**
 * Cliente da API interna do Expedit (app-v2.expedit.com.br).
 *
 * Autentica via `POST /login` (form-urlencoded), guarda o cookie de sessão
 * (`PHPSESSID`) num cookie jar e expõe métodos tipados para processos,
 * publicações e download de documentos.
 *
 * Espelha o padrão de cookie jar + `fetch` (undici) + `ProxyAgent` usado em
 * `src/lib/scraper/eproc-http.ts`, porém mais simples: o Expedit usa apenas
 * sessão PHP (sem Keycloak/TOTP) e responde JSON.
 *
 * Como a API é interna e pode mudar, todo o parsing/normalização fica isolado
 * aqui para minimizar o impacto de alterações no restante da aplicação.
 */
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici'

import type {
  ExpeditPaginatedResponse,
  ExpeditProcesso,
  ExpeditProcessoDetalhe,
  ExpeditProcessoDetalheResponse,
  ExpeditPublicacaoGrupo,
  ExpeditPublicacaoItem,
  ExpeditPublicacoesDiarioResponse,
} from '@/lib/expedit/expedit-types'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface ExpeditConfig {
  /** Base URL do app (ex.: https://app-v2.expedit.com.br). */
  baseUrl: string
  email: string
  senha: string
  /** Timeout por requisição em ms (default 30000). */
  timeout?: number
  /** Proxy HTTP opcional. */
  proxyUrl?: string
}

export type DataRange = {
  from: Date
  to: Date
}

export type ExpeditDocumentoDownload = {
  content: Buffer
  contentType: string
  filename: string
}

// ─── Cookie jar (mesmo padrão de eproc-http.ts) ───────────────────────────────

class CookieJar {
  private cookies = new Map<string, string>()
  public dispatcher?: Dispatcher

  capture(response: Response): void {
    const setCookies = response.headers.getSetCookie?.() ?? []
    for (const raw of setCookies) {
      const match = raw.match(/^([^=]+)=([^;]*)/)
      if (match) this.cookies.set(match[1], match[2])
    }
  }

  toString(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  has(name: string): boolean {
    return this.cookies.has(name)
  }
}

// ─── Helpers de data ──────────────────────────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** "dd/mm/yyyy" */
const toBrDate = (d: Date): string =>
  `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`

/** "YYYY-MM-DD" */
const toIsoDate = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`

// ─── Cliente ──────────────────────────────────────────────────────────────────

export interface ExpeditClient {
  /** Lista uma página de processos. */
  listProcessos(params?: {
    status?: string
    limit?: number
    offset?: number
  }): Promise<ExpeditPaginatedResponse<ExpeditProcesso>>
  /** Lista TODOS os processos paginando por `totalPages`. */
  listAllProcessos(params?: { status?: string; limit?: number }): Promise<ExpeditProcesso[]>
  /** Detalhe de um processo por número CNJ. */
  getProcessoDetalhe(numeroCNJ: string): Promise<ExpeditProcessoDetalhe | null>
  /** Grupos de publicações (por dia/diário) num intervalo. */
  listPublicacaoGrupos(range: DataRange, page?: number, limit?: number): Promise<ExpeditPublicacaoGrupo[]>
  /** Itens (publicações) de um diário específico. */
  listPublicacoesDoDiario(params: {
    data: Date
    uf: string
    sigla: string
    range: DataRange
  }): Promise<ExpeditPublicacaoItem[]>
  /** Baixa um documento do Expedit a partir de uma URL absoluta/relativa. */
  downloadDocumento(url: string): Promise<ExpeditDocumentoDownload | null>
}

export const createExpeditClient = (config: ExpeditConfig): ExpeditClient => {
  const timeout = config.timeout ?? 30000
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const cookies = new CookieJar()
  let authenticated = false

  if (config.proxyUrl) {
    cookies.dispatcher = new ProxyAgent(config.proxyUrl)
  }

  const doFetch = async (
    url: string,
    init: RequestInit & { dispatcher?: Dispatcher } = {}
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookies.toString(),
      ...(init.headers as Record<string, string> | undefined),
    }
    // Permite remover um header padrão passando string vazia (ex.: X-Requested-With
    // no fluxo de login, que deve imitar um POST de formulário do navegador).
    for (const key of Object.keys(headers)) {
      if (headers[key] === '') delete headers[key]
    }
    const fetchOptions: RequestInit & { dispatcher?: Dispatcher } = {
      ...init,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    }
    if (cookies.dispatcher) fetchOptions.dispatcher = cookies.dispatcher

    const response = cookies.dispatcher
      ? ((await undiciFetch(url, fetchOptions as never)) as unknown as Response)
      : await fetch(url, fetchOptions)
    cookies.capture(response)
    return response
  }

  /** Extrai o token CSRF do input hidden `name="csrf"` da página de login. */
  const extractCsrf = (html: string): string => {
    const m =
      html.match(/name=["']csrf["'][^>]*value=["']([^"']+)["']/i) ??
      html.match(/value=["']([^"']+)["'][^>]*name=["']csrf["']/i)
    return m?.[1] ?? ''
  }

  const authenticate = async (): Promise<void> => {
    if (authenticated) return

    // 1) GET /login → obtém PHPSESSID (cookie) e o token CSRF do formulário.
    const loginPage = await doFetch(`${baseUrl}/login`, {
      headers: { Accept: 'text/html', 'X-Requested-With': '' },
    })
    const csrf = extractCsrf(await loginPage.text())

    // 2) POST /login imitando o submit do formulário do navegador. Os nomes reais
    //    dos campos são `csrf`, `email` e `password` (não `senha`).
    const body = new URLSearchParams({ csrf, email: config.email, password: config.senha })
    await doFetch(`${baseUrl}/login`, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
        'X-Requested-With': '',
      },
    })

    // 3) Valida a sessão: um endpoint protegido deve responder JSON. Se vier HTML,
    //    o login não autenticou (credenciais inválidas ou CSRF ausente).
    const probe = await doFetch(`${baseUrl}/processos/getProcessCounts`)
    const contentType = probe.headers.get('content-type') ?? ''
    if (!cookies.has('PHPSESSID') || !contentType.includes('json')) {
      throw new Error('Expedit: falha no login (credenciais inválidas ou CSRF)')
    }
    authenticated = true
  }

  const getJson = async <T>(path: string): Promise<T> => {
    await authenticate()
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`
    const response = await doFetch(url)
    if (!response.ok) {
      throw new Error(`Expedit: GET ${path} retornou HTTP ${response.status}`)
    }
    return (await response.json()) as T
  }

  return {
    async listProcessos(params = {}) {
      const { status = 'ATIVOS', limit = 100, offset = 0 } = params
      const qs = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        status,
      })
      return getJson<ExpeditPaginatedResponse<ExpeditProcesso>>(
        `/processos/dados?${qs.toString()}`
      )
    },

    async listAllProcessos(params = {}) {
      const { status = 'ATIVOS', limit = 100 } = params
      const all: ExpeditProcesso[] = []
      let offset = 0
      let totalPages = 1
      let page = 0
      do {
        const res = await this.listProcessos({ status, limit, offset })
        all.push(...(res.data ?? []))
        totalPages = res.totalPages ?? 1
        offset += limit
        page += 1
      } while (page < totalPages && page < 1000) // guarda contra loop infinito
      return all
    },

    async getProcessoDetalhe(numeroCNJ) {
      const b64 = Buffer.from(numeroCNJ).toString('base64')
      const res = await getJson<ExpeditProcessoDetalheResponse>(`/processos/modal/${b64}`)
      return res.data?.[0] ?? null
    },

    async listPublicacaoGrupos(range, page = 1, limit = 100) {
      const dataParam = `${toBrDate(range.from)} - ${toBrDate(range.to)}`
      const qs = new URLSearchParams({
        data: dataParam,
        page: String(page),
        limit: String(limit),
      })
      const res = await getJson<ExpeditPaginatedResponse<ExpeditPublicacaoGrupo>>(
        `/atualizacao/publicacoes/lista?${qs.toString()}`
      )
      return res.data ?? []
    },

    async listPublicacoesDoDiario({ data, uf, sigla, range }) {
      const qs = new URLSearchParams({
        Data: toIsoDate(data),
        estado: uf,
        sigla_diario: sigla,
        'filter[data]': `${toBrDate(range.from)} - ${toBrDate(range.to)}`,
      })
      const res = await getJson<ExpeditPublicacoesDiarioResponse>(
        `/atualizacao/publicacoes/diarios?${qs.toString()}`
      )
      return res.montaTemplate?.[0]?.dados ?? []
    },

    async downloadDocumento(url) {
      await authenticate()
      const absolute = url.startsWith('http') ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`
      try {
        const response = await doFetch(absolute, { redirect: 'follow' })
        if (!response.ok) return null
        const content = Buffer.from(await response.arrayBuffer())
        if (content.byteLength < 100) return null

        const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
        const disposition = response.headers.get('content-disposition') ?? ''
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        const filename = match
          ? decodeURIComponent(match[1].replace(/['"]/g, ''))
          : 'documento.pdf'

        return { content, contentType, filename }
      } catch {
        return null
      }
    },
  }
}
