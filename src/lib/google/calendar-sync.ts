/**
 * Sincronização unidirecional Agenda → Google Calendar.
 *
 * Espelha tarefas ABERTAS com data (prazoData/dataInicio) como eventos de dia
 * inteiro no calendário da conta autorizada (o principal, ou o definido em
 * GOOGLE_CALENDAR_ID). Idempotente via `Tarefa.googleEventId`:
 *   - sem googleEventId → insere evento e grava o id
 *   - com googleEventId → atualiza (patch)
 *   - CONCLUIDO/CANCELADO com googleEventId → remove o evento (agenda limpa)
 *
 * Opt-in como o Drive: sem GOOGLE_OAUTH_* no ambiente, não faz nada.
 * O escopo usado é `calendar.events` (não permite criar calendários — por isso
 * o default é o calendário `primary`).
 */
import { google, type calendar_v3 } from 'googleapis'
import { TarefaStatus, type PrismaClient } from '@prisma/client'

export type CalendarSyncResult = {
  enabled: boolean
  criados: number
  atualizados: number
  removidos: number
  falhas: number
}

const DISABLED: CalendarSyncResult = { enabled: false, criados: 0, atualizados: 0, removidos: 0, falhas: 0 }

const createClient = (): calendar_v3.Calendar | null => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null
  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return google.calendar({ version: 'v3', auth })
}

/** "YYYY-MM-DD" (evento de dia inteiro) a partir da data da tarefa. */
const toDateStr = (d: Date): string => d.toISOString().slice(0, 10)

export async function runCalendarSync(prisma: PrismaClient): Promise<CalendarSyncResult> {
  const cal = createClient()
  if (!cal) return DISABLED

  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary'
  let criados = 0
  let atualizados = 0
  let removidos = 0
  let falhas = 0

  // 1) Tarefas abertas com data → upsert de evento.
  const abertas = await prisma.tarefa.findMany({
    where: {
      status: { in: [TarefaStatus.PENDENTE, TarefaStatus.EM_ANDAMENTO] },
      OR: [{ prazoData: { not: null } }, { dataInicio: { not: null } }],
    },
    select: {
      id: true,
      titulo: true,
      tipo: true,
      descricao: true,
      prazoData: true,
      dataInicio: true,
      googleEventId: true,
      processo: { select: { numero: true } },
      responsavel: { select: { name: true, email: true } },
    },
    take: 1000,
  })

  for (const t of abertas) {
    const data = t.prazoData ?? t.dataInicio
    if (!data) continue
    const dateStr = toDateStr(new Date(data))
    const body: calendar_v3.Schema$Event = {
      summary: `[${t.tipo}] ${t.titulo}`,
      description: [
        t.processo ? `Processo ${t.processo.numero}` : null,
        `Responsável: ${t.responsavel.name ?? t.responsavel.email}`,
        t.descricao,
      ]
        .filter(Boolean)
        .join('\n'),
      start: { date: dateStr },
      end: { date: dateStr },
    }
    try {
      if (t.googleEventId) {
        await cal.events.patch({ calendarId, eventId: t.googleEventId, requestBody: body })
        atualizados += 1
      } else {
        const res = await cal.events.insert({ calendarId, requestBody: body })
        if (res.data.id) {
          await prisma.tarefa.update({ where: { id: t.id }, data: { googleEventId: res.data.id } })
        }
        criados += 1
      }
    } catch (e) {
      // Evento apagado manualmente no Google (404/410) → recria no próximo ciclo.
      const status = (e as { status?: number; code?: number }).status ?? (e as { code?: number }).code
      if (t.googleEventId && (status === 404 || status === 410)) {
        await prisma.tarefa.update({ where: { id: t.id }, data: { googleEventId: null } })
      }
      falhas += 1
    }
  }

  // 2) Tarefas encerradas que ainda têm evento → remove do calendário.
  const encerradas = await prisma.tarefa.findMany({
    where: {
      status: { in: [TarefaStatus.CONCLUIDO, TarefaStatus.CANCELADO] },
      googleEventId: { not: null },
    },
    select: { id: true, googleEventId: true },
    take: 1000,
  })

  for (const t of encerradas) {
    try {
      await cal.events.delete({ calendarId, eventId: t.googleEventId! }).catch((e) => {
        const status = (e as { status?: number; code?: number }).status ?? (e as { code?: number }).code
        if (status !== 404 && status !== 410) throw e
      })
      await prisma.tarefa.update({ where: { id: t.id }, data: { googleEventId: null } })
      removidos += 1
    } catch {
      falhas += 1
    }
  }

  return { enabled: true, criados, atualizados, removidos, falhas }
}
