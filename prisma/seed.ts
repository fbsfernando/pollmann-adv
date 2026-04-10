import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Remove dados fictícios de implantações anteriores
  await prisma.andamento.deleteMany({})
  await prisma.documento.deleteMany({})
  await prisma.processo.deleteMany({})
  await prisma.cliente.deleteMany({})

  const adminHash = bcrypt.hashSync('admin123', 10)
  const advHash = bcrypt.hashSync('adv123', 10)

  await prisma.user.upsert({
    where: { email: 'richard@juridicoadv.com.br' },
    update: {},
    create: {
      name: 'Richard',
      email: 'richard@juridicoadv.com.br',
      passwordHash: adminHash,
      role: Role.ADMIN,
    },
  })

  await prisma.user.upsert({
    where: { email: 'carlos@juridicoadv.com.br' },
    update: {},
    create: {
      name: 'Carlos Silva',
      email: 'carlos@juridicoadv.com.br',
      passwordHash: advHash,
      role: Role.ADVOGADO,
    },
  })

  await prisma.user.upsert({
    where: { email: 'ana@juridicoadv.com.br' },
    update: {},
    create: {
      name: 'Ana Oliveira',
      email: 'ana@juridicoadv.com.br',
      passwordHash: advHash,
      role: Role.ADVOGADO,
    },
  })

  console.log('✅ Seed completo!')
  console.log(`   Users: ${await prisma.user.count()}`)
  console.log('')
  console.log('📋 Credenciais:')
  console.log('   Admin:    richard@juridicoadv.com.br / admin123')
  console.log('   Advogado: carlos@juridicoadv.com.br  / adv123')
  console.log('   Advogado: ana@juridicoadv.com.br     / adv123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
