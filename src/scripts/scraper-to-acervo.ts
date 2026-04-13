/**
 * Gera o arquivo de acervo (tmp/acervo.json) a partir do scraper E-PROC.
 *
 * Fluxo:
 *   1. Autentica no E-PROC TJSC via TOTP
 *   2. Lista todos os processos da relação do advogado
 *   3. Extrai andamentos de cada processo
 *   4. Converte para o formato InputProcesso[] esperado por import-acervo.ts
 *   5. Salva em tmp/acervo.json
 *
 * Uso:
 *   npx tsx src/scripts/scraper-to-acervo.ts [TJSC|TJRS]
 *   npx tsx src/scripts/scraper-to-acervo.ts TJRS
 *
 * O arquivo gerado pode ser importado com:
 *   ACERVO_SOURCE_PATH=tmp/acervo.json npm run migrate:acervo
 */

import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { createEprocHttpClient, type Tribunal } from '@/lib/scraper/eproc-http'
import type { ScraperSnapshot, ExternalAndamentoInput } from '@/lib/pipeline/types'

const TRIBUNAL = (process.argv[2]?.toUpperCase() as Tribunal) ?? 'TJSC'
const OUTPUT_PATH = path.join(process.cwd(), '..', 'tmp', 'acervo.json')

if (TRIBUNAL !== 'TJSC' && TRIBUNAL !== 'TJRS') {
  console.error('Tribunal inválido. Use TJSC ou TJRS.')
  process.exit(1)
}

const getEnv = (key: string): string => {
  const val = process.env[key]
  if (!val) throw new Error(`Variável de ambiente ausente: ${key}`)
  return val
}

// ─── Inferência de tribunal a partir do número CNJ ────────────────────────────

const inferTribunal = (numero: string, tribunal: Tribunal): 'TJSC' | 'TJRS' | 'OUTRO' => {
  // Padrão CNJ: NNNNNNN-DD.AAAA.8.24.OOOO → 8.24 = TJSC, 8.21 = TJRS
  if (numero.includes('.8.24.')) return 'TJSC'
  if (numero.includes('.8.21.')) return 'TJRS'
  return tribunal // fallback para o tribunal configurado
}

// ─── Conversão snapshot → payload do importador ──────────────────────────────

type InputAndamento = {
  dataIso: string
  tipo: string
  descricao: string
  origemId: string
  documentos: Array<{ nome: string; storagePath: string; tipo?: string; origemId: string }>
}

type InputProcesso = {
  numero: string
  tribunal: string
  status: 'ATIVO'
  cliente: { nome: string }
  andamentos: InputAndamento[]
}

function snapshotToAcervo(snapshot: ScraperSnapshot, tribunal: Tribunal): { processos: InputProcesso[] } {
  // Agrupa andamentos por processo
  const byProcesso = new Map<string, ExternalAndamentoInput[]>()

  for (const a of snapshot.andamentos) {
    const existing = byProcesso.get(a.processoNumero) ?? []
    existing.push(a)
    byProcesso.set(a.processoNumero, existing)
  }

  const processos: InputProcesso[] = []

  for (const [numero, andamentos] of byProcesso) {
    const tribunalInferido = inferTribunal(numero, tribunal)

    processos.push({
      numero,
      tribunal: tribunalInferido,
      status: 'ATIVO',
      // Nome do cliente desconhecido neste ponto — será preenchido como placeholder
      // O importador aceita nome como campo obrigatório; pode ser atualizado depois
      // via Astrea ou manualmente no dashboard
      cliente: {
        nome: `Cliente do processo ${numero}`,
      },
      andamentos: andamentos.map(a => ({
        dataIso: a.dataIso,
        tipo: a.tipo,
        descricao: a.descricao,
        origemId: a.externalId,
        documentos: (a.documentos ?? []).map(d => ({
          nome: d.nome || 'documento',
          // storagePath vazio por ora — os documentos serão baixados pelo pipeline
          storagePath: d.storagePath || `eproc/${numero}/${d.externalId}`,
          tipo: d.tipo ?? undefined,
          origemId: d.externalId,
        })),
      })),
    })
  }

  return { processos }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const usuario = getEnv(`EPROC_${TRIBUNAL}_USER`)
  const senha = getEnv(`EPROC_${TRIBUNAL}_PASSWORD`)
  const totpSeed = getEnv(`EPROC_${TRIBUNAL}_TOTP_SEED`)

  console.log(`\nGerando acervo a partir do E-PROC ${TRIBUNAL}...`)
  console.log(`Usuário: ${usuario}`)
  console.log(`Destino: ${OUTPUT_PATH}\n`)

  const client = createEprocHttpClient({
    tribunal: TRIBUNAL,
    usuario,
    senha,
    totpSeed,
    timeout: 45000,
    interProcessoDelayMs: Number(process.env.EPROC_INTER_PROCESSO_DELAY_MS ?? 2000),
  })

  console.log('[1/3] Coletando andamentos do E-PROC...')
  const snapshot = await client.collectSnapshot()

  console.log(`[1/3] Coletado: ${snapshot.andamentos.length} andamentos`)

  console.log('[2/3] Convertendo para formato de importação...')
  const payload = snapshotToAcervo(snapshot, TRIBUNAL)

  console.log(`[2/3] Convertido: ${payload.processos.length} processos`)

  const totalAndamentos = payload.processos.reduce((acc, p) => acc + p.andamentos.length, 0)
  console.log(`       ${totalAndamentos} andamentos`)

  console.log('[3/3] Salvando arquivo...')
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf-8')

  console.log(`\n✅ Acervo salvo em: ${OUTPUT_PATH}`)
  console.log(`   Processos : ${payload.processos.length}`)
  console.log(`   Andamentos: ${totalAndamentos}`)
  console.log(`\nPróximo passo:`)
  console.log(`   ACERVO_SOURCE_PATH=tmp/acervo.json npm run migrate:acervo`)
}

main().catch(err => {
  console.error('\n❌ Erro:', err.message)
  process.exit(1)
})
