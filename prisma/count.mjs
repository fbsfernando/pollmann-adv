import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const [c, pr, a] = await Promise.all([p.cliente.count(), p.processo.count(), p.andamento.count()]);
console.log('COUNTS:', JSON.stringify({ clientes: c, processos: pr, andamentos: a }));
await p.$disconnect();
