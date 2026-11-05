#!/usr/bin/env bash
# Corrige exclusivamente os emitentes das 21 NF-e confirmadas pelo usuário.
# Não adiciona notas nem altera fornecedores de pedidos, valores ou quantidades.
set -euo pipefail
ROOT=/opt/apps/meus-controles
cd "$ROOT"
exec 8>/run/lock/meus-controles-21-nfs.lock
flock -n 8 || { echo "Já existe uma correção de NF-e em andamento."; exit 1; }
COMPOSE=(docker compose --env-file "$ROOT/deploy/vps/.env.production" -f "$ROOT/deploy/vps/compose.yml")
echo "===== 1/4 DIAGNOSTICO DAS 21 NOTAS EXISTENTES ====="
"${COMPOSE[@]}" exec -T app python /srv/app/deploy/vps/CORRIGIR_21_NFS.py
echo "===== 2/4 BACKUP DO POSTGRESQL ====="
bash "$ROOT/deploy/vps/BACKUP_PG.sh"
echo "===== 3/4 CORRIGINDO APENAS O EMITENTE (INCLUSIVE QUANDO JA PREENCHIDO) ====="
"${COMPOSE[@]}" exec -T app python /srv/app/deploy/vps/CORRIGIR_21_NFS.py --apply
echo "===== 4/4 CONFERINDO RESULTADO ====="
"${COMPOSE[@]}" exec -T app python /srv/app/deploy/vps/CORRIGIR_21_NFS.py
echo "Correção concluída. Recarregue a aba Notas fiscais no navegador."
