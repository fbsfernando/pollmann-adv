/**
 * Faz uma requisição real a um processo e extrai todos os campos disponíveis
 * no HTML — partes, assunto, valor, vara, magistrado, datas, eventos, etc.
 */
import { TOTP } from 'otpauth'
import * as cheerio from 'cheerio'
import { writeFile } from 'node:fs/promises'

const tribunal = (process.argv[2] ?? 'TJSC').toUpperCase()
const getEnv = (k: string) => process.env[k]!

class Jar {
  c = new Map<string, string>()
  dispatcher: any
  capture(r: Response) {
    for (const s of r.headers.getSetCookie?.() ?? []) {
      const m = s.match(/^([^=]+)=([^;]*)/)
      if (m) this.c.set(m[1], m[2])
    }
  }
  toString() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; ') }
}

async function req(url: string, jar: Jar, body?: string): Promise<{ html: string; url: string }> {
  let u = url, m = body ? 'POST' : 'GET', b: string | undefined = body
  for (let i = 0; i < 15; i++) {
    const h: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
      Cookie: jar.toString(),
      Accept: 'text/html,*/*',
    }
    if (b) h['Content-Type'] = 'application/x-www-form-urlencoded'
    const r = await fetch(u, { method: m, headers: h, body: b, redirect: 'manual', signal: AbortSignal.timeout(30000) })
    jar.capture(r)
    const loc = r.headers.get('location')
    if (loc && [301, 302, 303, 307].includes(r.status)) {
      u = loc.startsWith('http') ? loc : new URL(loc, u).href
      if ([301, 302, 303].includes(r.status)) { m = 'GET'; b = undefined }
      continue
    }
    const buf = await r.arrayBuffer()
    const ct = r.headers.get('content-type') ?? ''
    const html = ct.includes('iso-8859-1') ? new TextDecoder('iso-8859-1').decode(buf) : new TextDecoder().decode(buf)
    return { html, url: u }
  }
  throw new Error('too many redirects')
}

async function main() {
  const jar = new Jar()
  const baseUrl = tribunal === 'TJRS' ? 'https://eproc1g.tjrs.jus.br/' : 'https://eproc1g.tjsc.jus.br/'

  console.log(`Login no ${tribunal}...`)
  const s1 = await req(baseUrl, jar)
  const $1 = cheerio.load(s1.html)
  const formAction = $1('form#kc-form-login, form[action*="login-actions"]').attr('action')!
  const actionUrl = formAction.startsWith('http') ? formAction : new URL(formAction, s1.url).href

  const s2 = await req(actionUrl, jar, `username=${encodeURIComponent(getEnv(`EPROC_${tribunal}_USER`))}&password=${encodeURIComponent(getEnv(`EPROC_${tribunal}_PASSWORD`))}&credentialId=&login=Entrar`)
  const $2 = cheerio.load(s2.html)
  const totpAction = $2('form[action*="login-actions"]').attr('action')
  if (totpAction) {
    const totp = new TOTP({
      secret: getEnv(`EPROC_${tribunal}_TOTP_SEED`).replace(/\s/g, '').toUpperCase(),
      digits: 6, period: 30, algorithm: 'SHA1',
    })
    const rem = totp.period - (Math.floor(Date.now() / 1000) % totp.period)
    if (rem < 8) await new Promise(r => setTimeout(r, (rem + 1) * 1000))
    const tu = totpAction.startsWith('http') ? totpAction : new URL(totpAction, s2.url).href
    await req(tu, jar, `otp=${totp.generate()}&login=Entrar`)
  }
  console.log('Login OK')

  // Pega relação de processos
  const painel = await req(baseUrl + 'eproc/', jar)
  const $p = cheerio.load(painel.html)
  let relHref = ''
  $p('a[href*="relatorio_processo_procurador_listar"]').each((_, el) => {
    const h = $p(el).attr('href'); if (h && !h.includes('ord_ultimas') && !relHref) relHref = h
  })
  const listaUrl = relHref.startsWith('http') ? relHref : new URL(relHref, painel.url).href
  const lista = await req(listaUrl, jar)

  // Pega o primeiro processo
  const $l = cheerio.load(lista.html)
  const procHref = $l('a[href*="processo_selecionar"]').first().attr('href')!
  const procNum = $l('a[href*="processo_selecionar"]').first().text().trim()
  const procUrl = procHref.startsWith('http') ? procHref : new URL(procHref, lista.url).href

  console.log(`Buscando processo ${procNum}...`)
  const proc = await req(procUrl, jar)
  const $ = cheerio.load(proc.html)

  // Salva o HTML bruto
  await writeFile('tmp/processo-completo.html', proc.html)
  console.log(`\nHTML bruto salvo em tmp/processo-completo.html (${proc.html.length} chars)`)

  // Extrai dados estruturados que costumam estar em páginas de processo
  console.log('\n═══ DADOS EXTRAÍVEIS DO HTML ═══\n')

  // Número do processo
  console.log('Número:', procNum)

  // Título / subtítulo da página
  const titulo = $('title').text().trim()
  console.log('Título da página:', titulo)

  // Tenta achar campos típicos por labels/spans
  const campos: Record<string, string | string[]> = {}
  const labelPatterns = [
    'Autor', 'Réu', 'Requerente', 'Requerido', 'Polo Ativo', 'Polo Passivo',
    'Assunto', 'Classe', 'Valor da causa', 'Distribuição', 'Autuação',
    'Órgão', 'Juiz', 'Magistrado', 'Vara', 'Foro', 'Competência',
    'Nível de Sigilo', 'Situação', 'Status', 'Última Atualização',
  ]

  // Procura em divs, spans, labels com conteúdo
  $('#fldCapa td, #divCapaProcesso td, .infraTable td, td.infraTable').each((_, el) => {
    const text = $(el).text().trim()
    if (text.length < 500 && text.length > 1) {
      for (const pat of labelPatterns) {
        if (text.toLowerCase().includes(pat.toLowerCase() + ':')) {
          const m = text.match(new RegExp(`${pat}[^:]*:\\s*([^\\n]{1,200})`, 'i'))
          if (m) campos[pat] = m[1].trim()
        }
      }
    }
  })

  console.log('\nCampos identificados via regex:')
  for (const [k, v] of Object.entries(campos)) {
    console.log(`  ${k}: ${Array.isArray(v) ? v.join(' | ') : v}`)
  }

  // Verifica seções padrão do E-PROC
  console.log('\nSeções #id presentes no HTML:')
  $('[id]').each((_, el) => {
    const id = $(el).attr('id') ?? ''
    if (id && (id.startsWith('fld') || id.includes('Capa') || id.includes('Parte') || id.includes('divInfo'))) {
      const len = $(el).text().trim().length
      if (len > 0) console.log(`  #${id} (${len} chars)`)
    }
  })

  // Pega texto das partes (Autor, Réu) se houver tabela específica
  console.log('\n#tblPartes:')
  const $partes = $('#tblPartes tr, table[id*="Partes"] tr, table[id*="partes"] tr')
  if ($partes.length) {
    $partes.each((i, tr) => {
      if (i < 10) {
        const texto = $(tr).text().trim().replace(/\s+/g, ' ').slice(0, 200)
        if (texto) console.log(`  ${texto}`)
      }
    })
  } else {
    console.log('  (não encontrado)')
  }

  // Informações da capa
  console.log('\nCapa do processo (#divInfoCabecalho ou similar):')
  const capa = $('#divInfoCabecalho, #divCapaProcesso, div.capaProcesso, #fldCapa').first()
  if (capa.length) {
    const texto = capa.text().replace(/\s+/g, ' ').trim().slice(0, 800)
    console.log('  ' + texto)
  } else {
    console.log('  (não encontrado)')
  }

  console.log('\n═══ Veja o arquivo tmp/processo-completo.html para estrutura completa ═══')
}

main().catch(err => { console.error('ERR:', err); process.exitCode = 1 })
