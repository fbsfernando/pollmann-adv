/** Wrapper CLI dos lembretes de prazo (lógica em @/lib/pipeline/lembretes-prazo). */
import { PrismaClient } from '@prisma/client'

import { runLembretesPrazo } from '@/lib/pipeline/lembretes-prazo'

export const run = async (): Promise<number> => {
  const prisma = new PrismaClient()
  try {
    const res = await runLembretesPrazo(prisma)
    console.info('[lembretes:prazo] concluído', { ...res, timestamp: new Date().toISOString() })
    return 0
  } catch (error) {
    console.error('[lembretes:prazo] falhou', {
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
