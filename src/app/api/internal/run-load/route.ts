import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { spawn } from 'child_process'

export async function POST(req: NextRequest) {
  if (req.headers.get('x-load-secret') !== process.env.LOAD_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const p = new PrismaClient()
  const count = await p.cliente.count()
  await p.$disconnect()

  if (count > 0) {
    return NextResponse.json({ message: `Carga já realizada (${count} clientes)` })
  }

  const script = `
LOG=/tmp/initial-load.log
echo "[$(date)] === INÍCIO DA CARGA INICIAL ===" >> $LOG
echo "[$(date)] TJSC: Iniciando scraper..." >> $LOG
npx tsx src/scripts/scraper-to-acervo.ts TJSC >> $LOG 2>&1
echo "[$(date)] TJSC: Importando acervo..." >> $LOG
ACERVO_SOURCE_PATH=/tmp/acervo.json npx tsx src/scripts/import-acervo.ts >> $LOG 2>&1
echo "[$(date)] TJSC: Concluído." >> $LOG
echo "[$(date)] TJRS: Iniciando scraper..." >> $LOG
npx tsx src/scripts/scraper-to-acervo.ts TJRS >> $LOG 2>&1
echo "[$(date)] TJRS: Importando acervo..." >> $LOG
ACERVO_SOURCE_PATH=/tmp/acervo.json npx tsx src/scripts/import-acervo.ts >> $LOG 2>&1
echo "[$(date)] TJRS: Concluído." >> $LOG
echo "[$(date)] === CARGA INICIAL FINALIZADA ===" >> $LOG
`

  const child = spawn('sh', ['-c', script], {
    detached: true,
    stdio: 'ignore',
    cwd: '/app',
    env: process.env,
  })
  child.unref()

  return NextResponse.json({ message: 'Carga iniciada em background', pid: child.pid })
}
