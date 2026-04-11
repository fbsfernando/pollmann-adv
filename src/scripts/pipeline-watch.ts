import { setTimeout as sleep } from 'node:timers/promises'

const intervalMs = Number(process.env.PIPELINE_INTERVAL_MS ?? 6 * 60 * 60 * 1000)

// Guard de concorrência: evita que uma nova run inicie antes da anterior terminar
let pipelineRunning = false

const run = async () => {
  for (;;) {
    if (pipelineRunning) {
      console.warn('[pipeline:watch] run anterior ainda em execução — ciclo ignorado', {
        nextCheckMs: intervalMs,
      })
    } else {
      const startedAt = new Date().toISOString()
      console.info('[pipeline:watch] cycle-start', { startedAt, intervalMs })

      pipelineRunning = true
      try {
        const { run: runPipeline } = await import('./pipeline-sync')
        const exitCode = await runPipeline()

        console.info('[pipeline:watch] cycle-finished', {
          finishedAt: new Date().toISOString(),
          exitCode,
          sleepMs: intervalMs,
        })
      } finally {
        pipelineRunning = false
      }
    }

    await sleep(intervalMs)
  }
}

void run()
