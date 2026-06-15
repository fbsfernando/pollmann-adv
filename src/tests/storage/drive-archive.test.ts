import { describe, it, expect } from 'vitest'

import {
  archiveToDrive,
  cleanName,
  mimeFromName,
  type DriveApi,
} from '@/lib/storage/drive-archive'

/**
 * DriveApi falso em memória. Modela pastas e arquivos por (nome, parentId),
 * permitindo verificar idempotência de pastas e dedupe de arquivos.
 */
const createFakeDrive = () => {
  let seq = 0
  const folders = new Map<string, string>() // `${parentId}/${name}` -> id
  const files = new Map<string, { id: string; webViewLink: string }>()
  const calls = { createFolder: 0, uploadFile: 0 }

  const api: DriveApi = {
    async findFolder(name, parentId) {
      return folders.get(`${parentId}/${name}`) ?? null
    },
    async createFolder(name, parentId) {
      calls.createFolder += 1
      const id = `folder-${++seq}`
      folders.set(`${parentId}/${name}`, id)
      return id
    },
    async findFile(name, parentId) {
      return files.get(`${parentId}/${name}`) ?? null
    },
    async uploadFile({ name, parentId }) {
      calls.uploadFile += 1
      const id = `file-${++seq}`
      const entry = { id, webViewLink: `https://drive.example/${id}` }
      files.set(`${parentId}/${name}`, entry)
      return entry
    },
  }

  return { api, calls, folders, files }
}

const baseInput = {
  clienteNome: 'João da Silva',
  processoNumero: '0312196-26.2014.8.24.0023',
  documentoNome: 'Petição Inicial.pdf',
  documentoExternalId: 'doc-1',
  content: Buffer.from('conteudo'),
}

describe('archiveToDrive', () => {
  it('cria estrutura cliente → processo → documento e retorna id + link', async () => {
    const { api, calls } = createFakeDrive()

    const res = await archiveToDrive(api, 'root', baseInput)

    expect(calls.createFolder).toBe(2) // cliente + processo
    expect(calls.uploadFile).toBe(1)
    expect(res.driveFileId).toMatch(/^file-/)
    expect(res.driveLink).toContain('https://drive.example/')
  })

  it('é idempotente: reutiliza pastas e arquivo existentes na 2ª execução', async () => {
    const { api, calls } = createFakeDrive()

    const first = await archiveToDrive(api, 'root', baseInput)
    const second = await archiveToDrive(api, 'root', baseInput)

    // Pastas e arquivo só são criados uma vez
    expect(calls.createFolder).toBe(2)
    expect(calls.uploadFile).toBe(1)
    expect(second.driveFileId).toBe(first.driveFileId)
  })

  it('compartilha a pasta do cliente entre processos diferentes', async () => {
    const { api, calls } = createFakeDrive()

    await archiveToDrive(api, 'root', baseInput)
    await archiveToDrive(api, 'root', {
      ...baseInput,
      processoNumero: '9999999-99.2024.8.24.0023',
      documentoExternalId: 'doc-2',
    })

    // 1 pasta cliente + 2 pastas de processo = 3
    expect(calls.createFolder).toBe(3)
    expect(calls.uploadFile).toBe(2)
  })
})

describe('helpers', () => {
  it('mimeFromName infere o tipo pela extensão', () => {
    expect(mimeFromName('a.pdf')).toBe('application/pdf')
    expect(mimeFromName('a.HTML')).toBe('text/html')
    expect(mimeFromName('sem-extensao')).toBe('application/octet-stream')
  })

  it('cleanName remove barras e usa fallback quando vazio', () => {
    expect(cleanName('a/b\\c', 'fb')).toBe('a-b-c')
    expect(cleanName('   ', 'fallback')).toBe('fallback')
    expect(cleanName('  Nome  Espaçado ', 'fb')).toBe('Nome Espaçado')
  })
})
