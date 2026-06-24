import { setTimeout as sleep } from 'node:timers/promises'

// Pedido do Richard: sincronizar a cada 6h.
const intervalMs = Number(process.env.EXPEDIT_INTERVAL_MS ?? 6 * 60 * 60 * 1000)

// Guard de concorrência: evita que uma nova run inicie antes da anterior terminar
let expeditRunning = false

const run = async () => {
  for (;;) {
    if (expeditRunning) {
      console.warn('[expedit:watch] run anterior ainda em execução — ciclo ignorado', {
        nextCheckMs: intervalMs,
      })
    } else {
      const startedAt = new Date().toISOString()
      console.info('[expedit:watch] cycle-start', { startedAt, intervalMs })

      expeditRunning = true
      try {
        const { run: runExpedit } = await import('./expedit-sync')
        const exitCode = await runExpedit()

        console.info('[expedit:watch] cycle-finished', {
          finishedAt: new Date().toISOString(),
          exitCode,
          sleepMs: intervalMs,
        })
      } finally {
        expeditRunning = false
      }
    }

    await sleep(intervalMs)
  }
}

void run()
