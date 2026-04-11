/**
 * Script de diagnóstico: captura todas as requisições de rede feitas pelo E-PROC
 * durante a navegação autenticada, com foco nos XHR/fetch que carregam dados dinâmicos.
 *
 * Uso:
 *   EPROC_TJSC_USER=... EPROC_TJSC_PASSWORD=... EPROC_TJSC_TOTP_SEED=... \
 *   npx tsx src/scripts/inspect-network.ts
 *
 * Saída: tmp/network-capture.json
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { TOTP } from 'otpauth'

const TRIBUNAL_URL = 'https://eproc1g.tjsc.jus.br/eproc/'

const getEnv = (key: string) => {
  const val = process.env[key]
  if (!val) throw new Error(`Variável ausente: ${key}`)
  return val
}

const createTotp = (seed: string) =>
  new TOTP({ secret: seed.replace(/\s+/g, '').toUpperCase(), digits: 6, period: 30, algorithm: 'SHA1' })

/** Aguarda até que faltem pelo menos 8 segundos no período TOTP, para garantir que o código não expire durante envio. */
const waitForFreshTotp = async (seed: string): Promise<string> => {
  const totp = createTotp(seed)
  const remaining = totp.period - (Math.floor(Date.now() / 1000) % totp.period)
  if (remaining < 8) {
    const waitMs = (remaining + 1) * 1000
    console.log(`[inspect] TOTP expira em ${remaining}s — aguardando ${waitMs}ms para código fresco...`)
    await new Promise((r) => setTimeout(r, waitMs))
  }
  return totp.generate()
}

type CapturedRequest = {
  phase: string
  method: string
  url: string
  resourceType: string
  postData?: string | null
  responseStatus?: number
  responseHeaders?: Record<string, string>
  responseBodySnippet?: string
}

async function main() {
  const usuario = getEnv('EPROC_TJSC_USER')
  const senha = getEnv('EPROC_TJSC_PASSWORD')
  const totpSeed = getEnv('EPROC_TJSC_TOTP_SEED')

  const captured: CapturedRequest[] = []
  let currentPhase = 'init'

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
  })

  // Intercepta todas as requisições
  context.on('request', (req) => {
    const type = req.resourceType()
    // Foca em xhr, fetch, document — ignora imagens/fontes/css
    if (!['xhr', 'fetch', 'document'].includes(type)) return

    captured.push({
      phase: currentPhase,
      method: req.method(),
      url: req.url(),
      resourceType: type,
      postData: req.postData(),
    })
  })

  // Captura respostas
  context.on('response', async (res) => {
    const type = res.request().resourceType()
    if (!['xhr', 'fetch'].includes(type)) return

    const entry = captured.findLast((r) => r.url === res.url() && !r.responseStatus)
    if (!entry) return

    entry.responseStatus = res.status()
    entry.responseHeaders = res.headers()

    try {
      const body = await res.body()
      const text = body.toString('utf-8').slice(0, 2000)
      entry.responseBodySnippet = text
    } catch {
      entry.responseBodySnippet = '[erro ao ler body]'
    }
  })

  const page = await context.newPage()

  try {
    // ── Fase 1: Login ──────────────────────────────────────────────────────────
    currentPhase = 'login'
    console.log('[inspect] Navegando para login...')
    await page.goto(TRIBUNAL_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('input#username', { timeout: 15000 })

    await page.fill('input#username', usuario)
    await page.fill('input#password', senha)
    await page.click('input[type=submit], button[type=submit]')
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 })

    const otpInput = await page.$('input#otp, input[name="otp"]')
    if (otpInput) {
      currentPhase = 'totp'
      const code = await waitForFreshTotp(totpSeed)
      console.log(`[inspect] TOTP: ${code}`)
      await otpInput.fill(code)
      await page.click('input[type=submit], button[type=submit]')
      await page.waitForURL(/eproc1g\.tjsc\.jus\.br.*controlador/, { timeout: 30000 })
    }

    console.log('[inspect] Login OK. URL:', page.url())

    // Captura cookies de sessão (útil para replicar em HTTP direto)
    const cookies = await context.cookies()
    console.log('[inspect] Cookies:', cookies.map(c => `${c.name}=${c.value.slice(0, 10)}...`).join('; '))

    // Delay pós-login para não sobrecarregar
    await page.waitForTimeout(3000)

    // ── Fase 2: Listagem de processos ──────────────────────────────────────────
    currentPhase = 'listagem-processos'
    console.log('[inspect] Navegando para relação de processos...')

    const relacaoHref = await page.evaluate((): string | null => {
      for (const a of Array.from(document.querySelectorAll('a[href*="relatorio_processo_procurador_listar"]')) as HTMLAnchorElement[]) {
        if (!a.href.includes('ord_ultimas')) return a.href
      }
      return null
    })

    if (!relacaoHref) throw new Error('Link "Relação de processos" não encontrado')
    console.log('[inspect] relacaoHref:', relacaoHref)

    // Retry com backoff para lidar com ERR_CONNECTION_RESET
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(relacaoHref, { waitUntil: 'domcontentloaded', timeout: 30000 })
        break
      } catch (err) {
        console.warn(`[inspect] Tentativa ${attempt}/3 falhou: ${(err as Error).message.slice(0, 80)}`)
        if (attempt === 3) throw err
        await page.waitForTimeout(3000 * attempt)
      }
    }
    await page.waitForSelector('a[href*="processo_selecionar"]', { timeout: 15000 })

    // ── Fase 3: Primeiro processo ──────────────────────────────────────────────
    currentPhase = 'processo-detail'
    const primeiroLink = await page.evaluate((): string | null => {
      const a = document.querySelector('a[href*="processo_selecionar"]') as HTMLAnchorElement | null
      return a?.href ?? null
    })

    if (!primeiroLink) throw new Error('Nenhum processo encontrado')
    console.log('[inspect] Primeiro processo:', primeiroLink.slice(0, 120))

    await page.waitForTimeout(2000)
    await page.goto(primeiroLink, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Aguarda a tabela de eventos carregar via AJAX
    currentPhase = 'tblEventos-ajax'
    console.log('[inspect] Aguardando #tblEventos carregar via AJAX...')
    try {
      await page.waitForFunction(
        () => {
          const t = document.querySelector('#tblEventos')
          return t && t.querySelectorAll('tr').length > 3
        },
        { timeout: 20000 }
      )
      console.log('[inspect] Tabela carregada!')
    } catch {
      console.warn('[inspect] Timeout aguardando #tblEventos')
    }

    // Pausa para capturar eventuais requisições tardias
    await page.waitForTimeout(2000)

  } catch (err) {
    console.error('[inspect] Erro durante navegação:', (err as Error).message)
    console.log('[inspect] Salvando dados capturados até o momento...')
  } finally {
    await browser.close()
  }

  // ── Salva resultado (mesmo em caso de falha parcial) ────────────────────────
  await mkdir('tmp', { recursive: true })
  const output = {
    capturedAt: new Date().toISOString(),
    lastPhase: currentPhase,
    totalRequests: captured.length,
    xhrFetchRequests: captured.filter((r) => ['xhr', 'fetch'].includes(r.resourceType)),
    allRequests: captured,
  }

  await writeFile('tmp/network-capture.json', JSON.stringify(output, null, 2))

  console.log('\n[inspect] ✓ Captura salva em tmp/network-capture.json')
  console.log(`[inspect] Última fase atingida: ${currentPhase}`)
  console.log(`[inspect] Total de requisições: ${captured.length}`)
  console.log(`[inspect] XHR/Fetch: ${output.xhrFetchRequests.length}`)

  // Resumo no terminal
  console.log('\n── Requisições XHR/Fetch capturadas ──────────────────────────')
  for (const r of output.xhrFetchRequests) {
    console.log(`[${r.phase}] ${r.method} ${r.url.slice(0, 120)}`)
    if (r.postData) console.log(`  POST body: ${r.postData.slice(0, 200)}`)
    if (r.responseStatus) console.log(`  → ${r.responseStatus}`)
  }
}

main().catch((err) => {
  console.error('[inspect] Erro:', err)
  process.exitCode = 1
})
