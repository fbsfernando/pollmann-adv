import { createHash } from 'node:crypto'

import { PrismaClient, Role, Tribunal, StatusProcesso, FonteAndamento } from '@prisma/client'
import bcrypt from 'bcryptjs'

const seedExternalId = (...parts: (string | number)[]): string =>
  createHash('sha256').update(parts.join('|')).digest('hex')

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Users
  const adminHash = bcrypt.hashSync('admin123', 10)
  const advHash = bcrypt.hashSync('adv123', 10)

  const richard = await prisma.user.upsert({
    where: { email: 'richard@juridicoadv.com.br' },
    update: {},
    create: {
      name: 'Richard',
      email: 'richard@juridicoadv.com.br',
      passwordHash: adminHash,
      role: Role.ADMIN,
    },
  })

  const advogado1 = await prisma.user.upsert({
    where: { email: 'carlos@juridicoadv.com.br' },
    update: {},
    create: {
      name: 'Carlos Silva',
      email: 'carlos@juridicoadv.com.br',
      passwordHash: advHash,
      role: Role.ADVOGADO,
    },
  })

  const advogado2 = await prisma.user.upsert({
    where: { email: 'ana@juridicoadv.com.br' },
    update: {},
    create: {
      name: 'Ana Oliveira',
      email: 'ana@juridicoadv.com.br',
      passwordHash: advHash,
      role: Role.ADVOGADO,
    },
  })

  // Clientes
  const clientes = await Promise.all([
    prisma.cliente.upsert({ where: { cpfCnpj: '12345678000190' }, update: {}, create: { nome: 'Maria Silva Ltda', cpfCnpj: '12345678000190', email: 'contato@mariasilva.com.br', telefone: '(48) 99999-1111', observacoes: 'Cliente desde 2020, área imobiliária' } }),
    prisma.cliente.upsert({ where: { cpfCnpj: '12345678900' }, update: {}, create: { nome: 'João Pereira', cpfCnpj: '12345678900', email: 'joao.pereira@email.com', telefone: '(48) 99999-2222', observacoes: 'Consultor, demandas trabalhistas' } }),
    prisma.cliente.upsert({ where: { cpfCnpj: '98765432000110' }, update: {}, create: { nome: 'Construtora Horizonte SA', cpfCnpj: '98765432000110', email: 'juridico@horizonte.com.br', telefone: '(51) 99999-3333', observacoes: 'Construtora, diversas ações cíveis' } }),
    prisma.cliente.upsert({ where: { cpfCnpj: '11222333000144' }, update: {}, create: { nome: 'Ana Costa ME', cpfCnpj: '11222333000144', email: 'ana@anacosta.com.br', telefone: '(48) 99999-4444', observacoes: 'Microempresa, consultoria tributária' } }),
    prisma.cliente.upsert({ where: { cpfCnpj: '98765432100' }, update: {}, create: { nome: 'Roberto Mendes', cpfCnpj: '98765432100', email: 'roberto.mendes@email.com', telefone: '(51) 99999-5555', observacoes: 'Ação previdenciária' } }),
  ])

  // Processos
  const processos = await Promise.all([
    prisma.processo.upsert({ where: { numero: '5001234-56.2024.8.24.0023' }, update: {}, create: { numero: '5001234-56.2024.8.24.0023', tribunal: Tribunal.TJSC, vara: '1ª Vara Cível de Florianópolis', area: 'Cível', status: StatusProcesso.ATIVO, clienteId: clientes[0].id, advogadoId: advogado1.id, observacoes: 'Ação de indenização por danos materiais' } }),
    prisma.processo.upsert({ where: { numero: '5009876-54.2024.8.24.0023' }, update: {}, create: { numero: '5009876-54.2024.8.24.0023', tribunal: Tribunal.TJSC, vara: '2ª Vara Cível de Florianópolis', area: 'Imobiliário', status: StatusProcesso.ATIVO, clienteId: clientes[0].id, advogadoId: advogado1.id } }),
    prisma.processo.upsert({ where: { numero: '5005555-33.2023.8.24.0023' }, update: {}, create: { numero: '5005555-33.2023.8.24.0023', tribunal: Tribunal.TJSC, vara: '1ª Vara do Trabalho de Florianópolis', area: 'Trabalhista', status: StatusProcesso.ATIVO, clienteId: clientes[1].id, advogadoId: advogado2.id } }),
    prisma.processo.upsert({ where: { numero: '5003333-11.2024.8.21.0001' }, update: {}, create: { numero: '5003333-11.2024.8.21.0001', tribunal: Tribunal.TJRS, vara: '3ª Vara Cível de Porto Alegre', area: 'Cível', status: StatusProcesso.ATIVO, clienteId: clientes[2].id, advogadoId: advogado1.id } }),
    prisma.processo.upsert({ where: { numero: '5007777-22.2023.8.21.0001' }, update: {}, create: { numero: '5007777-22.2023.8.21.0001', tribunal: Tribunal.TJRS, vara: '1ª Vara Cível de Porto Alegre', area: 'Imobiliário', status: StatusProcesso.ATIVO, clienteId: clientes[2].id, advogadoId: advogado2.id } }),
    prisma.processo.upsert({ where: { numero: '5008888-44.2024.8.24.0023' }, update: {}, create: { numero: '5008888-44.2024.8.24.0023', tribunal: Tribunal.TJSC, vara: '1ª Vara Cível de Joinville', area: 'Tributário', status: StatusProcesso.ATIVO, clienteId: clientes[3].id, advogadoId: richard.id } }),
    prisma.processo.upsert({ where: { numero: '5002222-99.2023.8.21.0001' }, update: {}, create: { numero: '5002222-99.2023.8.21.0001', tribunal: Tribunal.TJRS, vara: '2ª Vara Previdenciária de Porto Alegre', area: 'Previdenciário', status: StatusProcesso.ATIVO, clienteId: clientes[4].id, advogadoId: richard.id } }),
    prisma.processo.upsert({ where: { numero: '5006666-77.2022.8.24.0023' }, update: {}, create: { numero: '5006666-77.2022.8.24.0023', tribunal: Tribunal.TJSC, vara: '3ª Vara Cível de Florianópolis', area: 'Cível', status: StatusProcesso.ENCERRADO, clienteId: clientes[1].id, advogadoId: advogado1.id } }),
    prisma.processo.upsert({ where: { numero: '5004444-55.2024.8.24.0023' }, update: {}, create: { numero: '5004444-55.2024.8.24.0023', tribunal: Tribunal.TJSC, vara: '1ª Vara do Trabalho de Criciúma', area: 'Trabalhista', status: StatusProcesso.SUSPENSO, clienteId: clientes[2].id, advogadoId: advogado2.id } }),
    prisma.processo.upsert({ where: { numero: '5001111-88.2024.8.21.0001' }, update: {}, create: { numero: '5001111-88.2024.8.21.0001', tribunal: Tribunal.TJRS, vara: '1ª Vara Cível de Caxias do Sul', area: 'Consumidor', status: StatusProcesso.ATIVO, clienteId: clientes[4].id, advogadoId: advogado2.id } }),
  ])

  // Andamentos for first few processos
  const andamentosData = [
    { processoIdx: 0, data: new Date('2024-03-15T10:00:00-03:00'), tipo: 'Distribuição', descricao: 'Processo distribuído à 1ª Vara Cível de Florianópolis' },
    { processoIdx: 0, data: new Date('2024-04-10T14:30:00-03:00'), tipo: 'Citação', descricao: 'Citação do réu por AR' },
    { processoIdx: 0, data: new Date('2024-05-20T09:00:00-03:00'), tipo: 'Contestação', descricao: 'Réu apresentou contestação com documentos' },
    { processoIdx: 1, data: new Date('2024-02-01T11:00:00-03:00'), tipo: 'Distribuição', descricao: 'Processo distribuído à 2ª Vara Cível' },
    { processoIdx: 1, data: new Date('2024-03-15T16:00:00-03:00'), tipo: 'Despacho', descricao: 'Despacho determinando citação do réu' },
    { processoIdx: 2, data: new Date('2023-11-10T08:00:00-03:00'), tipo: 'Distribuição', descricao: 'Reclamatória trabalhista distribuída' },
    { processoIdx: 2, data: new Date('2024-01-20T10:30:00-03:00'), tipo: 'Audiência', descricao: 'Audiência de conciliação realizada — sem acordo' },
    { processoIdx: 3, data: new Date('2024-01-05T09:00:00-03:00'), tipo: 'Distribuição', descricao: 'Ação de cobrança distribuída em Porto Alegre' },
    { processoIdx: 3, data: new Date('2024-02-15T15:00:00-03:00'), tipo: 'Citação', descricao: 'Réu citado por oficial de justiça' },
    { processoIdx: 3, data: new Date('2024-04-01T11:00:00-03:00'), tipo: 'Sentença', descricao: 'Sentença de procedência parcial' },
    { processoIdx: 4, data: new Date('2023-08-20T10:00:00-03:00'), tipo: 'Distribuição', descricao: 'Ação possessória distribuída' },
    { processoIdx: 4, data: new Date('2023-10-15T14:00:00-03:00'), tipo: 'Liminar', descricao: 'Liminar de reintegração de posse concedida' },
    { processoIdx: 5, data: new Date('2024-05-01T09:30:00-03:00'), tipo: 'Distribuição', descricao: 'Mandado de segurança impetrado' },
    { processoIdx: 5, data: new Date('2024-05-15T16:00:00-03:00'), tipo: 'Liminar', descricao: 'Liminar deferida — suspensão da exigência tributária' },
    { processoIdx: 6, data: new Date('2023-06-10T08:00:00-03:00'), tipo: 'Distribuição', descricao: 'Ação previdenciária distribuída' },
    { processoIdx: 6, data: new Date('2023-09-20T10:00:00-03:00'), tipo: 'Perícia', descricao: 'Laudo pericial médico juntado aos autos' },
    { processoIdx: 9, data: new Date('2024-06-01T09:00:00-03:00'), tipo: 'Distribuição', descricao: 'Ação consumerista distribuída em Caxias do Sul' },
    { processoIdx: 9, data: new Date('2024-07-10T14:00:00-03:00'), tipo: 'Despacho', descricao: 'Despacho determinando inversão do ônus da prova' },
  ]

  for (const [i, a] of andamentosData.entries()) {
    const processoNumero = processos[a.processoIdx].numero
    const externalId = seedExternalId('seed', processoNumero, a.data.toISOString(), a.tipo, i)
    await prisma.andamento.upsert({
      where: { externalId },
      create: {
        externalId,
        processoId: processos[a.processoIdx].id,
        data: a.data,
        tipo: a.tipo,
        descricao: a.descricao,
        fonte: FonteAndamento.IMPORTACAO,
      },
      update: {},
    })
  }

  console.log('✅ Seed complete!')
  console.log(`   Users: ${await prisma.user.count()}`)
  console.log(`   Clientes: ${await prisma.cliente.count()}`)
  console.log(`   Processos: ${await prisma.processo.count()}`)
  console.log(`   Andamentos: ${await prisma.andamento.count()}`)
  console.log('')
  console.log('📋 Login credentials:')
  console.log('   Admin:    richard@juridicoadv.com.br / admin123')
  console.log('   Advogado: carlos@juridicoadv.com.br  / adv123')
  console.log('   Advogado: ana@juridicoadv.com.br     / adv123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
