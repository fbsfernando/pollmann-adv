/**
 * Consentimento OAuth único para o Google Drive (conta de usuário real).
 *
 * Gera o GOOGLE_OAUTH_REFRESH_TOKEN que o arquivamento usa em produção.
 * Roda UMA vez, na máquina do Richard (ou com ele logado), e imprime o token.
 *
 * Pré-requisitos no .env / .env.local:
 *   GOOGLE_OAUTH_CLIENT_ID=...        (OAuth Client ID tipo "Desktop app")
 *   GOOGLE_OAUTH_CLIENT_SECRET=...
 *
 * Uso:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config src/scripts/drive-auth.ts
 *
 * O script abre um servidor local em http://localhost:53682, imprime a URL de
 * consentimento, captura o código no redirect e troca por um refresh token.
 * Adicione esse e-mail do Richard como "usuário de teste" OU publique o app
 * (escopo drive.file é não-sensível → publicação não exige verificação).
 */
import 'dotenv/config'
import http from 'node:http'

import { google } from 'googleapis'

import { DRIVE_SCOPES } from '@/lib/storage/drive-archive'

const PORT = 53682
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`

const getEnv = (key: string): string => {
  const v = process.env[key]
  if (!v) throw new Error(`Variável ausente: ${key} (configure no .env.local)`)
  return v
}

const run = async (): Promise<number> => {
  const clientId = getEnv('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = getEnv('GOOGLE_OAUTH_CLIENT_SECRET')

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline', // necessário para receber refresh_token
    prompt: 'consent', // força emissão de refresh_token mesmo em re-consentimento
    // Inclui o Calendar no mesmo consentimento: o refresh token resultante serve
    // tanto para o arquivamento no Drive quanto para o sync da agenda Google.
    scope: [...DRIVE_SCOPES, 'https://www.googleapis.com/auth/calendar.events'],
  })

  console.info('\n1) Abra esta URL no navegador logado na conta do Richard:\n')
  console.info(authUrl)
  console.info('\n2) Conceda o acesso. O navegador será redirecionado de volta para localhost.\n')

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith('/oauth2callback')) {
        res.writeHead(404).end()
        return
      }
      const url = new URL(req.url, REDIRECT_URI)
      const err = url.searchParams.get('error')
      const authCode = url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        err
          ? `<h1>Erro: ${err}</h1><p>Pode fechar esta aba.</p>`
          : '<h1>Autorizado!</h1><p>Pode fechar esta aba e voltar ao terminal.</p>'
      )
      server.close()
      if (err) reject(new Error(`Consentimento negado: ${err}`))
      else if (authCode) resolve(authCode)
      else reject(new Error('Redirect sem code'))
    })
    server.listen(PORT)
    server.on('error', reject)
  })

  const { tokens } = await oauth2.getToken(code)
  if (!tokens.refresh_token) {
    console.error(
      '\n⚠️  Não veio refresh_token. Revogue o acesso do app em ' +
        'myaccount.google.com/permissions e rode de novo (precisa de prompt=consent).'
    )
    return 1
  }

  console.info('\n✅ Sucesso! Adicione ao .env / .env.local:\n')
  console.info(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`)
  return 0
}

void run().then((code) => {
  process.exitCode = code
})
