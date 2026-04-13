# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Reduz consumo de memória do npm ci:
# - max-old-space-size limita heap V8 a 1.5GB (evita OOM em VPS com RAM apertada)
# - --no-audit, --no-fund, --prefer-offline aceleram e reduzem I/O
# - --maxsockets=5 limita conexões paralelas
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm config set maxsockets 5 \
 && npm ci --ignore-scripts --no-audit --no-fund --prefer-offline \
 && npx prisma generate

# ── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Limita memória do Next.js build para evitar OOM em VPS
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN npm run build

# ── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Usa CA certificates do sistema (necessário para validar cert do TJRS via Cloudflare)
ENV NODE_OPTIONS=--use-openssl-ca

# Instala ca-certificates para o OpenSSL do Node encontrar as CAs
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends ca-certificates \
 && update-ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs --create-home

# Copia node_modules antes para poder usar playwright CLI
COPY --from=builder /app/node_modules ./node_modules

# Instala dependências de sistema para o chromium_headless_shell do Playwright
RUN ./node_modules/.bin/playwright install-deps chromium

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
RUN chown -R nextjs:nodejs /app/node_modules

RUN mkdir -p /app/storage/archive && chown -R nextjs:nodejs /app/storage

USER nextjs

# Instala o chromium_headless_shell do Playwright (otimizado para Docker, sem crashpad)
RUN npx playwright install chromium

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
