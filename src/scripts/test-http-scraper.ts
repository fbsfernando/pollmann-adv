/**
 * Teste rápido do scraper HTTP — faz login, lista processos e extrai andamentos do primeiro.
 */
import { createEprocHttpClient } from '@/lib/scraper/eproc-http'

const getEnv = (key: string) => {
  const val = process.env[key]
  if (!val) throw new Error(`Variável ausente: ${key}`)
  return val
}

async function main() {
  const client = createEprocHttpClient({
    tribunal: 'TJSC',
    usuario: getEnv('EPROC_TJSC_USER'),
    senha: getEnv('EPROC_TJSC_PASSWORD'),
    totpSeed: getEnv('EPROC_TJSC_TOTP_SEED'),
    timeout: 45000,
    interProcessoDelayMs: 2000,
  })

  console.log('=== Testando collectSnapshot (sem downloads) ===\n')

  const snapshot = await client.collectSnapshot()

  console.log(`\nResultado:`)
  console.log(`  Source: ${snapshot.source}`)
  console.log(`  Coletado em: ${snapshot.collectedAtIso}`)
  console.log(`  Total de andamentos: ${snapshot.andamentos.length}`)

  if (snapshot.andamentos.length > 0) {
    console.log(`\nPrimeiros 3 andamentos:`)
    for (const a of snapshot.andamentos.slice(0, 3)) {
      console.log(`  [${a.externalId}] ${a.dataIso} — ${a.descricao.slice(0, 80)}`)
      console.log(`    Docs: ${a.documentos?.length ?? 0}`)
    }
  }

  // Contabiliza
  const totalDocs = snapshot.andamentos.reduce((sum, a) => sum + (a.documentos?.length ?? 0), 0)
  const processos = new Set(snapshot.andamentos.map(a => a.processoNumero))
  console.log(`\nResumo:`)
  console.log(`  Processos: ${processos.size}`)
  console.log(`  Andamentos: ${snapshot.andamentos.length}`)
  console.log(`  Documentos referenciados: ${totalDocs}`)
}

main().catch((err) => {
  console.error('Erro:', err)
  process.exitCode = 1
})
