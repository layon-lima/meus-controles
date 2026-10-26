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
if [[ "$OLD" == "$NEW" ]]; then
  echo "Código Git já atualizado; verificando e reconstruindo a imagem Docker para aplicar a versão em execução."
else
  git merge --ff-only "$NEW"
fi
echo "Atualizando SOMENTE a API da Central..."
if ! "${COMPOSE[@]}" up -d --build --no-deps --wait app; then
  echo "Nova versão falhou; restaurando revisão anterior do código." >&2
  if [[ "$OLD" != "$NEW" ]]; then
    git reset --hard "$OLD"
    "${COMPOSE[@]}" up -d --build --no-deps app || true
  else
    echo "A origem Git não mudou. Veja o erro acima; o contêiner anterior não deve ser apagado." >&2
  fi
  exit 1
fi
echo "Verificando que o contêiner executa os MESMOS arquivos publicados..."
for file in app.py receiving.py static/receiving.js static/receiving.css; do
  expected="$(sha256sum "$ROOT/$file" | awk '{print $1}')"
  running="$("${COMPOSE[@]}" exec -T app sha256sum "/srv/app/$file" | awk '{print $1}')"
  if [[ "$expected" != "$running" ]]; then
    echo "ERRO: arquivo diferente na VPS e no contêiner: $file" >&2
    echo "Não considere a atualização concluída." >&2
    exit 1
  fi
done
echo "Verificando a versão reportada pela API em execução..."
"${COMPOSE[@]}" exec -T app python -c 'import json,urllib.request; d=json.load(urllib.request.urlopen("http://127.0.0.1:18765/api/health",timeout=10)); assert d.get("ok") and "release" in d, d; print("Versão ativa:",d["release"])'
echo "Revisão Git aplicada: $(git rev-parse --short HEAD)"
echo "Arquivos e API verificados. Banco PostgreSQL preservado. Atualização concluída."
