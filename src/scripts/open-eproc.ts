/**
 * Abre Chromium já logado no E-PROC (TJSC ou TJRS) e mantém o browser aberto.
 *
 * Uso:
 *   npx tsx -r dotenv/config src/scripts/open-eproc.ts TJRS
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config src/scripts/open-eproc.ts TJRS
 */

import 'dotenv/config'
import { chromium } from 'playwright'
import { TOTP } from 'otpauth'

type Tribunal = 'TJSC' | 'TJRS'

const BASE_URLS: Record<Tribunal, string> = {
  TJSC: 'https://eproc1g.tjsc.jus.br/eproc/',
  TJRS: 'https://eproc1g.tjrs.jus.br/eproc/',
}

const TRIBUNAL = (process.argv[2]?.toUpperCase() as Tribunal) ?? 'TJRS'
if (TRIBUNAL !== 'TJSC' && TRIBUNAL !== 'TJRS') {
  console.error('Uso: open-eproc.ts [TJSC|TJRS]')
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
const proxyUrl = process.env[`EPROC_${TRIBUNAL}_PROXY_URL`] ?? process.env.EPROC_PROXY_URL

function totpNow(): string {
  const totp = new TOTP({ secret: totpSeed.replace(/\s+/g, '').toUpperCase(), algorithm: 'SHA1', digits: 6, period: 30 })
  return totp.generate()
}

async function main() {
  console.log(`[OPEN-EPROC] Abrindo Chromium para ${TRIBUNAL}...`)

  const launchOpts: Parameters<typeof chromium.launch>[0] = { headless: false }
  if (proxyUrl) {
    const u = new URL(proxyUrl)
    launchOpts.proxy = {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    }
    console.log(`[OPEN-EPROC] Usando proxy: ${u.host}`)
  }

  const browser = await chromium.launch(launchOpts)
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await page.goto(BASE_URLS[TRIBUNAL], { waitUntil: 'domcontentloaded' })

  // Detecta formulário: Keycloak SSO ou form nativo do E-PROC (txtUsuario/pwdSenha)
  const isKeycloak = await page.locator('form#kc-form-login, form[action*="login-actions"]').count() > 0

  if (isKeycloak) {
    console.log('[OPEN-EPROC] Login via Keycloak SSO (fluxo sequencial)')

    const submit = async (label: string) => {
      console.log(`[OPEN-EPROC]  submit ${label}`)
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
        page.locator('input[type="submit"]:visible, button[type="submit"]:visible').first().click(),
      ])
    }

    // Etapa username + password (Keycloak combinado: username visível, password escondido no mesmo form)
    console.log(`[OPEN-EPROC] URL inicial: ${page.url()}`)
    await page.waitForSelector('input[name="username"]', { timeout: 15000 })
    await page.fill('input[name="username"]', usuario)

    // Preenche password mesmo se oculto via CSS (comum no Keycloak identity-first)
    const pwdCount = await page.locator('input[name="password"], input[type="password"]').count()
    if (pwdCount > 0) {
      console.log(`[OPEN-EPROC] preenchendo password (pode estar oculto via CSS)`)
      await page.locator('input[name="password"], input[type="password"]').first().fill(senha, { force: true })
    }
    await submit('username+password')

    // Se após submit ainda estiver no Keycloak sem OTP, pode ter havido split: tenta senha novamente
    await page.waitForTimeout(1500)
    console.log(`[OPEN-EPROC] URL pós-submit: ${page.url()}`)

    // Debug: captura screenshot e texto visível
    await page.screenshot({ path: '/tmp/eproc-debug.png', fullPage: true }).catch(() => {})
    const visibleText = await page.locator('body').innerText().catch(() => '')
    console.log(`[OPEN-EPROC] TEXTO VISÍVEL (primeiros 600 chars): ${visibleText.slice(0, 600).replace(/\s+/g, ' ')}`)

    const pwdVisibleAfter = await page.locator('input[type="password"]:visible').count()
    if (pwdVisibleAfter > 0) {
      console.log(`[OPEN-EPROC] password visível agora — preenchendo`)
      await page.locator('input[type="password"]:visible').first().fill(senha)
      await submit('password')
    }

    // Etapa OTP — aguarda campo otp aparecer (até 15s)
    console.log(`[OPEN-EPROC] URL pós-password: ${page.url()}`)
    const otpSelector = 'input#otp:visible, input[name="otp"]:visible'
    try {
      await page.waitForSelector(otpSelector, { timeout: 15000 })
      const remaining = 30 - (Math.floor(Date.now() / 1000) % 30)
      if (remaining < 8) {
        console.log(`[OPEN-EPROC] TOTP expira em ${remaining}s, aguardando renovação...`)
        await page.waitForTimeout((remaining + 1) * 1000)
      }
      await page.fill(otpSelector, totpNow())
      await submit('otp')
    } catch {
      console.log('[OPEN-EPROC] OTP não apareceu — provavelmente já no painel')
    }
  } else {
    console.log('[OPEN-EPROC] Login via formulário nativo E-PROC')
    await page.fill('input[name="txtUsuario"]', usuario)
    await page.fill('input[name="pwdSenha"]', senha)
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.click('input[type="submit"], button[type="submit"]'),
    ])
  }

  console.log(`[OPEN-EPROC] Login concluído. URL: ${page.url()}`)
  console.log('[OPEN-EPROC] Browser aberto. Feche a janela ou Ctrl+C para encerrar.')

  // Mantém processo vivo até o browser fechar
  await new Promise<void>((resolve) => {
    browser.on('disconnected', () => resolve())
  })
}

main().catch((err) => {
  console.error('[OPEN-EPROC] Erro:', err)
  process.exit(1)
})
