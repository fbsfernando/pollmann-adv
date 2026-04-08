# Juridico ADV — Runbook local (S02)

Este projeto usa Next.js + Prisma + PostgreSQL local via Docker.

## Pré-requisitos

- Node.js 20+
- npm 10+
- Docker Desktop (ou engine compatível com `docker compose`)

## 1) Subir banco local

```bash
cd app
docker compose up -d
```

Verificação rápida do container:

```bash
docker compose ps
```

Se houver erro de inicialização do banco:

```bash
docker compose logs db --tail=100
docker compose down -v
docker compose up -d
```

## 2) Aplicar schema e popular dados

```bash
cd app
npx prisma migrate dev
npx prisma db seed
```

Se timeout/falha por indisponibilidade do banco, aguarde health e repita os comandos.

## 3) Rodar app

```bash
cd app
npm run dev
```

A aplicação sobe em `http://localhost:3000`.

## 4) Credenciais de seed

- Gestão: `richard@juridicoadv.com.br / admin123`
- Advogado: `carlos@juridicoadv.com.br / adv123`
- Advogada: `ana@juridicoadv.com.br / adv123`

## 5) Verificação do slice S02

### Fluxo completo de validação

```bash
cd app && docker compose up -d && npx prisma migrate dev && npx prisma db seed && npm run test -- --runInBand dashboard processos && npm run build
```

### Checagens adicionais de qualidade

```bash
cd app && npm run test -- --runInBand auth processos
cd app && npm run lint
```

## 6) Diagnóstico por etapa (observabilidade operacional)

- **DB**: `docker compose ps`, `docker compose logs db --tail=100`
- **Schema/seed**: saídas de `npx prisma migrate dev` e `npx prisma db seed`
- **Fluxos de negócio**: `npm run test -- --runInBand dashboard processos`
- **Build/runtime**: `npm run build`

Quando algo falhar, registre o comando e a etapa (`db`, `migrate`, `seed`, `test`, `build`) para facilitar recuperação.

## 7) Pipeline operacional (S03)

### Variáveis mínimas

- `DATABASE_URL`: conexão PostgreSQL
- `PIPELINE_ARCHIVE_DIR` (opcional): diretório base para arquivamento; default `./storage/archive`

### Executar job

```bash
cd app
npm run pipeline:sync
```

Saída esperada: log `[pipeline:sync] completed` com `runId`, `phase` (contadores por etapa) e timestamp.

### Diagnóstico rápido

```bash
cd app
npm run test -- --runInBand src/tests/pipeline/pipeline-integration.test.ts
npm run pipeline:sync
npm run lint
```

No caso de falha parcial, o run reporta `archiveFailures` e/ou `notificationFailures` sem desfazer `persistedAndamentos` e `persistedDocumentos`.
