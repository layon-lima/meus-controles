#!/usr/bin/env bash
# Instalador de um host HTTPS dedicado, sem mexer nos outros aplicativos da VPS.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute com sudo/root." >&2; exit 1
fi
DOMAIN="${1:-}"
EMAIL="${2:-}"
USERNAME="${3:-admin}"
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ || "$DOMAIN" != *.* || "$DOMAIN" == *..* ]]; then
  echo "Uso: sudo bash deploy/vps/INSTALAR.sh controles.seudominio.com email@seudominio.com [usuario]" >&2; exit 1
fi
if [[ ! "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Informe um e-mail válido para o certificado HTTPS." >&2; exit 1
fi
if [[ ! "$USERNAME" =~ ^[a-zA-Z0-9_.-]{1,40}$ ]]; then
  echo "Usuário inválido." >&2; exit 1
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "$ROOT" != "/opt/apps/meus-controles" ]]; then
  echo "Faça o clone em /opt/apps/meus-controles antes de instalar. Atual: $ROOT" >&2; exit 1
fi
if ! getent ahostsv4 "$DOMAIN" >/dev/null; then
  echo "O domínio $DOMAIN ainda não resolve no DNS. Crie o registro A antes da instalação." >&2; exit 1
fi
if [[ -e /etc/nginx/sites-enabled/meus-controles.conf &&
      ! -L /etc/nginx/sites-enabled/meus-controles.conf ]]; then
  echo "Site Nginx existente não é um link; não vou sobrescrever." >&2; exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3 nginx certbot apache2-utils curl
id -u meuscontroles >/dev/null 2>&1 || useradd --system --home-dir /var/lib/meus-controles --shell /usr/sbin/nologin meuscontroles
install -d -o meuscontroles -g meuscontroles -m 0700 /var/lib/meus-controles
install -d -o meuscontroles -g meuscontroles -m 0700 /var/backups/meus-controles
install -d -m 0755 /var/www/letsencrypt/.well-known/acme-challenge
install -d -m 0755 /etc/nginx/sites-available /etc/nginx/sites-enabled

if [[ ! -f /etc/nginx/.htpasswd-meus-controles ]]; then
  echo "Defina uma senha forte para a Central de Controles. Ela não aparecerá na tela."
  htpasswd -cB /etc/nginx/.htpasswd-meus-controles "$USERNAME"
else
  echo "Senha existente mantida. Para alterar: sudo htpasswd -B /etc/nginx/.htpasswd-meus-controles $USERNAME"
fi
chown root:www-data /etc/nginx/.htpasswd-meus-controles
chmod 0640 /etc/nginx/.htpasswd-meus-controles

printf 'CONTROLES_PUBLIC_ORIGIN=https://%s\n' "$DOMAIN" > /etc/meus-controles.env
chown root:root /etc/meus-controles.env
chmod 0600 /etc/meus-controles.env

install -m 0644 "$ROOT/deploy/vps/meus-controles.service" /etc/systemd/system/meus-controles.service
install -m 0644 "$ROOT/deploy/vps/meus-controles-backup.service" /etc/systemd/system/meus-controles-backup.service
install -m 0644 "$ROOT/deploy/vps/meus-controles-backup.timer" /etc/systemd/system/meus-controles-backup.timer
install -m 0644 "$ROOT/deploy/vps/meus-controles-health.service" /etc/systemd/system/meus-controles-health.service
install -m 0644 "$ROOT/deploy/vps/meus-controles-health.timer" /etc/systemd/system/meus-controles-health.timer
systemctl daemon-reload

CONF=/etc/nginx/sites-available/meus-controles.conf
if [[ -f "$CONF" ]] && ! grep -q "server_name $DOMAIN;" "$CONF"; then
  echo "Já existe uma configuração da Central para outro domínio. Não vou sobrescrever $CONF." >&2; exit 1
fi
# Antes de emitir o certificado, somente o desafio ACME fica acessível em HTTP.
if [[ ! -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  cat > "$CONF" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
    }
    location / { return 404; }
}
NGINX
  ln -sfn "$CONF" /etc/nginx/sites-enabled/meus-controles.conf
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
  certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" \
    --email "$EMAIL" --agree-tos --non-interactive --keep-until-expiring
fi

cat > "$CONF" <<NGINX
# A Central roda somente em localhost:18765; Nginx termina HTTPS e pede senha.
server {
    listen 80;
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
    }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    server_name $DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    client_max_body_size 1m;

    auth_basic "Central de Controles";
    auth_basic_user_file /etc/nginx/.htpasswd-meus-controles;

    location / {
        proxy_pass http://127.0.0.1:18765;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:18765;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 10s;
        proxy_read_timeout 90s;
    }
}
NGINX

ln -sfn "$CONF" /etc/nginx/sites-enabled/meus-controles.conf
nginx -t
systemctl reload nginx
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/meus-controles-nginx.sh <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/meus-controles-nginx.sh

systemctl enable --now meus-controles.service
systemctl enable --now meus-controles-backup.timer meus-controles-health.timer
for i in {1..10}; do
  if curl --fail --silent --max-time 4 http://127.0.0.1:18765/api/health >/dev/null; then
    echo "Central no ar: https://$DOMAIN"
    echo "Serviço: systemctl status meus-controles --no-pager"
    echo "Backups: /var/backups/meus-controles/"
    exit 0
  fi
  sleep 1
done
echo "O serviço não respondeu. Verifique: journalctl -u meus-controles -n 80 --no-pager" >&2
exit 1
