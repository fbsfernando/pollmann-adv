/**
 * Sincronização de compromissos (agenda) do Expedit → `Tarefa`.
 *
 * Os compromissos do Expedit (CompromissoDTO, via `/api/processos/{id}/agenda`)
 * são o que alimenta a agenda do nosso sistema. Cada compromisso vira uma `Tarefa`
 * idempotente (por `expeditId`), vinculada ao processo, com prazo e responsável.
 *
 * O responsável vem do Expedit (`responsaveis[].nome`); mapeamos para um `User`
 * por nome (normalizado). Sem correspondência, atribui ao admin (fallback), já que
 * `Tarefa.responsavelId` é obrigatório.
 */
import { randomUUID } from 'node:crypto'

import { Role, TarefaStatus, type PrismaClient } from '@prisma/client'

import type { ExpeditApiClient } from '@/lib/expedit/expedit-api-client'
import type { CompromissoDTO } from '@/lib/expedit/expedit-api-types'

export type CompromissosSyncDeps = { maxProcessos?: number }

export type CompromissosSyncCounters = {
  processosVisitados: number
  compromissosColetados: number
  tarefasCriadas: number
  tarefasAtualizadas: number
  semResponsavelMapeado: number
}

export type CompromissosSyncResult = {
  runId: string
  phase: CompromissosSyncCounters
}

const norm = (s?: string): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const parseDate = (raw?: string): Date | null => {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const d = new Date(s.includes('T') ? s : `${s}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

const mapStatus = (c: CompromissoDTO): TarefaStatus => {
  if (c.concluido) return TarefaStatus.CONCLUIDO
  const sit = norm(c.situacao)
  if (sit === 'cancelado') return TarefaStatus.CANCELADO
  if (sit === 'em_andamento' || sit === 'andamento') return TarefaStatus.EM_ANDAMENTO
  return TarefaStatus.PENDENTE
}

export const syncCompromissosExpedit = async (
  prisma: PrismaClient,
  client: ExpeditApiClient,
  deps?: CompromissosSyncDeps
): Promise<CompromissosSyncResult> => {
  const runId = randomUUID()
  let compromissosColetados = 0
  let tarefasCriadas = 0
  let tarefasAtualizadas = 0
  let semResponsavelMapeado = 0

  // Mapa de Users por nome normalizado + admin de fallback (responsavel/criador).
  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true } })
  const userByNome = new Map<string, string>()
  for (const u of users) if (u.name) userByNome.set(norm(u.name), u.id)
  const admin = users.find((u) => u.role === Role.ADMIN) ?? users[0]
  if (!admin) {
    return {
      runId,
      phase: { processosVisitados: 0, compromissosColetados: 0, tarefasCriadas: 0, tarefasAtualizadas: 0, semResponsavelMapeado: 0 },
    }
  }

  const resolveResponsavel = (c: CompromissoDTO): string => {
    for (const r of c.responsaveis ?? []) {
      const id = userByNome.get(norm(r.nome))
      if (id) return id
    }
    semResponsavelMapeado += 1
    return admin.id
  }

  const processos = await prisma.processo.findMany({
    where: { expeditId: { not: null } },
    select: { id: true, expeditId: true },
    orderBy: { updatedAt: 'desc' },
    take: deps?.maxProcessos,
  })

  for (const proc of processos) {
    const expeditId = Number(proc.expeditId)
    if (!Number.isFinite(expeditId)) continue

    const agenda = await client.getAgenda(expeditId).catch(() => null)
    const compromissos = agenda?.compromissos ?? []
    compromissosColetados += compromissos.length

    for (const c of compromissos) {
      const tarefaExpeditId = `expedit-comp:${c.id}`
      const responsavelId = resolveResponsavel(c)
      const prazoData = parseDate(c.dataFim) ?? parseDate(c.dataInicio)
      const status = mapStatus(c)

      const dataFields = {
        tipo: String(c.tipoTarefa?.titulo ?? c.tipoTarefa?.nome ?? 'Compromisso'),
        titulo: String(c.titulo ?? 'Compromisso').trim() || 'Compromisso',
        descricao: c.descricao ? String(c.descricao) : null,
        dataInicio: parseDate(c.dataInicio),
        prazoData,
        status,
        processoId: proc.id,
        responsavelId,
        concluidoEm: c.concluido ? prazoData : null,
      }

      const existing = await prisma.tarefa.findUnique({
        where: { expeditId: tarefaExpeditId },
        select: { id: true },
      })

      await prisma.tarefa.upsert({
        where: { expeditId: tarefaExpeditId },
        create: { expeditId: tarefaExpeditId, criadoPorId: admin.id, ...dataFields },
        update: {
          tipo: dataFields.tipo,
          titulo: dataFields.titulo,
          descricao: dataFields.descricao,
          dataInicio: dataFields.dataInicio,
          prazoData: dataFields.prazoData,
          status: dataFields.status,
          processoId: dataFields.processoId,
          concluidoEm: dataFields.concluidoEm,
        },
      })

      if (existing) tarefasAtualizadas += 1
      else tarefasCriadas += 1
    }
  }

  return {
    runId,
    phase: {
      processosVisitados: processos.length,
      compromissosColetados,
      tarefasCriadas,
      tarefasAtualizadas,
      semResponsavelMapeado,
    },
  }
}
