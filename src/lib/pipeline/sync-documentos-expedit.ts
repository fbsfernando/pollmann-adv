/**
 * Sincronização de documentos (módulo Atualizações › Documentos) do Expedit.
 *
 * O robô do Expedit já baixa os documentos juntados e os hospeda em
 * `doc.expedit.com.br` (CDN S3 público). Este pipeline lista os documentos de um
 * intervalo, baixa cada `link_documento` e arquiva localmente + no Google Drive
 * (estrutura cliente → processo → documento), reaproveitando `archiveDocument` e
 * o `DriveArchiver`. Persiste `Documento` de forma idempotente por `externalId`.
 *
 * Só processa documentos cujo processo já está cadastrado (a FK de `Documento`
 * exige `processoId`); os demais são contados como ignorados.
 */
import { randomUUID } from 'node:crypto'

import type { PrismaClient } from '@prisma/client'

import type { ExpeditClient, DataRange } from '@/lib/expedit/expedit-client'
import type { ExpeditDocumentoItem } from '@/lib/expedit/expedit-types'
import { archiveDocument } from '@/lib/storage/document-archive'
import type { DriveArchiver } from '@/lib/storage/drive-archive'

export type DocumentosSyncDeps = {
  archiveBaseDir?: string
  driveArchiver?: DriveArchiver | null
}

export type DocumentosSyncCounters = {
  collected: number
  comProcesso: number
  baixados: number
  persistidos: number
  ignoradosSemProcesso: number
  downloadFailures: number
  archiveFailures: number
  driveFailures: number
}

export type DocumentosSyncResult = {
  runId: string
  phase: DocumentosSyncCounters
}

/** externalId estável a partir do caminho público do documento. */
export const documentoExternalId = (link: string): string => {
  try {
    const u = new URL(link)
    return `expedit-doc:${u.pathname.replace(/^\/+/, '')}`
  } catch {
    return `expedit-doc:${link}`
  }
}

/** Nome de arquivo legível: usa o basename do link (já único, com extensão). */
const documentoNome = (item: ExpeditDocumentoItem, link: string): string => {
  const base = link.split('/').pop()?.split('?')[0]?.trim()
  if (base) return base
  const nome = String(item.documento ?? '').trim()
  return nome ? `${nome}.pdf` : 'documento.pdf'
}

export const syncDocumentosExpedit = async (
  prisma: PrismaClient,
  client: ExpeditClient,
  range: DataRange,
  deps?: DocumentosSyncDeps
): Promise<DocumentosSyncResult> => {
  const runId = randomUUID()

  let comProcesso = 0
  let baixados = 0
  let persistidos = 0
  let ignoradosSemProcesso = 0
  let downloadFailures = 0
  let archiveFailures = 0
  let driveFailures = 0

  const itens = await client.listAllDocumentos(range)

  // Cache numProcesso → { id, clienteNome } | null
  const processoCache = new Map<string, { id: string; clienteNome: string } | null>()
  const resolveProcesso = async (numero: string) => {
    if (!numero) return null
    if (processoCache.has(numero)) return processoCache.get(numero)!
    const found = await prisma.processo.findUnique({
      where: { numero },
      select: { id: true, cliente: { select: { nome: true } } },
    })
    const value = found ? { id: found.id, clienteNome: found.cliente.nome } : null
    processoCache.set(numero, value)
    return value
  }

  for (const item of itens) {
    const link = String(item.link_documento ?? '').trim()
    const numProcesso = String(item.numero_processo ?? '').trim()
    if (!link || !numProcesso) {
      ignoradosSemProcesso += 1
      continue
    }

    const processo = await resolveProcesso(numProcesso)
    if (!processo) {
      ignoradosSemProcesso += 1
      continue
    }
    comProcesso += 1

    const externalId = documentoExternalId(link)

    // Idempotência: se já arquivado (path local), não baixa de novo.
    const existing = await prisma.documento.findUnique({
      where: { externalId },
      select: { storagePath: true },
    })
    if (existing?.storagePath) continue

    let download
    try {
      download = await client.downloadDocumento(link)
    } catch {
      download = null
    }
    if (!download) {
      downloadFailures += 1
      continue
    }
    baixados += 1

    const nome = documentoNome(item, link)
    let storagePath = ''
    let tamanhoBytes: bigint | null = null
    let driveFileId: string | null = null
    let driveLink: string | null = null

    try {
      const archive = await archiveDocument({
        baseDir: deps?.archiveBaseDir ?? 'tmp/pipeline-archive',
        clienteNome: processo.clienteNome,
        processoNumero: numProcesso,
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
          clienteNome: processo.clienteNome,
          processoNumero: numProcesso,
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
        processoId: processo.id,
        nome,
        storagePath,
        tamanhoBytes,
        driveFileId,
        driveLink,
      },
      update: { storagePath, tamanhoBytes, driveFileId, driveLink },
    })
    persistidos += 1
  }

  return {
    runId,
    phase: {
      collected: itens.length,
      comProcesso,
      baixados,
      persistidos,
      ignoradosSemProcesso,
      downloadFailures,
      archiveFailures,
      driveFailures,
    },
  }
}
