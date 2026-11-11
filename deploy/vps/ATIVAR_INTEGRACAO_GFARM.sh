#!/usr/bin/env bash
# Ativa o canal privado Meus Controles -> GFARM, com backups e teste real de autenticação.
# Nunca envia notas automaticamente nem contabiliza estoque.
set -Eeuo pipefail
umask 077

if (( EUID != 0 )); then echo "ERRO: execute como root." >&2; exit 1; fi

C=/opt/apps/meus-controles
GROOT=/opt/apps/gfarm/source
G="$GROOT/GFARM APP"
CENV="$C/deploy/vps/.env.production"
GENV="$G/backend/.env"
GC="$G/deploy/cloud/compose.yml"
CC="$C/deploy/vps/compose.yml"
ST="$(date +%Y%m%d-%H%M%S)"

exec 9>/run/lock/controles-gfarm-integracao.lock
flock -n 9 || { echo "ERRO: outra ativação já está em andamento." >&2; exit 1; }

check_files() {
  for file in "$CENV" "$GENV" "$GC" "$CC" "$C/deploy/vps/BACKUP_PG.sh"; do
    [[ -f "$file" ]] || { echo "ERRO: arquivo obrigatório ausente: $file" >&2; exit 1; }
  done
  for repo in "$C" "$GROOT"; do
    [[ -d "$repo/.git" ]] || { echo "ERRO: repositório ausente: $repo" >&2; exit 1; }
    [[ "$(git -C "$repo" branch --show-current)" == main ]] ||
      { echo "ERRO: use a branch main em $repo" >&2; exit 1; }
    [[ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ]] ||
      { echo "ERRO: há alterações locais versionadas em $repo; nada será sobrescrito." >&2; exit 1; }
  done
  docker info >/dev/null 2>&1 ||
    { echo "ERRO: Docker indisponível." >&2; exit 1; }
  docker network inspect gfarm_proxy >/dev/null 2>&1 ||
    { echo "ERRO: a rede privada gfarm_proxy não existe." >&2; exit 1; }
}
check_files

# As duas instalações usam banco próprio. Backup antes de renovar containers.
echo "[1/5] Criando backups dos dois bancos..."
bash "$C/deploy/vps/BACKUP_PG.sh"
GBACK="/opt/apps/backups/gfarm/integracao_$ST.sql.gz"
install -d -m 0700 /opt/apps/backups/gfarm
(
  cd "$G"
  docker compose -p gfarm --env-file backend/.env -f deploy/cloud/compose.yml \
    exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"'
) | gzip -c > "$GBACK"
[[ -s "$GBACK" ]] && gzip -t "$GBACK" ||
  { echo "ERRO: backup do GFARM inválido. Nenhuma atualização executada." >&2; exit 1; }
chmod 600 "$GBACK"

echo "[2/5] Atualizando o código do GFARM..."
git -C "$GROOT" pull --ff-only origin main
grep -q 'recebimentos_integracao_router' "$G/backend/app/main.py" ||
  { echo "ERRO: o GFARM local ainda não tem a API de recebimentos." >&2; exit 1; }

echo "[3/5] Instalando credencial idêntica nos dois apps..."
# Cópias locais protegidas (fora do Git), para recuperação se necessário.
cp -p -- "$CENV" "$CENV.antes-gfarm.$ST"
cp -p -- "$GENV" "$GENV.antes-gfarm.$ST"
chmod 600 "$CENV.antes-gfarm.$ST" "$GENV.antes-gfarm.$ST"
python3 - "$GENV" "$CENV" <<'PY'
import os,re,secrets,sys
from pathlib import Path
key="GFARM_RECEBIMENTOS_TOKEN"
paths=[Path(p) for p in sys.argv[1:]]
def existing(path):
    m=re.search(r"(?m)^\s*"+key+r"=([^\r\n]*)",path.read_text(encoding="utf-8"))
    return m.group(1).strip().strip("'\"") if m else ""
tokens=[existing(p) for p in paths]
# Preserve uma chave válida já existente. GFARM é a fonte primária.
token=next((t for t in tokens if re.fullmatch(r"[A-Za-z0-9_-]{32,256}",t)),None)
if not token: token=secrets.token_hex(32)
for path in paths:
    old=path.read_text(encoding="utf-8")
    lines=[line for line in old.splitlines() if not re.match(r"^\s*"+key+r"=",line)]
    path.write_text("\n".join(lines).rstrip()+"\n"+key+"="+token+"\n",encoding="utf-8")
    os.chmod(path,0o600)
print("Autenticação privada configurada (chave não exibida).")
PY

echo "[4/5] Recriando as APIs com a credencial nova..."
(
  cd "$G"
  docker compose -p gfarm --env-file backend/.env -f deploy/cloud/compose.yml \
    config --quiet
  docker compose -p gfarm --env-file backend/.env -f deploy/cloud/compose.yml \
    up -d --no-deps --build --wait app
)
# ATUALIZAR.sh faz backup e verifica todos os arquivos executados pelo contêiner.
(
  cd "$C"
  bash deploy/vps/ATUALIZAR.sh
)

echo "[5/5] Testando rede e segurança, sem criar ou enviar nota..."
(
  cd "$C"
  docker compose --env-file deploy/vps/.env.production -f deploy/vps/compose.yml \
    exec -T app python - <<'PY'
import json,os
from urllib import error,request
import receiving_gfarm

url=os.environ.get("GFARM_RECEBIMENTOS_URL","")
token=os.environ.get("GFARM_RECEBIMENTOS_TOKEN","")
assert len(token)>=32, "Controles não recebeu a chave no container"
assert receiving_gfarm._connection() is not None, "Canal GFARM não foi ativado no Controles"

endpoint=url.rstrip("/")+"/status/__teste_conexao_sem_envio__"

def code_for(secret):
    req=request.Request(endpoint,headers={"X-Integracao-Token":secret})
    try:
        with request.urlopen(req,timeout=12) as response:
            return response.status
    except error.HTTPError as e:
        return e.code

bad=code_for("token_incorreto_diagnostico")
good=code_for(token)
assert bad==401, f"GFARM não confirmou bloqueio de token incorreto: {bad}"
assert good==404, f"GFARM não confirmou autenticação correta: {good}"
print("OK: conexão privada, autenticação e API GFARM funcionando.")
PY
)
echo
echo "SUCESSO! Integração CONTROLES -> GFARM ativada."
echo "Abra o Controles > Recebimentos > Notas fiscais; marque e envie as notas escolhidas."
echo "Elas ficarão PENDENTES no GFARM até aprovação manual."
echo "Backups GFARM: $GBACK"
