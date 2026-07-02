import type { PrismaClient } from '@prisma/client'

export type NotificacaoInput = {
  userId: string
  tipo: string
  titulo: string
  descricao?: string | null
  link?: string | null
  tarefaId?: string | null
}

/** Cria uma notificação in-app. Falha de forma silenciosa (não deve derrubar o
 * fluxo principal que a origina). */
export async function criarNotificacao(prisma: PrismaClient, n: NotificacaoInput): Promise<void> {
  try {
    await prisma.notificacao.create({
      data: {
        userId: n.userId,
        tipo: n.tipo,
        titulo: n.titulo,
        descricao: n.descricao ?? null,
        link: n.link ?? null,
        tarefaId: n.tarefaId ?? null,
      },
    })
  } catch {
    // não propaga
  }
}

/** Notifica um advogado de que recebeu uma tarefa direcionada. */
export async function notificarTarefaDirecionada(
  prisma: PrismaClient,
  params: { responsavelId: string; tarefaId: string; titulo: string; processoNumero?: string | null }
): Promise<void> {
  await criarNotificacao(prisma, {
    userId: params.responsavelId,
    tipo: 'TAREFA_DIRECIONADA',
    titulo: params.titulo,
    descricao: params.processoNumero ? `Processo ${params.processoNumero}` : null,
    link: '/dashboard/agenda',
    tarefaId: params.tarefaId,
  })
}
