/**
 * Captura a requisição exata que o browser faz ao clicar em "próxima página"
 * na listagem de processos do TJRS. Foco em descobrir quais campos/headers são enviados.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { TOTP } from 'otpauth'

const getEnv = (k: string) => process.env[k]!

type CapturedReq = {
  phase: string
  method: string
  url: string
  postData?: string | null
  headers: Record<string, string>
}

async function main() {
  const captured: CapturedReq[] = []
  let phase = 'init'

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
  })

  context.on('request', (req) => {
    const rt = req.resourceType()
    if (!['document', 'xhr', 'fetch'].includes(rt)) return
    if (!req.url().includes('tjrs.jus.br')) return
    captured.push({
      phase,
      method: req.method(),
      url: req.url(),
      postData: req.postData(),
      headers: req.headers(),
    })
  })

  const page = await context.newPage()

  // Login — Keycloak 2-step: username primeiro, depois password em nova página
  phase = 'login'
  await page.goto('https://eproc1g.tjrs.jus.br/eproc/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('input[name="username"]', { timeout: 15000 })
  await page.locator('input[name="username"]').first().fill(getEnv('EPROC_TJRS_USER'))
  // Clica "Entrar" para ir para página de senha
  await page.locator('button[type=submit], input[type=submit]').first().click()
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 })
  // Agora preenche a senha na nova página
  await page.waitForSelector('input[name="password"]', { state: 'visible', timeout: 15000 })
  await page.locator('input[name="password"]').first().fill(getEnv('EPROC_TJRS_PASSWORD'))
  await page.locator('button[type=submit], input[type=submit]').first().click()
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 })

  const otp = await page.$('input#otp, input[name="otp"]')
  if (otp) {
    phase = 'totp'
    const totp = new TOTP({ secret: getEnv('EPROC_TJRS_TOTP_SEED').replace(/\s/g, '').toUpperCase(), digits: 6, period: 30, algorithm: 'SHA1' })
    const rem = totp.period - (Math.floor(Date.now() / 1000) % totp.period)
    if (rem < 8) await new Promise(r => setTimeout(r, (rem + 1) * 1000))
    await otp.fill(totp.generate())
    await page.click('input[type=submit], button[type=submit]')
    await page.waitForURL(/controlador\.php/, { timeout: 30000 })
  }

  console.log('[inspect] Login OK:', page.url())
  await page.waitForTimeout(2000)

  // Vai para relação de processos
  phase = 'listagem-pagina1'
  const relHref = await page.evaluate(() => {
    for (const a of Array.from(document.querySelectorAll('a[href*="relatorio_processo_procurador_listar"]')) as HTMLAnchorElement[]) {
      if (!a.href.includes('ord_ultimas')) return a.href
    }
    return null
  })
  if (!relHref) throw new Error('Relação não encontrada')
  await page.goto(relHref, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('a[href*="processo_selecionar"]', { timeout: 15000 })

  // Agora navega para a página 2 usando o select de paginação
  phase = 'listagem-pagina2'
  console.log('[inspect] Navegando para página 2...')

  // Preenche o select de paginação com valor "1" (segunda página) e dispara infraAcaoPaginar
  await page.evaluate(() => {
    const sel = document.querySelector('#selInfraPaginacaoSuperior') as HTMLSelectElement
    if (sel) {
      sel.value = '1'
      // Dispara o handler onchange
      const evt = new Event('change', { bubbles: true })
      sel.dispatchEvent(evt)
    }
  })

  await page.waitForLoadState('domcontentloaded', { timeout: 30000 })
  await page.waitForTimeout(3000)

  // Verifica se navegou
  const urlPag2 = page.url()
  const countPag2 = await page.evaluate(() => document.querySelectorAll('a[href*="processo_selecionar"]').length)
  console.log('[inspect] Página 2 URL:', urlPag2)
  console.log('[inspect] Links na página 2:', countPag2)

  await browser.close()

  // Salva
  await mkdir('tmp', { recursive: true })
  await writeFile('tmp/list-pagination-capture.json', JSON.stringify(captured, null, 2))

  // Imprime requisições de listagem-pagina2
  console.log('\n── Requisições da fase listagem-pagina2 ──')
  for (const r of captured.filter(c => c.phase === 'listagem-pagina2')) {
    console.log(`\n${r.method} ${r.url.slice(0, 150)}`)
    if (r.postData) {
      console.log(`  body: ${r.postData.slice(0, 500)}`)
    }
    console.log(`  headers: content-type=${r.headers['content-type'] ?? ''} x-requested-with=${r.headers['x-requested-with'] ?? ''}`)
  }
}

main().catch(err => { console.error(err); process.exitCode = 1 })
