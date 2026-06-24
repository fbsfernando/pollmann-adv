#!/bin/sh
set -e

# Sincroniza o schema do Prisma com o banco ANTES de subir o servidor.
# Evita o drift entre o código e o banco de produção — causa de erros 500
# pós-deploy quando o schema muda (ex.: tabelas/colunas/enums novos).
#
# Usa `db push` por ser o fluxo do projeto (sem pasta de migrations).
# SEM --accept-data-loss de propósito: mudanças destrutivas (drop de coluna
# com dados) falham aqui de forma explícita, em vez de corromper silenciosamente.
echo "[entrypoint] sincronizando schema (prisma db push)..."
node_modules/.bin/prisma db push --skip-generate

echo "[entrypoint] iniciando servidor..."
exec node server.js
