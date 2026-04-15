import { NextResponse } from 'next/server'
import { Tribunal } from '@prisma/client'

import { requireAuth } from '@/lib/auth/guards'
import { prisma } from '@/lib/db'
import { resolveEprocProcessLink } from '@/lib/scraper/eproc-http'

const getEnv = (key: string): string => {
  const value = process.env[key]
  if (!value) throw new Error(`Variável de ambiente ausente: ${key}`)
  return value
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await requireAuth()

  const { id } = await context.params

  const processo = await prisma.processo.findUnique({
    where: { id },
    select: { numero: true, tribunal: true },
  })

  if (!processo) {
    return NextResponse.json({ error: 'Processo não encontrado' }, { status: 404 })
  }

  if (processo.tribunal !== Tribunal.TJSC && processo.tribunal !== Tribunal.TJRS) {
    return NextResponse.json(
      { error: 'Link direto disponível apenas para processos TJSC/TJRS' },
      { status: 400 }
    )
  }

  const tribunal = processo.tribunal as 'TJSC' | 'TJRS'

  try {
    const link = await resolveEprocProcessLink(
      {
        tribunal,
        usuario: getEnv(`EPROC_${tribunal}_USER`),
        senha: getEnv(`EPROC_${tribunal}_PASSWORD`),
        totpSeed: getEnv(`EPROC_${tribunal}_TOTP_SEED`),
        timeout: 45000,
        proxyUrl: process.env[`EPROC_${tribunal}_PROXY_URL`] ?? process.env.EPROC_PROXY_URL,
      },
      processo.numero
    )

    if (!link) {
      return NextResponse.json(
        { error: 'Processo não encontrado na relação atual do E-PROC' },
        { status: 404 }
      )
    }

    return NextResponse.redirect(link)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Falha ao resolver link do E-PROC',
      },
      { status: 500 }
    )
  }
}
