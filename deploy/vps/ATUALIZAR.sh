#!/usr/bin/env bash
# Atualização sem recriar o volume de dados PostgreSQL da Central.
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo "Execute como root." >&2; exit 1; }
ROOT=/opt/apps/meus-controles
cd "$ROOT"
exec 9>/run/lock/meus-controles-update.lock
flock -n 9 || { echo "Outra atualização da Central está em andamento."; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  { echo "Arquivos versionados alterados localmente; atualização cancelada."; exit 1; }
[[ "$(git branch --show-current)" == "main" ]] ||
  { echo "Atualize apenas main."; exit 1; }
ENV="$ROOT/deploy/vps/.env.production"
COMPOSE=(docker compose --env-file "$ENV" -f "$ROOT/deploy/vps/compose.yml")
OLD="$(git rev-parse HEAD)"
git fetch --prune origin main
NEW="$(git rev-parse FETCH_HEAD)"
git merge-base --is-ancestor "$OLD" "$NEW" || { echo "A branch não está em fast-forward."; exit 1; }

echo "Salvando banco PostgreSQL antes da atualização..."
bash "$ROOT/deploy/vps/BACKUP_PG.sh"
if [[ "$OLD" == "$NEW" ]]; then echo "Código já atualizado."; exit 0; fi
git merge --ff-only "$NEW"
echo "Atualizando SOMENTE a API da Central..."
if ! "${COMPOSE[@]}" up -d --build --no-deps --wait app; then
  echo "Nova versão falhou; restaurando revisão anterior do código." >&2
  git reset --hard "$OLD"
  "${COMPOSE[@]}" up -d --build --no-deps app || true
  exit 1
fi
echo "Código atualizado e API no ar. Banco e outros aplicativos preservados."
