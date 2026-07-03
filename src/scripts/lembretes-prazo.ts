/**
 * Lembretes de prazo → notificação in-app.
 *
 * Varre as tarefas ABERTAS direcionadas a advogados e notifica quando o prazo
 * está próximo (dentro de LEMBRETE_DIAS, default 3) ou já venceu. Idempotente:
 * dedup por (tarefaId + tipo), então cada tarefa gera no máximo um lembrete de
 * "próximo" e um de "atrasado" ao longo do tempo — sem spam mesmo rodando a cada
 * ciclo do cron.
 */
import { PrismaClient, Role, TarefaStatus } from '@prisma/client'

import { criarNotificacao } from '@/lib/notificacoes'

const DIAS = Math.max(1, Number(process.env.LEMBRETE_DIAS ?? 3))
const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : ''

export const run = async (): Promise<number> => {
  const prisma = new PrismaClient()
  try {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const fimJanela = new Date(hoje.getTime() + (DIAS + 1) * 86_400_000) // inclui os próximos DIAS dias

    const abertas = { status: { in: [TarefaStatus.PENDENTE, TarefaStatus.EM_ANDAMENTO] } }
    const soAdvogado = { responsavel: { role: Role.ADVOGADO } }
    const sel = {
      id: true,
      titulo: true,
      prazoData: true,
      responsavelId: true,
      processo: { select: { numero: true } },
    } as const

    const [proximas, atrasadas] = await Promise.all([
      prisma.tarefa.findMany({
        where: { ...abertas, ...soAdvogado, prazoData: { gte: hoje, lt: fimJanela } },
        select: sel,
      }),
      prisma.tarefa.findMany({
        where: { ...abertas, ...soAdvogado, prazoData: { lt: hoje } },
        select: sel,
      }),
    ])

    // Dedup: tarefas que já têm notificação daquele tipo.
    const jaNotificadas = async (tipo: string, ids: string[]) => {
      if (ids.length === 0) return new Set<string>()
      const rows = await prisma.notificacao.findMany({
        where: { tipo, tarefaId: { in: ids } },
        select: { tarefaId: true },
      })
      return new Set(rows.map((r) => r.tarefaId).filter((x): x is string => !!x))
    }

    const jaProx = await jaNotificadas('PRAZO_PROXIMO', proximas.map((t) => t.id))
    const jaAtr = await jaNotificadas('PRAZO_ATRASADO', atrasadas.map((t) => t.id))

    let criadas = 0
    for (const t of proximas) {
      if (jaProx.has(t.id)) continue
      await criarNotificacao(prisma, {
        userId: t.responsavelId,
        tipo: 'PRAZO_PROXIMO',
        titulo: `Prazo em breve: ${t.titulo}`,
        descricao: `Vence em ${fmt(t.prazoData)}${t.processo ? ` · Processo ${t.processo.numero}` : ''}`,
        link: '/dashboard/agenda',
        tarefaId: t.id,
      })
      criadas += 1
    }
    for (const t of atrasadas) {
      if (jaAtr.has(t.id)) continue
      await criarNotificacao(prisma, {
        userId: t.responsavelId,
        tipo: 'PRAZO_ATRASADO',
        titulo: `Prazo atrasado: ${t.titulo}`,
        descricao: `Venceu em ${fmt(t.prazoData)}${t.processo ? ` · Processo ${t.processo.numero}` : ''}`,
        link: '/dashboard/agenda',
        tarefaId: t.id,
      })
      criadas += 1
    }

    console.info('[lembretes:prazo] concluído', {
      proximas: proximas.length,
      atrasadas: atrasadas.length,
      notificacoesCriadas: criadas,
      timestamp: new Date().toISOString(),
    })
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
