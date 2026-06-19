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

import { primeiraParteNome } from '@/lib/storage/document-archive'

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
  const clienteSeg = cleanName(primeiraParteNome(input.clienteNome), 'cliente-sem-nome')
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

// Escopo `drive.file`: o app só acessa arquivos/pastas que ELE criou. É um escopo
// não-sensível — não exige verificação do Google e o refresh token não expira em
// 7 dias (ao contrário do escopo `drive` amplo). Por isso a pasta-raiz é criada
// pelo próprio app (ver createDriveArchiver).
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file']

/**
 * Monta o cliente de autenticação. Ordem de precedência:
 *  1. OAuth de usuário real (Gmail pessoal): GOOGLE_OAUTH_CLIENT_ID/SECRET +
 *     GOOGLE_OAUTH_REFRESH_TOKEN — arquivos ficam de posse do usuário e usam a
 *     cota dele. (Service account não tem cota de Drive própria.)
 *  2. Service account inline (Workspace/Shared Drive): GOOGLE_SERVICE_ACCOUNT_KEY_JSON.
 *  3. Application Default Credentials: GOOGLE_APPLICATION_CREDENTIALS.
 */
const buildDriveAuth = () => {
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (refreshToken) {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    )
    oauth2.setCredentials({ refresh_token: refreshToken })
    return oauth2
  }
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON
  if (inline) {
    const creds = JSON.parse(inline) as { client_email: string; private_key: string }
    return new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: DRIVE_SCOPES,
    })
  }
  return new google.auth.GoogleAuth({ scopes: DRIVE_SCOPES })
}

export const createGoogleDriveApi = (): DriveApi => {
  // `auth` pode ser OAuth2, JWT ou GoogleAuth; o tipo do client é union.
  const drive = google.drive({ version: 'v3', auth: buildDriveAuth() as never })

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
 * Factory opt-in. Retorna `null` quando não há credenciais do Drive configuradas,
 * preservando o arquivamento só-local.
 *
 * Credenciais aceitas (qualquer uma habilita):
 *  - OAuth de usuário: GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET +
 *    GOOGLE_OAUTH_REFRESH_TOKEN (caminho para Gmail pessoal)
 *  - Service account: GOOGLE_SERVICE_ACCOUNT_KEY_JSON ou GOOGLE_APPLICATION_CREDENTIALS
 *
 * Pasta-raiz: usa GOOGLE_DRIVE_ROOT_FOLDER_ID se informado (ex.: Shared Drive);
 * caso contrário, o app cria/reutiliza uma pasta pelo nome GOOGLE_DRIVE_ROOT_FOLDER_NAME
 * (default "Acervo Jurídico ADV") na raiz do Drive — necessário com escopo drive.file.
 */
export const createDriveArchiver = (
  apiFactory: () => DriveApi = createGoogleDriveApi
): DriveArchiver | null => {
  const hasOAuth =
    !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN &&
    !!process.env.GOOGLE_OAUTH_CLIENT_ID &&
    !!process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const hasServiceAccount =
    !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON ||
    !!process.env.GOOGLE_APPLICATION_CREDENTIALS

  if (!hasOAuth && !hasServiceAccount) return null

  const api = apiFactory()
  const explicitRootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  const rootFolderName = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME ?? 'Acervo Jurídico ADV'

  // Resolve a pasta-raiz uma única vez (memoizada).
  let rootIdPromise: Promise<string> | null = null
  const resolveRootId = (): Promise<string> => {
    if (explicitRootId) return Promise.resolve(explicitRootId)
    if (!rootIdPromise) rootIdPromise = ensureFolder(api, rootFolderName, 'root')
    return rootIdPromise
  }

  return {
    archive: async (input) => archiveToDrive(api, await resolveRootId(), input),
  }
}
