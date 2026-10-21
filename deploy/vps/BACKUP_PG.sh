#!/usr/bin/env bash
# Backup PostgreSQL completo da Central, sem interferir em outros bancos da VPS.
set -euo pipefail
ROOT=/opt/apps/meus-controles
BACKUP_DIR=/opt/apps/backups/meus-controles
COMPOSE=(docker compose --env-file "$ROOT/deploy/vps/.env.production" -f "$ROOT/deploy/vps/compose.yml")
umask 077
install -d -m 0700 "$BACKUP_DIR"
FILE="$BACKUP_DIR/controles_pg_$(date +%Y%m%d_%H%M%S).dump"
TEMP="$FILE.partial"
trap 'rm -f "$TEMP"' EXIT
"${COMPOSE[@]}" exec -T db pg_dump -U meus_controles -d meus_controles -Fc > "$TEMP"
test -s "$TEMP"
"${COMPOSE[@]}" exec -T db pg_restore -l < "$TEMP" >/dev/null
mv "$TEMP" "$FILE"
trap - EXIT
# 30 dias de retenção e ao menos os sete backups mais recentes.
mapfile -t sorted < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'controles_pg_*.dump' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
for ((i=7;i<${#sorted[@]};i++)); do
  if [[ "$(find "${sorted[i]}" -mtime +30 -print)" ]]; then rm -f -- "${sorted[i]}"; fi
done
echo "Backup PostgreSQL verificado: $FILE"
