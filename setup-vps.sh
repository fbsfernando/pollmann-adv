#!/usr/bin/env bash
# setup-vps.sh — Configura VPS Ubuntu do zero
# Executa como root: bash setup-vps.sh SEU_DOMINIO
# Ex: bash setup-vps.sh adv.pollmann.com.br

set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
    echo "Uso: bash setup-vps.sh SEU_DOMINIO"
    echo "Ex:  bash setup-vps.sh adv.pollmann.com.br"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup VPS — $DOMAIN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Pacotes base ───────────────────────────────────────────────────────────
apt-get update -q
apt-get install -y --no-install-recommends \
    curl git nginx certbot python3-certbot-nginx \
    ufw fail2ban
echo "✓ Pacotes instalados"

# ── 2. Docker ────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    echo "✓ Docker instalado"
else
    echo "✓ Docker já instalado"
fi

# ── 3. Firewall ───────────────────────────────────────────────────────────────
ufw --force enable
ufw allow ssh
ufw allow 'Nginx Full'
echo "✓ Firewall configurado (SSH + HTTP/HTTPS)"

# ── 4. Nginx ──────────────────────────────────────────────────────────────────
# Copia config substituindo o domínio
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
cp /opt/juridico-adv/app/nginx.conf "$NGINX_CONF"
sed -i "s/DOMINIO_AQUI/$DOMAIN/g" "$NGINX_CONF"
ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
echo "✓ Nginx configurado"

# ── 5. SSL com Certbot ────────────────────────────────────────────────────────
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" --redirect
echo "✓ SSL configurado para $DOMAIN"

# ── 6. Renovação automática SSL ───────────────────────────────────────────────
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
fi
echo "✓ Renovação automática SSL configurada"

# ── 7. Log rotation pipeline ──────────────────────────────────────────────────
cat > /etc/logrotate.d/juridico-pipeline << 'EOF'
/var/log/juridico-pipeline.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
}
EOF
echo "✓ Log rotation do pipeline configurado"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  VPS configurado!"
echo "  Próximo passo: cd /opt/juridico-adv/app && ./deploy.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
