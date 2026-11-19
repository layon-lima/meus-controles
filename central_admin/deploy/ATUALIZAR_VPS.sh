#!/usr/bin/env bash
# Atualiza somente o painel Central Novo Horizonte ja existente na VPS.
# Preserva tokens internos, bancos, R2, Caddy, GFARM e demais apps.
set -Eeuo pipefail
umask 077

BASE="/opt/apps/central-novo-horizonte"
APP="$BASE/central_admin"
COMPOSE="$APP/deploy/compose.yml"
fail(){ printf 'ERRO: %s\n' "$*" >&2; exit 1; }
log(){ printf '\n==> %s\n' "$*"; }

[[ "$(id -u)" == "0" ]] || fail "Execute no terminal Ubuntu da VPS, como root."
for cmd in curl tar docker python3; do command -v "$cmd" >/dev/null || fail "Programa ausente: $cmd"; done
[[ -s "$APP/deploy/.env.production" ]] || fail "Arquivo de configuracao da Central existente nao encontrado. Nao criar nova chave."
[[ -f "$APP/server.py" && -f "$COMPOSE" ]] || fail "Central atual nao encontrada."
docker compose version >/dev/null || fail "Docker Compose indisponivel."
docker inspect central-novo-horizonte-painel-1 >/dev/null 2>&1 \
  || fail "Conteiner da Central nao localizado. Nao reinstalar sobre dados existentes."

TMP="$(mktemp -d)"
SUCCESS=0
rollback() {
  result=$?
  if [[ "$SUCCESS" != "1" && -d "$TMP/central_admin" ]]; then
    echo "Revertendo somente o painel da Central..."
    rm -rf "$APP"
    cp -a "$TMP/central_admin" "$APP"
    docker compose -f "$COMPOSE" up -d --build --no-deps painel || true
  fi
  rm -rf "$TMP"
  exit "$result"
}
trap rollback EXIT

log "Criando backup integral do codigo e das configuracoes atuais..."
cp -a "$APP" "$TMP/central_admin"
log "Obtendo nova interface de cards e integracao automatica..."
curl -fsSL --retry 2 \
  "https://api.github.com/repos/layon-lima/meus-controles/tarball/feature%2Fcentral-administrativa-v1" \
  -o "$TMP/central.tgz"
mkdir "$TMP/extract"
tar -xzf "$TMP/central.tgz" -C "$TMP/extract"
SOURCE="$(find "$TMP/extract" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -n "$SOURCE" && -f "$SOURCE/central_admin/server.py" ]] || fail "Download incompleto."
[[ -f "$SOURCE/central_admin/static/index.html" && -f "$SOURCE/central_admin/static/app.js" ]] \
  || fail "Interface nao encontrada no pacote."

log "Atualizando apenas o codigo da Central; preservando a configuracao de acesso..."
cp -a "$SOURCE/central_admin/." "$APP/"
# O repositorio nao possui .env.production. Confere, em vez de recriar.
cmp -s "$TMP/central_admin/deploy/.env.production" "$APP/deploy/.env.production" \
  || fail "Configuracao privada mudou inesperadamente. Publicacao cancelada."
python3 -m compileall -q "$APP/core.py" "$APP/server.py" || fail "Falha ao validar Python."
if command -v node >/dev/null 2>&1; then node --check "$APP/static/app.js"; fi
docker compose -f "$COMPOSE" config --quiet || fail "Docker Compose invalido."

log "Reconstruindo somente o container do painel..."
docker compose -f "$COMPOSE" up -d --build --no-deps painel
READY=0
for i in $(seq 1 25); do
  if curl -fsS --max-time 3 "http://127.0.0.1:18771/health" >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 2
done
[[ "$READY" == "1" ]] || fail "Painel nao respondeu. Versao anterior sera restaurada."

log "Conferindo dados reais pela API sem chave..."
HTTP="$(curl -sS --max-time 30 -o "$TMP/resumo.json" -w '%{http_code}' \
  "http://127.0.0.1:18771/api/resumo")"
[[ "$HTTP" == "200" ]] || fail "A API sem chave respondeu HTTP $HTTP. Versao anterior sera restaurada."
python3 - "$TMP/resumo.json" <<'PY'
import json,sys
with open(sys.argv[1],encoding="utf-8") as f:
    report=json.load(f)
if not report.get("ok"):
    raise SystemExit("ERRO: nenhuma base retornou dados.")
for name in ("contas","controles"):
    state=report.get("fontes",{}).get(name,{})
    if not state.get("disponivel"):
        raise SystemExit("ERRO: "+name+" indisponivel no painel: "+str(state.get("erro","sem detalhes")))
print("OK: contas e recebimentos conectados.")
PY
SUCCESS=1
echo
echo "CENTRAL ATUALIZADA COM SUCESSO."
echo "ACESSO: https://controles.fazendanovohorizonte.com/central/"
echo "LAYOUT: painel inicial com 8 cards, sem menu lateral e sem campo de chave."
echo "INTEGRACAO: contas e recebimentos carregados automaticamente em modo consulta."
echo "ATENCAO: sem autenticacao externa, os dados da API ficam visiveis a qualquer pessoa com o link."
echo "Bancos, Caddy, R2, Windows, GFARM e os aplicativos originais nao foram alterados."
