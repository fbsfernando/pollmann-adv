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
}

/**
 * HTTP request com follow manual de redirects para capturar cookies em cada hop.
 * O `fetch` nativo com `redirect: 'follow'` perde Set-Cookie de respostas intermediárias.
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

    if (currentBody && opts.contentType !== 'none') {
      headers['Content-Type'] = opts.contentType ?? 'application/x-www-form-urlencoded'
    }

    const response = await fetch(currentUrl, {
      method: currentMethod,
      headers,
      body: currentBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeout),
    })

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

  const $lista = cheerio.load(html)
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

// ─── Download de documento ───────────────────────────────────────────────────

async function downloadDocument(
  url: string,
  cookies: CookieJar,
  timeout: number
): Promise<{ content: Buffer; filename: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': cookies.toString(),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    })

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

      try {
        const { html } = await httpRequest(ref.link, {
          cookies: session.cookies,
          timeout,
        })

        const { andamentos: processoAndamentos, docRefs } = extrairAndamentosDoHtml(html, ref.numero)
        andamentos.push(...processoAndamentos)
        for (const [k, v] of docRefs) {
          if (v) allDocRefs.set(k, v)
        }
        console.log(`[EPROC-HTTP]   → ${processoAndamentos.length} andamento(s)`)
      } catch (err) {
        console.error(`[EPROC-HTTP] Erro em ${ref.numero}:`, err)
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
