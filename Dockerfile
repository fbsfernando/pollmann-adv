# ── Stage 1: deps + build ────────────────────────────────────────────────────
# Usa imagem Playwright que já tem Chromium e todas as dependências nativas
FROM mcr.microsoft.com/playwright:v1.49.0-noble AS builder
WORKDIR /app

# Instala Node.js 22 (imagem Playwright vem com Node 20)
RUN apt-get update -q && apt-get install -y --no-install-recommends curl \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts && npx prisma generate

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 2: runner ──────────────────────────────────────────────────────────
# Mesma imagem base — Chromium já instalado, sem downloads adicionais
FROM mcr.microsoft.com/playwright:v1.49.0-noble AS runner
WORKDIR /app

RUN apt-get update -q && apt-get install -y --no-install-recommends curl \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Usuário não-root
RUN groupadd --system --gid 1001 nodejs 2>/dev/null || true \
 && useradd --system --uid 1001 --gid nodejs nextjs 2>/dev/null || true

# Copia artefatos do build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

RUN mkdir -p /app/storage/archive && chown -R nextjs:nodejs /app/storage

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
