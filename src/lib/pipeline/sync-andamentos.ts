import { randomUUID } from 'node:crypto'

import { FonteAndamento, type PrismaClient } from '@prisma/client'

import { archiveDocument } from '@/lib/storage/document-archive'
import { notifyNovoAndamento } from '@/lib/notifications/notify-novo-andamento'
import { detectNewItems } from '@/lib/pipeline/detect-new-items'
import type { EprocClient } from '@/lib/scraper/eproc-client'
import type { SyncResult } from '@/lib/pipeline/types'

export type SyncRuntimeDeps = {
  archiveBaseDir: string
  loadDocumentContent?: (externalId: string) => Promise<Buffer>
  notificationSender?: (input: {
    processoNumero: string
    andamentoExternalId: string
    andamentoDescricao: string
    documentoPath?: string | null
  }) => Promise<{ messageId?: string }>
}

const defaultLoadDocumentContent = async (externalId: string): Promise<Buffer> =>
  Buffer.from(`document:${externalId}`)

export const syncAndamentos = async (
  prisma: PrismaClient,
  client: EprocClient,
  deps?: SyncRuntimeDeps
): Promise<SyncResult> => {
  const runId = randomUUID()

  const snapshot = await client.collectSnapshot()
  const diff = await detectNewItems(prisma, snapshot.andamentos)

  let persistedAndamentos = 0
  let persistedDocumentos = 0
  let archiveFailures = 0
  let notificationFailures = 0

  const loadDocumentContent = deps?.loadDocumentContent ?? defaultLoadDocumentContent

  for (const candidate of diff.candidates) {
    // Busca dados do processo antes da transação (necessário para o path de archive)
    const processo = await prisma.processo.findUnique({
      where: { id: candidate.processoId },
      include: { cliente: true },
    })

    // Passo 1: Arquiva documentos (I/O de arquivo fora da transação BD)
    type DocArchiveEntry = {
      doc: (typeof candidate.andamento.documentos)[number]
      archivePath: string
    }
    const docEntries: DocArchiveEntry[] = []

    for (const doc of candidate.andamento.documentos) {
      let archivePath = doc.storagePath ?? ''

      const inlineContent = (doc as { content?: Buffer }).content
      const contentSource = inlineContent
        ? Promise.resolve(inlineContent)
        : loadDocumentContent(doc.externalId)

      try {
        const content = await contentSource
        const archive = await archiveDocument({
          baseDir: deps?.archiveBaseDir ?? 'tmp/pipeline-archive',
          clienteNome: processo?.cliente.nome ?? 'cliente-desconhecido',
          processoNumero: candidate.andamento.processoNumero,
          documentoExternalId: doc.externalId,
          documentoNome: doc.nome,
          content,
        })
        archivePath = archive.storagePath
      } catch {
        archiveFailures += 1
      }

      docEntries.push({ doc, archivePath })
    }

    // Passo 2: Persiste andamento + documentos atomicamente
    const persistedDocPaths: string[] = []

    await prisma.$transaction(async (tx) => {
      const created = await tx.andamento.create({
        data: {
          processoId: candidate.processoId,
          externalId: candidate.andamento.externalId,
          data: candidate.andamento.data,
          tipo: candidate.andamento.tipo,
          descricao: candidate.andamento.descricao,
          fonte: FonteAndamento.SCRAPER,
        },
      })

      for (const { doc, archivePath } of docEntries) {
        await tx.documento.upsert({
          where: { externalId: doc.externalId },
          create: {
            externalId: doc.externalId,
            andamentoId: created.id,
            processoId: candidate.processoId,
            nome: doc.nome,
            tipo: doc.tipo,
            tamanhoBytes: doc.tamanhoBytes,
            storagePath: archivePath,
          },
          update: {
            andamentoId: created.id,
            processoId: candidate.processoId,
            nome: doc.nome,
            tipo: doc.tipo,
            tamanhoBytes: doc.tamanhoBytes,
            storagePath: archivePath,
          },
        })

        if (archivePath) persistedDocPaths.push(archivePath)
      }
    })

    persistedAndamentos += 1
    persistedDocumentos += docEntries.length

    if (deps?.notificationSender) {
      const notification = await notifyNovoAndamento(deps.notificationSender, {
        processoNumero: candidate.andamento.processoNumero,
        andamentoExternalId: candidate.andamento.externalId,
        andamentoDescricao: candidate.andamento.descricao,
        documentoPath: persistedDocPaths[0] ?? null,
      })

      if (notification.status === 'pending') {
        notificationFailures += 1
      }
    }
  }

  const validCount = snapshot.andamentos.length - diff.skippedInvalid.length

  return {
    runId,
    phase: {
      collected: snapshot.andamentos.length,
      valid: validCount,
      invalid: diff.skippedInvalid.length,
      newItems: diff.candidates.length,
      skippedUnknownProcesso: diff.skippedUnknownProcesso,
      persistedAndamentos,
      persistedDocumentos,
      archiveFailures,
      notificationFailures,
    },
  }
}
