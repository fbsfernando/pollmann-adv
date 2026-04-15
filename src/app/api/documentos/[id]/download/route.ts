import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { requireAuth } from '@/lib/auth/guards'
import { prisma } from '@/lib/db'
import { downloadEprocDocument } from '@/lib/scraper/eproc-http'
import { archiveDocument } from '@/lib/storage/document-archive'

const getEnv = (key: string): string => {
  const value = process.env[key]
  if (!value) throw new Error(`Variável de ambiente ausente: ${key}`)
  return value
}

const ARCHIVE_BASE = process.env.PIPELINE_ARCHIVE_DIR ?? './storage/archive'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireAuth()
  const { id } = await context.params

  const doc = await prisma.documento.findUnique({
    where: { id },
    include: {
      processo: {
        select: { numero: true, tribunal: true, cliente: { select: { nome: true } } },
      },
    },
  })

  if (!doc) {
    return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 })
  }

  // ── 1. Serve do acervo local se já arquivado ────────────────────────────────
  if (doc.storagePath && !doc.storagePath.startsWith('eproc/')) {
    const resolvedBase = path.resolve(ARCHIVE_BASE)
    const absolutePath = path.resolve(ARCHIVE_BASE, doc.storagePath)
    if (!absolutePath.startsWith(resolvedBase + path.sep) && absolutePath !== resolvedBase) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }
    const fileBuffer = await readFile(absolutePath).catch(() => null)

    if (fileBuffer) {
      const filename = path.basename(doc.storagePath)
      return new NextResponse(fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      ) as ArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.nome || filename)}"`,
          'Content-Length': String(fileBuffer.byteLength),
          'X-Archive-Source': 'local',
        },
      })
    }

    // Arquivo sumiu do disco — recai no E-PROC abaixo
    console.warn(`[download] storagePath existe mas arquivo não encontrado: ${doc.storagePath}`)
  }

  // ── 2. Fallback: busca do E-PROC (só TJSC/TJRS) ────────────────────────────
  const tribunal = doc.processo.tribunal
  if (tribunal !== 'TJSC' && tribunal !== 'TJRS') {
    return NextResponse.json(
      { error: 'Documento não arquivado e tribunal não suporta download direto' },
      { status: 400 }
    )
  }

  try {
    const result = await downloadEprocDocument(
      {
        tribunal: tribunal as 'TJSC' | 'TJRS',
        usuario: getEnv(`EPROC_${tribunal}_USER`),
        senha: getEnv(`EPROC_${tribunal}_PASSWORD`),
        totpSeed: getEnv(`EPROC_${tribunal}_TOTP_SEED`),
        timeout: 60000,
        proxyUrl: process.env[`EPROC_${tribunal}_PROXY_URL`] ?? process.env.EPROC_PROXY_URL,
      },
      doc.externalId,
      doc.processo.numero
    )

    if (!result) {
      return NextResponse.json(
        { error: 'Documento não pôde ser obtido do E-PROC' },
        { status: 502 }
      )
    }

    // Arquiva para não precisar ir ao E-PROC de novo
    try {
      const archive = await archiveDocument({
        baseDir: ARCHIVE_BASE,
        clienteNome: doc.processo.cliente.nome,
        processoNumero: doc.processo.numero,
        documentoExternalId: doc.externalId,
        documentoNome: result.filename,
        content: result.content,
      })

      await prisma.documento.update({
        where: { id },
        data: {
          storagePath: archive.storagePath,
          tamanhoBytes: archive.tamanhoBytes,
          nome: result.filename !== 'documento.pdf' ? result.filename : doc.nome,
        },
      })
    } catch (e) {
      console.warn('[download] Falha ao arquivar documento após download do E-PROC:', e)
    }

    return new NextResponse(result.content.buffer.slice(
      result.content.byteOffset,
      result.content.byteOffset + result.content.byteLength
    ) as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
        'Content-Length': String(result.content.byteLength),
        'X-Archive-Source': 'eproc-live',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao baixar documento' },
      { status: 500 }
    )
  }
}
