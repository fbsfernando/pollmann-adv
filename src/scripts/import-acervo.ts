import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  FonteAndamento,
  PrismaClient,
  type StatusProcesso,
  type Tribunal,
} from '@prisma/client'

type InputCliente = {
  nome?: string
  cpfCnpj?: string | null
  email?: string | null
  telefone?: string | null
  observacoes?: string | null
}

type InputProcesso = {
  numero?: string
  tribunal?: Tribunal
  vara?: string | null
  area?: string | null
  status?: StatusProcesso
  observacoes?: string | null
  cliente: InputCliente
  andamentos?: InputAndamento[]
  documentos?: InputDocumento[]
}

type InputAndamento = {
  dataIso?: string
  tipo?: string
  descricao?: string
  origemId?: string | null
  documentos?: InputDocumento[]
}

type InputDocumento = {
  nome?: string
  storagePath?: string
  tipo?: string | null
  tamanhoBytes?: number | string | bigint | null
  origemId?: string | null
}

type ImportPayload = {
  processos?: InputProcesso[]
}

type Counter = {
  created: number
  updated: number
  skipped: number
}

type ErrorEntry = {
  phase: string
  message: string
  context?: Record<string, unknown>
}

type ImportResult = {
  source: string
  startedAt: string
  finishedAt?: string
  phases: {
    clientes: Counter
    processos: Counter
    andamentos: Counter
    documentos: Counter
  }
  errors: ErrorEntry[]
}

const prisma = new PrismaClient()

const normalizeCpfCnpj = (value: string | null | undefined): string | null => {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length ? digits : null
}

const normalizeText = (value: string | null | undefined): string | null => {
  const text = String(value ?? '').trim()
  return text ? text : null
}

const requireField = <T>(value: T | null | undefined, field: string): T => {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Campo obrigatório ausente: ${field}`)
  }
  return value
}

const deterministicExternalId = (parts: Array<string | null | undefined>): string => {
  const raw = parts.map((p) => String(p ?? '').trim()).join('|')
  return createHash('sha256').update(raw).digest('hex')
}

const parseDate = (value: string | null | undefined, field: string): Date => {
  const date = new Date(requireField(value, field))
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Data inválida em ${field}: ${value}`)
  }
  return date
}

const parseBigInt = (value: InputDocumento['tamanhoBytes']): bigint | null => {
  if (value === null || value === undefined || value === '') return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

const fallbackClienteKey = (cliente: InputCliente): string => {
  const nome = normalizeText(cliente.nome)
  if (!nome) throw new Error('Cliente sem cpfCnpj exige nome válido')
  const email = normalizeText(cliente.email)
  const telefone = normalizeText(cliente.telefone)
  return deterministicExternalId([nome.toLowerCase(), email?.toLowerCase(), telefone])
}

const createCounter = (): Counter => ({ created: 0, updated: 0, skipped: 0 })

async function main() {
  const sourcePath = process.env.ACERVO_SOURCE_PATH
  if (!sourcePath) {
    throw new Error('Defina ACERVO_SOURCE_PATH com o JSON de importação do acervo')
  }

  const startedAt = new Date().toISOString()
  const result: ImportResult = {
    source: sourcePath,
    startedAt,
    phases: {
      clientes: createCounter(),
      processos: createCounter(),
      andamentos: createCounter(),
      documentos: createCounter(),
    },
    errors: [],
  }

  const raw = await readFile(sourcePath, 'utf-8')
  const payload = JSON.parse(raw) as ImportPayload
  const processos = payload.processos ?? []

  for (const processoInput of processos) {
    try {
      const numero = requireField(normalizeText(processoInput.numero), 'processo.numero')
      const tribunal = requireField(processoInput.tribunal, 'processo.tribunal')
      const status = processoInput.status ?? 'ATIVO'

      const clienteInput = processoInput.cliente
      const clienteNome = requireField(normalizeText(clienteInput?.nome), 'cliente.nome')
      const clienteCpfCnpj = normalizeCpfCnpj(clienteInput?.cpfCnpj)

      const processoResult = await prisma.$transaction(async (tx) => {
        let clienteId: string

        if (clienteCpfCnpj) {
          const existing = await tx.cliente.findUnique({ where: { cpfCnpj: clienteCpfCnpj } })
          const saved = await tx.cliente.upsert({
            where: { cpfCnpj: clienteCpfCnpj },
            create: {
              nome: clienteNome,
              cpfCnpj: clienteCpfCnpj,
              email: normalizeText(clienteInput.email),
              telefone: normalizeText(clienteInput.telefone),
              observacoes: normalizeText(clienteInput.observacoes),
            },
            update: {
              nome: clienteNome,
              email: normalizeText(clienteInput.email),
              telefone: normalizeText(clienteInput.telefone),
              observacoes: normalizeText(clienteInput.observacoes),
            },
          })
          clienteId = saved.id
          if (existing) result.phases.clientes.updated += 1
          else result.phases.clientes.created += 1
        } else {
          const key = fallbackClienteKey(clienteInput)
          const existing = await tx.cliente.findFirst({ where: { observacoes: { equals: `[import-key:${key}]` } } })

          let saved
          if (existing) {
            saved = await tx.cliente.update({
              where: { id: existing.id },
              data: {
                nome: clienteNome,
                email: normalizeText(clienteInput.email),
                telefone: normalizeText(clienteInput.telefone),
              },
            })
            result.phases.clientes.updated += 1
          } else {
            saved = await tx.cliente.create({
              data: {
                nome: clienteNome,
                email: normalizeText(clienteInput.email),
                telefone: normalizeText(clienteInput.telefone),
                observacoes: `[import-key:${key}]`,
              },
            })
            result.phases.clientes.created += 1
          }
          clienteId = saved.id
        }

        const existingProcesso = await tx.processo.findUnique({ where: { numero } })
        const processo = await tx.processo.upsert({
          where: { numero },
          create: {
            numero,
            tribunal,
            status,
            vara: normalizeText(processoInput.vara),
            area: normalizeText(processoInput.area),
            observacoes: normalizeText(processoInput.observacoes),
            clienteId,
          },
          update: {
            tribunal,
            status,
            vara: normalizeText(processoInput.vara),
            area: normalizeText(processoInput.area),
            observacoes: normalizeText(processoInput.observacoes),
            clienteId,
          },
        })

        if (existingProcesso) result.phases.processos.updated += 1
        else result.phases.processos.created += 1

        return processo
      })

      const andamentos = processoInput.andamentos ?? []
      for (const andamentoInput of andamentos) {
        try {
          const data = parseDate(andamentoInput.dataIso, 'andamento.dataIso')
          const tipo = requireField(normalizeText(andamentoInput.tipo), 'andamento.tipo')
          const descricao = requireField(normalizeText(andamentoInput.descricao), 'andamento.descricao')

          const andamentoExternalId = andamentoInput.origemId
            ? String(andamentoInput.origemId)
            : deterministicExternalId([numero, data.toISOString(), tipo, descricao])

          const existingAndamento = await prisma.andamento.findUnique({ where: { externalId: andamentoExternalId } })
          const andamento = await prisma.andamento.upsert({
            where: { externalId: andamentoExternalId },
            create: {
              externalId: andamentoExternalId,
              processoId: processoResult.id,
              data,
              tipo,
              descricao,
              fonte: FonteAndamento.IMPORTACAO,
            },
            update: {
              processoId: processoResult.id,
              data,
              tipo,
              descricao,
              fonte: FonteAndamento.IMPORTACAO,
            },
          })

          if (existingAndamento) result.phases.andamentos.updated += 1
          else result.phases.andamentos.created += 1

          const docs = [...(andamentoInput.documentos ?? [])]
          for (const d of docs) {
            const nome = requireField(normalizeText(d.nome), 'documento.nome')
            const storagePath = requireField(normalizeText(d.storagePath), 'documento.storagePath')
            const documentoExternalId = d.origemId
              ? String(d.origemId)
              : deterministicExternalId([numero, andamentoExternalId, nome, storagePath])

            const existingDocumento = await prisma.documento.findUnique({ where: { externalId: documentoExternalId } })
            await prisma.documento.upsert({
              where: { externalId: documentoExternalId },
              create: {
                externalId: documentoExternalId,
                processoId: processoResult.id,
                andamentoId: andamento.id,
                nome,
                storagePath,
                tipo: normalizeText(d.tipo),
                tamanhoBytes: parseBigInt(d.tamanhoBytes),
              },
              update: {
                processoId: processoResult.id,
                andamentoId: andamento.id,
                nome,
                storagePath,
                tipo: normalizeText(d.tipo),
                tamanhoBytes: parseBigInt(d.tamanhoBytes),
              },
            })

            if (existingDocumento) result.phases.documentos.updated += 1
            else result.phases.documentos.created += 1
          }
        } catch (error) {
          result.phases.andamentos.skipped += 1
          result.errors.push({
            phase: 'andamentos',
            message: (error as Error).message,
            context: { processoNumero: numero },
          })
        }
      }

      const processoDocs = processoInput.documentos ?? []
      for (const d of processoDocs) {
        try {
          const nome = requireField(normalizeText(d.nome), 'documento.nome')
          const storagePath = requireField(normalizeText(d.storagePath), 'documento.storagePath')
          const documentoExternalId = d.origemId
            ? String(d.origemId)
            : deterministicExternalId([numero, nome, storagePath, 'processo'])

          const existingDocumento = await prisma.documento.findUnique({ where: { externalId: documentoExternalId } })
          await prisma.documento.upsert({
            where: { externalId: documentoExternalId },
            create: {
              externalId: documentoExternalId,
              processoId: processoResult.id,
              nome,
              storagePath,
              tipo: normalizeText(d.tipo),
              tamanhoBytes: parseBigInt(d.tamanhoBytes),
            },
            update: {
              processoId: processoResult.id,
              nome,
              storagePath,
              tipo: normalizeText(d.tipo),
              tamanhoBytes: parseBigInt(d.tamanhoBytes),
            },
          })

          if (existingDocumento) result.phases.documentos.updated += 1
          else result.phases.documentos.created += 1
        } catch (error) {
          result.phases.documentos.skipped += 1
          result.errors.push({
            phase: 'documentos',
            message: (error as Error).message,
            context: { processoNumero: numero },
          })
        }
      }
    } catch (error) {
      result.phases.processos.skipped += 1
      result.errors.push({
        phase: 'processos',
        message: (error as Error).message,
      })
    }
  }

  result.finishedAt = new Date().toISOString()
  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch((error) => {
    console.error('[migrate:acervo] fatal', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
