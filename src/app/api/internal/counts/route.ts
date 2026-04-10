import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

export async function GET(req: NextRequest) {
  if (req.headers.get('x-load-secret') !== process.env.LOAD_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const p = new PrismaClient()
  const [clientes, processos, andamentos, documentos, docsSemArquivo] = await Promise.all([
    p.cliente.count(),
    p.processo.count(),
    p.andamento.count(),
    p.documento.count(),
    p.documento.count({ where: { storagePath: { startsWith: 'eproc/' } } }),
  ])
  await p.$disconnect()

  return NextResponse.json({
    clientes,
    processos,
    andamentos,
    documentos,
    arquivos_pendentes: docsSemArquivo,
    arquivos_baixados: documentos - docsSemArquivo,
  })
}
