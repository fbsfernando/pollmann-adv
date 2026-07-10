/**
 * Boot do servidor Next: liga o sync rápido do Expedit (agenda global,
 * intimações e publicações a cada ~1 min) direto no processo do app —
 * sem depender de cron externo nem SSH na VPS.
 *
 * Controle por env:
 *   FAST_SYNC_INTERVAL_MS  — intervalo em ms (default 60000; "0" desliga)
 *
 * Só roda no runtime Node em produção (em dev ligaria a cada hot-reload).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV !== 'production' && !process.env.FAST_SYNC_INTERVAL_MS) return

  const intervalMs = Number(process.env.FAST_SYNC_INTERVAL_MS ?? 60_000)
  if (!Number.isFinite(intervalMs) || intervalMs < 15_000) return

  const { startFastSyncLoop } = await import('@/lib/pipeline/fast-sync')
  startFastSyncLoop(intervalMs)
}
