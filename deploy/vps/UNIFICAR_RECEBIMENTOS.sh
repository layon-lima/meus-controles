#!/usr/bin/env bash
# Unificacao segura e auditavel de 32 controles PEDIDOS na central de recebimentos.
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo "Execute como root." >&2; exit 1; }
ROOT=/opt/apps/meus-controles
cd "$ROOT"
exec 8>/run/lock/meus-controles-recebimentos.lock
flock -n 8 || { echo "Outra unificacao ja esta em andamento."; exit 1; }
COMPOSE=(docker compose --env-file "$ROOT/deploy/vps/.env.production" -f "$ROOT/deploy/vps/compose.yml")

echo "1/3: Validando os controles PEDIDOS e seus dados (somente leitura)..."
"${COMPOSE[@]}" exec -T app python /srv/app/receiving_consolidation.py

echo "2/3: Salvando BACKUP COMPLETO e testando a integridade do dump..."
bash "$ROOT/deploy/vps/BACKUP_PG.sh"

echo "3/3: Unificando em uma unica transacao, com arquivo de auditoria..."
"${COMPOSE[@]}" exec -T app python /srv/app/receiving_consolidation.py --apply

echo "Verificacao final:"
"${COMPOSE[@]}" exec -T app python /srv/app/receiving_consolidation.py
echo "Concluido. Atualize a pasta RECEBIMENTOS no navegador."
