/**
 * Autentica no E-PROC via HTTP (username + senha + TOTP), captura cookies por
 * domínio e injeta no Chromium — abrindo o navegador já logado.
 *
 * Uso:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config src/scripts/open-eproc-via-http.ts TJRS
 */

import 'dotenv/config'
import { chromium } from 'playwright'
import { TOTP } from 'otpauth'
import * as cheerio from 'cheerio'

type Tribunal = 'TJSC' | 'TJRS'

const BASE_URLS: Record<Tribunal, string> = {
  TJSC: 'https://eproc1g.tjsc.jus.br/eproc/',
  TJRS: 'https://eproc1g.tjrs.jus.br/eproc/',
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const TRIBUNAL = (process.argv[2]?.toUpperCase() as Tribunal) ?? 'TJRS'
if (TRIBUNAL !== 'TJSC' && TRIBUNAL !== 'TJRS') {
  console.error('Uso: open-eproc-via-http.ts [TJSC|TJRS]')
  process.exit(1)
}

const getEnv = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`Variável ausente: ${k}`)
  return v
}

const usuario = getEnv(`EPROC_${TRIBUNAL}_USER`)
const senha = getEnv(`EPROC_${TRIBUNAL}_PASSWORD`)
const totpSeed = getEnv(`EPROC_${TRIBUNAL}_TOTP_SEED`)

function totpNow(): string {
  const totp = new TOTP({ secret: totpSeed.replace(/\s+/g, '').toUpperCase(), algorithm: 'SHA1', digits: 6, period: 30 })
  return totp.generate()
}

// ─── Cookie jar com rastreamento por domínio ─────────────────────────────────

type StoredCookie = {
  name: string
  value: string
  domain: string // host do último response que setou (sem leading dot)
  path: string
}

class DomainCookieJar {
  private cookies = new Map<string, StoredCookie>() // key = domain|name|path

  capture(resUrl: string, response: Response): void {
    const setCookies = response.headers.getSetCookie?.() ?? []
    const url = new URL(resUrl)
    for (const raw of setCookies) {
      const parts = raw.split(';').map((p) => p.trim())
      const [head, ...attrs] = parts
      const eq = head.indexOf('=')
      if (eq < 0) continue
      const name = head.slice(0, eq)
      const value = head.slice(eq + 1)
      let domain = url.hostname
      let path = '/'
      for (const a of attrs) {
        const [k, v] = a.split('=').map((s) => s?.trim())
        if (!k) continue
        if (k.toLowerCase() === 'domain' && v) domain = v.replace(/^\./, '')
        if (k.toLowerCase() === 'path' && v) path = v
      }
      this.cookies.set(`${domain}|${name}|${path}`, { name, value, domain, path })
    }
  }

  // Cookies a enviar para uma URL (domain-match simples)
  cookieHeaderFor(url: string): string {
    const u = new URL(url)
    const host = u.hostname
    return Array.from(this.cookies.values())
      .filter((c) => host === c.domain || host.endsWith(`.${c.domain}`))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')
  }

  toPlaywright(): Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; sameSite: 'Lax' | 'Strict' | 'None' }> {
    return Array.from(this.cookies.values()).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: true,
      httpOnly: false,
      sameSite: 'Lax' as const,
    }))
  }
}

// ─── HTTP com follow manual ──────────────────────────────────────────────────

async function httpRequest(
  url: string,
  opts: {
    method?: 'GET' | 'POST'
    body?: string
    jar: DomainCookieJar
    referer?: string
    timeout?: number
    maxRedirects?: number
  },
): Promise<{ finalUrl: string; status: number; html: string }> {
  let currentUrl = url
  let currentMethod = opts.method ?? 'GET'
  let currentBody: string | undefined = opts.body
  const maxRedirects = opts.maxRedirects ?? 15

  for (let i = 0; i <= maxRedirects; i++) {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Cookie': opts.jar.cookieHeaderFor(currentUrl),
    }
    if (opts.referer) headers['Referer'] = opts.referer
    if (currentBody) headers['Content-Type'] = 'application/x-www-form-urlencoded'

    const res = await fetch(currentUrl, {
      method: currentMethod,
      headers,
      body: currentBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeout ?? 30000),
    })
    opts.jar.capture(currentUrl, res)

    const location = res.headers.get('location')
    if (location && [301, 302, 303, 307, 308].includes(res.status)) {
      currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href
      if ([301, 302, 303].includes(res.status)) {
        currentMethod = 'GET'
        currentBody = undefined
      }
      continue
    }

    const ct = res.headers.get('content-type') ?? ''
    const html = ct.includes('iso-8859-1') || ct.includes('latin1')
      ? new TextDecoder('iso-8859-1').decode(await res.arrayBuffer())
      : await res.text()
    return { finalUrl: currentUrl, status: res.status, html }
  }
  throw new Error(`Excedeu ${maxRedirects} redirects a partir de ${url}`)
}

// ─── Fluxo de login ──────────────────────────────────────────────────────────

async function loginHttp(): Promise<{ jar: DomainCookieJar; painelUrl: string }> {
  const jar = new DomainCookieJar()
  const timeout = 30000

  console.log('[HTTP-LOGIN] GET inicial')
  const step1 = await httpRequest(BASE_URLS[TRIBUNAL], { jar, timeout })
  const $1 = cheerio.load(step1.html)

  // Detecta form de login
  const kcForm = $1('form#kc-form-login, form[action*="login-actions"]').first()
  const isKc = kcForm.length > 0

  let loginAction = ''
  let loginBody: URLSearchParams

  if (isKc) {
    console.log('[HTTP-LOGIN] Form Keycloak detectado')
    const action = kcForm.attr('action') ?? ''
    loginAction = action.startsWith('http') ? action : new URL(action, step1.finalUrl).href
    loginBody = new URLSearchParams({
      username: usuario,
      password: senha,
      credentialId: '',
      login: 'Entrar',
    })
  } else {
    const nativeForm = $1('input[name="txtUsuario"]').closest('form')
    const action = nativeForm.attr('action') ?? ''
    if (!action) throw new Error('Form de login não detectado')
    console.log('[HTTP-LOGIN] Form nativo E-PROC detectado')
    loginAction = action.startsWith('http') ? action : new URL(action, step1.finalUrl).href
    loginBody = new URLSearchParams({
      txtUsuario: usuario,
      pwdSenha: senha,
    })
  }

  console.log('[HTTP-LOGIN] POST credenciais')
  const step2 = await httpRequest(loginAction, {
    method: 'POST',
    body: loginBody.toString(),
    jar,
    referer: step1.finalUrl,
    timeout,
  })

  // Detecta campo OTP na resposta
  const $2 = cheerio.load(step2.html)
  const otpAction = $2('form[action*="login-actions"]').attr('action')
    ?? $2('form#kc-otp-login-form').attr('action')
    ?? ($2('input#otp, input[name="otp"]').length
      ? $2('input#otp, input[name="otp"]').closest('form').attr('action')
      : undefined)

  if (otpAction) {
    const totpUrl = otpAction.startsWith('http') ? otpAction : new URL(otpAction, step2.finalUrl).href

    // Aguarda TOTP fresco
    const remaining = 30 - (Math.floor(Date.now() / 1000) % 30)
    if (remaining < 8) {
      console.log(`[HTTP-LOGIN] TOTP expira em ${remaining}s — aguardando renovação...`)
      await new Promise((r) => setTimeout(r, (remaining + 1) * 1000))
    }

    const code = totpNow()
    console.log(`[HTTP-LOGIN] POST TOTP (${code})`)
    const step3 = await httpRequest(totpUrl, {
      method: 'POST',
      body: new URLSearchParams({ otp: code, login: 'Entrar' }).toString(),
      jar,
      referer: step2.finalUrl,
      timeout,
    })

    // Se após TOTP ainda está em tela de erro
    const bodyText = cheerio.load(step3.html)('body').text().trim().slice(0, 300).replace(/\s+/g, ' ')
    console.log(`[HTTP-LOGIN] URL final: ${step3.finalUrl}`)
    if (/inv[aá]lid|incorret|falhou/i.test(bodyText)) {
      console.warn(`[HTTP-LOGIN] possível erro: ${bodyText}`)
    }
    return { jar, painelUrl: step3.finalUrl }
  }

  // Sem TOTP — verifica se login realmente concluiu
  const bodyText2 = cheerio.load(step2.html)('body').text().trim().slice(0, 300).replace(/\s+/g, ' ')
  if (/inv[aá]lid|incorret|falhou/i.test(bodyText2)) {
    throw new Error(`Login falhou: ${bodyText2}`)
  }
  console.log(`[HTTP-LOGIN] URL final: ${step2.finalUrl}`)
  return { jar, painelUrl: step2.finalUrl }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[MAIN] Autenticando ${TRIBUNAL} via HTTP...`)
  const { jar, painelUrl } = await loginHttp()

  const cookies = jar.toPlaywright()
  console.log(`[MAIN] Cookies capturados: ${cookies.length}`)
  const domains = [...new Set(cookies.map((c) => c.domain))]
  console.log(`[MAIN] Domínios: ${domains.join(', ')}`)

  console.log('[MAIN] Abrindo Chromium com cookies injetados...')
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ userAgent: USER_AGENT })
  await ctx.addCookies(cookies)
  const page = await ctx.newPage()
  await page.goto(painelUrl, { waitUntil: 'domcontentloaded' })
  console.log(`[MAIN] Navegado para: ${page.url()}`)
  console.log('[MAIN] Browser aberto. Feche a janela ou Ctrl+C para encerrar.')

  await new Promise<void>((resolve) => browser.on('disconnected', () => resolve()))
}

main().catch((err) => {
  console.error('[MAIN] Erro:', err)
  process.exit(1)
})
