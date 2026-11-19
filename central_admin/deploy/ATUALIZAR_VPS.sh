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
for cmd in curl tar docker python3 openssl; do command -v "$cmd" >/dev/null || fail "Programa ausente: $cmd"; done
[[ -s "$APP/deploy/.env.production" ]] || fail "Arquivo de configuracao da Central existente nao encontrado. Nao criar nova chave."
[[ -f "$APP/server.py" && -f "$COMPOSE" ]] || fail "Central atual nao encontrada."
docker compose version >/dev/null || fail "Docker Compose indisponivel."
docker inspect central-novo-horizonte-painel-1 >/dev/null 2>&1 \
  || fail "Conteiner da Central nao localizado. Nao reinstalar sobre dados existentes."

# Verificacao dos dois motores reais, sem tocar nos containers.
docker inspect contas-web-original-contas-web-1 meus-controles-app-1 >/dev/null 2>&1 \
  || fail "Containers originais do CONTAS ou dos Controles nao foram encontrados."
for net in contas-web-original_default meus-controles_interface_web meus-controles_banco_privado; do
  docker network inspect "$net" >/dev/null 2>&1 || fail "Rede privada ausente: $net"
done
curl -fsS --max-time 5 http://127.0.0.1:18769/health >/dev/null \
  || fail "Motor web do CONTAS nao respondeu na VPS."
CONTAS_ORIGIN="$(docker inspect contas-web-original-contas-web-1 --format \
  '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CONTAS_PUBLIC_ORIGIN=//p' | head -1)"
[[ "$CONTAS_ORIGIN" =~ ^https?://[a-zA-Z0-9.:-]+$ ]] \
  || fail "Origem efetiva do CONTAS nao identificada. Nenhuma alteracao aplicada."

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
log "Baixando o sistema unificado com modulos operacionais..."
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
# Sessao segura sem formulario de chave no navegador.
ENVFILE="$APP/deploy/.env.production"
setting(){ sed -n "s/^$1=//p" "$ENVFILE" | head -1; }
replace_setting(){
  local key="$1" value="$2"
  grep -v "^$key=" "$ENVFILE" >"$TMP/environment" || true
  mv "$TMP/environment" "$ENVFILE"
  printf '%s=%s\n' "$key" "$value" >>"$ENVFILE"
}
SESSION_SECRET="$(setting CENTRAL_SESSION_SECRET)"
PAIR_TOKEN="$(setting CENTRAL_PAIR_TOKEN)"
[[ -n "$SESSION_SECRET" ]] || SESSION_SECRET="$(openssl rand -hex 32)"
[[ -n "$PAIR_TOKEN" ]] || PAIR_TOKEN="$(openssl rand -hex 32)"
replace_setting CENTRAL_SESSION_SECRET "$SESSION_SECRET"
replace_setting CENTRAL_PAIR_TOKEN "$PAIR_TOKEN"
replace_setting CENTRAL_OPERATIONS_ENABLED 1
replace_setting CENTRAL_CONTAS_ORIGIN "$CONTAS_ORIGIN"
chmod 600 "$ENVFILE"
printf 'https://controles.fazendanovohorizonte.com/central/#parear=%s\n' "$PAIR_TOKEN" \
  > /root/CENTRAL_NH_PRIMEIRO_ACESSO.txt
chmod 600 /root/CENTRAL_NH_PRIMEIRO_ACESSO.txt

python3 -m compileall -q "$APP" || fail "Falha na verificacao de sintaxe Python."
if command -v node >/dev/null 2>&1; then
  node --check "$APP/static/app.js"
  node --check "$APP/static/operations.js"
fi
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

log "Verificando sessao protegida, dados e operacoes reais..."
# Testa o pareamento somente pela porta interna da VPS.
CODE="$(curl -sS -D "$TMP/headers" -o "$TMP/pair.json" -w '%{http_code}' \
  -X POST http://127.0.0.1:18771/api/pair \
  -H 'Origin: https://controles.fazendanovohorizonte.com' \
  -H 'Content-Type: application/json' \
  --data "{\"token\":\"$PAIR_TOKEN\"}")"
[[ "$CODE" == 200 ]] || fail "Falha ao parear navegador (HTTP $CODE)."
COOKIE="$(sed -n 's/^[Ss]et-[Cc]ookie: *\(central_nh_session=[^;]*\).*/\1/p' \
  "$TMP/headers" | tr -d '\r' | head -1)"
[[ -n "$COOKIE" ]] || fail "Cookie da sessao nao emitido."
for entry in 'api/resumo' \
             'modules/contas/' 'modules/funcionarios/' 'modules/documentos/' \
             'modules/controles/' 'modules/recebimentos/' \
             'modules/transportadoras/' 'modules/relatorios/'; do
  HTTP="$(curl -sS --max-time 25 -o "$TMP/response" -w '%{http_code}' \
    -H "Cookie: $COOKIE" "http://127.0.0.1:18771/$entry")"
  [[ "$HTTP" == 200 ]] || fail "Rota $entry indisponivel (HTTP $HTTP)."
  if [[ "$entry" == 'api/resumo' ]]; then
    cp "$TMP/response" "$TMP/resumo.json"
  else
    grep -Fq '/central/operations.css' "$TMP/response" \
      || fail "Tema comum nao encontrado em $entry."
    grep -Fq 'central-operational' "$TMP/response" \
      || fail "Classe de interface unica ausente em $entry."
  fi
done
python3 - "$TMP/resumo.json" <<'PY'
import json,sys
with open(sys.argv[1],encoding="utf-8") as f: report=json.load(f)
for key in ("contas","controles"):
    if not report.get("fontes",{}).get(key,{}).get("disponivel"):
        raise SystemExit("ERRO: fonte "+key+" indisponivel. Aplicacao anterior sera restaurada.")
print("OK: os dois bancos de dados estao conectados sem nenhuma escrita.")
PY
# A API de escrita precisa recusar uma tentativa sem Origin de navegador.
HTTP="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  --data '{}' http://127.0.0.1:18771/modules/contas/api/accounts)"
[[ "$HTTP" == 403 ]] || fail "Barreira contra escrita sem Origin nao funcionou."
SUCCESS=1
echo
echo "CENTRAL ATUALIZADA COM SUCESSO."
echo "ACESSO: https://controles.fazendanovohorizonte.com/central/"
echo "LAYOUT: Liquid Glass em toda a Central, sem barra lateral e com modulos separados."
echo "INTEGRACAO: formularios nativos de Contas, Recebimentos, Controles, Transportadoras e Funcionarios dentro da Central."
echo "PAREAMENTO UNICO: execute cat /root/CENTRAL_NH_PRIMEIRO_ACESSO.txt e abra a URL privada no navegador."
echo "Apos parear, nao e necessario digitar chaves: a sessao fica salva com cookie seguro."
echo "ACESSO: sem sessao pareada, nao e possivel consultar ou alterar dados financeiros."
echo "Bancos, Caddy, R2, Windows, GFARM e os aplicativos originais nao foram alterados."
