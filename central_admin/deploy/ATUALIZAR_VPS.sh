#!/usr/bin/env bash
# Atualiza somente o painel Central Novo Horizonte ja existente na VPS.
# Preserva tokens internos, bancos, R2, Caddy, GFARM e demais apps.
set -Eeuo pipefail
umask 077
printf 'Instalador Central: fretes-modal-20261127-r1\n'

BASE="/opt/apps/central-novo-horizonte"
APP="$BASE/central_admin"
COMPOSE="$APP/deploy/compose.yml"
fail(){ printf 'ERRO: %s\n' "$*" >&2; exit 1; }
log(){ printf '\n==> %s\n' "$*"; }

[[ "$(id -u)" == "0" ]] || fail "Execute no terminal Ubuntu da VPS, como root."
for cmd in curl tar docker python3 openssl; do command -v "$cmd" >/dev/null || fail "Programa ausente: $cmd"; done
# Banco privativo da integração. Não modifica bancos originais.
mkdir -p -m 0700 "$BASE/data"
chmod 0700 "$BASE/data"
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
  "https://api.github.com/repos/layon-lima/meus-controles/tarball/${CENTRAL_SOURCE_REF:-feature%2Fcentral-administrativa-v1}" \
  -o "$TMP/central.tgz"
mkdir "$TMP/extract"
tar -xzf "$TMP/central.tgz" -C "$TMP/extract"
SOURCE="$(find "$TMP/extract" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -n "$SOURCE" && -f "$SOURCE/central_admin/server.py" ]] || fail "Download incompleto."
[[ -f "$SOURCE/central_admin/static/index.html" && -f "$SOURCE/central_admin/static/app.js" &&
    -f "$SOURCE/central_admin/static/launcher.js" &&
    -f "$SOURCE/central_admin/static/entry-preflight.js" &&
    -f "$SOURCE/central_admin/static/route-preflight.js" &&
    -f "$SOURCE/central_admin/static/launcher.css" &&
    -f "$SOURCE/central_admin/static/horizon-theme.css" &&
    -f "$SOURCE/central_admin/static/horizon-logo.svg" &&
    -f "$SOURCE/central_admin/static/recebimentos.html" &&
    -f "$SOURCE/central_admin/static/recebimentos.js" &&
    -f "$SOURCE/central_admin/static/recebimentos_imports.js" &&
    -f "$SOURCE/central_admin/static/recebimentos.css" &&
    -f "$SOURCE/central_admin/static/contas_batch.js" &&
    -f "$SOURCE/central_admin/static/contas_batch.css" &&
    -f "$SOURCE/central_admin/static/contas_pdf_review.css" &&
    -f "$SOURCE/central_admin/static/contas_pdf_review.js" &&
    -f "$SOURCE/central_admin/vales_holerites.py" &&
    -f "$SOURCE/central_admin/static/vales_holerites.css" &&
    -f "$SOURCE/central_admin/static/vales_holerites.js" &&
    -f "$SOURCE/central_admin/funcionarios.py" &&
    -f "$SOURCE/central_admin/static/funcionarios.html" &&
    -f "$SOURCE/central_admin/static/funcionarios.js" &&
    -f "$SOURCE/central_admin/static/funcionarios.css" &&
    -f "$SOURCE/central_admin/static/holerites_vales.js" &&
    -f "$SOURCE/central_admin/static/holerites_vales.css" ]] \
  || fail "Arquivos da Central, Recebimentos ou fila de Contas ausentes."

python3 "$SOURCE/central_admin/css_validation.py" "$SOURCE/central_admin/static" \
  || fail "CSS estruturalmente invalido. Publicacao recusada antes da copia."

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
  node --check "$APP/static/confirm-actions.js"
  node --check "$APP/static/form-drafts.js"
  node --check "$APP/static/app.js"
  node --check "$APP/static/operations.js"
  node --check "$APP/static/launcher.js"
  node --check "$APP/static/entry-preflight.js"
  node --check "$APP/static/route-preflight.js"
  node --check "$APP/static/recebimentos.js"
  node --check "$APP/static/recebimentos_imports.js"
  node --check "$APP/static/contas_batch.js"
  node --check "$APP/static/contas_pdf_review.js"
  node --check "$APP/static/vales_holerites.js"
  node --check "$APP/static/funcionarios.js"
  node --check "$APP/static/holerites_vales.js"
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
# Links da Central enviados por outros aplicativos precisam funcionar
# no primeiro clique; a validação de Origem continua protegendo escritas.
grep -Ei '^[Ss]et-[Cc]ookie:' "$TMP/headers" | grep -Fq 'SameSite=Lax' \
  || fail "Cookie da Central não aceita navegação por links externos."
# Numa sessão Strict antiga o primeiro GET externo pode chegar sem cookie.
# Navegação HTML vai à Home; chamadas de API continuam retornando 401.
CODE="$(curl -sS --max-time 6 -D "$TMP/external-headers" -o /dev/null \
  -w '%{http_code}' -H 'Accept: text/html,application/xhtml+xml' \
  -H 'Sec-Fetch-Mode: navigate' \
  'http://127.0.0.1:18771/modules/funcionarios/?utm_source=chatgpt.com')"
[[ "$CODE" == 303 ]] || fail "Link externo não recupera navegação por sessão (HTTP $CODE)."
grep -Ei '^Location: /central/\?abrir=funcionarios' "$TMP/external-headers" >/dev/null \
  || fail "A Central não retorna ao módulo Funcionários após validar a sessão."
CODE="$(curl -sS --max-time 6 -o /dev/null -w '%{http_code}' \
  -H 'Accept: application/json' \
  http://127.0.0.1:18771/modules/contas/api/accounts)"
[[ "$CODE" == 401 ]] || fail "API de Contas poderia ser consultada sem sessão (HTTP $CODE)."
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
    if [[ "$entry" == 'modules/contas/' ]]; then
      grep -Fq '/central/contas_batch.js' "$TMP/response" \
        || fail "Fila de Contas não foi incluída no módulo."
      grep -Fq '/central/contas_batch.css' "$TMP/response" \
        || fail "Estilo da fila de Contas não foi incluído."
      grep -Fq '/central/contas_pdf_review.css' "$TMP/response" \
        || fail "Layout de revisão de PDF lado a lado não carregado."
      grep -Fq '/central/contas_pdf_review.js' "$TMP/response" \
        || fail "Visualizador de PDF da Central não carregado."
      grep -Fq '/central/vales_holerites.js' "$TMP/response" \
        || fail "Cálculo de vales não incluído no holerite."
      grep -Fq '/central/vales_holerites.css' "$TMP/response" \
        || fail "Layout de vales não incluído no holerite."
      grep -Fq '/central/holerites_vales.js' "$TMP/response" \
        || fail "A lista de Holerites não carrega os vales."
      grep -Fq '/central/holerites_vales.css' "$TMP/response" \
        || fail "Estilo dos vales na lista de Holerites ausente."
      curl -fsS --max-time 8 -D "$TMP/contas-csp" -o /dev/null \
        -H "Cookie: $COOKIE" http://127.0.0.1:18771/modules/contas/ \
        || fail "Não foi possível conferir segurança do visualizador de PDF."
      grep -Ei '^[Cc]ontent-[Ss]ecurity-[Pp]olicy:' "$TMP/contas-csp" \
        | grep -Fq "frame-src 'self' blob:" \
        || fail "Navegador bloquearia o PDF incorporado por causa da política CSP."
      grep -Ei '^[Cc]ontent-[Ss]ecurity-[Pp]olicy:' "$TMP/contas-csp" \
        | grep -Fq "frame-ancestors 'none'" \
        || fail "Proteção contra incorporação externa foi alterada."
    fi
    if [[ "$entry" == 'modules/funcionarios/' ]]; then
      # Página AUTORAL: não deve carregar o frontend de Contas por baixo.
      grep -Fq '/central/funcionarios.js' "$TMP/response" \
        || fail "A tela nativa de Funcionários não foi carregada."
      grep -Fq 'id="staffList"' "$TMP/response" \
        || fail "Lista consolidada de funcionários ausente."
      if grep -Fq '/central/modules/funcionarios/app.js' "$TMP/response"; then
        fail "Funcionários continua abrindo a interface antiga do Contas."
      fi
    fi
    if [[ "$entry" == 'modules/recebimentos/' ]]; then
      # O módulo próprio já é entregue pronto pelo servidor. NUNCA carregar
      # o HTML de Controles para depois substituí-lo por JavaScript.
      grep -Fq '/central/recebimentos.js' "$TMP/response" \
        || fail "Tela nativa de Recebimentos ausente."
      grep -Fq '/central/recebimentos_imports.js' "$TMP/response" \
        || fail "Importadores nativos não foram carregados."
      if grep -Fq '/central/modules/recebimentos/static/app.js' "$TMP/response"; then
        fail "Recebimentos ainda esta carregando o frontend antigo."
      fi
    elif [[ "$entry" != 'modules/funcionarios/' ]]; then
      grep -Fq '/central/operations.css' "$TMP/response" \
        || fail "Tema comum nao encontrado em $entry."
      # Controles / Transportadoras / Relatorios / Contas / Documentos
      # devem bloquear a Home intermediaria ANTES dos scripts do motor.
      grep -Fq '/central/route-preflight.js?v=20261123route1' "$TMP/response" \
        || fail "Modulo $entry ainda monta Home antiga antes do controle."
      grep -Fq '/central/operations.js?v=20261127fretesmodal1' "$TMP/response" \
        || fail "Modulo $entry sem navegador direto atualizado."
    fi
    grep -Fq '/central/launcher.js' "$TMP/response" \
      || fail "Botao flutuante nao encontrado em $entry."
    grep -Fq '/central/launcher.css' "$TMP/response" \
      || fail "Estilo da animacao ausente em $entry."
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
# O novo módulo deve acessar os contratos reais do motor, sem sessão falsa.
# Os arquivos devem existir antes de qualquer publicação.
for asset in recebimentos.js recebimentos_imports.js recebimentos.css funcionarios.html funcionarios.js funcionarios.css; do
  HTTP="$(curl -sS --max-time 8 -o "$TMP/native-asset" -w '%{http_code}' \
    "http://127.0.0.1:18771/$asset")"
  [[ "$HTTP" == 200 ]] || fail "Recurso nativo $asset indisponível."
done
# A navegação da Central nunca deve exibir a Home antiga ao abrir controle.
grep -Fq 'document.body.append(popup)' "$APP/static/operations.js" || fail "Popup do lapis nao instalado."
grep -Fq 'Encerrar controle' "$APP/static/operations.js" || fail "Acao encerrar ausente."
grep -Fq '.nh-control-popup' "$APP/static/operations.css" || fail "Estilo do popup ausente."
grep -Fq 'function defaultFreightControl(state)' "$APP/static/operations.js" || fail "Entrada direta de Transportadoras ausente."
grep -Fq 'function installFreightWindow(app)' "$APP/static/operations.js" || fail "Janela flutuante de fretes ausente."
grep -Fq 'function freightWindowPosition(' "$APP/static/operations.js" || fail "Limites de arraste ausentes."
grep -Fq '.truck-entry-form.nh-freight-floating' "$APP/static/operations.css" || fail "Estilo da janela de fretes ausente."
grep -Fq 'this.navigate("control",freightOpening,{replace:true})' "$APP/static/operations.js" || fail "Transportadoras ainda depende da lista de controles."
grep -Fq 'function paintTargetWhileLoading(' "$APP/static/operations.js" \
  || fail "Navegação ainda deixa a tela anterior visível ao abrir controle."
grep -Fq 'function releaseEntryAfterRealRender(' "$APP/static/operations.js" \
  || fail "Controle pode aparecer depois da Home por falta de hidratação de rota."
grep -Fq 'nh-route-boot' "$APP/static/route-preflight.js" \
  || fail "Bloqueio de primeira pintura não está instalado."
grep -Fq 'html.nh-route-boot body :is(.app-shell,.app)' "$APP/static/operations.css" \
  || fail "A Home antiga ainda pode ser pintada antes do controle."
grep -Fq 'nh-module-redirect' "$APP/static/entry-preflight.js" \
  || fail "Navegação por sessão ainda expõe página inicial intermediária."
grep -Fq 'if (openRequestedModuleAfterAuth()) return;' "$APP/static/app.js" \
  || fail "Redirecionamento pode montar a Home antes do módulo escolhido."
HTTP="$(curl -sS --max-time 8 -o "$TMP/route-asset" -w '%{http_code}' \
  "http://127.0.0.1:18771/route-preflight.js")"
[[ "$HTTP" == 200 ]] || fail "Script de navegação direta não está acessível (HTTP $HTTP)."
echo "OK: navegação direta com guarda de pintura e carregamento por destino."
# Identidade original Horizonte: uma única logo, uma única paleta, todos
# os módulos recebem a mesma folha de estilo DEPOIS do CSS original.
for page in index recebimentos funcionarios; do
  grep -Fq '/central/horizon-theme.css?v=20261125detail3' "$APP/static/$page.html" \
    || fail "Pagina $page sem tema unificado do Horizonte."
  grep -Fq '/central/horizon-logo.svg?v=1' "$APP/static/$page.html" \
    || fail "Pagina $page sem logotipo original do Horizonte."
done
grep -Fq 'horizon-theme.css?v=20261125detail3' "$APP/operations_gateway.py" \
  || fail "Os modulos antigos nao receberam o tema compartilhado."
grep -Fq 'horizon-logo.svg' "$APP/server.py" \
  || fail "Logo compartilhada nao foi registrada no servidor."
grep -Fq 'data:image/webp;base64,' "$APP/static/horizon-logo.svg" \
  || fail "O arquivo original do logotipo nao foi incorporado."
grep -Fq 'body.central-operational' "$APP/static/horizon-theme.css" \
  || fail "O tema nao cobre os modulos operacionais."
grep -Fq 'body.nh-native-screen' "$APP/static/horizon-theme.css" \
  || fail "O tema nao cobre Recebimentos."
grep -Fq 'body .nhf-mark' "$APP/static/horizon-theme.css" \
  || fail "O tema nao cobre Funcionarios."
echo "OK: tema administrativo neutro e logotipo Horizonte em todos os modulos."
# Saldos são dados: jamais aplicar estilo de botão primário ao valor.
grep -Fq 'balance.pagar,"payable"' "$APP/static/funcionarios.js" || fail "Estilo de saldo antigo."
if grep -Fq 'class="nhf-explanation"' "$APP/static/funcionarios.html"; then
  fail "Textos explicativos antigos ainda presentes."
fi
# Recebimentos: composição compacta, sem alterar contratos de importação.
grep -Fq 'rx-compact-header' "$APP/static/recebimentos.html" \
  || fail "Cabecalho compacto de Recebimentos ausente."
grep -Fq 'rx-supplier-card' "$APP/static/recebimentos.js" \
  || fail "Cards individuais de fornecedores ausentes."
grep -Fq '/central/recebimentos.css?v=20261125unit4' "$APP/static/recebimentos.html" \
  || fail "Versao compacta do CSS nao carregada."
# Recebimentos: arrastar XML e selecionar arquivo usam a mesma previa.
grep -Fq 'id="rx-xml-drop"' "$APP/static/recebimentos.html" \
  || fail "Recebimentos sem feedback de arraste XML."
grep -Fq 'NHReceivingImports.importXML(ui,files[0])' "$APP/static/recebimentos.js" \
  || fail "Recebimentos sem importacao por arrastar XML."
grep -Fq 'async function importXML(app,file)' "$APP/static/recebimentos_imports.js" \
  || fail "Conferencia XML compartilhada ausente."
grep -Fq 'NHReceivingImports.importPDF(ui,files)' "$APP/static/recebimentos.js" \
  || fail "Recebimentos sem importacao por arrastar PDF."
grep -Fq 'async function importPDF(app,files)' "$APP/static/recebimentos_imports.js" \
  || fail "Importador PDF compartilhado ausente."
grep -Fq 'function buildXMLChoices' "$APP/static/recebimentos_imports.js" || fail "Sugestao inteligente de pedidos XML ausente."
grep -Fq 'function historyMatch' "$APP/static/recebimentos_imports.js" || fail "Historico de identificacao XML ausente."
grep -Fq 'role="combobox"' "$APP/static/recebimentos_imports.js" || fail "Seletor pesquisavel unico ausente."
grep -Fq 'function bindXMLPicker' "$APP/static/recebimentos_imports.js" || fail "Selecao de pedidos XML ausente."
grep -Fq 'rx-xml-no-order-' "$APP/static/recebimentos_imports.js" || fail "Marcador Sem pedido ausente."
grep -Fq 'hasCompatible:valid.length>0' "$APP/static/recebimentos_imports.js" || fail "Marcador condicional e aproximacao XML ausentes."
grep -Fq 'function convertedTotal(quantity,factor)' "$APP/static/recebimentos_imports.js" || fail "Conversao por unidade ausente."
echo "OK: arrastar PDFs/XML, sugestao por historico/produto/saldo e pesquisa de pedidos; gravacao somente apos confirmacao."
# Gerenciamento Pix separado; não executar operação de escrita no deploy.
grep -Fq 'id="managePix"' "$APP/static/funcionarios.html" \
  || fail "Gerenciamento Pix ausente da tela."
grep -Fq '/central/api/funcionarios/pix' "$APP/static/funcionarios.js" \
  || fail "Interface de edição Pix ausente."
grep -Fq 'def update_pix(payload):' "$APP/funcionarios.py" \
  || fail "Integração de cadastro Pix ausente."
echo "OK: gerenciamento Pix usa cadastro original do Contas; nenhuma chave alterada pelo instalador."
# Saldos pendentes e histórico pago ficam separados; sem ações de vínculo manual.
grep -Fq 'function openAmounts(person)' "$APP/static/funcionarios.js" \
  || fail "Painel de Funcionários antigo: cálculo de pendências não instalado."
grep -Fq 'class="nhf-open-table"' "$APP/static/funcionarios.html" >/dev/null 2>&1 \
  && fail "A tabela de pendências foi inserida estaticamente em vez de consultar valores."
for forbidden in 'Abrir no Contas' 'Buscar contas' 'Confirmar vínculo' 'renderAccountFinder('; do
  if grep -Fq "$forbidden" "$APP/static/funcionarios.js"; then
    fail "A ficha de Funcionários continua com ações manuais antigas: $forbidden"
  fi
done
if grep -Fq 'id="unlinkedSection"' "$APP/static/funcionarios.html"; then
  fail "Painel de Funcionários ainda tem lista manual de vínculos."
fi
grep -Fq 'function makeHistory(person)' "$APP/static/funcionarios.js" || fail "Historico de pagamentos ausente."
grep -Fq 'id="historyFilter"' "$APP/static/funcionarios.html" || fail "Acesso ao historico ausente."
grep -Fq 'AS data_pagamento' "$APP/funcionarios.py" || fail "Data de pagamento ausente."
grep -Fq 'id="addVale"' "$APP/static/funcionarios.html" || fail "Botao adicionar vale ausente."
grep -Fq 'def vale_action(payload)' "$APP/funcionarios.py" || fail "Motor de operacao de vales ausente."
grep -Fq 'function manageVales(person)' "$APP/static/funcionarios.js" || fail "Gestao individual de vales ausente."
echo "OK: Funcionários mostra saldos em aberto e histórico pago separadamente; sem vínculos manuais."
# Todas as paginas da Central usam largura fluida; não publicar só
# Recebimentos deixando as outras telas com faixas laterais vazias.
grep -Fq '.rx-app{width:100%;max-width:none;' "$APP/static/recebimentos.css" \
  || fail "Recebimentos ainda possui limite de largura fixo."
grep -Fq '.nhf-main{width:100%;max-width:none;' "$APP/static/funcionarios.css" \
  || fail "Funcionarios ainda possui limite de largura fixo."
grep -Fq '.content{max-width:none;width:100%;' "$APP/static/app.css" \
  || fail "Pagina inicial da Central ainda esta limitada em largura."
grep -Fq 'body.central-operational #main{max-width:none!important;' "$APP/static/operations.css" \
  || fail "Modulos operacionais continuam com largura limitada."
grep -Fq '.nh-documents{width:100%;max-width:none;' "$APP/static/operations.css" \
  || fail "Modulo Documentos ainda possui limite de largura fixo."
grep -Fq 'operations.css?v=20261127fretesmodal1' "$APP/operations_gateway.py" \
  || fail "Modulo legado nao recebe CSS atualizado de largura fluida."
echo "OK: paginas da Central preparadas para ocupar a largura do monitor."
# Verifica se o motor de origem continua a responder no mesmo banco.
HTTP="$(curl -sS --max-time 25 -o "$TMP/receiving-state" -w '%{http_code}' \
  -H "Cookie: $COOKIE" \
  "http://127.0.0.1:18771/modules/recebimentos/api/state")"
[[ "$HTTP" == 200 ]] || fail "Motor de Recebimentos nao respondeu em /api/state."
python3 - "$TMP/receiving-state" <<'PY'
import json,sys
with open(sys.argv[1],encoding="utf-8") as f: payload=json.load(f)
if not isinstance(payload.get("boards"),list) or not isinstance(payload.get("controls"),list):
    raise SystemExit("ERRO: contrato de dados de Recebimentos incompleto.")
print("OK: modulo nativo acessa os controles reais, sem trocar o banco.")
PY
# Conferir cada recurso pelo seu conteúdo real, não pelo marcador do launcher.
# A regra anterior exigia JavaScript dentro do SVG e revertia toda atualização.
for asset in launcher.js launcher.css horizon-theme.css horizon-logo.svg; do
  HTTP="$(curl -sS --max-time 8 -D "$TMP/asset-headers" -o "$TMP/asset" -w '%{http_code}' \
    "http://127.0.0.1:18771/$asset")"
  [[ "$HTTP" == 200 ]] || fail "Recurso $asset nao respondeu (HTTP $HTTP)."
  cmp -s "$APP/static/$asset" "$TMP/asset" \
    || fail "Recurso $asset servido pelo container difere do arquivo instalado."
  case "$asset" in
    launcher.js|launcher.css)
      grep -Fq 'nh-start-menu' "$TMP/asset" \
        || fail "Recurso $asset nao corresponde ao lancador unificado." ;;
    horizon-theme.css)
      grep -Fq -- '--hz-surface:#ffffff;' "$TMP/asset" \
        || fail "CSS do tema Horizonte ausente."
      grep -Ei '^Content-Type: text/css' "$TMP/asset-headers" >/dev/null \
        || fail "CSS Horizonte com MIME incorreto." ;;
    horizon-logo.svg)
      grep -Fq '<svg' "$TMP/asset" \
        || fail "Logotipo Horizonte nao e SVG."
      grep -Ei '^Content-Type: image/svg\+xml' "$TMP/asset-headers" >/dev/null \
        || fail "Logotipo Horizonte com MIME incorreto." ;;
  esac
done
echo "OK: tema e logotipo foram servidos pelo container, byte a byte."
# Verificar HTML e recursos na URL HTTPS que o navegador realmente usa.
PUBLIC="https://controles.fazendanovohorizonte.com/central"
for entry in '' 'modules/contas/' 'modules/funcionarios/' 'modules/documentos/' \
  'modules/controles/' 'modules/recebimentos/' 'modules/transportadoras/' 'modules/relatorios/'; do
  HTTP="$(curl -sS --max-time 25 -H "Cookie: $COOKIE" -H 'Cache-Control: no-cache' \
    -o "$TMP/theme-page" -w '%{http_code}' "$PUBLIC/$entry")"
  [[ "$HTTP" == 200 ]] || fail "Pagina publica $entry indisponivel (HTTP $HTTP)."
  grep -Fq '/central/horizon-theme.css?v=20261125detail3' "$TMP/theme-page" \
    || fail "Pagina publica $entry nao carrega o tema Horizonte."
  grep -Fq '/central/confirm-actions.js?v=20261125draft2' "$TMP/theme-page" || fail "Notificacoes de resultado ausentes em $entry."
  grep -Fq '/central/form-drafts.js?v=20261125draft2' "$TMP/theme-page" || fail "Protecao de formularios ausente em $entry."
  if grep -Eq '/icons/brand\.svg|/static/icons\.svg#logo|class="mr-logo"[^>]*>MC<' "$TMP/theme-page"; then
    fail "Pagina $entry ainda possui marca antiga."
  fi
  case "$entry" in
    ''|modules/contas/|modules/documentos/|modules/funcionarios/|modules/recebimentos/)
      grep -Fq 'src="/central/horizon-logo.svg?v=1"' "$TMP/theme-page" \
        || fail "Cabecalho de $entry nao recebeu a marca Horizonte." ;;
  esac
done
echo "OK: marcas antigas ausentes das paginas publicas; cabecalhos conferidos."
for asset in horizon-theme.css horizon-logo.svg confirm-actions.js confirm-actions.css form-drafts.js form-drafts.css operations.js operations.css app.css; do
  curl -fsS --max-time 15 -H 'Cache-Control: no-cache' \
    "$PUBLIC/$asset?v=20261125detail3" -o "$TMP/public-asset" \
    || fail "Recurso HTTPS $asset indisponivel."
  cmp -s "$APP/static/$asset" "$TMP/public-asset" \
    || fail "Recurso HTTPS $asset nao corresponde ao novo arquivo."
done
echo "OK: tema e logotipo confirmados no endereco HTTPS de uso do navegador."
# Verificar as duas abas reais no HTTPS, sem modificar chaves Pix.
for view in staff pix; do
  QUERY="v=20261126vales3-$(date +%s)-$RANDOM"
  [[ "$view" != pix ]] || QUERY="$QUERY&view=pix"
  curl -fsS --max-time 20 -H "Cookie: $COOKIE" -H 'Cache-Control: no-cache' \
    "$PUBLIC/modules/funcionarios/?$QUERY" -o "$TMP/pix-page" \
    || fail "Pagina publica de Funcionarios ($view) indisponivel."
  grep -Fq 'href="/central/modules/funcionarios/?view=pix"' "$TMP/pix-page" \
    || fail "Aba Gerenciar Pix ausente."
  grep -Fq 'id="pixTitle">Gerenciar Pix dos funcionários' "$TMP/pix-page" \
    || fail "Painel Pix ausente."
  grep -Fq 'id="addVale"' "$TMP/pix-page" || fail "Botao de vale nao chegou ao HTTPS."
  grep -Fq 'value="valeHistory"' "$TMP/pix-page" || fail "Historico de vales nao chegou ao HTTPS."
  if [[ "$view" == pix ]]; then
    grep -Fq 'class="central-operational nh-scope-funcionarios nhf-view-pix"' "$TMP/pix-page" \
      || fail "Servidor nao abriu a aba Pix diretamente."
    grep -Fq 'id="managePix" aria-current="page"' "$TMP/pix-page" \
      || fail "Aba Pix nao esta selecionada."
  else
    grep -Fq 'id="staffTab" aria-current="page"' "$TMP/pix-page" \
      || fail "Aba de saldos nao esta selecionada."
  fi
  for asset in funcionarios.js funcionarios.css; do
    # A referencia esperada vem do HTML instalado nesta mesma revisao,
    # nao de uma versao fixa de outro dia. Continua conferindo HTML e bytes HTTPS.
    ASSET_URL="$(python3 - "$APP/static/funcionarios.html" "$asset" <<'PY'
import re,sys
from pathlib import Path
html=Path(sys.argv[1]).read_text(encoding="utf-8")
matches=re.findall(r'["\x27](/central/'+re.escape(sys.argv[2])+r'\?v=[A-Za-z0-9_-]+)["\x27]',html)
if len(matches)!=1:
    raise SystemExit("Referencia versionada ausente ou duplicada: "+sys.argv[2])
print(matches[0])
PY
)" || fail "Referencia local invalida: $asset."
    grep -Fq "$ASSET_URL" "$TMP/pix-page" \
      || fail "HTML HTTPS diverge da revisao instalada: $asset; esperado $ASSET_URL."
    curl -fsS --max-time 15 -H 'Cache-Control: no-cache' \
      "$PUBLIC/${ASSET_URL#/central/}" -o "$TMP/pix-asset" \
      || fail "Recurso Pix $asset indisponivel."
    cmp -s "$APP/static/$asset" "$TMP/pix-asset" \
      || fail "Recurso Pix $asset diverge da versao instalada."
  done
done
echo "OK: adicionar vale, historico e abas de Funcionarios confirmados no HTTPS."
curl -fsS --max-time 20 -H "Cookie: $COOKIE" -H 'Cache-Control: no-cache' \
  "$PUBLIC/modules/recebimentos/?v=20261125draft2" -o "$TMP/rx-page" \
  || fail "Recebimentos indisponivel no HTTPS."
grep -Fq 'rx-compact-header' "$TMP/rx-page" || fail "Cabecalho antigo de Recebimentos no HTTPS."
for asset in recebimentos.js recebimentos.css recebimentos_imports.js; do
  VERSION=20261125unit4
  grep -Fq "/central/$asset?v=$VERSION" "$TMP/rx-page" \
    || fail "Recebimentos usa recurso antigo: $asset."
  curl -fsS --max-time 15 -H 'Cache-Control: no-cache' \
    "$PUBLIC/$asset?v=$VERSION" -o "$TMP/rx-asset" \
    || fail "Recurso de Recebimentos indisponivel: $asset."
  cmp -s "$APP/static/$asset" "$TMP/rx-asset" \
    || fail "Recurso de Recebimentos diverge do arquivo instalado."
done
grep -Fq 'rx-supplier-card' "$APP/static/recebimentos.css" || fail "Estilo dos cards de fornecedor ausente."
grep -Fq 'rx-dialog-summary' "$APP/static/recebimentos.js" || fail "Resumo rapido nao recebeu dialogo proprio."
grep -Fq 'width:100%;min-width:0;max-width:100%;table-layout:fixed' "$APP/static/recebimentos.css" || fail "Tabela do resumo ainda pode exceder a janela."
grep -Fq 'rx-summary-search' "$APP/static/recebimentos.js" || fail "Pesquisa do resumo ausente."
grep -Fq '/api/recebimentos/resumo.xlsx' "$APP/server.py" || fail "Exportador XLSX do resumo ausente."
test -f "$APP/recebimentos_export.py" || fail "Gerador XLSX ausente."
echo "OK: resumo rapido com pesquisa e exportacao XLSX atualizado."

# Testa recursos da importação de contas em lote, sem cadastrar nem
# modificar nenhuma conta. Mantém R2, holerites e duplicidades no motor atual.
for asset in contas_batch.js contas_batch.css contas_pdf_review.js contas_pdf_review.css vales_holerites.js vales_holerites.css holerites_vales.js holerites_vales.css; do
  HTTP="$(curl -sS --max-time 8 -o "$TMP/contas-lote" -w '%{http_code}' \
    "http://127.0.0.1:18771/$asset")"
  [[ "$HTTP" == 200 ]] || fail "Arquivo $asset da fila de Contas ausente."
done
grep -Fq 'startDetectedHolerite(result)' "$APP/static/contas_batch.js" \
  || fail "Importação em lote não reutiliza conferência e holerites originais."
grep -Fq 'source.kind === "file"' "$APP/static/contas_pdf_review.js" \
  || fail "Visualizador não aproveita o PDF original do formulário."
grep -Fq 'URL.revokeObjectURL' "$APP/static/contas_pdf_review.js" \
  || fail "Visualizador não libera o PDF ao fechar a revisão."
grep -Fq 'frame-src' "$APP/operations_gateway.py" \
  || fail "Visualizador de PDF pode estar bloqueado pela CSP do navegador."
# Teste real da API ORIGINAL dos Vales. Não basta responder HTTP 200:
# comparar funcionários e parcelas do controle com a tradução da Central.
# Não requer CENTRAL_CONTROLES_DSN, não abre SQL e NÃO grava baixas.
docker exec -i central-novo-horizonte-painel-1 python - <<'PY' || fail "Central não leu os vales verdadeiros do Meus Controles."
from central_admin.vales_holerites import read_controls, _control_request
catalog=_control_request("GET","/api/state")
ids=[int(c["id"]) for c in catalog["controls"]
     if c.get("mode")=="vale_funcionarios"]
expected_people=0
expected_installments=0
for cid in ids:
    summary=_control_request("GET",f"/api/controls/{cid}/vales")
    employees=summary["employees"]
    expected_people+=len(employees)
    expected_installments+=sum(
        len(debt["installments"])
        for employee in employees
        for debt in employee["debts"]
    )
people,installments=read_controls()
if len(people)!=expected_people or len(installments)!=expected_installments:
    raise SystemExit("API de Vales diverge do painel de Funcionários.")
if ids and expected_people==0:
    raise SystemExit("Controle de Vales existe, mas não retornou os funcionários.")
print(f"OK: {len(ids)} controle(s) de Vales, {len(people)} funcionário(s), "
      f"{len(installments)} parcela(s) reais lidas via API privada.")
PY
# Teste somente-leitura dos cadastros que serão vinculados.
HTTP="$(curl -sS --max-time 15 -o "$TMP/vales-staff" -w '%{http_code}' \
  -H "Cookie: $COOKIE" http://127.0.0.1:18771/api/vales-holerites/funcionarios)"
[[ "$HTTP" == 200 ]] || fail "Integração não consulta funcionários dos dois módulos (HTTP $HTTP)."
python3 - "$TMP/vales-staff" <<'PY'
import json,sys
with open(sys.argv[1],encoding="utf-8") as f: data=json.load(f)
if not isinstance(data.get("funcionarios_contas"),list) or not isinstance(data.get("funcionarios_vales"),list):
    raise SystemExit("Contrato de funcionários não corresponde ao esperado.")
print("OK: vínculo de funcionários pronto, bancos originais somente leitura.")
PY
# Reúne contas, holerites, vales e pagamentos sem criar nenhum deles.
MONTH="$(date +%Y-%m)"
HTTP="$(curl -sS --max-time 20 -o "$TMP/funcionarios-painel" -w '%{http_code}' \
  -H "Cookie: $COOKIE" "http://127.0.0.1:18771/api/funcionarios/painel?competencia=$MONTH")"
[[ "$HTTP" == 200 ]] || fail "Painel de Funcionários não consolidou as duas bases (HTTP $HTTP)."
python3 - "$TMP/funcionarios-painel" <<'PY'
import json,sys
with open(sys.argv[1],encoding="utf-8") as file: data=json.load(file)
if not isinstance(data.get("funcionarios"),list):
    raise SystemExit("Funcionários não retornou lista de pessoas.")
metrics=data.get("indicadores",{})
for key in ("funcionarios_com_pagamentos","total_a_pagar","vales_a_descontar",
            "holerites_pendentes_mes"):
    if key not in metrics:
        raise SystemExit("Indicador não encontrado: "+key)
print("OK: Funcionários reúne holerites, contas e vales no modo leitura.")
PY
# Conferir a nova rota de detalhes usando um cadastro real, somente leitura.
VALE_PERSON="$(python3 - "$TMP/funcionarios-painel" <<'PY'
import json,sys
with open(sys.argv[1],encoding="utf-8") as file:
    people=json.load(file)["funcionarios"]
print(next((p["id"] for p in people if p.get("vales_ids")),""))
PY
)"
if [[ -n "$VALE_PERSON" ]]; then
  HTTP="$(curl -sS --max-time 45 -o "$TMP/vale-detail" -w '%{http_code}' \
    -H "Cookie: $COOKIE" "http://127.0.0.1:18771/api/funcionarios/vales?funcionario_id=$VALE_PERSON")"
  [[ "$HTTP" == 200 ]] || fail "Historico individual de vales nao respondeu (HTTP $HTTP)."
  python3 - "$TMP/vale-detail" <<'PY'
import json,sys
with open(sys.argv[1],encoding="utf-8") as file: data=json.load(file)
assert data.get("ok") and data["cadastros"], "Historico individual sem cadastro original"
assert all(isinstance(p.get("payments"),list) and isinstance(p.get("debts"),list) for p in data["cadastros"]), "Historico de vales incompleto"
print("OK: historico individual de vales e descontos consultado no motor original.")
PY
fi
# Paridade completa: TODO cadastro de Vales e TODA parcela com saldo devem
# aparecer na ficha de algum funcionário da Central, inclusive sem holerite.
# Nenhuma escrita em pagamentos, fichas originais ou reservas.
docker exec -i central-novo-horizonte-painel-1 python - <<'PY' || fail "Algum funcionário ou parcela de Vale sumiu da Central."
from decimal import Decimal
from central_admin import funcionarios
from central_admin.vales_holerites import read_controls, read_staff
staff, parts = read_controls()
report = funcionarios.dashboard()
seen_staff = {int(vid) for person in report["funcionarios"]
              for vid in person["vales_ids"]}
seen_installments = {int(row["id"]) for person in report["funcionarios"]
                     for row in person["parcelas"]}
expected_staff = {int(x["id"]) for x in staff}
expected_parts = {int(p["id"]) for p in parts
                  if Decimal(p["amount"]) > Decimal(p["paid"])}
missing_staff = expected_staff - seen_staff
missing_parts = expected_parts - seen_installments
if missing_staff or missing_parts:
    raise SystemExit(
      "Ausências na Central: %d cadastro(s) de Vales; %d parcela(s) pendente(s)."
      % (len(missing_staff), len(missing_parts)))
only_vales = sum(x.get("origem_cadastro") == "vales" for x in report["funcionarios"])
print("OK: todos os %d cadastro(s) de Vales e %d parcela(s) com saldo "
      "estão visíveis nas fichas de Funcionários." % (
      len(expected_staff), len(expected_parts)))
print("Perfis exclusivos de Vales (sem cadastro de holerite):", only_vales)
PY
CODE="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:18771/api/funcionarios/painel?competencia=$MONTH")"
[[ "$CODE" == 401 ]] || fail "Painel de Funcionários permite consulta sem sessão."
docker exec central-novo-horizonte-painel-1 python -c \
  'from central_admin.vales_holerites import journal; journal().close()' \
  || fail "Banco independente de conciliação não está gravável."
# Confere a versão EFETIVA do frontend original servida na Central.
# Se funções de OCR, contas ou Windows tiverem mudado, não instalar fila
# incompatível e não deixar o usuário perder documentos no meio do lote.
HTTP="$(curl -sS --max-time 10 -H "Cookie: $COOKIE" \
  -o "$TMP/contas-engine-js" -w '%{http_code}' \
  http://127.0.0.1:18771/modules/contas/app.js)"
[[ "$HTTP" == 200 ]] || fail "Frontend operacional de Contas não respondeu."
for contract in 'async function postPDF(' 'function startDetectedHolerite(' \
                'function accountModal(' 'function closeModal(' \
                'let pendingImportPDF='; do
  grep -Fq "$contract" "$TMP/contas-engine-js" \
    || fail "Contrato do CONTAS 4 alterado ($contract); fila recusada com segurança."
done
grep -Fq 'postPDF("/central/modules/contas/api/import/preview"' "$APP/static/contas_batch.js" \
  || fail "Importação em lote não está usando o gateway autenticado."
grep -Fq 'window.addEventListener("dragover",event=>' "$APP/static/contas_batch.js" \
  || fail "O navegador não foi configurado para aceitar soltar PDFs."
grep -Fq 'window.addEventListener("drop",event=>' "$APP/static/contas_batch.js" \
  || fail "Importação por arrastar PDFs não foi instalada no nível da janela."
grep -Fq 'api(MANIFEST_API)' "$APP/static/contas_batch.js" \
  || fail "Fila de Contas não consulta SHA-256 de PDFs cadastrados no R2."
grep -Fq 'sha256(file)' "$APP/static/contas_batch.js" \
  || fail "Fila de Contas não deduplica os PDFs arrastados por conteúdo."
grep -Fq 'duplicateByPayment(result.fields,state.existingRecords)' "$APP/static/contas_batch.js" \
  || fail "Fila de Contas não pula cobrança duplicada detectada pelo OCR."
grep -Fq 'nh-contas-dragging-files' "$APP/static/contas_batch.css" \
  || fail "Feedback visual do arraste de PDFs ausente."
if grep -Fq 'nh-contas-batch-action' "$APP/static/contas_batch.js"; then
  fail "Botão extra antigo permanece no módulo Contas."
fi
for hidden in '#aiConnect' '#mobileBtn' '#pdfImport'; do
  grep -Fq "$hidden" "$APP/static/contas_batch.css" \
    || fail "Cabeçalho Contas não removeu a ação $hidden."
done
grep -Fq '"X-Pdf-Name", "X-Ocr-Mode"' "$APP/operations_gateway.py" \
  || fail "Gateway não repassa os cabeçalhos de OCR originais."
# Verifica a entrada em duas fases antes de publicar:
# primeiro fundo e, somente depois, os cards.
HTTP="$(curl -sS --max-time 8 -o "$TMP/entry-script" -w '%{http_code}' \
  http://127.0.0.1:18771/entry-preflight.js)"
[[ "$HTTP" == 200 ]] || fail "Script de revelacao pos-expansao nao esta disponivel."
grep -Fq 'nh-start-arriving' "$TMP/entry-script" \
  || fail "Entrada em duas fases nao esta configurada."
grep -Fq 'id="nh-entry-surface"' "$APP/static/index.html" \
  || fail "Fundo expansivel independente do dashboard nao encontrado."
grep -Fq 'html.nh-start-arriving .page {opacity:0!important}' "$APP/static/app.css" \
  || fail "A home mostraria os cards antes de expandir."
# Checa compressao de assets na VPS sem expor tokens ou dados de usuarios.
HTTP="$(curl -sS --max-time 8 -D "$TMP/asset-headers" -o "$TMP/asset-gzip" \
  -w '%{http_code}' -H 'Accept-Encoding: gzip' \
  http://127.0.0.1:18771/launcher.js)"
[[ "$HTTP" == 200 ]] || fail "Launcher JS indisponivel apos otimizar."
grep -qi '^Content-Encoding: gzip' "$TMP/asset-headers" \
  || fail "Compressao gzip nao foi ativada para a Central."
grep -qi '^Cache-Control: private, max-age=60' "$TMP/asset-headers" \
  || fail "Cache de recursos estaticos da Central esta inativo."
# Impede retorno da antiga abertura de pagina em tela cheia.
grep -Fq 'nh-start-menu' "$APP/static/launcher.js" \
  || fail "Menu Iniciar nao encontrado. Aplicacao anterior sera restaurada."
grep -Fq 'root.append(trigger,panel)' "$APP/static/launcher.js" \
  || fail "Icone e janela ainda nao são a mesma superficie."
grep -Fq 'pointerEvents(header,"open")' "$APP/static/launcher.js" \
  || fail "Arraste da janela aberta nao está ativado."
if grep -Fq 'document.body.append(menu,fab)' "$APP/static/launcher.js"; then
  fail "Codigo antigo abre segunda janela solta; versao recusada."
fi
grep -Fq 'DESKTOP={w:600,h:455}' "$APP/static/launcher.js" \
  || fail "Janela desktop sem tamanho fixo esperado."
grep -Fq 'nh-start-expand' "$APP/static/launcher.js" \
  || fail "Botao de expandir nao encontrado no popup."
grep -Fq 'pointerEvents(trigger,"closed")' "$APP/static/launcher.js" \
  || fail "Arraste do ícone não encontrado."
grep -Fq 'trigger.addEventListener("contextmenu"' "$APP/static/launcher.js" \
  || fail "Ciclo de tamanho por botão direito não encontrado."
grep -Fq 'animateMorph(' "$APP/static/launcher.js" \
  || fail "A animação de transformação do mesmo elemento não foi encontrada."
grep -Fq 'fitPanel(' "$APP/static/launcher.js" \
  || fail "Janela sem limitação às bordas do monitor."
if grep -Fq 'search.focus({preventScroll:true})' "$APP/static/launcher.js"; then
  fail "Busca do launcher ainda está aplicando foco e contorno azul automático."
fi
grep -Fq 'body.central-operational .nh-start-search .nh-start-search-input:focus-visible' "$APP/static/launcher.css" \
  || fail "Correção do contorno de busca não foi aplicada."
grep -Fq '@view-transition' "$APP/static/launcher.css" \
  || fail "Expansao suave nativa nao encontrada no menu."
grep -Fq 'view-transition-name: nh-central-expand' "$APP/static/app.css" \
  || fail "Pagina inicial nao configurada para a expansao suave."
if grep -Fq 'transition:width .22s' "$APP/static/launcher.css"; then
  fail "Animacao antiga de largura ainda presente; atualizacao cancelada."
fi
grep -Fq 'overflow:hidden!important' "$APP/static/launcher.css" \
  || fail "Janela sem limite de rolagem fixa."
if grep -Fq 'nh-start-bottom' "$APP/static/launcher.js"; then
  fail "O rodape antigo ainda aparece no popup."
fi
if grep -Fq 'DOMParser' "$APP/static/launcher.js"; then
  fail "Lancador ainda tenta copiar a pagina inteira para dentro do app."
fi
# A API de escrita precisa recusar uma tentativa sem Origin de navegador.
HTTP="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  --data '{}' http://127.0.0.1:18771/modules/contas/api/accounts)"
[[ "$HTTP" == 403 ]] || fail "Barreira contra escrita sem Origin nao funcionou."
SUCCESS=1
echo
echo "CENTRAL ATUALIZADA COM SUCESSO."
echo "ACESSO: https://controles.fazendanovohorizonte.com/central/"
echo "LAYOUT: icone se transforma na MESMA janela; ambos arrastaveis, sem popup separado."
echo "GEOMETRIA: janela fixa, ajustada à tela por escala; sempre completa sem scroll."
echo "ANIMAÇÃO: expandir primeiro o fundo, revelar cards somente após a transição."
echo "FLUIDEZ: JS/CSS comprimidos e reutilizados, listas mais leves e downloads em streaming."
echo "NAVEGACAO: abre diretamente o controle escolhido, sem mostrar Home de Controles nem Home da Central antes."
echo "IDENTIDADE: marca Horizonte apenas nos pontos de identidade; icones indicativos preservados; menu original; interface neutra sem Liquid Glass."
echo "NOVA ARQUITETURA: Recebimentos usa frontend proprio sem carregar o antigo."
echo "CONTAS: upload em lote, leitura e confirmação manual UMA CONTA POR VEZ."
echo "FUNCIONÁRIOS: painel nativo com holerites, Pix, contas a pagar, vales e vínculos confirmados."
echo "HOLERITES CONTAS: vales e descontos aparecem diretamente na lista de funcionários."
echo "DUPLICIDADES: PDFs idênticos do R2/no lote são filtrados antes de entrar na fila; cobrança repetida não abre formulário."
echo "CONFERÊNCIA: formulário tela inteira à esquerda + PDF com zoom/páginas à direita."
echo "TRANSICAO: demais modulos mantem os motores originais ate migracao e verificacao."
echo "PAREAMENTO UNICO: execute cat /root/CENTRAL_NH_PRIMEIRO_ACESSO.txt e abra a URL privada no navegador."
echo "Apos parear, nao e necessario digitar chaves: a sessao fica salva com cookie seguro."
echo "ACESSO: sem sessao pareada, nao e possivel consultar ou alterar dados financeiros."
echo "Bancos, Caddy, R2, Windows, GFARM e os aplicativos originais nao foram alterados."
