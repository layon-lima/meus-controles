#!/usr/bin/env bash
# Central Novo Horizonte - instalador seguro (VPS Ubuntu).
set -Eeuo pipefail
umask 077
APP=/opt/apps/central-novo-horizonte
CONTAS=/opt/apps/contas-runtime/data/controle_contas.db
CADDY=pluv-https-caddy-1
CADDYFILE=/opt/apps/pluviometros/source/deploy/Caddyfile
die(){ echo "ERRO: $*" >&2; exit 1; }
note(){ printf '\n==> %s\n' "$*"; }
[[ "$(id -u)" == 0 ]] || die "Execute na VPS como root."
for x in docker curl tar python3 openssl; do command -v "$x" >/dev/null || die "Falta: $x"; done
docker info >/dev/null 2>&1 || die "Docker indisponivel."
docker compose version >/dev/null || die "Docker Compose indisponivel."
[[ -s "$CONTAS" ]] || die "Banco ativo do Contas nao encontrado em $CONTAS; nao instalar."
[[ -f "$CADDYFILE" ]] || die "Caddyfile nao encontrado."
for x in meus-controles-db-1 "$CADDY"; do docker inspect "$x" >/dev/null || die "Container ausente: $x"; done
for x in meus-controles_banco_privado meus-controles_interface_web; do docker network inspect "$x" >/dev/null || die "Rede ausente: $x"; done
python3 - "$CADDY" "$CADDYFILE" <<'PY'
import json,subprocess,sys
obj=json.loads(subprocess.check_output(["docker","inspect",sys.argv[1]]))[0]
if not any(m.get("Source")==sys.argv[2] and m.get("Destination")=="/etc/caddy/Caddyfile" for m in obj.get("Mounts",[])):
    raise SystemExit("ERRO: montagem Caddyfile diferente. Sem alteracoes.")
if "meus-controles_interface_web" not in obj.get("NetworkSettings",{}).get("Networks",{}):
    raise SystemExit("ERRO: Caddy fora da rede do Meus Controles.")
PY
note "Conferindo bancos originais (somente leitura)..."
docker exec meus-controles-db-1 psql -U meus_controles -d meus_controles -v ON_ERROR_STOP=1 -Atc "SELECT (SELECT count(*) FROM purchase_items),(SELECT count(*) FROM purchase_receipts)" >/dev/null || die "Tabelas de recebimentos indisponiveis."
python3 - "$CONTAS" <<'PY'
import sqlite3,sys
con=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
try:
    con.execute("PRAGMA query_only=ON")
    con.execute("SELECT COUNT(*) FROM contas").fetchone()
    con.execute("SELECT COUNT(*) FROM pagamentos").fetchone()
finally: con.close()
PY
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
note "Obtendo a Central sem atualizar os outros aplicativos..."
curl -fsSL --retry 2 "https://api.github.com/repos/layon-lima/meus-controles/tarball/feature%2Fcentral-administrativa-v1" -o "$TMP/code.tgz"
mkdir -p "$TMP/source"
tar -xzf "$TMP/code.tgz" -C "$TMP/source"
SOURCE="$(find "$TMP/source" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -n "$SOURCE" && -f "$SOURCE/central_admin/server.py" && -f "$SOURCE/central_admin/deploy/compose.yml" ]] || die "Arquivos incompletos."
mkdir -p "$APP/central_admin"
cp -a "$SOURCE/central_admin/." "$APP/central_admin/"
chmod 700 "$APP" "$APP/central_admin/deploy"
note "Criando credencial de consulta somente leitura..."
PGPASS="$(openssl rand -hex 32)"
TOKEN="$(openssl rand -hex 32)"
docker exec -i meus-controles-db-1 psql -U meus_controles -d meus_controles -v ON_ERROR_STOP=1 >/dev/null <<SQL
DO \$\$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='central_nh_ro') THEN
  CREATE ROLE central_nh_ro LOGIN PASSWORD '$PGPASS';
 ELSE
  ALTER ROLE central_nh_ro LOGIN PASSWORD '$PGPASS';
 END IF;
END
\$\$;
GRANT CONNECT ON DATABASE meus_controles TO central_nh_ro;
GRANT USAGE ON SCHEMA public TO central_nh_ro;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM central_nh_ro;
GRANT SELECT ON public.purchase_items,public.purchase_receipts TO central_nh_ro;
ALTER ROLE central_nh_ro SET default_transaction_read_only=on;
SQL
cat > "$APP/central_admin/deploy/.env.production" <<EOF
CENTRAL_TOKEN=$TOKEN
CENTRAL_CONTROLES_DSN=postgresql://central_nh_ro:$PGPASS@db:5432/meus_controles
EOF
chmod 600 "$APP/central_admin/deploy/.env.production"
printf '%s\n' "$TOKEN" > /root/CENTRAL_NH_CHAVE.txt
chmod 600 /root/CENTRAL_NH_CHAVE.txt
note "Iniciando somente o container novo..."
docker compose -f "$APP/central_admin/deploy/compose.yml" up -d --build --no-deps painel
for i in $(seq 1 20); do
  if curl -fsS --max-time 3 http://127.0.0.1:18771/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS --max-time 5 http://127.0.0.1:18771/health >/dev/null || die "Container novo sem resposta; Caddy nao foi alterado."
HTTP="$(curl -sS --max-time 15 -o "$TMP/status.json" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18771/api/resumo)"
[[ "$HTTP" == 200 ]] || die "Central nao consultou os bancos. Caddy nao foi alterado."
python3 - "$TMP/status.json" <<'PY'
import json,sys
with open(sys.argv[1]) as f: result=json.load(f)
for source in ("contas","controles"):
    if not result["fontes"][source]["disponivel"]:
        raise SystemExit("ERRO: base "+source+" nao conectou. Nao publicar.")
print("OK: bancos conectados somente para leitura.")
PY
note "Adicionando /central/ ao dominio existente, com backup e rollback..."
python3 - "$CADDY" "$CADDYFILE" <<'PY'
from pathlib import Path
from datetime import datetime
import os,re,subprocess,sys
caddy=sys.argv[1]; p=Path(sys.argv[2])
domain="controles.fazendanovohorizonte.com"
old="reverse_proxy central-controles-api:18765"
new="""handle_path /central/* {
        reverse_proxy central-nh:18771
    }
    handle {
        reverse_proxy central-controles-api:18765
    }"""
def cmd(*args):
    subprocess.run(args,check=True,timeout=60,stdout=subprocess.DEVNULL)
cmd("docker","exec",caddy,"caddy","validate","--config","/etc/caddy/Caddyfile","--adapter","caddyfile")
original=p.read_text(encoding="utf-8")
matches=list(re.finditer(r"(?m)^"+re.escape(domain)+r"\s*\{[ \t]*$",original))
if len(matches)!=1: raise SystemExit("ERRO: dominio Caddy nao identificado unicamente. Sem alteracoes.")
start=original.find("{",matches[0].start())
depth=0;end=None
for i in range(start,len(original)):
    if original[i]=="{": depth+=1
    elif original[i]=="}":
        depth-=1
        if depth==0: end=i; break
if end is None: raise SystemExit("ERRO: Caddyfile inconsistente.")
body=original[start+1:end].strip()
if body==new.strip():
    print("Rota /central/ ja existe, sem modificacao.")
    raise SystemExit(0)
if body!=old:
    raise SystemExit("ERRO: regras atuais diferentes do esperado. Nao sobrescrever Caddy.")
updated=original[:start+1]+"\n    "+new+"\n"+original[end:]
backupdir=Path("/root/caddy-config-backups")
backupdir.mkdir(parents=True,exist_ok=True,mode=0o700)
backup=backupdir/("Caddyfile_pre_central_"+datetime.now().strftime("%Y%m%d_%H%M%S")+".bak")
backup.write_text(original,encoding="utf-8")
backup.chmod(0o600)
try:
    with p.open("w",encoding="utf-8") as f:
        f.write(updated);f.flush();os.fsync(f.fileno())
    cmd("docker","exec",caddy,"caddy","validate","--config","/etc/caddy/Caddyfile","--adapter","caddyfile")
    cmd("docker","exec",caddy,"caddy","reload","--config","/etc/caddy/Caddyfile","--adapter","caddyfile")
except Exception:
    with p.open("w",encoding="utf-8") as f:
        f.write(original);f.flush();os.fsync(f.fileno())
    try: cmd("docker","exec",caddy,"caddy","reload","--config","/etc/caddy/Caddyfile","--adapter","caddyfile")
    except Exception: print("ATENCAO: conferir restauracao do Caddy.",file=sys.stderr)
    raise
print("Backup do Caddy:",backup)
PY
echo
echo "CENTRAL INSTALADA: https://controles.fazendanovohorizonte.com/central/"
echo "CHAVE PRIVADA: cat /root/CENTRAL_NH_CHAVE.txt"
echo "ETAPA INICIAL: painel integrado somente leitura, sem pagamentos automaticos."
echo "Contas, Controles, GFARM, PLUV, R2 e Windows preservados."
