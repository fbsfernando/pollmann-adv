/**
 * Sync rápido (minuto a minuto), rodando DENTRO do app Next (instrumentation).
 *
 * Cobre só o que é leve e urgente — 3-4 requests por ciclo:
 *   1. Agenda global (1 req) → compromissos/audiências viram Tarefa + notificação
 *   2. Intimações página 1 (1 req) → novas intimações (chegam no topo)
 *   3. Publicações de hoje/ontem (poucos reqs) → novas publicações + import do
 *      estado de triagem do Expedit (tratada lá → tratada aqui)
 *
 * O pesado (timeline de andamentos, documentos, Drive, Google Calendar,
 * lembretes) continua no expedit-sync completo do cron de 6h.
 *
 * A sessão PHP do client é reaproveitada entre ciclos (module-level); o
 * re-login automático do client cobre a expiração.
 */
import { prisma } from '@/lib/db'
import { createExpeditClient, type ExpeditClient } from '@/lib/expedit/expedit-client'
import { syncAgendaGlobal } from '@/lib/pipeline/sync-agenda-global'
import { syncIntimacoesExpedit } from '@/lib/pipeline/sync-intimacoes-expedit'
import { syncPublicacoesExpedit } from '@/lib/pipeline/sync-publicacoes-expedit'

let client: ExpeditClient | null | undefined
let running = false
let timer: ReturnType<typeof setInterval> | null = null

const getClient = (): ExpeditClient | null => {
  if (client !== undefined) return client
  const email = process.env.EXPEDIT_EMAIL
  const senha = process.env.EXPEDIT_PASSWORD
  client =
    email && senha
      ? createExpeditClient({
          baseUrl: process.env.EXPEDIT_BASE_URL ?? 'https://app-v2.expedit.com.br',
          email,
          senha,
        })
      : null
  return client
}

export const runFastSync = async (): Promise<void> => {
  const appV2 = getClient()
  if (!appV2) return

  const mudancas: string[] = []

  try {
    const agenda = await syncAgendaGlobal(prisma, appV2)
    if (agenda.phase.tarefasCriadas > 0) {
      mudancas.push(`agenda +${agenda.phase.tarefasCriadas} tarefas`)
    }
  } catch (e) {
    console.warn('[fast-sync] agenda falhou', { error: e instanceof Error ? e.message : 'unknown' })
  }

  try {
    const intimacoes = await syncIntimacoesExpedit(prisma, appV2, { maxPaginas: 1 })
    if (intimacoes.phase.intimacoesCriadas > 0) {
      mudancas.push(`+${intimacoes.phase.intimacoesCriadas} intimações`)
    }
  } catch (e) {
    console.warn('[fast-sync] intimações falharam', { error: e instanceof Error ? e.message : 'unknown' })
  }

  try {
    const to = new Date()
    const from = new Date(to)
    from.setUTCDate(from.getUTCDate() - 1)
    // Sem arquivamento aqui (pesado) — o sync de 6h arquiva local + Drive.
    const pubs = await syncPublicacoesExpedit(prisma, appV2, { from, to }, { archiveDocumentos: false })
    if (pubs.phase.publicacoesCriadas > 0) {
      mudancas.push(`+${pubs.phase.publicacoesCriadas} publicações`)
    }
  } catch (e) {
    console.warn('[fast-sync] publicações falharam', { error: e instanceof Error ? e.message : 'unknown' })
  }

  // Loga só quando algo mudou — a cada minuto, silêncio é ouro.
  if (mudancas.length > 0) {
    console.info('[fast-sync]', mudancas.join(' · '))
  }
}

/** Inicia o loop (chamado uma vez pelo instrumentation.ts no boot do server). */
export const startFastSyncLoop = (intervalMs: number): void => {
  if (timer) return
  console.info(`[fast-sync] ativo — a cada ${Math.round(intervalMs / 1000)}s`)
  timer = setInterval(async () => {
    if (running) return // ciclo anterior ainda rodando — pula
    running = true
    try {
      await runFastSync()
    } finally {
      running = false
    }
  }, intervalMs)
  timer.unref?.()
}
