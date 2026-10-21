#!/usr/bin/env bash
# Migra um backup consistente do PC para o Postgres da VPS.
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo "Execute como root." >&2; exit 1; }
SOURCE="${1:-}"
if [[ -z "$SOURCE" || ! -f "$SOURCE" || -L "$SOURCE" ]]; then
  echo "Uso: bash deploy/vps/MIGRAR_BANCO.sh /root/controles-do-pc.db" >&2; exit 1
fi
SOURCE="$(realpath "$SOURCE")"
ROOT=/opt/apps/meus-controles
COMPOSE=(docker compose --env-file "$ROOT/deploy/vps/.env.production" -f "$ROOT/deploy/vps/compose.yml")
echo "O arquivo precisa ser um BACKUP SQLite obtido no painel do PC, não cópia de base em uso."
read -r -p "Digite MIGRAR para substituir a base inicial da VPS: " CONFIRM
[[ "$CONFIRM" == "MIGRAR" ]] || { echo "Cancelado."; exit 1; }
bash "$ROOT/deploy/vps/BACKUP_PG.sh"
"${COMPOSE[@]}" stop app
trap '"${COMPOSE[@]}" up -d app >/dev/null || true' EXIT
"${COMPOSE[@]}" run --rm --no-deps --user 0:0 \
  -v "$SOURCE:/import/controles.db:ro" app \
  python deploy/vps/MIGRAR_SQLITE_PG.py /import/controles.db
"${COMPOSE[@]}" up -d --wait app
trap - EXIT
echo "Migração concluída. Backup PostgreSQL anterior preservado em /opt/apps/backups/meus-controles."
echo "Não continue lançando no aplicativo local; passe a usar exclusivamente a VPS."
