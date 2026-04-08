/**
 * Script de teste do scraper E-PROC.
 * Roda fora da plataforma, sem banco de dados.
 *
 * Uso:
 *   npx tsx src/scripts/test-scraper.ts [TJSC|TJRS] [numero_processo]
 *
 * Exemplos:
 *   npx tsx src/scripts/test-scraper.ts TJSC
 *   npx tsx src/scripts/test-scraper.ts TJSC 5005888-57.2023.8.24.0023
 *   npx tsx src/scripts/test-scraper.ts TJRS
 */

import 'dotenv/config'
import { createEprocPlaywrightClient, generateTotp, normalizeTotpSeed, type Tribunal } from '@/lib/scraper/eproc-playwright'

async function main() {
  const TRIBUNAL = (process.argv[2]?.toUpperCase() as Tribunal) ?? 'TJSC'
  const PROCESSO_ARG = process.argv[3] ?? ''

  // Valida tribunal
  if (TRIBUNAL !== 'TJSC' && TRIBUNAL !== 'TJRS') {
    console.error('Tribunal inválido. Use TJSC ou TJRS.')
    process.exit(1)
  }

  // Lê credenciais do .env
  const getEnv = (key: string): string => {
    const val = process.env[key]
    if (!val) throw new Error(`Variável de ambiente ausente: ${key}`)
    return val
  }

  const usuario = getEnv(`EPROC_${TRIBUNAL}_USER`)
  const senha = getEnv(`EPROC_${TRIBUNAL}_PASSWORD`)
  const totpSeed = getEnv(`EPROC_${TRIBUNAL}_TOTP_SEED`)

  console.log('─'.repeat(60))
  console.log(`Tribunal   : ${TRIBUNAL}`)
  console.log(`Usuário    : ${usuario}`)
  console.log(`TOTP seed  : ${normalizeTotpSeed(totpSeed)}`)
  console.log(`TOTP atual : ${generateTotp(totpSeed)}`)
  if (PROCESSO_ARG) console.log(`Processo   : ${PROCESSO_ARG}`)
  console.log('─'.repeat(60))

  const client = createEprocPlaywrightClient({
    tribunal: TRIBUNAL,
    usuario,
    senha,
    totpSeed,
    processos: PROCESSO_ARG ? [PROCESSO_ARG] : [],
    headless: true,
    timeout: 45000,
  })

  console.log('\n[TEST] Iniciando collectSnapshot()...\n')

  try {
    const snapshot = await client.collectSnapshot()

    console.log('\n' + '─'.repeat(60))
    console.log(`[TEST] Snapshot concluído`)
    console.log(`  source       : ${snapshot.source}`)
    console.log(`  collectedAt  : ${snapshot.collectedAtIso}`)
    console.log(`  andamentos   : ${snapshot.andamentos.length}`)
    console.log('─'.repeat(60))

    for (const a of snapshot.andamentos.slice(0, 10)) {
      console.log(`\n  Processo : ${a.processoNumero}`)
      console.log(`  ID externo: ${a.externalId}`)
      console.log(`  Data      : ${a.dataIso}`)
      console.log(`  Tipo      : ${a.tipo}`)
      console.log(`  Descrição : ${a.descricao.slice(0, 120)}`)
      if (a.documentos && a.documentos.length > 0) {
        console.log(`  Documentos: ${a.documentos.length}`)
        for (const d of a.documentos.slice(0, 3)) {
          console.log(`    - ${d.nome} (${d.tipo ?? 'sem tipo'})`)
        }
      }
    }

    if (snapshot.andamentos.length > 10) {
      console.log(`\n  ... e mais ${snapshot.andamentos.length - 10} andamentos`)
    }

    console.log('\n[TEST] ✅ Scraper funcionando corretamente\n')
  } catch (err) {
    console.error('\n[TEST] ❌ Erro durante o scraping:\n', err)
    process.exit(1)
  }
}

main()
