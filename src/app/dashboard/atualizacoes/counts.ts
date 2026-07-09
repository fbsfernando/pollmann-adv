import { prisma } from "@/lib/db"
import { PublicacaoStatus } from "@prisma/client"

/** Pendências por aba do módulo Atualizações (badge das abas). */
export async function getPendentesPorAba(): Promise<{
  publicacoes: number
  intimacoes: number
}> {
  const [publicacoes, intimacoes] = await Promise.all([
    prisma.publicacao.count({ where: { status: PublicacaoStatus.PENDENTE } }),
    prisma.intimacao.count({ where: { status: PublicacaoStatus.PENDENTE } }),
  ])
  return { publicacoes, intimacoes }
}
