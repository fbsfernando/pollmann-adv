import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { spawn } from 'child_process'

export async function POST(req: NextRequest) {
  if (req.headers.get('x-load-secret') !== process.env.LOAD_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'
  const tribunal = url.searchParams.get('tribunal')?.toUpperCase() // TJSC, TJRS ou null (ambos)

  const p = new PrismaClient()
  const count = await p.cliente.count()
  await p.$disconnect()

  if (count > 0 && !force) {
    return NextResponse.json({ message: `Carga já realizada (${count} clientes). Use ?force=true para recarregar.` })
  }

  // Monta script dinamicamente: só o tribunal pedido ou ambos
  const steps: string[] = ['LOG=/tmp/initial-load.log', `echo "[$(date)] === INÍCIO DA CARGA ===" >> $LOG`]

  if (!tribunal || tribunal === 'TJSC') {
    steps.push(
      `echo "[$(date)] TJSC: Iniciando scraper..." >> $LOG`,
      `npx tsx src/scripts/scraper-to-acervo.ts TJSC >> $LOG 2>&1`,
      `echo "[$(date)] TJSC: Importando acervo..." >> $LOG`,
      `ACERVO_SOURCE_PATH=/tmp/acervo.json npx tsx src/scripts/import-acervo.ts >> $LOG 2>&1`,
      `echo "[$(date)] TJSC: Concluído." >> $LOG`,
    )
  }

  if (!tribunal || tribunal === 'TJRS') {
    steps.push(
      `echo "[$(date)] TJRS: Iniciando scraper..." >> $LOG`,
      `npx tsx src/scripts/scraper-to-acervo.ts TJRS >> $LOG 2>&1`,
      `echo "[$(date)] TJRS: Importando acervo..." >> $LOG`,
      `ACERVO_SOURCE_PATH=/tmp/acervo.json npx tsx src/scripts/import-acervo.ts >> $LOG 2>&1`,
      `echo "[$(date)] TJRS: Concluído." >> $LOG`,
    )
  }

  steps.push(`echo "[$(date)] === CARGA FINALIZADA ===" >> $LOG`)
  const script = steps.join('\n')

  const child = spawn('sh', ['-c', script], {
    detached: true,
    stdio: 'ignore',
    cwd: '/app',
    env: process.env,
  })
  child.unref()

  return NextResponse.json({ message: 'Carga iniciada em background', pid: child.pid })
}
