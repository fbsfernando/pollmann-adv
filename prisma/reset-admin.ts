import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const hash = bcrypt.hashSync('admin123', 10)
  const result = await prisma.user.updateMany({
    where: { email: 'richard@juridicoadv.com.br' },
    data: { passwordHash: hash },
  })
  console.log(`✅ Senha resetada para richard@juridicoadv.com.br (${result.count} usuário)`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
