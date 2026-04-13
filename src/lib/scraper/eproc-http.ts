/**
 * Scraper E-PROC via HTTP direto (sem Playwright/Chromium).
 *
 * Substitui o scraper Playwright por requests HTTP + cheerio,
 * eliminando a necessidade de ~300MB de Chromium em memória.
 *
 * Fluxo de autenticação:
 *   1. GET eproc/ → redirect SSO Keycloak
 *   2. POST credenciais no Keycloak
 *   3. POST TOTP → redirect com code
 *   4. GET callback → sessão autenticada (cookies PHPSESSID etc.)
 *
 * Coleta:
 *   - Listagem de processos: GET + cheerio parse
 *   - Andamentos: GET processo_selecionar + cheerio parse #tblEventos
 *   - Downloads: GET direto com cookies de sessão
 */

import { setTimeout as sleep } from 'node:timers/promises'
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici'
import { TOTP } from 'otpauth'
import * as cheerio from 'cheerio'

import type { EprocClient } from '@/lib/scraper/eproc-client'
import type { ExternalAndamentoInput, ExternalDocumentoInput, ScraperSnapshot } from '@/lib/pipeline/types'

// ─── Configuração ────────────────────────────────────────────────────────────

export type Tribunal = 'TJSC' | 'TJRS'

export interface EprocHttpConfig {
  tribunal: Tribunal
  usuario: string
  senha: string
  totpSeed: string
  /** Números de processo a consultar. Se vazio, lista do painel. */
  processos?: string[]
  /** Timeout por operação em ms (default 30000) */
  timeout?: number
  /** Delay em ms entre consultas de processos (default 2000) */
  interProcessoDelayMs?: number
  /**
   * URL do proxy HTTP para rotear as requisições.
   * Ex: http://user:pass@host:port
   * Necessário para TJRS quando o IP do servidor está bloqueado pelo Cloudflare.
   */
  proxyUrl?: string
}

const BASE_URLS: Record<Tribunal, string> = {
  TJSC: 'https://eproc1g.tjsc.jus.br/eproc/',
  TJRS: 'https://eproc1g.tjrs.jus.br/eproc/',
}

const SSO_HOSTS: Record<Tribunal, string> = {
  TJSC: 'sso.tjsc.jus.br',
  TJRS: 'sso.tjrs.jus.br',
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ─── Helpers TOTP ────────────────────────────────────────────────────────────

const normalizeTotpSeed = (seed: string): string =>
  seed.replace(/\s+/g, '').toUpperCase()

const generateFreshTotp = async (seed: string): Promise<string> => {
  const totp = new TOTP({
    secret: normalizeTotpSeed(seed),
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  })
  // Aguarda período TOTP fresco (>8s restantes) para evitar expiração durante envio
  const remaining = totp.period - (Math.floor(Date.now() / 1000) % totp.period)
  if (remaining < 8) {
    const waitMs = (remaining + 1) * 1000
    console.log(`[EPROC-HTTP] TOTP expira em ${remaining}s — aguardando ${waitMs}ms...`)
    await sleep(waitMs)
  }
  return totp.generate()
}

// ─── Parser de data do E-PROC ────────────────────────────────────────────────

const parseEprocDate = (raw: string): string | null => {
  const m = raw.trim().match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)/)
  if (!m) return null
  const [, d, mo, y, h = '00', min = '00'] = m
  return `${y}-${mo}-${d}T${h}:${min}:00.000Z`
}

// ─── Gerenciamento de cookies ────────────────────────────────────────────────

class CookieJar {
  private cookies = new Map<string, string>()
  /** Dispatcher compartilhado (ProxyAgent) para propagar proxy em todas as requisições */
  public dispatcher?: Dispatcher

  /** Extrai Set-Cookie headers de um Response e armazena */
  capture(response: Response): void {
    const setCookies = response.headers.getSetCookie?.() ?? []
    for (const raw of setCookies) {
      const match = raw.match(/^([^=]+)=([^;]*)/)
      if (match) this.cookies.set(match[1], match[2])
    }
  }

  /** Retorna header Cookie para enviar nas requests */
  toString(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  has(name: string): boolean {
    return this.cookies.has(name)
  }
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

type FetchOpts = {
  method?: string
  body?: string | URLSearchParams
  cookies: CookieJar
  timeout: number
  redirect?: RequestRedirect
  contentType?: string
  referer?: string
  dispatcher?: Dispatcher
}

/**
 * HTTP request com follow manual de redirects para capturar cookies em cada hop.
 * O `fetch` nativo com `redirect: 'follow'` perde Set-Cookie de respostas intermediárias.
 * Suporta dispatcher customizado (ProxyAgent) via opts.dispatcher.
 */
async function httpRequest(
  url: string,
  opts: FetchOpts & { maxRedirects?: number }
): Promise<{ response: Response; html: string }> {
  let currentUrl = url
  let currentMethod = opts.method ?? 'GET'
  let currentBody: string | undefined = opts.body ? String(opts.body) : undefined
  const maxRedirects = opts.maxRedirects ?? 15

  for (let i = 0; i <= maxRedirects; i++) {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Cookie': opts.cookies.toString(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    }

    if (opts.referer) {
      headers['Referer'] = opts.referer
    }

    if (currentBody && opts.contentType !== 'none') {
      headers['Content-Type'] = opts.contentType ?? 'application/x-www-form-urlencoded'
    }

    // Usa undici.fetch quando há dispatcher (proxy) porque o fetch nativo do Node
    // usa undici interno e há incompatibilidade entre versões quando se passa
    // um Dispatcher criado com o pacote @undici.
    const dispatcher = opts.dispatcher ?? opts.cookies.dispatcher
    const fetchOptions: RequestInit & { dispatcher?: Dispatcher } = {
      method: currentMethod,
      headers,
      body: currentBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeout),
    }
    if (dispatcher) {
      fetchOptions.dispatcher = dispatcher
    }

    const response = dispatcher
      ? await (undiciFetch(currentUrl, fetchOptions as never) as unknown as Promise<Response>)
      : await fetch(currentUrl, fetchOptions)

    opts.cookies.capture(response)

    // Segue redirects manualmente para capturar cookies de cada hop
    const location = response.headers.get('location')
    if (location && [301, 302, 303, 307, 308].includes(response.status)) {
      currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href
      // 303 e 301/302 convertem POST→GET; 307/308 preservam o método
      if ([301, 302, 303].includes(response.status)) {
        currentMethod = 'GET'
        currentBody = undefined
      }
      continue
    }

    // E-PROC usa iso-8859-1 (latin1) — decodifica corretamente acentos
    const contentType = response.headers.get('content-type') ?? ''
    let html: string
    if (contentType.includes('iso-8859-1') || contentType.includes('latin1')) {
      const buffer = await response.arrayBuffer()
      html = new TextDecoder('iso-8859-1').decode(buffer)
    } else {
      html = await response.text()
    }
    return { response, html }
  }

  throw new Error(`Excedeu ${maxRedirects} redirects a partir de ${url}`)
}

// ─── Autenticação ────────────────────────────────────────────────────────────

interface AuthSession {
  cookies: CookieJar
  painelUrl: string
  painelHtml: string
}

/**
 * Detecta o tipo de formulário de login e monta os campos corretos.
 *
 * TJSC: SSO Keycloak puro → campos `username` / `password`
 * TJRS: Formulário nativo do E-PROC (txtUsuario/pwdSenha) OU SSO Keycloak
 */
function detectLoginForm($: cheerio.CheerioAPI, pageUrl: string): {
  action: string
  fields: Record<string, string>
  type: 'keycloak' | 'nativo'
} {
  // Tenta Keycloak primeiro (form com id kc-form-login ou action contendo login-actions)
  const kcForm = $('form#kc-form-login, form[action*="login-actions"]')
  if (kcForm.length) {
    const action = kcForm.attr('action') ?? ''
    return {
      action: action.startsWith('http') ? action : new URL(action, pageUrl).href,
      fields: { username: '', password: '', credentialId: '', login: 'Entrar' },
      type: 'keycloak',
    }
  }

  // Formulário nativo do E-PROC (TJRS usa txtUsuario/pwdSenha)
  const nativeUserField = $('input[name="txtUsuario"]')
  if (nativeUserField.length) {
    const form = nativeUserField.closest('form')
    const action = form.attr('action') ?? ''
    return {
      action: action.startsWith('http') ? action : new URL(action, pageUrl).href,
      fields: { txtUsuario: '', pwdSenha: '' },
      type: 'nativo',
    }
  }

  // Fallback genérico — tenta qualquer form com campos de login
  const anyForm = $('form').first()
  const action = anyForm.attr('action') ?? ''
  return {
    action: action.startsWith('http') ? action : new URL(action, pageUrl).href,
    fields: { username: '', password: '', login: 'Entrar' },
    type: 'keycloak',
  }
}

async function authenticate(config: EprocHttpConfig): Promise<AuthSession> {
  const timeout = config.timeout ?? 30000
  const cookies = new CookieJar()
  const baseUrl = BASE_URLS[config.tribunal]

  // Configura proxy (necessário para TJRS quando IP do servidor está bloqueado pelo Cloudflare)
  if (config.proxyUrl) {
    cookies.dispatcher = new ProxyAgent(config.proxyUrl)
    console.log(`[EPROC-HTTP] Usando proxy: ${config.proxyUrl.replace(/:\/\/[^@]+@/, '://***@')}`)
  }

  console.log(`[EPROC-HTTP] Iniciando login no ${config.tribunal}...`)

  // 1. GET inicial → segue redirects até o formulário de login
  const step1 = await httpRequest(baseUrl, { cookies, timeout })

  // 2. Detecta o tipo de form e monta os campos
  const $login = cheerio.load(step1.html)
  const loginForm = detectLoginForm($login, step1.response.url)

  if (!loginForm.action) {
    throw new Error(`Formulário de login não encontrado. URL: ${step1.response.url}`)
  }

  console.log(`[EPROC-HTTP] Form type: ${loginForm.type}, action: ${loginForm.action.slice(0, 100)}...`)

  // Preenche credenciais nos campos corretos
  const loginBody = new URLSearchParams()
  for (const [key, defaultVal] of Object.entries(loginForm.fields)) {
    if (key === 'username' || key === 'txtUsuario') {
      loginBody.set(key, config.usuario)
    } else if (key === 'password' || key === 'pwdSenha') {
      loginBody.set(key, config.senha)
    } else {
      loginBody.set(key, defaultVal)
    }
  }

  const step2 = await httpRequest(loginForm.action, {
    method: 'POST',
    body: loginBody,
    cookies,
    timeout,
  })

  // 3. TOTP (se necessário) — ambos os tribunais podem ter TOTP
  const $totp = cheerio.load(step2.html)
  const totpAction = $totp('form[action*="login-actions"]').attr('action')
    ?? $totp('form#kc-otp-login-form').attr('action')
    ?? ($totp('input#otp, input[name="otp"]').length
      ? $totp('input#otp, input[name="otp"]').closest('form').attr('action')
      : undefined)

  if (totpAction) {
    const code = await generateFreshTotp(config.totpSeed)
    console.log(`[EPROC-HTTP] TOTP: ${code}`)

    const totpUrl = totpAction.startsWith('http') ? totpAction : new URL(totpAction, step2.response.url).href

    const step3 = await httpRequest(totpUrl, {
      method: 'POST',
      body: new URLSearchParams({ otp: code, login: 'Entrar' }),
      cookies,
      timeout,
    })

    const painelUrl = step3.response.url
    console.log(`[EPROC-HTTP] Login OK. URL: ${painelUrl}`)
    return { cookies, painelUrl, painelHtml: step3.html }
  }

  // Login sem TOTP — já deve estar no painel
  console.log(`[EPROC-HTTP] Login OK (sem TOTP). URL: ${step2.response.url}`)
  return { cookies, painelUrl: step2.response.url, painelHtml: step2.html }
}

// ─── Extração de hash de sessão ──────────────────────────────────────────────

function extractSessionHash(html: string): string | null {
  // Busca hash em qualquer link do painel
  const match = html.match(/hash=([a-f0-9]{32})/)
  return match?.[1] ?? null
}

// ─── Listagem de processos ───────────────────────────────────────────────────

interface ProcessoRef {
  numero: string
  link: string
}

/**
 * O E-PROC pagina a listagem de processos (50 por página por padrão).
 *
 * A paginação usa o Infra framework: `infraAcaoPaginar('=', pag, 'Infra', null)`.
 * A função apenas muda `hdnInfraPaginaAtual.value = pag` e submete o form.
 * Replicamos via POST para o form action com todos os campos hidden preservados.
 */
async function fetchAllListPages(
  initialHtml: string,
  listaUrl: string,
  cookies: CookieJar,
  timeout: number
): Promise<string> {
  const $ = cheerio.load(initialHtml)

  // Detecta total de páginas pelo <select id="selInfraPaginacaoSuperior">
  const options = $('#selInfraPaginacaoSuperior option')
  if (options.length <= 1) return initialHtml // sem paginação

  const totalPaginas = options.length
  const itemsPerPage = parseInt($('input[name="hdnInfraNroItens"]').attr('value') ?? '50', 10)
  console.log(`[EPROC-HTTP]   Listagem paginada: ${totalPaginas} páginas × ${itemsPerPage} itens`)

  const form = $('#frmProcessoLista')
  if (!form.length) return initialHtml

  // Tenta primeiro: POST ao form action setando hdnInfraNroItens alto para trazer tudo em 1 página
  const formAction = form.attr('action') ?? ''
  const actionUrl = formAction.startsWith('http')
    ? formAction
    : new URL(formAction, listaUrl).href

  // Extrai APENAS os campos hdnInfra* (estado de pagina/critérios stored server-side).
  // Campos de filtro vazios (localidade, data, etc.) fazem o servidor resetar a busca
  // e retornar "Nenhum registro encontrado".
  const baseFields: Record<string, string> = {}
  form.find('input[name^="hdnInfra"]').each((_, el) => {
    const name = $(el).attr('name')
    if (!name || name.startsWith('chkInfraItem')) return
    const val = $(el).attr('value') ?? ''
    baseFields[name] = typeof val === 'string' ? val : ''
  })

  let mergedHtml = initialHtml
  for (let pagina = 1; pagina < totalPaginas; pagina++) {
    try {
      // infraAcaoPaginar apenas muda hdnInfraPaginaAtual e submete o form
      const body = new URLSearchParams(baseFields)
      body.set('hdnInfraPaginaAtual', String(pagina))

      const { html: pageHtml } = await httpRequest(actionUrl, {
        method: 'POST',
        body,
        cookies,
        timeout,
        referer: listaUrl,
      })

      const $page = cheerio.load(pageHtml)
      const novosLinks = $page('a[href*="processo_selecionar"]').length
      console.log(`[EPROC-HTTP]   Página ${pagina + 1}/${totalPaginas}: ${novosLinks} links`)
      if (novosLinks > 0) mergedHtml += '\n' + pageHtml
    } catch (err) {
      console.warn(`[EPROC-HTTP]   Falha na página ${pagina + 1}: ${(err as Error).message}`)
    }
  }

  return mergedHtml
}

async function listarProcessos(
  session: AuthSession,
  timeout: number
): Promise<ProcessoRef[]> {
  const $ = cheerio.load(session.painelHtml)

  // Extrai link da "Relação de processos"
  let relacaoHref: string | undefined
  $('a[href*="relatorio_processo_procurador_listar"]').each((_, el) => {
    const href = $(el).attr('href')
    if (href && !href.includes('ord_ultimas') && !relacaoHref) {
      relacaoHref = href
    }
  })

  if (!relacaoHref) {
    console.warn('[EPROC-HTTP] Link "Relação de processos" não encontrado')
    return []
  }

  if (!relacaoHref.startsWith('http')) {
    relacaoHref = new URL(relacaoHref, session.painelUrl).href
  }

  console.log('[EPROC-HTTP] Navegando para relação de processos...')
  const { html } = await httpRequest(relacaoHref, {
    cookies: session.cookies,
    timeout,
  })

  // O E-PROC pagina a listagem em blocos (default 50 itens/página).
  // Coleta todas as páginas agregando os links em um único documento.
  const fullHtml = await fetchAllListPages(html, relacaoHref, session.cookies, timeout)

  const $lista = cheerio.load(fullHtml)
  const cnj = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/
  const refs: ProcessoRef[] = []
  const seen = new Set<string>()

  $lista('a[href*="processo_selecionar"]').each((_, el) => {
    const numero = $lista(el).text().trim()
    const href = $lista(el).attr('href')
    if (!cnj.test(numero) || !href || seen.has(numero)) return
    seen.add(numero)

    const link = href.startsWith('http')
      ? href
      : new URL(href, relacaoHref!).href

    refs.push({ numero, link })
  })

  console.log(`[EPROC-HTTP] ${refs.length} processo(s) encontrados`)
  return refs
}

// ─── Extração de andamentos ──────────────────────────────────────────────────

function extrairAndamentosDoHtml(
  html: string,
  processoNumero: string
): { andamentos: ExternalAndamentoInput[]; docRefs: Map<string, string> } {
  const $ = cheerio.load(html)
  const andamentos: ExternalAndamentoInput[] = []
  const docRefs = new Map<string, string>()

  const tbl = $('#tblEventos')
  if (!tbl.length) {
    console.warn(`[EPROC-HTTP] Tabela #tblEventos não encontrada para ${processoNumero}`)
    return { andamentos, docRefs }
  }

  const rows = tbl.find('tr').slice(1) // pula header
  console.log(`[EPROC-HTTP] ${rows.length} evento(s) na tabela`)

  rows.each((_, row) => {
    const tds = $(row).find('td')
    if (tds.length < 3) return

    const eventoNumRaw = $(tds[0]).text().trim()
    const eventoNum = eventoNumRaw.match(/^\d+/)?.[0] ?? eventoNumRaw.replace(/\D/g, '').slice(0, 6)
    const textoData = $(tds[1]).text().trim()
    const descricao = $(tds[2]).text().trim()

    const dataIso = parseEprocDate(textoData)
    if (!dataIso || !descricao) return

    const docs: ExternalDocumentoInput[] = []
    $(row).find('a[href*="acessar_documento"]').each((_, a) => {
      const href = $(a).attr('href') ?? ''
      const nome = $(a).text().trim() || 'documento'
      const externalId = href
      docs.push({ externalId, nome })
      if (href) docRefs.set(externalId, href.startsWith('http') ? href : '')
    })

    andamentos.push({
      externalId: `${processoNumero}-evt-${eventoNum}`,
      processoNumero,
      dataIso,
      tipo: 'EVENTO',
      descricao: descricao.slice(0, 500),
      documentos: docs,
    })
  })

  return { andamentos, docRefs }
}

// ─── Paginação de eventos ────────────────────────────────────────────────────

/**
 * O E-PROC pagina os eventos em blocos de ~100. A primeira página vem no HTML
 * do processo. As demais são carregadas via POST AJAX para `processo_selecionar_pagina`.
 *
 * Extrai `urlPaginacao` e `totalPaginas` do JavaScript embutido na página,
 * faz POST para cada página adicional (1..totalPaginas), e injeta as linhas
 * retornadas (#tblEventosNovos > tbody > tr) na tabela #tblEventos do HTML original.
 */
async function fetchAllEventPages(
  initialHtml: string,
  processoUrl: string,
  cookies: CookieJar,
  timeout: number
): Promise<string> {
  // Extrai urlPaginacao do JS embutido
  const urlMatch = initialHtml.match(/urlPaginacao\s*=\s*'([^']+)'/)
  if (!urlMatch) return initialHtml

  // Extrai totalPaginas
  const totalMatch = initialHtml.match(/window\.totalPaginas\s*=\s*(\d+)/)
  if (!totalMatch) return initialHtml

  const totalPaginas = parseInt(totalMatch[1], 10)
  if (totalPaginas <= 0) return initialHtml

  // Resolve URL relativa para absoluta (relativa ao diretório da URL do processo)
  const paginacaoUrl = urlMatch[1].startsWith('http')
    ? urlMatch[1]
    : new URL(urlMatch[1], processoUrl).href

  console.log(`[EPROC-HTTP]   Paginação: ${totalPaginas + 1} páginas (buscando ${totalPaginas} adicionais)...`)

  // Coleta as linhas de eventos adicionais
  const extraRows: string[] = []

  for (let pagina = 1; pagina <= totalPaginas; pagina++) {
    try {
      const { html: pageHtml } = await httpRequest(paginacaoUrl, {
        method: 'POST',
        body: `pagina=${pagina}`,
        cookies,
        timeout,
      })

      // A resposta contém #tblEventosNovos com as linhas da página
      const $page = cheerio.load(pageHtml)
      const newRows = $page('#tblEventosNovos > tbody').html()
        ?? $page('#tblEventosNovos tbody').html()
        ?? $page('#tblEventosNovos').html()
        ?? ($page('tr').length > 0 ? $page('body').html() : null)

      if (newRows) {
        extraRows.push(newRows)
      } else {
        console.warn(`[EPROC-HTTP]     Página ${pagina}: sem eventos`)
      }
    } catch (err) {
      console.warn(`[EPROC-HTTP]   Falha na página ${pagina}/${totalPaginas}: ${(err as Error).message}`)
    }
  }

  if (extraRows.length === 0) return initialHtml

  // Injeta as linhas extras na tabela #tblEventos do HTML original
  const $ = cheerio.load(initialHtml)
  const tbody = $('#tblEventos tbody')
  if (tbody.length) {
    tbody.append(extraRows.join(''))
  } else {
    $('#tblEventos').append(`<tbody>${extraRows.join('')}</tbody>`)
  }

  return $.html()
}

// ─── Download de documento ───────────────────────────────────────────────────

async function downloadDocument(
  url: string,
  cookies: CookieJar,
  timeout: number
): Promise<{ content: Buffer; filename: string } | null> {
  try {
    const fetchOpts: RequestInit & { dispatcher?: Dispatcher } = {
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': cookies.toString(),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    }
    if (cookies.dispatcher) {
      fetchOpts.dispatcher = cookies.dispatcher
    }
    const response = cookies.dispatcher
      ? await (undiciFetch(url, fetchOpts as never) as unknown as Promise<Response>)
      : await fetch(url, fetchOpts)

    cookies.capture(response)

    if (!response.ok) return null

    const ct = response.headers.get('content-type') ?? ''
    if (!ct.includes('pdf') && !ct.includes('octet') && !ct.includes('pkcs7') && !ct.includes('application/')) {
      return null
    }

    const content = Buffer.from(await response.arrayBuffer())
    if (content.byteLength < 100) return null

    const disposition = response.headers.get('content-disposition') ?? ''
    const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
    const filename = filenameMatch
      ? decodeURIComponent(filenameMatch[1].replace(/['"]/g, ''))
      : 'documento.pdf'

    return { content, filename }
  } catch {
    return null
  }
}

// ─── Client público ──────────────────────────────────────────────────────────

export function createEprocHttpClient(config: EprocHttpConfig): EprocClient & {
  collectSnapshotWithDocuments(
    isDocumentKnown: (externalId: string) => Promise<boolean>
  ): Promise<ScraperSnapshot>
} {
  const timeout = config.timeout ?? 30000
  const interProcessoDelayMs = config.interProcessoDelayMs ?? 2000

  async function coletarAndamentos(session: AuthSession): Promise<{
    andamentos: ExternalAndamentoInput[]
    allDocRefs: Map<string, string>
  }> {
    let processoRefs = await listarProcessos(session, timeout)

    if (config.processos && config.processos.length > 0) {
      const numerosConfig = new Set(config.processos)
      processoRefs = processoRefs.filter(r => numerosConfig.has(r.numero))
      for (const num of config.processos) {
        if (!processoRefs.find(r => r.numero === num)) {
          console.warn(`[EPROC-HTTP] Processo ${num} não encontrado na relação — pulando`)
        }
      }
    }

    const andamentos: ExternalAndamentoInput[] = []
    const allDocRefs = new Map<string, string>()

    for (let i = 0; i < processoRefs.length; i++) {
      const ref = processoRefs[i]

      if (i > 0 && interProcessoDelayMs > 0) {
        await sleep(interProcessoDelayMs)
      }

      console.log(`[EPROC-HTTP] Consultando ${ref.numero} (${i + 1}/${processoRefs.length})...`)

      // Retry com backoff para lidar com timeouts em processos pesados
      let lastError: unknown = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          // Timeout progressivo: processos pesados ganham mais tempo em retries
          const attemptTimeout = timeout * attempt

          const { html } = await httpRequest(ref.link, {
            cookies: session.cookies,
            timeout: attemptTimeout,
          })

          // Busca páginas adicionais de eventos (paginação AJAX do E-PROC)
          const fullHtml = await fetchAllEventPages(html, ref.link, session.cookies, attemptTimeout)

          const { andamentos: processoAndamentos, docRefs } = extrairAndamentosDoHtml(fullHtml, ref.numero)
          andamentos.push(...processoAndamentos)
          for (const [k, v] of docRefs) {
            if (v) allDocRefs.set(k, v)
          }
          console.log(`[EPROC-HTTP]   → ${processoAndamentos.length} andamento(s)`)
          lastError = null
          break
        } catch (err) {
          lastError = err
          if (attempt < 3) {
            const backoffMs = 3000 * attempt
            console.warn(`[EPROC-HTTP]   Tentativa ${attempt}/3 falhou (${(err as Error).message?.slice(0, 60)}) — retry em ${backoffMs / 1000}s...`)
            await sleep(backoffMs)
          }
        }
      }

      if (lastError) {
        console.error(`[EPROC-HTTP] Erro em ${ref.numero} após 3 tentativas:`, (lastError as Error).message)
      }
    }

    return { andamentos, allDocRefs }
  }

  return {
    async collectSnapshot(): Promise<ScraperSnapshot> {
      const session = await authenticate(config)
      const { andamentos } = await coletarAndamentos(session)
      return { source: 'eproc', collectedAtIso: new Date().toISOString(), andamentos }
    },

    async collectSnapshotWithDocuments(
      isDocumentKnown: (externalId: string) => Promise<boolean>
    ): Promise<ScraperSnapshot> {
      const session = await authenticate(config)
      const { andamentos, allDocRefs } = await coletarAndamentos(session)

      let downloaded = 0
      let skipped = 0
      let failed = 0

      for (const andamento of andamentos) {
        if (!andamento.documentos?.length) continue
        for (const doc of andamento.documentos) {
          const known = await isDocumentKnown(doc.externalId).catch(() => false)
          if (known) { skipped++; continue }

          const href = allDocRefs.get(doc.externalId)
          if (!href) { failed++; continue }

          console.log(`[EPROC-HTTP] Baixando documento ${doc.nome}...`)
          const result = await downloadDocument(href, session.cookies, timeout)

          if (result) {
            doc.content = result.content
            if (result.filename && result.filename !== 'documento.pdf') {
              doc.nome = result.filename
            }
            downloaded++
          } else {
            failed++
          }
        }
      }

      console.log(`[EPROC-HTTP] Documentos: ${downloaded} baixados, ${skipped} já arquivados, ${failed} falhas`)
      return { source: 'eproc', collectedAtIso: new Date().toISOString(), andamentos }
    },
  }
}
