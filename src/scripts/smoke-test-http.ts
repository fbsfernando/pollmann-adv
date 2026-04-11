/**
 * Smoke test rápido: testa login e 1 processo para validar que o client HTTP funciona.
 */
import { createEprocHttpClient, type Tribunal } from '@/lib/scraper/eproc-http'

const tribunal = (process.env.EPROC_TRIBUNAL ?? 'TJSC') as Tribunal
const client = createEprocHttpClient({
  tribunal,
  usuario: process.env[`EPROC_${tribunal}_USER`]!,
  senha: process.env[`EPROC_${tribunal}_PASSWORD`]!,
  totpSeed: process.env[`EPROC_${tribunal}_TOTP_SEED`]!,
  timeout: 30000,
})

async function main() {
  const snapshot = await client.collectSnapshot()
  console.log(`\n✓ ${tribunal}: ${snapshot.andamentos.length} andamentos de ${new Set(snapshot.andamentos.map(a => a.processoNumero)).size} processos`)
  if (snapshot.andamentos.length > 0) {
    console.log(`  Amostra: ${snapshot.andamentos[0].descricao.slice(0, 80)}`)
  }
}

main().catch((err) => {
  console.error('✗ Erro:', err.message)
  process.exitCode = 1
})
