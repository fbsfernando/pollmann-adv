/**
 * Arquivamento de documentos no Google Drive na estrutura padronizada
 * (reunião 13/04): pasta do cliente → pasta do processo → documento.
 *
 * Arquitetura:
 *  - A orquestração (montar caminho de pastas, garantir pastas idempotentes,
 *    deduplicar e fazer upload) é pura e recebe um `DriveApi` injetável — o que
 *    a torna testável sem bater no Drive real.
 *  - A construção do client `googleapis` (service account) vive em
 *    `createGoogleDriveApi`, chamada apenas em runtime.
 *  - `createDriveArchiver` é opt-in: retorna `null` quando o Drive não está
 *    configurado por variáveis de ambiente, preservando o fluxo atual (apenas
 *    arquivamento local em disco).
 */
import { Readable } from 'node:stream'

import { google } from 'googleapis'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Subconjunto mínimo da API do Drive que usamos — facilita testes com fake. */
export interface DriveApi {
  /** Procura uma subpasta por nome dentro de um parent. Retorna o id ou null. */
  findFolder(name: string, parentId: string): Promise<string | null>
  /** Cria uma subpasta e retorna o id. */
  createFolder(name: string, parentId: string): Promise<string>
  /** Procura um arquivo por nome dentro de um parent. */
  findFile(
    name: string,
    parentId: string
  ): Promise<{ id: string; webViewLink?: string | null } | null>
  /** Faz upload de um arquivo e retorna id + link de visualização. */
  uploadFile(input: {
    name: string
    parentId: string
    mimeType: string
    content: Buffer
  }): Promise<{ id: string; webViewLink?: string | null }>
}

export type DriveArchiveInput = {
  clienteNome: string
  processoNumero: string
  documentoNome: string
  documentoExternalId: string
  content: Buffer
}

export type DriveArchiveResult = {
  driveFileId: string
  driveLink: string | null
}

export interface DriveArchiver {
  archive(input: DriveArchiveInput): Promise<DriveArchiveResult>
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export const mimeFromName = (name: string): string => {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_BY_EXT[name.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

/** Nomes de pasta/arquivo legíveis, sem barras nem espaços redundantes. */
export const cleanName = (value: string, fallback: string): string => {
  const cleaned = value
    .replace(/[/\\]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}

/** Garante que uma subpasta existe (idempotente): busca, senão cria. */
const ensureFolder = async (
  api: DriveApi,
  name: string,
  parentId: string
): Promise<string> => {
  const existing = await api.findFolder(name, parentId)
  if (existing) return existing
  return api.createFolder(name, parentId)
}

/**
 * Orquestração pura do arquivamento no Drive. Garante
 * `<root>/<cliente>/<processo>/<documento>` e deduplica por nome de arquivo
 * dentro da pasta do processo.
 */
export const archiveToDrive = async (
  api: DriveApi,
  rootFolderId: string,
  input: DriveArchiveInput
): Promise<DriveArchiveResult> => {
  const clienteSeg = cleanName(input.clienteNome, 'cliente-sem-nome')
  const processoSeg = cleanName(input.processoNumero, 'processo-sem-numero')
  const fileName = cleanName(input.documentoNome, input.documentoExternalId)

  const clienteFolder = await ensureFolder(api, clienteSeg, rootFolderId)
  const processoFolder = await ensureFolder(api, processoSeg, clienteFolder)

  const existing = await api.findFile(fileName, processoFolder)
  if (existing) {
    return { driveFileId: existing.id, driveLink: existing.webViewLink ?? null }
  }

  const created = await api.uploadFile({
    name: fileName,
    parentId: processoFolder,
    mimeType: mimeFromName(fileName),
    content: input.content,
  })
  return { driveFileId: created.id, driveLink: created.webViewLink ?? null }
}

// ─── Client googleapis (runtime) ──────────────────────────────────────────────

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive']

/**
 * Constrói um `DriveApi` real a partir de uma service account. Credenciais via:
 *  - `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` (conteúdo JSON inline), ou
 *  - `GOOGLE_APPLICATION_CREDENTIALS` (caminho do arquivo JSON — padrão do SDK).
 */
export const createGoogleDriveApi = (): DriveApi => {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON
  const auth = inline
    ? (() => {
        const creds = JSON.parse(inline) as { client_email: string; private_key: string }
        return new google.auth.JWT({
          email: creds.client_email,
          key: creds.private_key,
          scopes: DRIVE_SCOPES,
        })
      })()
    : new google.auth.GoogleAuth({ scopes: DRIVE_SCOPES })

  // `auth` aceita tanto JWT quanto GoogleAuth; o tipo do client é union.
  const drive = google.drive({ version: 'v3', auth: auth as never })

  const escapeQuery = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

  return {
    async findFolder(name, parentId) {
      const res = await drive.files.list({
        q: `mimeType = '${FOLDER_MIME}' and name = '${escapeQuery(name)}' and '${parentId}' in parents and trashed = false`,
        fields: 'files(id)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      return res.data.files?.[0]?.id ?? null
    },
    async createFolder(name, parentId) {
      const res = await drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
        fields: 'id',
        supportsAllDrives: true,
      })
      const id = res.data.id
      if (!id) throw new Error('Drive: createFolder não retornou id')
      return id
    },
    async findFile(name, parentId) {
      const res = await drive.files.list({
        q: `name = '${escapeQuery(name)}' and '${parentId}' in parents and trashed = false`,
        fields: 'files(id, webViewLink)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      const f = res.data.files?.[0]
      return f?.id ? { id: f.id, webViewLink: f.webViewLink } : null
    },
    async uploadFile({ name, parentId, mimeType, content }) {
      const res = await drive.files.create({
        requestBody: { name, parents: [parentId] },
        media: { mimeType, body: bufferToStream(content) },
        fields: 'id, webViewLink',
        supportsAllDrives: true,
      })
      const id = res.data.id
      if (!id) throw new Error('Drive: uploadFile não retornou id')
      return { id, webViewLink: res.data.webViewLink }
    },
  }
}

/** Converte Buffer em stream legível (a media body do googleapis exige stream). */
const bufferToStream = (buffer: Buffer) => Readable.from(buffer)

/**
 * Factory opt-in. Retorna `null` quando o Drive não está configurado
 * (`GOOGLE_DRIVE_ROOT_FOLDER_ID` ausente), preservando o arquivamento só-local.
 */
export const createDriveArchiver = (
  apiFactory: () => DriveApi = createGoogleDriveApi
): DriveArchiver | null => {
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  if (!rootFolderId) return null

  const hasCreds =
    !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON ||
    !!process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!hasCreds) {
    console.warn(
      '[drive-archive] GOOGLE_DRIVE_ROOT_FOLDER_ID definido mas faltam credenciais ' +
        '(GOOGLE_SERVICE_ACCOUNT_KEY_JSON ou GOOGLE_APPLICATION_CREDENTIALS) — Drive desativado'
    )
    return null
  }

  const api = apiFactory()
  return {
    archive: (input) => archiveToDrive(api, rootFolderId, input),
  }
}
