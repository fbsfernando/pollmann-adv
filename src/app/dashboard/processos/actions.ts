"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireAuth } from "@/lib/auth/guards"
import { Tribunal, StatusProcesso, Role, Prisma } from "@prisma/client"
import { createEprocHttpClient, type Tribunal as ScraperTribunal } from "@/lib/scraper/eproc-http"
import { syncAndamentos } from "@/lib/pipeline/sync-andamentos"

const processoSchema = z.object({
  numero: z.string().min(5, "Número do processo é obrigatório"),
  tribunal: z.nativeEnum(Tribunal),
  vara: z.string().optional().nullable(),
  area: z.string().optional().nullable(),
  status: z.nativeEnum(StatusProcesso).optional(),
  clienteId: z.string().min(1, "Cliente é obrigatório"),
  advogadoId: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
})

export async function getProcessos(filters?: {
  search?: string
  tribunal?: string
  status?: string
  advogadoId?: string
  clienteId?: string
}) {
  const session = await requireAuth()

  const where: Prisma.ProcessoWhereInput = {}

  if (filters?.search) {
    const search = filters.search.slice(0, 100)
    where.OR = [
      { numero: { contains: search, mode: "insensitive" } },
      { cliente: { nome: { contains: search, mode: "insensitive" } } },
    ]
  }
  if (filters?.tribunal) where.tribunal = filters.tribunal as Tribunal
  if (filters?.status) where.status = filters.status as StatusProcesso

  if (session.user.role === Role.ADVOGADO) {
    where.advogadoId = session.user.id
  } else if (filters?.advogadoId) {
    where.advogadoId = filters.advogadoId
  }

  if (filters?.clienteId) where.clienteId = filters.clienteId

  return prisma.processo.findMany({
    where,
    take: 500,
    orderBy: { updatedAt: "desc" },
    include: {
      cliente: true,
      advogado: true,
      _count: { select: { andamentos: true } },
    },
  })
}

export async function getProcesso(id: string) {
  const session = await requireAuth()

  const processoId = id.trim()
  if (!processoId) {
    throw new Error("Processo inválido")
  }

  const where: Prisma.ProcessoWhereInput = { id: processoId }
  if (session.user.role === Role.ADVOGADO) {
    where.advogadoId = session.user.id
  }

  const processo = await prisma.processo.findFirst({
    where,
    include: {
      cliente: true,
      advogado: true,
      andamentos: {
        orderBy: { data: "desc" },
        take: 50,
        include: {
          documentos: true,
        },
      },
      documentos: true,
      _count: { select: { andamentos: true } },
    },
  })

  if (!processo) {
    throw new Error("Acesso negado ou processo não encontrado")
  }

  return processo
}

export async function getFormOptions() {
  await requireAuth()

  const [clientes, advogados] = await Promise.all([
    prisma.cliente.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ])
  return { clientes, advogados }
}

export async function createProcesso(formData: FormData) {
  await requireAuth()

  const raw = {
    numero: formData.get("numero") as string,
    tribunal: formData.get("tribunal") as string,
    vara: (formData.get("vara") as string) || null,
    area: (formData.get("area") as string) || null,
    status: (formData.get("status") as string) || undefined,
    clienteId: formData.get("clienteId") as string,
    advogadoId: (formData.get("advogadoId") as string) || null,
    observacoes: (formData.get("observacoes") as string) || null,
  }

  const parsed = processoSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  try {
    await prisma.processo.create({ data: parsed.data })
    revalidatePath("/dashboard/processos")
    return { success: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("Unique constraint") && msg.includes("numero")) {
      return { error: "Número de processo já cadastrado" }
    }
    return { error: "Erro ao criar processo" }
  }
}

const syncInFlight = new Set<string>()

function getEnvOrThrow(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Variável de ambiente ausente: ${key}`)
  return v
}

export async function syncProcessoAgora(id: string): Promise<
  | { success: true; newAndamentos: number; newDocumentos: number }
  | { error: string }
> {
  const session = await requireAuth()
  const processoId = id.trim()
  if (!processoId) return { error: "Processo inválido" }

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, numero: true, tribunal: true, advogadoId: true },
  })

  if (!processo) return { error: "Processo não encontrado" }

  if (
    session.user.role === Role.ADVOGADO &&
    processo.advogadoId !== session.user.id
  ) {
    return { error: "Acesso negado" }
  }

  if (processo.tribunal !== "TJSC" && processo.tribunal !== "TJRS") {
    return { error: "Sincronização disponível apenas para TJSC e TJRS" }
  }

  if (syncInFlight.has(processoId)) {
    return { error: "Sincronização já em andamento para este processo" }
  }
  syncInFlight.add(processoId)

  try {
    const tribunal = processo.tribunal as ScraperTribunal
    const archiveBaseDir = process.env.PIPELINE_ARCHIVE_DIR ?? "./storage/archive"
    const proxyUrl =
      process.env[`EPROC_${tribunal}_PROXY_URL`] ?? process.env.EPROC_PROXY_URL

    const client = createEprocHttpClient({
      tribunal,
      usuario: getEnvOrThrow(`EPROC_${tribunal}_USER`),
      senha: getEnvOrThrow(`EPROC_${tribunal}_PASSWORD`),
      totpSeed: getEnvOrThrow(`EPROC_${tribunal}_TOTP_SEED`),
      timeout: 45000,
      interProcessoDelayMs: 0,
      proxyUrl: proxyUrl || undefined,
      processos: [processo.numero],
    })

    const isDocumentKnown = async (externalId: string): Promise<boolean> => {
      const doc = await prisma.documento.findUnique({
        where: { externalId },
        select: { storagePath: true },
      })
      return !!(doc?.storagePath && !doc.storagePath.startsWith("eproc/"))
    }

    const snapshot = await client.collectSnapshotWithDocuments(isDocumentKnown)

    const result = await syncAndamentos(
      prisma,
      { collectSnapshot: async () => snapshot },
      { archiveBaseDir }
    )

    revalidatePath(`/dashboard/processos/${processoId}`)
    revalidatePath("/dashboard/processos")

    return {
      success: true,
      newAndamentos: result.phase.persistedAndamentos,
      newDocumentos: result.phase.persistedDocumentos,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown-error"
    if (msg.startsWith("PROCESSO_NAO_ENCONTRADO:")) {
      return { error: "Processo não encontrado no E-PROC ou em segredo de justiça" }
    }
    console.error("[syncProcessoAgora] failed", { processoId, error: msg })
    return { error: `Falha ao sincronizar: ${msg}` }
  } finally {
    syncInFlight.delete(processoId)
  }
}

export async function updateProcesso(id: string, formData: FormData) {
  await requireAuth()

  const raw = {
    numero: formData.get("numero") as string,
    tribunal: formData.get("tribunal") as string,
    vara: (formData.get("vara") as string) || null,
    area: (formData.get("area") as string) || null,
    status: (formData.get("status") as string) || undefined,
    clienteId: formData.get("clienteId") as string,
    advogadoId: (formData.get("advogadoId") as string) || null,
    observacoes: (formData.get("observacoes") as string) || null,
  }

  const parsed = processoSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" }
  }

  try {
    await prisma.processo.update({ where: { id }, data: parsed.data })
    revalidatePath("/dashboard/processos")
    revalidatePath(`/dashboard/processos/${id}`)
    return { success: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("Unique constraint") && msg.includes("numero")) {
      return { error: "Número de processo já cadastrado" }
    }
    return { error: "Erro ao atualizar processo" }
  }
}
