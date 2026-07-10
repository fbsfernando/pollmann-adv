import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { readFile } from 'fs/promises'

/**
 * Dispara o expedit-sync manualmente via HTTP (mesmo padrão do run-load:
 * protegido por LOAD_SECRET). Útil para popular dados recém-lançados sem
 * esperar o cron de 6h — e sem depender de acesso SSH à VPS.
 *
 * POST  → inicia o sync em background (log em /tmp/expedit-sync-manual.log)
 * GET   → devolve o final do log (acompanhamento)
 */

const LOG = '/tmp/expedit-sync-manual.log'

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

const isAuthorized = (req: NextRequest): boolean => {
  const secret = process.env.LOAD_SECRET
  return !!secret && req.headers.get('x-load-secret') === secret
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorized()

  const script = [
    `echo "[$(date)] === EXPEDIT SYNC (manual) ===" >> ${LOG}`,
    `npx tsx src/scripts/expedit-sync.ts >> ${LOG} 2>&1`,
    `echo "[$(date)] === FIM (exit $?) ===" >> ${LOG}`,
  ].join('\n')

  const child = spawn('sh', ['-c', script], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: process.env,
  })
  child.unref()

  return NextResponse.json({ message: 'Sync iniciado em background', pid: child.pid, log: LOG })
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorized()

  try {
    const content = await readFile(LOG, 'utf8')
    const lines = content.split('\n')
    return new NextResponse(lines.slice(-200).join('\n'), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch {
    return new NextResponse('(log vazio — nenhum sync manual executado ainda)', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
