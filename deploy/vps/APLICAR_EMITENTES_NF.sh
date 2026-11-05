#!/usr/bin/env bash
# Correção pontual de emitentes com CNPJ/número/chave NF-e verificáveis.
# NÃO modifica valores, produtos, quantidades, pedidos ou notas.
set -euo pipefail
ROOT=/opt/apps/meus-controles
cd "$ROOT"
exec 8>/run/lock/meus-controles-emitentes-nf.lock
flock -n 8 || { echo "Outra conciliação já está em execução."; exit 1; }
COMPOSE=(docker compose --env-file "$ROOT/deploy/vps/.env.production" -f "$ROOT/deploy/vps/compose.yml")

echo "===== DIAGNOSTICO (SEM ALTERAR) ====="
"${COMPOSE[@]}" exec -T app python /srv/app/deploy/vps/CONCILIAR_EMITENTES_NF.py

echo
echo "===== BACKUP VERIFICADO ====="
bash "$ROOT/deploy/vps/BACKUP_PG.sh"

echo
echo "===== APLICACAO ATOMICA E AUDITAVEL ====="
"${COMPOSE[@]}" exec -T app python /srv/app/deploy/vps/CONCILIAR_EMITENTES_NF.py --apply

echo
echo "===== CONFERENCIA FINAL ====="
"${COMPOSE[@]}" exec -T app python /srv/app/deploy/vps/CONCILIAR_EMITENTES_NF.py
echo "Concluído. Atualize a aba Notas fiscais no navegador."
