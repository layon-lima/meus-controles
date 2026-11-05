#!/usr/bin/env bash
# Aplica os nomes confirmados por produto a notas ja existentes do Recebimento.
# Executa diagnostico, backup PostgreSQL, atualizacao e conferencia final.
set -euo pipefail
ROOT=/opt/apps/meus-controles
cd "$ROOT"
exec 8>/run/lock/meus-controles-produtos-emitentes.lock
flock -n 8 || { echo "Outra correcao por produto ja esta em execucao."; exit 1; }
COMPOSE=(docker compose --env-file "$ROOT/deploy/vps/.env.production" -f "$ROOT/deploy/vps/compose.yml")

echo "===== 1/4 DIAGNOSTICO (SEM ALTERAR NADA) ====="
"${COMPOSE[@]}" exec -T app python /srv/app/deploy/vps/CORRIGIR_PRODUTOS_EMITENTES.py

echo "===== 2/4 BACKUP VERIFICADO ====="
bash "$ROOT/deploy/vps/BACKUP_PG.sh"

echo "===== 3/4 ALTERANDO EXCLUSIVAMENTE O EMITENTE DAS NOTAS ====="
"${COMPOSE[@]}" exec -T app python /srv/app/deploy/vps/CORRIGIR_PRODUTOS_EMITENTES.py --apply

echo "===== 4/4 CONFERENCIA FINAL ====="
"${COMPOSE[@]}" exec -T app python /srv/app/deploy/vps/CORRIGIR_PRODUTOS_EMITENTES.py
echo "Finalizado. Atualize a aba Notas fiscais."
