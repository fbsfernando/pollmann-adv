import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

type ArchiveInput = {
  baseDir: string
  clienteNome: string
  processoNumero: string
  documentoExternalId: string
  documentoNome: string
  content: Buffer
}

export type ArchiveResult = {
  storagePath: string
  tamanhoBytes: bigint
  checksumSha256: string
}

const sanitizeSegment = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

const extFromName = (name: string): string => {
  const ext = path.extname(name || '').trim()
  return ext || '.bin'
}

export const buildArchiveRelativePath = (params: {
  clienteNome: string
  processoNumero: string
  documentoExternalId: string
  documentoNome: string
}): string => {
  const cliente = sanitizeSegment(params.clienteNome) || 'cliente-sem-nome'
  const processo = sanitizeSegment(params.processoNumero) || 'processo-sem-numero'
  const externalId = sanitizeSegment(params.documentoExternalId) || 'documento'
  const ext = extFromName(params.documentoNome)

  const fileName = `${externalId}${ext}`

  return path.posix.join(cliente, processo, fileName)
}

export const archiveDocument = async (input: ArchiveInput): Promise<ArchiveResult> => {
  const relativePath = buildArchiveRelativePath({
    clienteNome: input.clienteNome,
    processoNumero: input.processoNumero,
    documentoExternalId: input.documentoExternalId,
    documentoNome: input.documentoNome,
  })

  const absolutePath = path.join(input.baseDir, relativePath)

  // Proteção contra path traversal: garante que o arquivo resolve dentro de baseDir
  const resolvedBase = path.resolve(input.baseDir)
  const resolvedFile = path.resolve(absolutePath)
  if (!resolvedFile.startsWith(resolvedBase + path.sep) && resolvedFile !== resolvedBase) {
    throw new Error(`Path traversal detectado: "${relativePath}" escapa do diretório base`)
  }

  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, input.content)

  const checksumSha256 = createHash('sha256').update(input.content).digest('hex')

  return {
    storagePath: relativePath,
    tamanhoBytes: BigInt(input.content.byteLength),
    checksumSha256,
  }
}
