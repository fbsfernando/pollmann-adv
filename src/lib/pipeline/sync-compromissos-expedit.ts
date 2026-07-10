/**
 * Sincronização da AGENDA do Expedit → `Tarefa`.
 *
 * A chamada `/api/processos/{id}/agenda` retorna três tipos de evento, todos
 * convertidos em `Tarefa` (idempotentes por `expeditId`):
 *   - compromissos (CompromissoDTO)  → tipo do tipoTarefa
 *   - audiências  (AudienciaDTO)     → tipo "Audiência"
 *   - expedientes (ExpedienteDTO)    → tipo "Prazo" (prazos processuais)
 *
 * Assim todos aparecem no calendário/lista, filtros e RBAC já existentes.
 *
 * O responsável vem do nome escrito no título/descrição (o Richard "linka" o
 * advogado no evento) e, em fallback, de `responsaveis[].nome`; sem match,
 * atribui ao admin, já que `Tarefa.responsavelId` é obrigatório.
 */
import { randomUUID } from 'node:crypto'

import { TarefaStatus, type PrismaClient } from '@prisma/client'

import { notificarTarefaDirecionada } from '@/lib/notificacoes'
import { createResponsavelResolver } from '@/lib/pipeline/responsavel-matching'
import type { ExpeditApiClient } from '@/lib/expedit/expedit-api-client'
import type {
  CompromissoDTO,
  AudienciaDTO,
  ExpedienteDTO,
  ResponsavelDTO,
} from '@/lib/expedit/expedit-api-types'

export type CompromissosSyncDeps = { maxProcessos?: number }

export type CompromissosSyncCounters = {
  processosVisitados: number
  compromissosColetados: number
  audienciasColetadas: number
  expedientesColetados: number
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

const mapStatusStr = (s?: string, concluido?: boolean): TarefaStatus => {
  if (concluido) return TarefaStatus.CONCLUIDO
  const v = norm(s)
  if (v.includes('cancel')) return TarefaStatus.CANCELADO
  if (v.includes('realiz') || v.includes('conclu')) return TarefaStatus.CONCLUIDO
  if (v.includes('andamento')) return TarefaStatus.EM_ANDAMENTO
  return TarefaStatus.PENDENTE
}

const joinDesc = (...parts: (string | null | undefined)[]): string | null => {
  const t = parts.map((p) => (p ? String(p).trim() : '')).filter(Boolean).join(' · ')
  return t || null
}

type EventoFields = {
  tipo: string
  titulo: string
  descricao: string | null
  dataInicio: Date | null
  prazoData: Date | null
  status: TarefaStatus
  processoId: string
  responsavelId: string
  concluidoEm: Date | null
}

export const syncCompromissosExpedit = async (
  prisma: PrismaClient,
  client: ExpeditApiClient,
  deps?: CompromissosSyncDeps
): Promise<CompromissosSyncResult> => {
  const runId = randomUUID()
  let compromissosColetados = 0
  let audienciasColetadas = 0
  let expedientesColetados = 0
  let tarefasCriadas = 0
  let tarefasAtualizadas = 0
  let semResponsavelMapeado = 0

  const resolver = await createResponsavelResolver(prisma)
  const admin = resolver.admin
  if (!admin) {
    return {
      runId,
      phase: {
        processosVisitados: 0,
        compromissosColetados: 0,
        audienciasColetadas: 0,
        expedientesColetados: 0,
        tarefasCriadas: 0,
        tarefasAtualizadas: 0,
        semResponsavelMapeado: 0,
      },
    }
  }
  const advogadoIds = resolver.advogadoIds

  /** Resolve responsável: nome no texto → responsaveis[] → admin (fila de pré-triagem). */
  const resolveResp = (
    texto: string,
    responsaveis?: ResponsavelDTO[]
  ): { id: string; byTexto: string | null; fallback: boolean } => {
    const r = resolver.resolve(texto, responsaveis)
    if (r.fallback) semResponsavelMapeado += 1
    return r
  }

  const upsertEvento = async (
    externalId: string,
    f: EventoFields,
    resolved: { byTexto: string | null; fallback: boolean },
    processoNumero?: string
  ) => {
    const existing = await prisma.tarefa.findUnique({
      where: { expeditId: externalId },
      select: { id: true, responsavelId: true },
    })
    const tarefa = await prisma.tarefa.upsert({
      where: { expeditId: externalId },
      create: {
        expeditId: externalId,
        criadoPorId: admin.id,
        semResponsavel: resolved.fallback,
        ...f,
      },
      update: {
        tipo: f.tipo,
        titulo: f.titulo,
        descricao: f.descricao,
        dataInicio: f.dataInicio,
        prazoData: f.prazoData,
        status: f.status,
        processoId: f.processoId,
        concluidoEm: f.concluidoEm,
        // Re-direciona só quando o título indica um advogado; senão preserva
        // uma reatribuição manual feita na nossa plataforma. Tarefas que
        // continuam no admin sem match entram na fila de pré-triagem.
        ...(resolved.byTexto
          ? { responsavelId: resolved.byTexto, semResponsavel: false }
          : resolved.fallback && existing?.responsavelId === admin.id
            ? { semResponsavel: true }
            : {}),
      },
      select: { id: true },
    })
    if (existing) {
      tarefasAtualizadas += 1
    } else {
      tarefasCriadas += 1
      // Notifica o advogado quando uma tarefa NOVA é criada direcionada a ele.
      if (advogadoIds.has(f.responsavelId)) {
        await notificarTarefaDirecionada(prisma, {
          responsavelId: f.responsavelId,
          tarefaId: tarefa.id,
          titulo: f.titulo,
          processoNumero: processoNumero ?? null,
        })
      }
    }
  }

  // Rotação real (mesma lógica do sync de detalhes): visita primeiro os
  // processos há mais tempo sem leitura de agenda — `updatedAt desc` não
  // rotacionava porque o sync de processos reescreve updatedAt de todos.
  const processos = await prisma.processo.findMany({
    where: { expeditId: { not: null } },
    select: { id: true, expeditId: true, numero: true },
    orderBy: { agendaSyncedAt: { sort: 'asc', nulls: 'first' } },
    take: deps?.maxProcessos,
  })

  for (const proc of processos) {
    // Marca a visita antes de qualquer skip — é o que faz a janela rotacionar
    // (um id inválido ou agenda vazia não pode ocupar a janela para sempre).
    await prisma.processo
      .update({ where: { id: proc.id }, data: { agendaSyncedAt: new Date() } })
      .catch(() => {})

    const expeditId = Number(proc.expeditId)
    if (!Number.isFinite(expeditId)) continue

    const agenda = await client.getAgenda(expeditId).catch(() => null)
    if (!agenda) continue

    // ── Compromissos ──────────────────────────────────────────────────────
    for (const c of agenda.compromissos ?? []) {
      compromissosColetados += 1
      const cc = c as CompromissoDTO
      const texto = `${cc.titulo ?? ''} ${cc.descricao ?? ''}`
      const resolved = resolveResp(texto, cc.responsaveis)
      const prazoData = parseDate(cc.dataFim) ?? parseDate(cc.dataInicio)
      await upsertEvento(
        `expedit-comp:${cc.id}`,
        {
          tipo: String(cc.tipoTarefa?.titulo ?? cc.tipoTarefa?.nome ?? 'Compromisso'),
          titulo: String(cc.titulo ?? 'Compromisso').trim() || 'Compromisso',
          descricao: cc.descricao ? String(cc.descricao) : null,
          dataInicio: parseDate(cc.dataInicio),
          prazoData,
          status: mapStatusStr(cc.situacao, cc.concluido),
          processoId: proc.id,
          responsavelId: resolved.id,
          concluidoEm: cc.concluido ? prazoData : null,
        },
        resolved,
        proc.numero
      )
    }

    // ── Audiências ────────────────────────────────────────────────────────
    for (const a of agenda.audiencias ?? []) {
      audienciasColetadas += 1
      const aud = a as AudienciaDTO
      const titulo = `${aud.tipoAudiencia ?? 'Audiência'}${aud.sala ? ` — Sala ${aud.sala}` : ''}`
      const texto = `${titulo} ${(aud.responsaveis ?? []).map((r) => r.nome).join(' ')}`
      const resolved = resolveResp(texto, aud.responsaveis)
      const data = parseDate(aud.dataInicio) ?? parseDate(aud.dataFim)
      const status = mapStatusStr(aud.status)
      await upsertEvento(
        `expedit-aud:${aud.id}`,
        {
          tipo: 'Audiência',
          titulo: titulo.trim(),
          descricao: joinDesc(aud.horaInicio ? `Início ${aud.horaInicio}` : null, aud.status),
          dataInicio: data,
          prazoData: data,
          status,
          processoId: proc.id,
          responsavelId: resolved.id,
          concluidoEm: status === TarefaStatus.CONCLUIDO ? data : null,
        },
        resolved,
        proc.numero
      )
    }

    // ── Expedientes (prazos processuais) ──────────────────────────────────
    for (const e of agenda.expedientes ?? []) {
      expedientesColetados += 1
      const exp = e as ExpedienteDTO
      const titulo = exp.titulo
        ? String(exp.titulo)
        : `Prazo${exp.tipoLimite ? ` — ${exp.tipoLimite}` : ''}`
      const texto = `${titulo} ${exp.destinatario ?? ''} ${(exp.responsaveis ?? []).map((r) => r.nome).join(' ')}`
      const resolved = resolveResp(texto, exp.responsaveis)
      const prazoData = parseDate(exp.dataFim) ?? parseDate(exp.dataInicio)
      await upsertEvento(
        `expedit-exp:${exp.id}`,
        {
          tipo: 'Prazo',
          titulo: titulo.trim() || 'Prazo',
          descricao: joinDesc(
            exp.tipoLimite,
            exp.destinatario ? `Destinatário: ${exp.destinatario}` : null,
            exp.linkExpediente
          ),
          dataInicio: parseDate(exp.dataCiencia) ?? parseDate(exp.dataInicio),
          prazoData,
          status: TarefaStatus.PENDENTE,
          processoId: proc.id,
          responsavelId: resolved.id,
          concluidoEm: null,
        },
        resolved,
        proc.numero
      )
    }
  }

  return {
    runId,
    phase: {
      processosVisitados: processos.length,
      compromissosColetados,
      audienciasColetadas,
      expedientesColetados,
      tarefasCriadas,
      tarefasAtualizadas,
      semResponsavelMapeado,
    },
  }
}
