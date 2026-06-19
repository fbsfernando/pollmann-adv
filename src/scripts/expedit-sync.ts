import { PrismaClient } from '@prisma/client'

import { createExpeditClient } from '@/lib/expedit/expedit-client'
import { syncProcessosExpedit } from '@/lib/pipeline/sync-processos-expedit'
import { syncPublicacoesExpedit } from '@/lib/pipeline/sync-publicacoes-expedit'
import { createDriveArchiver } from '@/lib/storage/drive-archive'

const getEnv = (key: string, fallback?: string): string => {
  const val = process.env[key] ?? fallback
  if (!val) throw new Error(`Variável de ambiente ausente: ${key}`)
  return val
}

/** Intervalo de datas a sincronizar (default: últimos EXPEDIT_SYNC_DAYS dias, mín. hoje). */
const buildRange = (): { from: Date; to: Date } => {
  const days = Math.max(1, Number(process.env.EXPEDIT_SYNC_DAYS ?? 1))
  const to = new Date()
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - (days - 1))
  return { from, to }
}

export const run = async (): Promise<number> => {
  const prisma = new PrismaClient()

  try {
    const client = createExpeditClient({
      baseUrl: getEnv('EXPEDIT_BASE_URL', 'https://app-v2.expedit.com.br'),
      email: getEnv('EXPEDIT_EMAIL'),
      senha: getEnv('EXPEDIT_PASSWORD'),
      timeout: 45000,
      proxyUrl: process.env.EXPEDIT_PROXY_URL || undefined,
    })

    const archiveBaseDir = process.env.PIPELINE_ARCHIVE_DIR ?? './storage/archive'
    const driveArchiver = createDriveArchiver()

    // 1) Importa/atualiza processos.
    const processosResult = await syncProcessosExpedit(prisma, client)
    console.info('[expedit:sync] processos', { phase: processosResult.phase })

    // 2) Sincroniza publicações do intervalo + arquiva documentos.
    const range = buildRange()
    const publicacoesResult = await syncPublicacoesExpedit(prisma, client, range, {
      archiveBaseDir,
      driveArchiver,
    })

    console.info('[expedit:sync] completed', {
      runId: publicacoesResult.runId,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      processos: processosResult.phase,
      publicacoes: publicacoesResult.phase,
      timestamp: new Date().toISOString(),
    })

    return 0
  } catch (error) {
    console.error('[expedit:sync] failed', {
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
