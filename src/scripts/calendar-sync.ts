/** Wrapper CLI do sync com o Google Calendar (lógica em @/lib/google/calendar-sync). */
import { PrismaClient } from '@prisma/client'

import { runCalendarSync } from '@/lib/google/calendar-sync'

const run = async (): Promise<number> => {
  const prisma = new PrismaClient()
  try {
    const res = await runCalendarSync(prisma)
    console.info('[google-calendar:sync] concluído', { ...res, timestamp: new Date().toISOString() })
    return res.enabled ? 0 : 2
  } catch (error) {
    console.error('[google-calendar:sync] falhou', {
      error: error instanceof Error ? error.message : 'unknown-error',
    })
    return 1
  } finally {
    await prisma.$disconnect()
  }
}

void run().then((code) => {
  process.exitCode = code
})
