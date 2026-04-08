#!/usr/bin/env bash
# deploy.sh — Script de deploy para VPS Ubuntu
# Uso: ./deploy.sh
# Requer: docker, docker compose, git

set -euo pipefail

APP_DIR="/opt/juridico-adv"
REPO_URL="REPO_URL_AQUI"   # ex: git@github.com:user/repo.git
BRANCH="main"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deploy — Pollmann ADV"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Atualiza código ────────────────────────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR"
    git fetch origin
    git reset --hard "origin/$BRANCH"
    echo "✓ Código atualizado"
else
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
    echo "✓ Repositório clonado"
fi

cd "$APP_DIR/app"

# ── 2. Valida .env.prod ───────────────────────────────────────────────────────
if [ ! -f ".env.prod" ]; then
    echo "✗ Arquivo .env.prod não encontrado em $APP_DIR/app/"
    echo "  Copie .env.prod.example e preencha as variáveis"
    exit 1
fi
echo "✓ .env.prod encontrado"

# ── 3. Build da imagem ────────────────────────────────────────────────────────
echo "→ Build da imagem Docker..."
docker compose -f docker-compose.prod.yml --env-file .env.prod build --no-cache
echo "✓ Imagem construída"

# ── 4. Sobe Postgres primeiro (garante healthcheck) ───────────────────────────
echo "→ Subindo Postgres..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres
echo "  Aguardando Postgres ficar pronto..."
sleep 5

# ── 5. Migrations / db push ───────────────────────────────────────────────────
echo "→ Aplicando schema no banco..."
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
    -e DATABASE_URL="$(grep DATABASE_URL .env.prod | cut -d= -f2-)" \
    app npx prisma db push --skip-generate
echo "✓ Schema aplicado"

# ── 6. Sobe aplicação ────────────────────────────────────────────────────────
echo "→ Subindo aplicação..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d app
echo "✓ Aplicação no ar"

# ── 7. Configura cron do pipeline ────────────────────────────────────────────
CRON_JOB="0 */6 * * * cd $APP_DIR/app && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T app node -r tsconfig-paths/register -r ts-node/register src/scripts/pipeline-sync.ts >> /var/log/juridico-pipeline.log 2>&1"

# Adiciona só se ainda não existe
if ! crontab -l 2>/dev/null | grep -q "pipeline-sync"; then
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "✓ Cron do pipeline configurado (a cada 6h)"
else
    echo "✓ Cron do pipeline já configurado"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deploy concluído!"
echo "  App rodando em http://localhost:3000"
echo "  Logs: docker compose -f docker-compose.prod.yml logs -f app"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
