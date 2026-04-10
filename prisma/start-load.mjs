/**
 * Inicia a carga inicial (TJSC + TJRS) em background e retorna imediatamente.
 * Uso: node prisma/start-load.mjs
 * Logs: /tmp/initial-load.log
 */
import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const count = await p.cliente.count();
await p.$disconnect();

if (count > 0) {
  console.log(`Carga inicial já realizada (${count} clientes). Nada a fazer.`);
  process.exit(0);
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
`;

const child = spawn('sh', ['-c', script], {
  detached: true,
  stdio: 'ignore',
  cwd: '/app',
  env: process.env,
});
child.unref();

console.log(`Carga inicial iniciada em background (PID: ${child.pid})`);
console.log('Acompanhe: tail -f /tmp/initial-load.log');
