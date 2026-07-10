/**
 * Sincronização de publicações (módulo Atualizações) do Expedit.
 *
 * Para um intervalo de datas: lista os grupos de publicações, depois os itens de
 * cada diário e faz upsert de `Publicacao` por `externalId` (= hash_publicacao),
 * de forma idempotente — mesmo espírito de `detectNewItems`, mas com loop próprio
 * porque publicações podem existir sem `Processo` cadastrado (processoId nullable).
 *
 * Quando a publicação referencia um processo já cadastrado e traz inteiro-teor,
 * o documento é (opcionalmente) baixado do Expedit e arquivado reaproveitando
 * `archiveDocument` + Google Drive, persistindo um `Documento`. Para publicações
 * de processos não cadastrados só a `Publicacao` é gravada (FK de Documento exige
 * processo).
 */
import { randomUUID } from 'node:crypto'

import { PublicacaoStatus, type PrismaClient } from '@prisma/client'

import type { ExpeditClient, DataRange } from '@/lib/expedit/expedit-client'
import type { ExpeditPublicacaoItem } from '@/lib/expedit/expedit-types'
import { parsePublicacaoConteudo } from '@/lib/expedit/expedit-parse'
import { archiveDocument } from '@/lib/storage/document-archive'
import type { DriveArchiver } from '@/lib/storage/drive-archive'

export type PublicacoesSyncDeps = {
  /** Diretório base de arquivamento local de documentos. */
  archiveBaseDir?: string
  /** Arquivador opcional do Google Drive. */
  driveArchiver?: DriveArchiver | null
  /** Habilita download/arquivamento do inteiro-teor (default: só quando há destino). */
  archiveDocumentos?: boolean
}

export type PublicacoesSyncCounters = {
  collectedGrupos: number
  collectedItens: number
  publicacoesCriadas: number
  publicacoesAtualizadas: number
  vinculadasAProcesso: number
  documentosArquivados: number
  archiveFailures: number
  driveFailures: number
}

export type PublicacoesSyncResult = {
  runId: string
  phase: PublicacoesSyncCounters
}

/** Aceita "dd/mm/yyyy[ hh:mm]" ou "yyyy-mm-dd[...]". Retorna null se inválida. */
export const parseExpeditDate = (raw?: string | null): Date | null => {
  if (!raw) return null
  const s = String(raw).trim()
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/)
  if (m) {
    const [, d, mo, y, h = '00', min = '00'] = m
    const date = new Date(`${y}-${mo}-${d}T${h}:${min}:00.000Z`)
    return Number.isNaN(date.getTime()) ? null : date
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const fallback = new Date(s)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

const pickExternalId = (item: ExpeditPublicacaoItem): string =>
  String(item.hash_publicacao ?? item.cod_publicacao ?? '').trim()

const pickNumProcesso = (item: ExpeditPublicacaoItem): string =>
  String(item.num_processo ?? item.numero_processo ?? '').trim()

export const syncPublicacoesExpedit = async (
  prisma: PrismaClient,
  client: ExpeditClient,
  range: DataRange,
  deps?: PublicacoesSyncDeps
): Promise<PublicacoesSyncResult> => {
  const runId = randomUUID()

  let collectedItens = 0
  let publicacoesCriadas = 0
  let publicacoesAtualizadas = 0
  let vinculadasAProcesso = 0
  let documentosArquivados = 0
  let archiveFailures = 0
  let driveFailures = 0

  const grupos = await client.listPublicacaoGrupos(range)

  // Cache numProcesso → { id, clienteNome } | null
  const processoCache = new Map<
    string,
    { id: string; clienteNome: string } | null
  >()

  const resolveProcesso = async (numProcesso: string) => {
    if (!numProcesso) return null
    if (processoCache.has(numProcesso)) return processoCache.get(numProcesso)!
    const found = await prisma.processo.findUnique({
      where: { numero: numProcesso },
      select: { id: true, cliente: { select: { nome: true } } },
    })
    const value = found ? { id: found.id, clienteNome: found.cliente.nome } : null
    processoCache.set(numProcesso, value)
    return value
  }

  const wantsArchive =
    deps?.archiveDocumentos ?? !!(deps?.driveArchiver || deps?.archiveBaseDir)

  for (const grupo of grupos) {
    const uf = String(grupo.estado ?? grupo.uf ?? '').trim()
    const sigla = String(grupo.sigla_diario ?? grupo.siglaDiario ?? '').trim()
    // O endpoint de itens filtra por `Data` = data de publicação do grupo. A listagem
    // expõe `data_publicacao`/`data_disponibilizacao` (não `Data`/`data`).
    const dataStr = String(
      grupo.data_publicacao ?? grupo.data_disponibilizacao ?? grupo.Data ?? grupo.data ?? ''
    ).trim()
    const data = parseExpeditDate(dataStr) ?? range.from

    if (!uf || !sigla) continue

    const itens = await client.listPublicacoesDoDiario({ data, uf, sigla, range })
    collectedItens += itens.length

    for (const item of itens) {
      const externalId = pickExternalId(item)
      if (!externalId) continue

      const numProcesso = pickNumProcesso(item)
      const parsed = parsePublicacaoConteudo(item.conteudo_publicacao)
      const dataPublicacao =
        parseExpeditDate(item.data_publicacao ?? item.Data) ?? data
      const dataDisponibilizacao = parseExpeditDate(item.data_disponibilizacao)

      const processo = await resolveProcesso(numProcesso)

      // Estado de triagem no Expedit: `status` explícito (TRATADA/DESCARTADA,
      // via modal de descarte) ou `lido: 1` (botão concluir). Importado para
      // manter os dois sistemas coerentes quando o Richard trata por lá.
      const expeditStatus =
        item.status === 'DESCARTADA'
          ? PublicacaoStatus.DESCARTADA
          : item.status === 'TRATADA' || Number(item.lido) === 1
            ? PublicacaoStatus.TRATADA
            : null

      const dataFields = {
        expeditRef: item._id ? String(item._id) : null,
        processoId: processo?.id ?? null,
        numProcesso,
        siglaDiario: sigla || (item.sigla_diario ?? null),
        nomeDiario: (item.nome_diario as string) ?? grupo.nome_diario ?? null,
        esfera: (item.esfera_diario as string) ?? grupo.esfera_diario ?? null,
        uf: uf || (item.uf as string) || null,
        comarca: (item.comarca as string) ?? null,
        orgao: (item.orgao as string) ?? null,
        vara: (item.vara as string) ?? null,
        dataPublicacao,
        dataDisponibilizacao,
        tipoComunicacao: parsed.tipoComunicacao,
        conteudo: parsed.textoLimpo || String(item.conteudo_publicacao ?? ''),
        inteiroTeorUrl: parsed.inteiroTeorUrl,
        insightIa: (item.insight_ia as string) ?? null,
      }

      const existing = await prisma.publicacao.findUnique({
        where: { externalId },
        select: { id: true, status: true },
      })

      await prisma.publicacao.upsert({
        where: { externalId },
        create: {
          externalId,
          ...dataFields,
          ...(expeditStatus ? { status: expeditStatus } : {}),
        },
        update: {
          expeditRef: dataFields.expeditRef,
          processoId: dataFields.processoId,
          inteiroTeorUrl: dataFields.inteiroTeorUrl,
          tipoComunicacao: dataFields.tipoComunicacao,
          // Só promove PENDENTE → estado do Expedit; nunca rebaixa triagem local
          // (tratada aqui continua tratada mesmo se lá ainda constar pendente).
          ...(expeditStatus && existing?.status === PublicacaoStatus.PENDENTE
            ? { status: expeditStatus }
            : {}),
        },
      })

      if (existing) publicacoesAtualizadas += 1
      else publicacoesCriadas += 1
      if (processo) vinculadasAProcesso += 1

      // Arquivamento opcional do inteiro-teor (só para processo conhecido).
      if (wantsArchive && processo && parsed.inteiroTeorUrl) {
        const docExternalId = `expedit-pub-${externalId}`
        try {
          const download = await client.downloadDocumento(parsed.inteiroTeorUrl)
          if (download) {
            const baseDir = deps?.archiveBaseDir ?? 'tmp/pipeline-archive'
            const archive = await archiveDocument({
              baseDir,
              clienteNome: processo.clienteNome,
              processoNumero: numProcesso,
              documentoExternalId: docExternalId,
              documentoNome: download.filename,
              content: download.content,
            })

            let driveFileId: string | null = null
            let driveLink: string | null = null
            if (deps?.driveArchiver) {
              try {
                const drive = await deps.driveArchiver.archive({
                  clienteNome: processo.clienteNome,
                  processoNumero: numProcesso,
                  documentoNome: download.filename,
                  documentoExternalId: docExternalId,
                  content: download.content,
                })
                driveFileId = drive.driveFileId
                driveLink = drive.driveLink
              } catch {
                driveFailures += 1
              }
            }

            await prisma.documento.upsert({
              where: { externalId: docExternalId },
              create: {
                externalId: docExternalId,
                processoId: processo.id,
                nome: download.filename,
                storagePath: archive.storagePath,
                tamanhoBytes: archive.tamanhoBytes,
                driveFileId,
                driveLink,
              },
              update: {
                storagePath: archive.storagePath,
                tamanhoBytes: archive.tamanhoBytes,
                driveFileId,
                driveLink,
              },
            })
            documentosArquivados += 1
          }
        } catch {
          archiveFailures += 1
        }
      }
    }
  }

  return {
    runId,
    phase: {
      collectedGrupos: grupos.length,
      collectedItens,
      publicacoesCriadas,
      publicacoesAtualizadas,
      vinculadasAProcesso,
      documentosArquivados,
      archiveFailures,
      driveFailures,
    },
  }
}
