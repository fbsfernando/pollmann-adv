import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Report = {
  clientesSemCpf: number
  clientesDuplicadosPorNome: Array<{ nome: string; count: number; ids: string[] }>
  clientesNomeSuspeito: Array<{ id: string; nome: string; processos: number }>
  processosSemAndamentos: number
  processosComClienteSuspeito: Array<{ numero: string; cliente: string }>
  documentosMesmoPathDiferenteId: Array<{ storagePath: string; count: number }>
  andamentosSemHash: number
  totais: {
    clientes: number
    processos: number
    andamentos: number
    documentos: number
  }
}

const NOME_SUSPEITO_MAX_LEN = 6
const NOME_SUSPEITO_REGEX = /^(pat|pj|parte|réu|reu|autor)\s*\d*$/i

const run = async (): Promise<Report> => {
  const [clientes, processos, andamentos, documentos] = await Promise.all([
    prisma.cliente.count(),
    prisma.processo.count(),
    prisma.andamento.count(),
    prisma.documento.count(),
  ])

  const clientesSemCpf = await prisma.cliente.count({ where: { cpfCnpj: null } })

  const agrupadosPorNome = await prisma.cliente.groupBy({
    by: ['nome'],
    _count: { nome: true },
    having: { nome: { _count: { gt: 1 } } },
  })

  const clientesDuplicadosPorNome = await Promise.all(
    agrupadosPorNome.map(async (g) => {
      const ids = await prisma.cliente.findMany({
        where: { nome: g.nome },
        select: { id: true },
      })
      return { nome: g.nome, count: g._count.nome, ids: ids.map((c) => c.id) }
    }),
  )

  const todosClientes = await prisma.cliente.findMany({
    select: { id: true, nome: true, _count: { select: { processos: true } } },
  })
  const clientesNomeSuspeito = todosClientes
    .filter((c) => c.nome.length <= NOME_SUSPEITO_MAX_LEN || NOME_SUSPEITO_REGEX.test(c.nome.trim()))
    .map((c) => ({ id: c.id, nome: c.nome, processos: c._count.processos }))

  const processosSemAndamentos = await prisma.processo.count({
    where: { andamentos: { none: {} } },
  })

  const processosComClienteSuspeito = await prisma.processo.findMany({
    where: {
      OR: [
        { cliente: { nome: { in: clientesNomeSuspeito.map((c) => c.nome) } } },
      ],
    },
    select: { numero: true, cliente: { select: { nome: true } } },
    take: 50,
  }).then((rows) => rows.map((r) => ({ numero: r.numero, cliente: r.cliente.nome })))

  const docsAgrupados = await prisma.documento.groupBy({
    by: ['storagePath'],
    _count: { storagePath: true },
    where: { storagePath: { not: null } },
    having: { storagePath: { _count: { gt: 1 } } },
  })
  const documentosMesmoPathDiferenteId = docsAgrupados.map((g) => ({
    storagePath: g.storagePath ?? '',
    count: g._count.storagePath,
  }))

  const andamentosSemHash = await prisma.andamento.count({ where: { hash: null } })

  return {
    totais: { clientes, processos, andamentos, documentos },
    clientesSemCpf,
    clientesDuplicadosPorNome,
    clientesNomeSuspeito,
    processosSemAndamentos,
    processosComClienteSuspeito,
    documentosMesmoPathDiferenteId,
    andamentosSemHash,
  }
}

run()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2))
    console.log('\n=== RESUMO ===')
    console.log(`Totais: ${JSON.stringify(report.totais)}`)
    console.log(`Clientes sem CPF/CNPJ: ${report.clientesSemCpf}`)
    console.log(`Grupos de clientes com nome duplicado: ${report.clientesDuplicadosPorNome.length}`)
    console.log(`Clientes com nome suspeito (curto ou padrão "Pat1"): ${report.clientesNomeSuspeito.length}`)
    console.log(`Processos sem andamentos: ${report.processosSemAndamentos}`)
    console.log(`Documentos com storagePath repetido: ${report.documentosMesmoPathDiferenteId.length}`)
    console.log(`Andamentos sem hash: ${report.andamentosSemHash}`)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
