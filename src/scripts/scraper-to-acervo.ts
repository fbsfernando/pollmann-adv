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
  area?: string
  vara?: string
  observacoes?: string
  cliente: {
    nome: string
    cpfCnpj?: string
  }
  andamentos: InputAndamento[]
}

/**
 * Identifica a parte "cliente do escritório" dentre as partes do processo.
 *
 * Critério: a parte cujos advogados representantes incluem o OAB do usuário
 * logado (passado em `userOab`). Se nenhuma parte bater, usa a primeira parte
 * como fallback (melhor que ter "Cliente do processo X" genérico).
 */
function identificarClienteDoEscritorio(
  metadata: import('@/lib/pipeline/types').ExternalProcessoMetadata | undefined,
  userOab: string | null,
): { nome: string; cpfCnpj?: string } {
  if (!metadata?.partes?.length) {
    return { nome: `Cliente do processo ${metadata?.numero ?? 'desconhecido'}` }
  }

  // Procura uma parte cuja lista de advogados contenha o OAB do usuário
  if (userOab) {
    const upper = userOab.toUpperCase()
    const hit = metadata.partes.find(p => p.advogadosOab?.some(o => o.toUpperCase() === upper))
    if (hit) return { nome: hit.nome, cpfCnpj: hit.cpfCnpj }
  }

  // Fallback: primeira parte (geralmente o réu, que costuma ser o cliente do advogado)
  const first = metadata.partes[0]
  return { nome: first.nome, cpfCnpj: first.cpfCnpj }
}

function snapshotToAcervo(
  snapshot: ScraperSnapshot,
  tribunal: Tribunal,
  userOab: string | null,
): { processos: InputProcesso[] } {
  // Agrupa andamentos por processo
  const byProcesso = new Map<string, ExternalAndamentoInput[]>()

  for (const a of snapshot.andamentos) {
    const existing = byProcesso.get(a.processoNumero) ?? []
    existing.push(a)
    byProcesso.set(a.processoNumero, existing)
  }

  const processos: InputProcesso[] = []
  const allNumeros = new Set<string>([
    ...byProcesso.keys(),
    ...Object.keys(snapshot.processosMetadata ?? {}),
  ])

  for (const numero of allNumeros) {
    const andamentos = byProcesso.get(numero) ?? []
    const metadata = snapshot.processosMetadata?.[numero]
    const tribunalInferido = inferTribunal(numero, tribunal)
    const cliente = identificarClienteDoEscritorio(metadata, userOab)

    processos.push({
      numero,
      tribunal: tribunalInferido,
      status: 'ATIVO',
      area: metadata?.area,
      vara: metadata?.vara,
      observacoes: metadata?.classe ? `Classe: ${metadata.classe}` : undefined,
      cliente,
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

  // Proxy específico por tribunal (útil quando um tribunal está atrás de Cloudflare
  // bloqueando o IP do servidor, como o TJRS em VPS de datacenter)
  const proxyUrl = process.env[`EPROC_${TRIBUNAL}_PROXY_URL`] ?? process.env.EPROC_PROXY_URL

  const client = createEprocHttpClient({
    tribunal: TRIBUNAL,
    usuario,
    senha,
    totpSeed,
    timeout: 45000,
    interProcessoDelayMs: Number(process.env.EPROC_INTER_PROCESSO_DELAY_MS ?? 2000),
    proxyUrl: proxyUrl || undefined,
  })

  console.log('[1/3] Coletando andamentos do E-PROC...')
  const snapshot = await client.collectSnapshot()

  console.log(`[1/3] Coletado: ${snapshot.andamentos.length} andamentos`)

  console.log('[2/3] Convertendo para formato de importação...')
  // OAB do usuário logado — usado para identificar qual parte do processo é
  // o cliente do escritório (a parte que tem esse OAB como advogado representante)
  const userOab = process.env[`EPROC_${TRIBUNAL}_OAB`] ?? usuario
  const payload = snapshotToAcervo(snapshot, TRIBUNAL, userOab)

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
