/**
 * Sincronização de detalhes por processo via API REST oficial do Expedit.
 *
 * Para cada processo já importado (com `expeditId`), busca a timeline completa de
 * andamentos e os documentos, persistindo de forma idempotente. É o complemento
 * de `sync-processos-expedit` (que só grava a última movimentação): aqui vem o
 * histórico que o app-v2 não expunha.
 *
 * Documentos são baixados de `linkDocumento` e arquivados (local + Drive),
 * reaproveitando `archiveDocument` e o `DriveArchiver`.
 */
import { randomUUID } from 'node:crypto'

import { FonteAndamento, type PrismaClient } from '@prisma/client'

import type { ExpeditApiClient } from '@/lib/expedit/expedit-api-client'
import { archiveDocument } from '@/lib/storage/document-archive'
import type { DriveArchiver } from '@/lib/storage/drive-archive'

export type DetalhesSyncDeps = {
  archiveBaseDir?: string
  driveArchiver?: DriveArchiver | null
  /** Limita quantos processos detalhar por execução (default: todos). */
  maxProcessos?: number
}

export type DetalhesSyncCounters = {
  processosVisitados: number
  andamentosCriados: number
  documentosPersistidos: number
  documentosBaixados: number
  downloadFailures: number
  archiveFailures: number
  driveFailures: number
}

export type DetalhesSyncResult = {
  runId: string
  phase: DetalhesSyncCounters
}

const parseDate = (raw?: string): Date | null => {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

export const syncDetalhesExpedit = async (
  prisma: PrismaClient,
  client: ExpeditApiClient,
  deps?: DetalhesSyncDeps
): Promise<DetalhesSyncResult> => {
  const runId = randomUUID()
  let andamentosCriados = 0
  let documentosPersistidos = 0
  let documentosBaixados = 0
  let downloadFailures = 0
  let archiveFailures = 0
  let driveFailures = 0

  // Processos importados do Expedit, em rotação real: visita primeiro os que
  // estão há mais tempo sem detalhamento (nulls first). O `updatedAt desc`
  // anterior NÃO rotacionava — o sync de processos reescreve updatedAt de
  // todos a cada ciclo, então a janela de `maxProcessos` pegava sempre os
  // mesmos; os demais nunca recebiam a timeline completa.
  const processos = await prisma.processo.findMany({
    where: { expeditId: { not: null } },
    select: { id: true, numero: true, expeditId: true, cliente: { select: { nome: true } } },
    orderBy: { detalhesSyncedAt: { sort: 'asc', nulls: 'first' } },
    take: deps?.maxProcessos,
  })

  for (const proc of processos) {
    const expeditId = Number(proc.expeditId)
    if (!Number.isFinite(expeditId)) {
      // Carimba mesmo sem id válido, senão o processo ocupa a janela para sempre.
      await prisma.processo
        .update({ where: { id: proc.id }, data: { detalhesSyncedAt: new Date() } })
        .catch(() => {})
      continue
    }

    // ── Andamentos (timeline completa) ──────────────────────────────────────
    const andamentos = await client.listarAndamentos(expeditId).catch(() => [])
    for (const a of andamentos) {
      if (a.deleted) continue
      const data = parseDate(a.dataAndamento)
      const descricao = String(a.andamento ?? '').trim()
      if (!data || !descricao) continue
      const externalId = `expedit-and:${a.id}`
      try {
        await prisma.andamento.upsert({
          where: { externalId },
          create: {
            processoId: proc.id,
            externalId,
            data,
            tipo: String(a.tipoAndamento ?? 'Andamento'),
            descricao,
            fonte: FonteAndamento.EXPEDIT,
          },
          update: { descricao, tipo: String(a.tipoAndamento ?? 'Andamento') },
        })
        andamentosCriados += 1
      } catch {
        // ignora colisões/erros pontuais
      }
    }

    // ── Documentos (baixa + arquiva) ────────────────────────────────────────
    const documentos = await client.listarDocumentos(expeditId).catch(() => [])
    for (const d of documentos) {
      const link = String(d.linkDocumento ?? '').trim()
      const externalId = d.idDocumento ? `expedit-doc:${d.idDocumento}` : `expedit-doc:${d.id}`

      const existing = await prisma.documento.findUnique({
        where: { externalId },
        select: { storagePath: true },
      })
      if (existing?.storagePath) continue // já arquivado
      if (!link) continue

      const download = await client.downloadDocumento(link).catch(() => null)
      if (!download) {
        downloadFailures += 1
        continue
      }
      documentosBaixados += 1

      const nome = String(d.documento ?? download.filename ?? 'documento.pdf').trim()
      let storagePath = ''
      let tamanhoBytes: bigint | null = null
      let driveFileId: string | null = null
      let driveLink: string | null = null

      try {
        const archive = await archiveDocument({
          baseDir: deps?.archiveBaseDir ?? 'tmp/pipeline-archive',
          clienteNome: proc.cliente.nome,
          processoNumero: proc.numero,
          documentoExternalId: externalId,
          documentoNome: nome,
          content: download.content,
        })
        storagePath = archive.storagePath
        tamanhoBytes = archive.tamanhoBytes
      } catch {
        archiveFailures += 1
      }

      if (deps?.driveArchiver) {
        try {
          const drive = await deps.driveArchiver.archive({
            clienteNome: proc.cliente.nome,
            processoNumero: proc.numero,
            documentoNome: nome,
            documentoExternalId: externalId,
            content: download.content,
          })
          driveFileId = drive.driveFileId
          driveLink = drive.driveLink
        } catch {
          driveFailures += 1
        }
      }

      await prisma.documento.upsert({
        where: { externalId },
        create: {
          externalId,
          processoId: proc.id,
          nome,
          tipo: d.tipoDocumento ?? null,
          storagePath,
          tamanhoBytes,
          driveFileId,
          driveLink,
        },
        update: { storagePath, tamanhoBytes, driveFileId, driveLink },
      })
      documentosPersistidos += 1
    }

    // Marca a visita — é o que faz a janela de `maxProcessos` rotacionar.
    await prisma.processo
      .update({ where: { id: proc.id }, data: { detalhesSyncedAt: new Date() } })
      .catch(() => {})
  }

  return {
    runId,
    phase: {
      processosVisitados: processos.length,
      andamentosCriados,
      documentosPersistidos,
      documentosBaixados,
      downloadFailures,
      archiveFailures,
      driveFailures,
    },
  }
}
