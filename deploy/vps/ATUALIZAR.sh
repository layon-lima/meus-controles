#!/usr/bin/env bash
# Atualização manual: salva backup, testa sintaxe, aplica main e verifica saúde.
set -euo pipefail
if [[ "$EUID" -ne 0 ]]; then echo "Execute com sudo/root." >&2; exit 1; fi
ROOT=/opt/apps/meus-controles
cd "$ROOT"
exec 9>/run/lock/meus-controles-update.lock
flock -n 9 || { echo "Já há uma atualização em execução."; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  { echo "Há alterações locais: atualização abortada para proteger arquivos."; exit 1; }
[[ "$(git branch --show-current)" == "main" ]] ||
  { echo "Atualize somente a branch main."; exit 1; }
OLD="$(git rev-parse HEAD)"
git fetch --prune origin main
NEW="$(git rev-parse FETCH_HEAD)"
git merge-base --is-ancestor "$OLD" "$NEW" ||
  { echo "Main divergiu: atualização interrompida, sem reset automático."; exit 1; }

echo "Criando backup íntegro antes de atualizar..."
runuser -u meuscontroles -- env CONTROLES_DATA_DIR=/var/lib/meus-controles \
  CONTROLES_BACKUP_DIR=/var/backups/meus-controles \
  /usr/bin/python3 "$ROOT/deploy/vps/BACKUP.py"
if [[ "$OLD" == "$NEW" ]]; then
  systemctl is-active --quiet meus-controles || systemctl start meus-controles
  echo "Código já está atualizado."
  exit 0
fi

git merge --ff-only "$NEW"
if ! python3 -m compileall -q app.py controller pair.py pair_records.py \
   pair_financial_import.py pair_mixed_import.py truck.py debt.py \
   open_debt.py receiving.py tests; then
  echo "Código falhou na validação de sintaxe: restaurando revisão anterior." >&2
  git reset --hard "$OLD"
  exit 1
fi

systemctl restart meus-controles.service
OK=0
for i in {1..12}; do
  if curl --fail --silent --max-time 4 http://127.0.0.1:18765/api/health >/dev/null; then
    OK=1; break
  fi
  sleep 2
done
if [[ "$OK" -ne 1 ]]; then
  echo "Nova versão não iniciou; restaurando código anterior (banco permanece intacto)." >&2
  git reset --hard "$OLD"
  systemctl restart meus-controles.service
  exit 1
fi
echo "Central atualizada e respondendo. Revisão: $(git rev-parse --short HEAD)"
