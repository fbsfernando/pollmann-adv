/**
 * Testa diferentes parâmetros de URL para forçar mais itens por página no TJRS.
 */
import { TOTP } from 'otpauth'
import * as cheerio from 'cheerio'

class Jar {
  c = new Map<string, string>()
  capture(r: Response) {
    for (const s of r.headers.getSetCookie?.() ?? []) {
      const m = s.match(/^([^=]+)=([^;]*)/)
      if (m) this.c.set(m[1], m[2])
    }
  }
  toString() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

async function req(url: string, jar: Jar, body?: string): Promise<{ html: string; url: string }> {
  let u = url
  let m = body ? 'POST' : 'GET'
  let b: string | undefined = body
  for (let i = 0; i < 15; i++) {
    const h: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', Cookie: jar.toString(), Accept: 'text/html' }
    if (b) h['Content-Type'] = 'application/x-www-form-urlencoded'
    const r = await fetch(u, { method: m, headers: h, body: b, redirect: 'manual' })
    jar.capture(r)
    const loc = r.headers.get('location')
    if (loc && [301, 302, 303, 307].includes(r.status)) {
      u = loc.startsWith('http') ? loc : new URL(loc, u).href
      if ([301, 302, 303].includes(r.status)) { m = 'GET'; b = undefined }
      continue
    }
    const buf = await r.arrayBuffer()
    return { html: new TextDecoder('iso-8859-1').decode(buf), url: u }
  }
  throw new Error('too many redirects')
}

async function main() {
  const jar = new Jar()

  const s1 = await req('https://eproc1g.tjrs.jus.br/eproc/', jar)
  const fa = cheerio.load(s1.html)('form#kc-form-login').attr('action')
  if (!fa) throw new Error('no login form')
  const s2 = await req(
    fa.startsWith('http') ? fa : new URL(fa, s1.url).href,
    jar,
    `username=${encodeURIComponent(process.env.EPROC_TJRS_USER!)}&password=${encodeURIComponent(process.env.EPROC_TJRS_PASSWORD!)}&credentialId=&login=Entrar`
  )
  const ta = cheerio.load(s2.html)('form[action*="login-actions"]').attr('action')
  if (ta) {
    const totp = new TOTP({
      secret: process.env.EPROC_TJRS_TOTP_SEED!.replace(/\s/g, '').toUpperCase(),
      digits: 6, period: 30, algorithm: 'SHA1',
    })
    const rem = totp.period - (Math.floor(Date.now() / 1000) % totp.period)
    if (rem < 8) await new Promise(r => setTimeout(r, (rem + 1) * 1000))
    const tu = ta.startsWith('http') ? ta : new URL(ta, s2.url).href
    await req(tu, jar, `otp=${totp.generate()}&login=Entrar`)
  }
  console.log('Login OK')

  // Pega link da relação de processos do painel
  const p = await req('https://eproc1g.tjrs.jus.br/eproc/', jar)
  const $p = cheerio.load(p.html)
  let relHref = ''
  $p('a[href*="relatorio_processo_procurador_listar"]').each((_, el) => {
    const h = $p(el).attr('href')
    if (h && !h.includes('ord_ultimas') && !relHref) relHref = h
  })
  const relUrl = relHref.startsWith('http') ? relHref : new URL(relHref, p.url).href
  console.log('Relação URL:', relUrl.slice(0, 100))

  // Pega a primeira página
  const firstPage = await req(relUrl, jar)
  const $first = cheerio.load(firstPage.html)
  const formAction1 = $first('#frmProcessoLista').attr('action')
  const formActionUrl1 = formAction1!.startsWith('http') ? formAction1! : new URL(formAction1!, firstPage.url).href
  console.log('Form action hash 1:', formActionUrl1.match(/hash=([^&]+)/)?.[1])

  // Pega a primeira página DE NOVO e compara hashes
  await new Promise(r => setTimeout(r, 2000))
  const firstPage2 = await req(relUrl, jar)
  const $first2 = cheerio.load(firstPage2.html)
  const formAction2 = $first2('#frmProcessoLista').attr('action')
  const formActionUrl2 = formAction2!.startsWith('http') ? formAction2! : new URL(formAction2!, firstPage2.url).href
  console.log('Form action hash 2:', formActionUrl2.match(/hash=([^&]+)/)?.[1])
  console.log('Hashes iguais?', formActionUrl1 === formActionUrl2)

  // Testa GET ao form action URL (com acao_origem)
  console.log('\nTeste GET ao form action URL:')
  const viaForm = await req(formActionUrl1, jar)
  console.log('Links:', cheerio.load(viaForm.html)('a[href*="processo_selecionar"]').length)

  // Testa POST vazio (só com pagina=1) ao form action URL
  console.log('\nTeste POST ao form action URL (body=hdnInfraPaginaAtual=1):')
  const postSimple = await req(formActionUrl1, jar, 'hdnInfraPaginaAtual=1')
  console.log('Links:', cheerio.load(postSimple.html)('a[href*="processo_selecionar"]').length)

  // Extrai APENAS campos hdnInfra* (estado de paginação/critérios), sem filtros
  console.log('\nTeste POST ao form action URL (body=só hdnInfra* + pagina=1):')
  const hdnFields: string[] = []
  $first('#frmProcessoLista input[name^="hdnInfra"]').each((_, el) => {
    const name = $first(el).attr('name')
    if (!name || name.startsWith('chkInfraItem')) return
    const val = $first(el).attr('value') ?? ''
    hdnFields.push(`${encodeURIComponent(name)}=${encodeURIComponent(typeof val === 'string' ? val : '')}`)
  })
  const bodyHdn = hdnFields.filter(f => !f.startsWith('hdnInfraPaginaAtual=')).join('&') + '&hdnInfraPaginaAtual=1'
  const postHdn = await req(formActionUrl1, jar, bodyHdn)
  const linksHdn = cheerio.load(postHdn.html)('a[href*="processo_selecionar"]').length
  console.log('Links:', linksHdn)
  console.log('Body:', bodyHdn.substring(0, 300))

  // Extrai primeiros números de processo de cada resposta pra saber se trocou de página
  if (linksHdn > 0) {
    const firstProc1 = $first('a[href*="processo_selecionar"]').first().text().trim()
    const firstProc2 = cheerio.load(postHdn.html)('a[href*="processo_selecionar"]').first().text().trim()
    console.log('Primeiro processo página 1:', firstProc1)
    console.log('Primeiro processo após POST:', firstProc2)
    console.log('Mudou de página?', firstProc1 !== firstProc2)
  }
}

main().catch(err => { console.error(err); process.exitCode = 1 })
