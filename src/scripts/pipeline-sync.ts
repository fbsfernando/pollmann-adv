import { PrismaClient } from '@prisma/client'

import { createEprocHttpClient, type Tribunal } from '@/lib/scraper/eproc-http'
import { syncAndamentos } from '@/lib/pipeline/sync-andamentos'

const getEnv = (key: string, fallback?: string): string => {
  const val = process.env[key] ?? fallback
  if (!val) throw new Error(`Variável de ambiente ausente: ${key}`)
  return val
}

export const run = async (): Promise<number> => {
  const prisma = new PrismaClient()

  try {
    const tribunal = (process.env.EPROC_TRIBUNAL ?? 'TJSC') as Tribunal
    const archiveBaseDir = process.env.PIPELINE_ARCHIVE_DIR ?? './storage/archive'

    const proxyUrl = process.env[`EPROC_${tribunal}_PROXY_URL`] ?? process.env.EPROC_PROXY_URL

    // Busca processos INATIVOS do banco para excluir do scraping (economia de tempo
    // e respeito ao pedido do Richard: só monitorar processos ativos).
    const inativos = await prisma.processo.findMany({
      where: { tribunal, status: { not: 'ATIVO' } },
      select: { numero: true },
    })
    const excludeProcessos = inativos.map((p) => p.numero)
    if (excludeProcessos.length > 0) {
      console.info(`[pipeline:sync] ignorando ${excludeProcessos.length} processo(s) inativo(s) em ${tribunal}`)
    }

    const scraperConfig = {
      tribunal,
      usuario: getEnv(`EPROC_${tribunal}_USER`),
      senha: getEnv(`EPROC_${tribunal}_PASSWORD`),
      totpSeed: getEnv(`EPROC_${tribunal}_TOTP_SEED`),
      timeout: 45000,
      interProcessoDelayMs: Number(process.env.EPROC_INTER_PROCESSO_DELAY_MS ?? 2000),
      proxyUrl: proxyUrl || undefined,
      excludeProcessos,
    }

    const client = createEprocHttpClient(scraperConfig)

    // Verifica quais documentos já estão arquivados para não baixar de novo
    const isDocumentKnown = async (externalId: string): Promise<boolean> => {
      const doc = await prisma.documento.findUnique({
        where: { externalId },
        select: { storagePath: true },
      })
      // Considera arquivado só se tem path real (não URL do E-PROC)
      return !!(doc?.storagePath && !doc.storagePath.startsWith('eproc/'))
    }

    // Coleta andamentos e baixa documentos novos via HTTP direto
    const snapshot = await client.collectSnapshotWithDocuments(isDocumentKnown)

    const result = await syncAndamentos(prisma, { collectSnapshot: async () => snapshot }, {
      archiveBaseDir,
    })

    console.info('[pipeline:sync] completed', {
      runId: result.runId,
      phase: result.phase,
      timestamp: new Date().toISOString(),
    })

    return 0
  } catch (error) {
    console.error('[pipeline:sync] failed', {
      error: error instanceof Error ? error.message : 'unknown-error',
      timestamp: new Date().toISOString(),
    })
    return 1
  } finally {
    await prisma.$disconnect()
  }
}

void run().then((code) => {
  process.exitCode = code
})
