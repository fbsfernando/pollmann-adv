# Deploy — Pollmann ADV

## Pré-requisitos

- VPS Ubuntu 22.04/24.04 com acesso root via SSH
- Domínio apontando para o IP do VPS (registro A no DNS)
- Repositório Git acessível do VPS (GitHub, GitLab, etc.)

---

## 1. Primeira vez no VPS

```bash
# Acessa o VPS
ssh root@SEU_IP

# Clona o repositório
git clone git@github.com:SEU_USUARIO/SEU_REPO.git /opt/juridico-adv

# Roda o setup (instala Docker, Nginx, SSL)
bash /opt/juridico-adv/app/setup-vps.sh adv.pollmann.com.br
```

## 2. Configura variáveis de ambiente

```bash
cd /opt/juridico-adv/app
cp .env.prod.example .env.prod
nano .env.prod   # preenche todas as variáveis
```

Gera o `AUTH_SECRET`:
```bash
openssl rand -base64 32
```

## 3. Deploy

```bash
bash /opt/juridico-adv/app/deploy.sh
```

O script faz:
1. Pull do código
2. Build da imagem Docker (com Playwright/Chromium incluído)
3. Sobe Postgres
4. Aplica schema no banco (`prisma db push`)
5. Sobe a aplicação
6. Configura cron do pipeline (a cada 6h)

## 4. Seed inicial da base (primeira vez)

```bash
cd /opt/juridico-adv/app
docker compose -f docker-compose.prod.yml --env-file .env.prod exec app \
    npx tsx prisma/seed.ts
```

## 5. Deploys subsequentes

```bash
ssh root@SEU_IP
bash /opt/juridico-adv/app/deploy.sh
```

---

## Comandos úteis

```bash
# Logs da aplicação
docker compose -f docker-compose.prod.yml logs -f app

# Logs do pipeline
tail -f /var/log/juridico-pipeline.log

# Rodar pipeline manualmente
docker compose -f docker-compose.prod.yml --env-file .env.prod exec app \
    npx tsx src/scripts/pipeline-sync.ts

# Reiniciar só a app (sem rebuild)
docker compose -f docker-compose.prod.yml --env-file .env.prod restart app

# Status dos containers
docker compose -f docker-compose.prod.yml ps
```

## Estrutura de armazenamento

Os documentos são salvos em `/app/storage/archive/` dentro do container,
mapeado para o volume Docker `archive`. Para backup:

```bash
docker run --rm -v juridico-adv_archive:/data -v $(pwd):/backup \
    alpine tar czf /backup/archive-$(date +%Y%m%d).tar.gz /data
```
