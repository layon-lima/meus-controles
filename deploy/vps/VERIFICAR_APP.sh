#!/usr/bin/env bash
# Auto recuperação SOMENTE da API da Central (não reinicia PostgreSQL ou outros apps).
set -euo pipefail
ROOT=/opt/apps/meus-controles
ENV="$ROOT/deploy/vps/.env.production"
[[ -s "$ENV" ]] || exit 0
command -v docker >/dev/null || exit 0
COMPOSE=(docker compose --env-file "$ENV" -f "$ROOT/deploy/vps/compose.yml")
DB_ID="$("${COMPOSE[@]}" ps -q db)"
APP_ID="$("${COMPOSE[@]}" ps -q app)"
if [[ -z "$DB_ID" ]]; then
  echo "Banco da Central ausente: sem reinicialização automática para preservar dados."
  exit 1
fi
DB_HEALTH="$(docker inspect "$DB_ID" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
if [[ "$DB_HEALTH" != "healthy" ]]; then
  echo "PostgreSQL da Central não está saudável ($DB_HEALTH); API será preservada para diagnóstico."
  exit 1
fi
if [[ -z "$APP_ID" ]]; then
  echo "API da Central ausente: iniciando somente o contêiner app."
  "${COMPOSE[@]}" up -d --no-deps app
  exit 0
fi
STATE="$(docker inspect "$APP_ID" --format '{{.State.Status}}')"
HEALTH="$(docker inspect "$APP_ID" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
if [[ "$STATE" == "running" && "$HEALTH" == "healthy" ]]; then
  exit 0
fi
if [[ "$STATE" == "running" && "$HEALTH" == "starting" ]]; then
  exit 0
fi
echo "API da Central com estado $STATE / $HEALTH; recuperando somente app."
if [[ "$STATE" == "running" ]]; then
  "${COMPOSE[@]}" restart app
else
  "${COMPOSE[@]}" up -d --no-deps app
fi
