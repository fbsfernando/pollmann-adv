import { setTimeout as sleep } from 'node:timers/promises'

const intervalMs = Number(process.env.PIPELINE_INTERVAL_MS ?? 6 * 60 * 60 * 1000)

const run = async () => {
  for (;;) {
    const startedAt = new Date().toISOString()
    console.info('[pipeline:watch] cycle-start', { startedAt, intervalMs })

    const { run } = await import('./pipeline-sync')
    const exitCode = await run()

    console.info('[pipeline:watch] cycle-finished', {
      finishedAt: new Date().toISOString(),
      exitCode,
      sleepMs: intervalMs,
    })

    await sleep(intervalMs)
  }
}

void run()
