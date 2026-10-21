#!/usr/bin/env bash
# Implantação isolada em Docker; NÃO altera Caddy, GFARM, Pluviômetros ou Contas.
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo "Execute como root." >&2; exit 1; }
ROOT=/opt/apps/meus-controles
DOMAIN="${1:-controles.fazendanovohorizonte.com}"
[[ -f "$ROOT/deploy/vps/compose.yml" ]] || { echo "Faça clone em $ROOT primeiro." >&2; exit 1; }
[[ "$DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ && "$DOMAIN" == *.* && "$DOMAIN" != *..* ]] ||
  { echo "Domínio inválido." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker não está instalado." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose não está instalado." >&2; exit 1; }

ENV="$ROOT/deploy/vps/.env.production"
if [[ ! -e "$ENV" ]]; then
  umask 077
  PASSWORD="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
  printf 'CONTROLES_DOMAIN=%s\nCONTROLES_DB_PASSWORD=%s\n' "$DOMAIN" "$PASSWORD" > "$ENV"
  echo "Senha PostgreSQL exclusiva gerada na VPS (não exibida)."
else
  if ! grep -Fxq "CONTROLES_DOMAIN=$DOMAIN" "$ENV"; then
    echo "Esta instalação já pertence a outro domínio. Não alterei as credenciais." >&2
    exit 1
  fi
fi
chmod 0600 "$ENV"
COMPOSE=(docker compose --env-file "$ENV" -f "$ROOT/deploy/vps/compose.yml")
"${COMPOSE[@]}" config --quiet
systemctl enable --now docker >/dev/null
echo "Subindo SOMENTE o PostgreSQL e a API da Central..."
"${COMPOSE[@]}" up -d --build --wait
echo "Verificando serviço interno..."
"${COMPOSE[@]}" exec -T app python -c \
  "import urllib.request;urllib.request.urlopen('http://127.0.0.1:18765/api/health',timeout=8)"

# Anexa a instância Caddy já existente a uma rede SEM publicar portas.
if docker container inspect pluv-https-caddy-1 >/dev/null 2>&1; then
  if docker inspect pluv-https-caddy-1 --format '{{json .NetworkSettings.Networks}}' | grep -q '"meus-controles_interface_web"'; then
    echo "Caddy já participa da rede privada da Central."
  else
    docker network connect meus-controles_interface_web pluv-https-caddy-1
    echo "Caddy conectado à rede Docker da Central, sem reiniciar os outros serviços."
  fi
fi

install -d -m 0700 /opt/apps/backups/meus-controles
install -m 0644 "$ROOT/deploy/vps/meus-controles-pg-backup.service" \
  /etc/systemd/system/meus-controles-pg-backup.service
install -m 0644 "$ROOT/deploy/vps/meus-controles-pg-backup.timer" \
  /etc/systemd/system/meus-controles-pg-backup.timer
systemctl daemon-reload
systemctl enable --now meus-controles-pg-backup.timer
install -m 0644 "$ROOT/deploy/vps/meus-controles-watchdog.service" \
  /etc/systemd/system/meus-controles-watchdog.service
install -m 0644 "$ROOT/deploy/vps/meus-controles-watchdog.timer" \
  /etc/systemd/system/meus-controles-watchdog.timer
systemctl daemon-reload
systemctl enable --now meus-controles-watchdog.timer
bash "$ROOT/deploy/vps/BACKUP_PG.sh"
echo
echo "CENTRAL: Docker, PostgreSQL e watchdog ativados. Os outros projetos não foram alterados."
echo "API interna: central-controles-api:18765 (rede meus-controles_interface_web)."
echo "IMPORTANTE: adicione um novo site no Caddyfile existente com base em:"
echo "$ROOT/deploy/vps/Caddyfile.example"
echo "Depois crie o DNS para: https://$DOMAIN"
echo "Se há dados no PC, migre um BACKUP SQLite antes de começar a usar a VPS."
