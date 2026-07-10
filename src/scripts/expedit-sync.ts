import { PrismaClient } from '@prisma/client'

import { createExpeditClient } from '@/lib/expedit/expedit-client'
import { createExpeditApiClient } from '@/lib/expedit/expedit-api-client'
import { syncProcessosExpedit } from '@/lib/pipeline/sync-processos-expedit'
import { syncDetalhesExpedit } from '@/lib/pipeline/sync-detalhes-expedit'
import { syncCompromissosExpedit } from '@/lib/pipeline/sync-compromissos-expedit'
import { syncPublicacoesExpedit } from '@/lib/pipeline/sync-publicacoes-expedit'
import { syncIntimacoesExpedit } from '@/lib/pipeline/sync-intimacoes-expedit'
import { syncDocumentosExpedit } from '@/lib/pipeline/sync-documentos-expedit'
import { runLembretesPrazo } from '@/lib/pipeline/lembretes-prazo'
import { runCalendarSync } from '@/lib/google/calendar-sync'
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
    // Fonte primária: API REST oficial (JWT) para processos/andamentos.
    const apiClient = createExpeditApiClient({
      baseUrl: getEnv('EXPEDIT_API_BASE_URL', 'https://api.expedit.com.br'),
      username: getEnv('EXPEDIT_EMAIL'),
      password: getEnv('EXPEDIT_PASSWORD'),
      timeout: 45000,
      proxyUrl: process.env.EXPEDIT_PROXY_URL || undefined,
    })

    // app-v2 (sessão PHP): usado só onde a API oficial não tem equivalente —
    // as publicações diárias por diário (a tela principal de tratamento).
    const appV2Client = createExpeditClient({
      baseUrl: getEnv('EXPEDIT_BASE_URL', 'https://app-v2.expedit.com.br'),
      email: getEnv('EXPEDIT_EMAIL'),
      senha: getEnv('EXPEDIT_PASSWORD'),
      timeout: 45000,
      proxyUrl: process.env.EXPEDIT_PROXY_URL || undefined,
    })

    const archiveBaseDir = process.env.PIPELINE_ARCHIVE_DIR ?? './storage/archive'
    const driveArchiver = createDriveArchiver()

    // 1) Importa/atualiza processos via API oficial.
    const processosResult = await syncProcessosExpedit(prisma, apiClient)
    console.info('[expedit:sync] processos', { phase: processosResult.phase })

    // 1b) Detalhes por processo (andamentos completos + documentos) via API oficial.
    const detalhesMax = process.env.EXPEDIT_DETALHES_MAX
      ? Number(process.env.EXPEDIT_DETALHES_MAX)
      : undefined
    const detalhesResult = await syncDetalhesExpedit(prisma, apiClient, {
      archiveBaseDir: process.env.PIPELINE_ARCHIVE_DIR ?? './storage/archive',
      driveArchiver: createDriveArchiver(),
      maxProcessos: detalhesMax,
    })
    console.info('[expedit:sync] detalhes', { phase: detalhesResult.phase })

    // 1c) Compromissos da agenda do Expedit → Tarefa.
    const compromissosResult = await syncCompromissosExpedit(prisma, apiClient, {
      maxProcessos: detalhesMax,
    })
    console.info('[expedit:sync] compromissos', { phase: compromissosResult.phase })

    // Etapas do app-v2 isoladas: a sessão PHP pode expirar/falhar no meio de um
    // run longo — uma etapa quebrada não pode derrubar as demais.
    const step = async <T>(nome: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        const result = await fn()
        console.info(`[expedit:sync] ${nome}`, { phase: (result as { phase?: unknown }).phase })
        return result
      } catch (e) {
        console.error(`[expedit:sync] ${nome} falhou`, {
          error: e instanceof Error ? e.message : 'unknown-error',
        })
        return null
      }
    }

    // 2) Sincroniza publicações do intervalo (app-v2) + arquiva documentos.
    const range = buildRange()
    const publicacoesResult = await step('publicacoes', () =>
      syncPublicacoesExpedit(prisma, appV2Client, range, { archiveBaseDir, driveArchiver })
    )

    // 2b) Sincroniza intimações eletrônicas (app-v2) — traz data de ciência e limite.
    const intimacoesResult = await step('intimacoes', () =>
      syncIntimacoesExpedit(prisma, appV2Client)
    )

    // 3) Sincroniza documentos juntados no intervalo (app-v2) + arquiva (local + Drive).
    const documentosResult = await step('documentos', () =>
      syncDocumentosExpedit(prisma, appV2Client, range, { archiveBaseDir, driveArchiver })
    )

    // 4) Lembretes de prazo (não derruba o sync em caso de falha).
    try {
      const lembretes = await runLembretesPrazo(prisma)
      console.info('[expedit:sync] lembretes', lembretes)
    } catch (e) {
      console.error('[expedit:sync] lembretes falharam', {
        error: e instanceof Error ? e.message : 'unknown-error',
      })
    }

    // 5) Espelha a agenda no Google Calendar (opt-in; não derruba o sync).
    try {
      const gcal = await runCalendarSync(prisma)
      console.info('[expedit:sync] google-calendar', gcal)
    } catch (e) {
      console.error('[expedit:sync] google-calendar falhou', {
        error: e instanceof Error ? e.message : 'unknown-error',
      })
    }

    console.info('[expedit:sync] completed', {
      runId: publicacoesResult?.runId ?? null,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      processos: processosResult.phase,
      publicacoes: publicacoesResult?.phase ?? 'falhou',
      intimacoes: intimacoesResult?.phase ?? 'falhou',
      documentos: documentosResult?.phase ?? 'falhou',
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
