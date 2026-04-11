/**
 * Scraper E-PROC via Playwright.
 *
 * Suporta TJSC (eproc1g.tjsc.jus.br) e TJRS (eproc.tjrs.jus.br).
 * Autenticação: login + senha + TOTP (Google Authenticator).
 *
 * Fluxo:
 *   1. Navega para a URL do tribunal
 *   2. Preenche usuário/senha no SSO Keycloak
 *   3. Resolve o TOTP em tempo real a partir do seed configurado
 *   4. Extrai links do painel autenticado (incluem hash de sessão CSRF)
 *   5. Navega para "Relação de processos" usando o link extraído
 *   6. Para cada processo, extrai andamentos recentes
 *   7. Retorna ScraperSnapshot normalizado
 *
 * Nota sobre o hash de sessão:
 *   O E-PROC usa um hash CSRF em todas as URLs autenticadas.
 *   Navegar para URLs sem o hash correto resulta em "Link sem assinatura".
 *   Por isso, todos os links são extraídos dos hrefs do painel logado.
 */

import { setTimeout as sleep } from 'node:timers/promises'

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { TOTP } from 'otpauth'

// Usa chromium do sistema se disponível (Docker), caso contrário Playwright gerencia
const CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
const BASE_LAUNCH_ARGS = ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox']

import type { EprocClient } from '@/lib/scraper/eproc-client'
import type { ExternalAndamentoInput, ScraperSnapshot } from '@/lib/pipeline/types'

// ─── Configuração por tribunal ────────────────────────────────────────────────

export type Tribunal = 'TJSC' | 'TJRS'

export interface EprocConfig {
  tribunal: Tribunal
  usuario: string
  senha: string
  totpSeed: string
  /** Números de processo a consultar. Se vazio, lista do painel. */
  processos?: string[]
  headless?: boolean
  /** Timeout por operação em ms (default 30000) */
  timeout?: number
  /** Delay em ms entre consultas de processos para evitar bloqueio por rate limit (default 2000) */
  interProcessoDelayMs?: number
}

const ENTRY_URLS: Record<Tribunal, string> = {
  TJSC: 'https://eproc1g.tjsc.jus.br/eproc/',
  TJRS: 'https://eproc.tjrs.jus.br/eprocV2/',
}

// ─── Helpers TOTP ─────────────────────────────────────────────────────────────

export const normalizeTotpSeed = (seed: string): string =>
  seed.replace(/\s+/g, '').toUpperCase()

export const generateTotp = (seed: string): string => {
  const totp = new TOTP({
    secret: normalizeTotpSeed(seed),
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  })
  return totp.generate()
}

// ─── Parser de data do E-PROC ─────────────────────────────────────────────────

export const parseEprocDate = (raw: string): string | null => {
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/)
  if (!m) return null
  const [, d, mo, y, h = '00', min = '00'] = m
  return `${y}-${mo}-${d}T${h}:${min}:00.000Z`
}

// ─── Autenticação TJSC ────────────────────────────────────────────────────────

async function loginTJSC(page: Page, config: EprocConfig): Promise<void> {
  const timeout = config.timeout ?? 30000

  await page.goto(ENTRY_URLS.TJSC, { waitUntil: 'domcontentloaded', timeout })
  await page.waitForSelector('input#username', { timeout })

  await page.fill('input#username', config.usuario)
  await page.fill('input#password', config.senha)
  await page.click('input[type=submit], button[type=submit], button:has-text("Entrar")')
  await page.waitForLoadState('domcontentloaded', { timeout })

  // Tela TOTP: campo input#otp
  const otpInput = await page.$('input#otp, input[name="otp"]')
  if (otpInput) {
    const code = generateTotp(config.totpSeed)
    console.log(`[EPROC] TOTP: ${code}`)
    await otpInput.fill(code)
    await page.click('input[type=submit], button[type=submit], button:has-text("Entrar"), button:has-text("Verificar")')
    await page.waitForURL(/eproc1g\.tjsc\.jus\.br.*controlador/, { timeout })
  } else if (page.url().includes('eproc1g.tjsc.jus.br')) {
    console.log('[EPROC] Login direto (sem TOTP)')
  } else {
    throw new Error(`Estado de login inesperado após credenciais. URL: ${page.url()}`)
  }
}

// ─── Autenticação TJRS ────────────────────────────────────────────────────────

async function loginTJRS(page: Page, config: EprocConfig): Promise<void> {
  const timeout = config.timeout ?? 30000

  await page.goto(ENTRY_URLS.TJRS, { waitUntil: 'domcontentloaded', timeout })

  // TJRS: tenta SSO Keycloak primeiro, fallback para formulário nativo
  await page.waitForSelector('input[name="txtUsuario"], input#username, input[name="user"]', { timeout })

  const userField = (await page.$('input[name="txtUsuario"]')) ?? (await page.$('input#username'))
  const passField = (await page.$('input[name="pwdSenha"]')) ?? (await page.$('input#password'))
  if (!userField || !passField) throw new Error('Campos de login não encontrados no TJRS')

  await userField.fill(config.usuario)
  await passField.fill(config.senha)

  const submit = await page.$('input[type=submit], button[type=submit], button:has-text("Entrar")')
  if (!submit) throw new Error('Botão submit não encontrado no TJRS')
  await submit.click()
  await page.waitForLoadState('domcontentloaded', { timeout })

  // TOTP — campo genérico
  const otpInput = await page.$('input#otp, input[name="otp"], input[id*="otp"]')
  if (otpInput) {
    const code = generateTotp(config.totpSeed)
    await otpInput.fill(code)
    const submitTotp = await page.$('input[type=submit], button[type=submit]')
    if (submitTotp) await submitTotp.click()
    await page.waitForLoadState('domcontentloaded', { timeout })
  }

  console.log(`[TJRS] Login concluído. URL: ${page.url()}`)
}

// ─── Listagem de processos ────────────────────────────────────────────────────

export interface ProcessoRef {
  numero: string
  link: string
}

/**
 * Extrai referências de processos (número + link com hash) do painel autenticado.
 * Navega pela "Relação de processos" e captura os links diretos para cada processo.
 */
async function listarProcessosDoPainel(page: Page, timeout: number): Promise<ProcessoRef[]> {
  // Extrai o href do link "Relação de processos" do menu (tem hash de sessão correto)
  const relacaoHref = await page.evaluate((): string | null => {
    for (const a of Array.from(document.querySelectorAll('a[href*="relatorio_processo_procurador_listar"]')) as HTMLAnchorElement[]) {
      if (!a.href.includes('ord_ultimas')) return a.href
    }
    return null
  })

  if (!relacaoHref) {
    console.warn('[EPROC] Link "Relação de processos" não encontrado')
    return []
  }

  console.log(`[EPROC] Navegando para relação de processos...`)
  await page.goto(relacaoHref, { waitUntil: 'domcontentloaded', timeout })

  try {
    await page.waitForSelector('a[href*="processo_selecionar"]', { timeout: Math.min(timeout, 15000) })
  } catch {
    console.warn('[EPROC] Links de processo não encontrados na relação')
    return []
  }

  // Extrai número + link direto de cada processo (link já tem hash)
  const refs = await page.evaluate((): Array<{numero: string, link: string}> => {
    const cnj = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/
    return Array.from(document.querySelectorAll('a[href*="processo_selecionar"]') as NodeListOf<HTMLAnchorElement>)
      .map(a => ({
        numero: a.textContent?.trim() ?? '',
        link: a.href,
      }))
      .filter(r => cnj.test(r.numero))
  })

  // Deduplica por número
  const seen = new Set<string>()
  const unique = refs.filter(r => {
    if (seen.has(r.numero)) return false
    seen.add(r.numero)
    return true
  })

  console.log(`[EPROC] ${unique.length} processo(s) encontrados`)
  return unique
}

// ─── Extração de andamentos ───────────────────────────────────────────────────

interface AndamentoRaw {
  externalId: string
  dataIso: string
  tipo: string
  descricao: string
  documentos: Array<{ externalId: string; href: string; nome: string; tipo?: string }>
}

/**
 * Navega para um processo via link direto (com hash) e extrai os eventos da tabela #tblEventos.
 *
 * O link do processo deve ser extraído da Relação de Processos pois já contém o hash de sessão.
 * A tabela de eventos tem id "tblEventos" com colunas: Evento | Data/Hora | Descrição | Usuário | Documentos
 */
async function extrairAndamentosDoProcessoViaLink(
  page: Page,
  processoLink: string,
  processoNumero: string,
  timeout: number
): Promise<AndamentoRaw[]> {
  try {
    await page.goto(processoLink, { waitUntil: 'domcontentloaded', timeout })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('net::ERR_ABORTED')) {
      console.warn(`[EPROC] Navegação abortada para ${processoNumero}; tentando continuar com a página atual`) 
    } else {
      throw error
    }
  }

  // O E-PROC popula #tblEventos via AJAX após o carregamento inicial.
  // Aguarda até que a tabela tenha mais de 3 linhas (header + ao menos 1 evento real).
  // 3 linhas = tabela vazia (só estrutura); mais que isso = conteúdo carregado.
  try {
    await page.waitForFunction(
      () => {
        const t = document.querySelector('#tblEventos')
        return t && t.querySelectorAll('tr').length > 3
      },
      { timeout: Math.min(timeout, 15000) }
    )
  } catch {
    // Pode não ter eventos — verifica se a tabela existe com poucos registros
    const tblVazia = await page.$('#tblEventos')
    if (!tblVazia) {
      const titulo = await page.title()
      console.warn(`[EPROC] Tabela de eventos ausente para ${processoNumero} (${titulo})`)
      return []
    }
    // Tabela existe mas vazia — processo sem movimentações
  }

  const tblFound = await page.$('#tblEventos')
  if (!tblFound) return []

  const linhasCount = await tblFound.evaluate(el => el.querySelectorAll('tr').length)
  console.log(`[EPROC] ${linhasCount - 1} evento(s) na tabela`)

  const tblEl = await page.$('#tblEventos')!
  const rows = await tblEl!.$$('tr')

  const andamentos: AndamentoRaw[] = []
  for (const row of rows.slice(1)) { // pula header
    const tds = await row.$$('td')
    if (tds.length < 3) continue

    const textoData = (await tds[1].textContent() ?? '').trim()
    const descricao = (await tds[2].textContent() ?? '').trim()
    // O textContent da coluna 0 pode incluir JS de tooltip — extrai só o número inicial
    const eventoNumRaw = (await tds[0].textContent() ?? '').trim()
    const eventoNum = eventoNumRaw.match(/^\d+/)?.[0] ?? eventoNumRaw.replace(/\D/g, '').slice(0, 6)

    const dataMatch = textoData.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/) ??
                      textoData.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (!dataMatch || !descricao) continue

    const [, d, m, y, h = '00', min = '00'] = dataMatch
    const dataIso = `${y}-${m}-${d}T${h}:${min}:00.000Z`

    const docLinks = await row.$$('a[href*="acessar_documento"]')
    const docs = await Promise.all(docLinks.map(async a => ({
      externalId: await a.getAttribute('href') ?? '',
      // href completo para download em sessão
      href: await a.evaluate((el: HTMLAnchorElement) => el.href),
      nome: (await a.textContent() ?? '').trim() || 'documento',
      tipo: undefined as string | undefined,
    })))

    andamentos.push({
      externalId: `${processoNumero}-evt-${eventoNum}`,
      dataIso,
      tipo: 'EVENTO',
      descricao: descricao.slice(0, 500),
      documentos: docs,
    })
  }

  return andamentos
}

// ─── Download de documento dentro de sessão existente ────────────────────────

/**
 * Baixa um documento do E-PROC reaproveitando uma BrowserContext já autenticada.
 * Evita abrir um browser separado por documento — usa a sessão da coleta.
 *
 * @param context   BrowserContext autenticado (cookies válidos)
 * @param docHref   href completo do link acessar_documento (com hash)
 * @param timeout   timeout em ms
 */
export async function downloadDocumentInSession(
  context: BrowserContext,
  docHref: string,
  timeout = 30000
): Promise<{ content: Buffer; filename: string } | null> {
  const page = await context.newPage()
  try {
    const [downloadOrNewPage] = await Promise.all([
      Promise.race([
        page.waitForEvent('download', { timeout }),
        context.waitForEvent('page', { timeout }),
      ]),
      page.goto(docHref, { waitUntil: 'domcontentloaded', timeout }).catch(() => null),
    ]).catch(() => [null])

    if (!downloadOrNewPage) {
      // Tenta navegar diretamente — alguns documentos respondem ao goto
      const res = await page.goto(docHref, { waitUntil: 'load', timeout }).catch(() => null)
      if (res) {
        const ct = res.headers()['content-type'] ?? ''
        if (ct.includes('pdf') || ct.includes('octet') || ct.includes('pkcs7')) {
          const body = await res.body().catch(() => null)
          if (body && body.byteLength > 100) {
            const filename = decodeURIComponent(
              res.headers()['content-disposition']
                ?.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i)?.[1]
                ?.replace(/['"]/g, '') ?? 'documento.pdf'
            )
            return { content: body, filename }
          }
        }
      }
      return null
    }

    // É um Download direto
    if ('suggestedFilename' in downloadOrNewPage) {
      const dl = downloadOrNewPage as import('playwright').Download
      const dlPath = await dl.path()
      if (!dlPath) return null
      const { readFile } = await import('node:fs/promises')
      const content = await readFile(dlPath)
      return { content, filename: dl.suggestedFilename() || 'documento.pdf' }
    }

    // É uma nova aba
    const newPage = downloadOrNewPage as Page
    await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => null)

    // Tenta download na nova aba
    const dl2 = await newPage.waitForEvent('download', { timeout: 10000 }).catch(() => null)
    if (dl2) {
      const dlPath = await dl2.path()
      if (dlPath) {
        const { readFile } = await import('node:fs/promises')
        const content = await readFile(dlPath)
        await newPage.close().catch(() => null)
        return { content, filename: dl2.suggestedFilename() || 'documento.pdf' }
      }
    }

    // Tenta ler PDF embutido na nova aba
    const embedSrc = await newPage.evaluate(() => {
      const el = document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]') as HTMLEmbedElement | null
      return el?.src ?? el?.getAttribute('data') ?? null
    })
    if (embedSrc) {
      const cookies = await context.cookies()
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      const pdfRes = await fetch(embedSrc, {
        headers: { Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0' },
      }).catch(() => null)
      if (pdfRes?.ok) {
        const content = Buffer.from(await pdfRes.arrayBuffer())
        if (content.byteLength > 100) {
          await newPage.close().catch(() => null)
          return { content, filename: 'documento.pdf' }
        }
      }
    }

    await newPage.close().catch(() => null)
    return null
  } finally {
    await page.close().catch(() => null)
  }
}

export async function resolveEprocProcessLink(config: EprocConfig, processoNumero: string): Promise<string | null> {
  const timeout = config.timeout ?? 30000
  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: config.headless ?? true, executablePath: CHROMIUM_EXECUTABLE, args: BASE_LAUNCH_ARGS })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
    })
    const page = await context.newPage()

    if (config.tribunal === 'TJSC') {
      await loginTJSC(page, config)
    } else {
      await loginTJRS(page, config)
    }

    const refs = await listarProcessosDoPainel(page, timeout)
    return refs.find((ref) => ref.numero === processoNumero)?.link ?? null
  } finally {
    if (browser) await browser.close()
  }
}

/**
 * Baixa o binário de um documento do E-PROC.
 *
 * O externalId contém a URL relativa do documento incluindo key e hash estáticos.
 * O E-PROC exige cookies de sessão autenticada para servir o arquivo.
 *
 * Estratégia:
 *   1. Faz login via Playwright para obter cookies de sessão válidos
 *   2. Navega para o processo (para que o E-PROC registre o acesso ao processo no contexto)
 *   3. Intercepta a resposta do documento durante a navegação para a URL do arquivo
 *   4. Retorna o binário capturado
 */
export async function downloadEprocDocument(
  config: EprocConfig,
  documentoExternalId: string,
  processoNumero?: string
): Promise<{ content: Buffer; contentType: string; filename: string } | null> {
  const timeout = config.timeout ?? 45000
  let browser: Browser | null = null

  const BASE_URLS: Record<Tribunal, string> = {
    TJSC: 'https://eproc1g.tjsc.jus.br/eproc/',
    TJRS: 'https://eproc.tjrs.jus.br/eprocV2/',
  }

  try {
    browser = await chromium.launch({ headless: config.headless ?? true, executablePath: CHROMIUM_EXECUTABLE, args: BASE_LAUNCH_ARGS })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
      acceptDownloads: true,
    })
    const page = await context.newPage()

    // Login
    if (config.tribunal === 'TJSC') {
      await loginTJSC(page, config)
    } else {
      await loginTJRS(page, config)
    }

    // Se temos o número do processo, navega até ele primeiro para estabelecer contexto
    if (processoNumero) {
      const refs = await listarProcessosDoPainel(page, timeout)
      const ref = refs.find(r => r.numero === processoNumero)
      if (ref) {
        await page.goto(ref.link, { waitUntil: 'domcontentloaded', timeout })
      }
    }

    // Navega ao processo para ter acesso válido ao documento
    const refs = await listarProcessosDoPainel(page, timeout)
    const ref = processoNumero ? refs.find(r => r.numero === processoNumero) : null

    if (!ref) {
      console.warn(`[EPROC] Processo ${processoNumero ?? '?'} não encontrado no painel`)
      return null
    }

    await page.goto(ref.link, { waitUntil: 'domcontentloaded', timeout })

    // Aguarda eventos carregarem
    await page.waitForFunction(
      () => {
        const t = document.querySelector('#tblEventos')
        return t && t.querySelectorAll('tr').length > 3
      },
      { timeout: 15000 }
    ).catch(() => null)

    // Extrai o parâmetro doc= para localizar o link certo na tabela
    const docUrlObj = new URL(`https://placeholder/${documentoExternalId}`)
    const docParam = docUrlObj.searchParams.get('doc') ?? ''
    const docId = docParam || 'documento'

    console.log(`[EPROC] Procurando link do documento (doc=${docId.slice(0,20)}) na página do processo...`)

    // Localiza o link do documento dentro da página do processo
    const docLinkHref = await page.evaluate((docParam: string) => {
      const links = Array.from(document.querySelectorAll('a[href*="acessar_documento"]')) as HTMLAnchorElement[]
      const match = links.find(a => a.href.includes(docParam))
      return match?.href ?? null
    }, docParam)

    if (!docLinkHref) {
      console.warn(`[EPROC] Link do documento não encontrado na página do processo`)
      return null
    }

    console.log(`[EPROC] Link encontrado, clicando para download...`)

    // Captura download ou nova aba ao clicar no link
    const [downloadOrPage] = await Promise.all([
      Promise.race([
        page.waitForEvent('download', { timeout: 30000 }),
        context.waitForEvent('page', { timeout: 30000 }),
      ]),
      page.click(`a[href*="${docParam}"]`),
    ]).catch(() => [null])

    if (!downloadOrPage) {
      console.warn('[EPROC] Nenhum download ou nova página capturada ao clicar no documento')
      return null
    }

    // É um Download
    if ('suggestedFilename' in downloadOrPage) {
      const dl = downloadOrPage as import('playwright').Download
      const dlPath = await dl.path()
      if (!dlPath) return null
      const { readFile } = await import('node:fs/promises')
      const content = await readFile(dlPath)
      const filename = dl.suggestedFilename() || `${docId}.pdf`
      console.log(`[EPROC] Download capturado: ${filename} (${content.byteLength}b)`)
      return { content, contentType: 'application/pdf', filename }
    }

    // É uma nova página/aba — pode ser um viewer HTML ou download
    const newPage = downloadOrPage as Page
    await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null)

    // Tenta capturar download na nova aba
    const newTabDownload = await newPage.waitForEvent('download', { timeout: 10000 }).catch(() => null)
    if (newTabDownload) {
      const dlPath = await newTabDownload.path()
      if (dlPath) {
        const { readFile } = await import('node:fs/promises')
        const content = await readFile(dlPath)
        const filename = newTabDownload.suggestedFilename() || `${docId}.pdf`
        console.log(`[EPROC] Download via nova aba: ${filename} (${content.byteLength}b)`)
        return { content, contentType: 'application/pdf', filename }
      }
    }

    // Tenta ler o conteúdo diretamente da nova página
    const bodyContent = await newPage.evaluate(() => {
      // Verifica se é um PDF embutido via <embed> ou <object>
      const embed = document.querySelector('embed[type="application/pdf"]') as HTMLEmbedElement | null
      const obj = document.querySelector('object[type="application/pdf"]') as HTMLObjectElement | null
      return embed?.src ?? obj?.data ?? null
    })

    if (bodyContent) {
      // Faz fetch do PDF com cookies da sessão
      const cookies = await context.cookies()
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      const pdfRes = await fetch(bodyContent, {
        headers: { Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0' },
      })
      if (pdfRes.ok) {
        const content = Buffer.from(await pdfRes.arrayBuffer())
        if (content.slice(0, 4).toString('ascii') === '%PDF') {
          console.log(`[EPROC] PDF via embed/object: ${content.byteLength}b`)
          return { content, contentType: 'application/pdf', filename: `${docId}.pdf` }
        }
      }
    }

    await newPage.close().catch(() => null)
    console.warn('[EPROC] Não foi possível obter o binário do documento')
    return null
  } finally {
    if (browser) await browser.close()
  }
}

// ─── Coleta de andamentos (lógica compartilhada) ──────────────────────────────

async function coletarAndamentos(
  context: BrowserContext,
  config: EprocConfig,
): Promise<{ andamentos: ExternalAndamentoInput[]; rawDocs: Map<string, string> }> {
  const timeout = config.timeout ?? 30000
  let page: Page = await context.newPage()

  console.log(`[EPROC] Login no ${config.tribunal}...`)
  if (config.tribunal === 'TJSC') {
    await loginTJSC(page, config)
  } else {
    await loginTJRS(page, config)
  }
  console.log(`[EPROC] Painel: ${page.url()}`)

  let processoRefs: ProcessoRef[]
  if (config.processos && config.processos.length > 0) {
    const todosRefs = await listarProcessosDoPainel(page, timeout)
    const numerosConfig = new Set(config.processos)
    processoRefs = todosRefs.filter(r => numerosConfig.has(r.numero))
    for (const num of config.processos) {
      if (!processoRefs.find(r => r.numero === num)) {
        console.warn(`[EPROC] Processo ${num} não encontrado na relação — pulando`)
      }
    }
  } else {
    console.log('[EPROC] Listando processos do painel...')
    processoRefs = await listarProcessosDoPainel(page, timeout)
  }

  const andamentos: ExternalAndamentoInput[] = []
  // Mapa externalId → href completo para download posterior
  const rawDocs = new Map<string, string>()
  const interProcessoDelayMs = config.interProcessoDelayMs ?? 2000

  for (let i = 0; i < processoRefs.length; i++) {
    const ref = processoRefs[i]

    // Rate limiting: aguarda entre processos para não sobrecarregar o tribunal
    if (i > 0 && interProcessoDelayMs > 0) {
      await sleep(interProcessoDelayMs)
    }

    console.log(`[EPROC] Consultando ${ref.numero} (${i + 1}/${processoRefs.length})...`)
    try {
      if (page.isClosed()) {
        page = await context.newPage()
        if (config.tribunal === 'TJSC') {
          await loginTJSC(page, config)
        } else {
          await loginTJRS(page, config)
        }
      }

      const raw = await extrairAndamentosDoProcessoViaLink(page, ref.link, ref.numero, timeout)
      console.log(`[EPROC]   → ${raw.length} andamento(s)`)
      for (const a of raw) {
        for (const doc of a.documentos) {
          if (doc.href) rawDocs.set(doc.externalId, doc.href)
        }
        andamentos.push({
          externalId: a.externalId,
          processoNumero: ref.numero,
          dataIso: a.dataIso,
          tipo: a.tipo,
          descricao: a.descricao,
          documentos: a.documentos.map(d => ({
            externalId: d.externalId,
            nome: d.nome,
            tipo: d.tipo,
          })),
        })
      }
    } catch (err) {
      console.error(`[EPROC] Erro em ${ref.numero}:`, err)
    }
  }

  return { andamentos, rawDocs }
}

export function createEprocPlaywrightClient(config: EprocConfig): EprocClient & {
  collectSnapshotWithDocuments(
    isDocumentKnown: (externalId: string) => Promise<boolean>
  ): Promise<ScraperSnapshot>
} {
  return {
    // ── Coleta só andamentos (sem downloads) ──────────────────────────────
    async collectSnapshot(): Promise<ScraperSnapshot> {
      let browser: Browser | null = null
      try {
        browser = await chromium.launch({ headless: config.headless ?? true, executablePath: CHROMIUM_EXECUTABLE, args: BASE_LAUNCH_ARGS })
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1280, height: 800 },
          locale: 'pt-BR',
        })
        const { andamentos } = await coletarAndamentos(context, config)
        return { source: 'eproc', collectedAtIso: new Date().toISOString(), andamentos }
      } finally {
        if (browser) await browser.close()
      }
    },

    // ── Coleta andamentos E baixa documentos novos na mesma sessão ────────
    async collectSnapshotWithDocuments(
      isDocumentKnown: (externalId: string) => Promise<boolean>
    ): Promise<ScraperSnapshot> {
      const timeout = config.timeout ?? 30000
      let browser: Browser | null = null
      try {
        browser = await chromium.launch({
          headless: config.headless ?? true,
          executablePath: CHROMIUM_EXECUTABLE,
          args: BASE_LAUNCH_ARGS,
        })
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1280, height: 800 },
          locale: 'pt-BR',
          acceptDownloads: true,
        })

        const { andamentos, rawDocs } = await coletarAndamentos(context, config)

        // Download dos documentos novos dentro da mesma sessão autenticada
        let downloaded = 0
        let skipped = 0
        let failed = 0

        for (const andamento of andamentos) {
          if (!andamento.documentos?.length) continue
          for (const doc of andamento.documentos) {
            // Pula se já está arquivado
            const known = await isDocumentKnown(doc.externalId).catch(() => false)
            if (known) { skipped++; continue }

            const href = rawDocs.get(doc.externalId)
            if (!href) { failed++; continue }

            console.log(`[EPROC] Baixando documento ${doc.nome}...`)
            const result = await downloadDocumentInSession(context, href, timeout).catch((e) => {
              console.warn(`[EPROC] Falha no download de ${doc.externalId.slice(0, 40)}: ${e.message}`)
              return null
            })

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

        console.log(`[EPROC] Documentos: ${downloaded} baixados, ${skipped} já arquivados, ${failed} falhas`)

        return { source: 'eproc', collectedAtIso: new Date().toISOString(), andamentos }
      } finally {
        if (browser) await browser.close()
      }
    },
  }
}
