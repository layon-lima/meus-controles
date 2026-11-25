"""Gateway de operações completas sob um único domínio e uma navegação comum.

Preserva os servidores originais como motores: não migra ou recria dados.
Este módulo não deve ser exposto sem controle de acesso ao domínio.
"""
from __future__ import annotations

import gzip
import json
import http.client
import os
import re
from urllib.parse import urlsplit

from .performance import cached_asset, invalidate_summary, safe_static_path, save_asset

MODULES = {
    "controles": "controles",
    "recebimentos": "controles",
    "transportadoras": "controles",
    "relatorios": "controles",
    "contas": "contas",
    "funcionarios": "contas",
    "documentos": "contas",
}
BLOCKED = (
    "/api/internal/shutdown", "/api/control/stop",
    "/api/agent/", "/auth/callback"
)
MAX_REQUEST = 60 * 1024 * 1024
ASSET_PREFIXES = (
    "api/", "static/", "icons/", "mobile/",
    "app.js", "search.svg", "sw.js", "favicon.ico",
    "manifest.webmanifest", "pwa-icon-", "icon.svg", "styles.css", "?"
)
# Somente aspas de um caminho absoluto conhecido: nunca substitui URLs
# externas, strings financeiras, XML nem o corpo das requisições.
ABSOLUTE = re.compile(
    r"(?P<q>['\"])/(?P<part>" +
    "|".join(re.escape(part) for part in ASSET_PREFIXES) +
    r")"
)


def destination(path):
    """Resolve apenas os módulos permitidos; nunca aceita URL arbitrária."""
    if not path.startswith("/modules/"):
        return None
    remainder = path[len("/modules/"):]
    module, _, extra = remainder.partition("/")
    backend = MODULES.get(module)
    if backend is None or any(".." == p for p in extra.split("/")):
        return None
    upstream_path = "/" + extra
    if any(upstream_path.startswith(block) for block in BLOCKED):
        return None
    return backend, module, upstream_path


def adapt_legacy_script(backend, upstream_path, source):
    """Executa as telas completas no celular, apenas dentro da Central."""
    # A confirmação de gravações passa pela camada fetch comum. Remover
    # apenas os antigos avisos redundantes de gravação. Decisões de
    # descarte e escolha de fornecedor permanecem, em diálogo próprio.
    if ((backend == "controles" and upstream_path.startswith("/static/") and upstream_path.endswith(".js"))
            or (backend == "contas" and upstream_path == "/app.js")):
        if backend == "contas":
            source = source.replace("function closeModal({saved=false}={})",
                                    "async function closeModal({saved=false}={})", 1)
            source = source.replace("if(!saved&&$(\'accountForm\')&&!window.confirm(",
                                    "if(!saved&&$(\'accountForm\')&&!window.NHDrafts?.isDiscarding()&&!window.confirm(", 1)
        def replace_confirmation(match):
            condition = match.group(0)
            if any(word in condition for word in ("Cadastrar \"", "ChatGPT", "com GPT")):
                return re.sub(r'(?<![\w.])(?:window\.)?confirm\s*\(', 'await window.NHConfirm.ask(', condition)
            return ""
        source = re.sub(
            r'(?m)^[ \t]*if\s*\(!\s*(?:window\.)?confirm\s*\([\s\S]*?\)\s*\)\s*return\s*;',
            replace_confirmation, source)
        # Os avisos específicos dos motores usam a mesma área de notificações.
        source = source.replace("toast(message,error=false){", "toast(message,error=false){\n    if(window.NHFeedback){window.NHFeedback.notify(message,error);return;}", 1)
        source = source.replace("function notice(message,error=false,duration=4200){", "function notice(message,error=false,duration=4200){\n  if(window.NHFeedback){window.NHFeedback.notify(message,error);return;}", 1)
        # As decisões que não são uma gravação continuam pedindo resposta.
        source = re.sub(r'(?<![\w.])(?:window\.)?confirm\s*\(', 'await window.NHConfirm.ask(', source)
    if backend != "controles":
        return source
    if upstream_path == "/static/receiving_mobile.js":
        # O painel legado mobile é só consulta e ocultava toda a aplicação.
        return "/* A Central usa a interface operacional responsiva completa. */"
    if upstream_path == "/static/app.js":
        guard = ('if(!window.matchMedia("(max-width: 820px), '
                 '(hover: none) and (pointer: coarse)").matches){')
        return source.replace(guard, "if(true){", 1)
    return source


def rewrite_text(text, prefix, kind):
    """Ajusta URLs dos módulos web para funcionar sob a mesma origem."""
    text = ABSOLUTE.sub(
        lambda match: match.group("q") + prefix + "/" + match.group("part"),
        text,
    )
    if kind == "html":
        # Aplicar o tema ANTES do primeiro paint, evitando o flash da barra
        # lateral do sistema antigo quando outra página é aberta.
        module = prefix.rstrip("/").rsplit("/", 1)[-1]
        if module in MODULES:
            text = text.replace("<body>", '<body class="central-operational nh-scope-' + module + '">', 1)
        # Identidade única dos motores legados, antes da primeira pintura.
        # Preservar ícones de status, ações, avatares e menu.
        if module in MODULES:
            logo = "/central/horizon-logo.svg?v=1"
            old_image = re.escape(prefix + "/icons/brand.svg")
            text = re.sub(r'(<img\b[^>]*\bsrc\s*=\s*)(["\x27])' + old_image + r'\2',
                          lambda m: m.group(1) + m.group(2) + logo + m.group(2), text,
                          flags=re.I)
            old_mark = re.compile(
                r'(<span\s+class="brand-icon"[^>]*>)\s*<svg\b[^>]*>\s*'
                r'<use\b[^>]*href="' + re.escape(prefix) +
                r'/static/icons\.svg#logo"[^>]*>\s*</use>\s*</svg>\s*</span>', re.I)
            text = old_mark.sub(
                lambda m: m.group(1) + '<img class="nh-legacy-brand-logo" src="' +
                logo + '" alt=""></span>', text)
            text = text.replace(
                '<span class="mr-logo" aria-hidden="true">MC</span>',
                '<span class="mr-logo" aria-hidden="true"><img class="nh-legacy-brand-logo" src="' +
                logo + '" alt=""></span>')
            text = re.sub(
                r'<link\b(?=[^>]*\brel\s*=\s*["\x27](?:shortcut\s+)?icon["\x27])[^>]*>',
                '', text, flags=re.I)
        # CSP do Contas permite scripts/estilos carregados da mesma origem.
        css = ('<link rel="stylesheet" href="/central/operations.css?v=20261123route1">'
               '<link rel="stylesheet" href="/central/launcher.css?v=20261120g">')
        # Script síncrono no HEAD: não mostrar o dashboard legado
        # antes de a rota real ser hidratada. Mantém CSP self sem inline JS.
        js = ('<script src="/central/route-preflight.js?v=20261123route1"></script>'
              '<script defer src="/central/operations.js?v=20261125draft2"></script>'
              '<script defer src="/central/launcher.js?v=20261124glass4"></script>')
        if module == "contas":
            # A fila apenas coordena as PRÓPRIAS funções/validações do CONTAS 4.
            # Não reimplementa OCR, holerites, R2, sincronização nem cadastro.
            css += '<link rel="stylesheet" href="/central/contas_batch.css?v=20261120i">'
            js += '<script defer src="/central/contas_batch.js?v=20261121b"></script>'
            css += '<link rel="stylesheet" href="/central/contas_pdf_review.css?v=20261121a">'
            js += '<script defer src="/central/contas_pdf_review.js?v=20261121a"></script>'
            css += '<link rel="stylesheet" href="/central/vales_holerites.css?v=20261121b">'
            js += '<script defer src="/central/vales_holerites.js?v=20261121b"></script>'
            css += '<link rel="stylesheet" href="/central/holerites_vales.css?v=20261121a">'
            js += '<script defer src="/central/holerites_vales.js?v=20261125draft2"></script>'
        # O tema final deve vir DEPOIS de todas as folhas legadas e do módulo.
        css += '<link rel="stylesheet" href="/central/horizon-theme.css?v=20261124neutral1">'
        css += '<link rel="icon" type="image/svg+xml" href="/central/horizon-logo.svg?v=1">'
        # Antes dos scripts legados, inclusive os que capturam fetch na carga.
        confirmation = ('<link rel="stylesheet" href="/central/confirm-actions.css?v=20261125draft2">'
                        '<script src="/central/confirm-actions.js?v=20261125draft2"></script>'
                        '<link rel="stylesheet" href="/central/form-drafts.css?v=20261125draft2">'
                        '<script src="/central/form-drafts.js?v=20261125draft2"></script>')
        text = re.sub(r"<head(?:\s[^>]*)?>", lambda m: m.group(0) + confirmation, text, count=1, flags=re.I)
        if "</head>" in text:
            text = text.replace("</head>", css + js + "</head>", 1)
    return text


def rewrite_location(value, prefix):
    if value.startswith("/") and not value.startswith("//"):
        return prefix + value
    return value


def _upstream(backend):
    key = ("CENTRAL_CONTAS_UPSTREAM" if backend == "contas"
           else "CENTRAL_CONTROLES_UPSTREAM")
    fallback = ("http://contas-web:8767" if backend == "contas"
                else "http://central-controles-api:18765")
    url = urlsplit(os.environ.get(key) or fallback)
    if url.scheme != "http" or url.username or url.password or url.path not in ("", "/"):
        raise ValueError("Endpoint interno inválido")
    # Requer rede Docker privada e nomes de serviços, jamais redes públicas.
    if url.hostname not in ("contas-web", "central-controles-api", "127.0.0.1", "localhost"):
        raise ValueError("Destino fora da rede interna")
    return url.hostname, url.port or 80


def _requested_origin(backend):
    return (os.environ.get("CENTRAL_CONTAS_ORIGIN", "https://contas-cloud.fazendanovohorizonte.com")
            if backend == "contas" else
            os.environ.get("CENTRAL_CONTROLES_ORIGIN", "https://controles.fazendanovohorizonte.com"))


def _incoming_origin_allowed(origin):
    return bool(origin) and origin.rstrip("/") == os.environ.get(
        "CENTRAL_PUBLIC_ORIGIN", "https://controles.fazendanovohorizonte.com"
    ).rstrip("/")


def _send_asset(handler, status, mime, content, max_age=75):
    """Entrega JS/CSS sem recriar suas rotinas a cada troca de aba."""
    accepts = "gzip" in handler.headers.get("Accept-Encoding", "").lower()
    compressed = accepts and len(content) >= 1024
    body = gzip.compress(content, compresslevel=5) if compressed else content
    handler.send_response(status)
    handler.send_header("Content-Type", mime)
    handler.send_header("Cache-Control", f"private, max-age={max_age}, must-revalidate")
    handler.send_header("Content-Length", str(len(body)))
    if compressed:
        handler.send_header("Content-Encoding", "gzip")
        handler.send_header("Vary", "Accept-Encoding")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("X-Frame-Options", "DENY")
    handler.end_headers()
    handler.wfile.write(body)


def _stream_large_download(handler, response, content_type, method):
    """Stream de PDFs/Excel/ZIP grandes em blocos, sem guardar tudo na RAM."""
    raw = response.getheader("Content-Length", "")
    if method != "GET" or response.status != 200:
        return False
    if not str(raw).isdigit() or int(raw) < 1024 * 1024:
        return False
    mime = content_type.lower()
    if any(word in mime for word in ("text/", "javascript", "json", "xml", "css", "html")):
        return False
    if response.getheader("Content-Encoding", "identity").lower() not in ("identity", ""):
        return False
    handler.send_response(response.status)
    for header in ("Content-Type", "Content-Disposition", "Cache-Control",
                   "Last-Modified", "Set-Cookie"):
        for value in response.headers.get_all(header, []):
            handler.send_header(header, value)
    handler.send_header("Content-Length", raw)
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("X-Frame-Options", "DENY")
    handler.end_headers()
    while True:
        chunk = response.read(64 * 1024)
        if not chunk:
            break
        handler.wfile.write(chunk)
    return True


def proxy(handler):
    """Atende as rotas operacionais dentro da Central; retorna True se tratou."""
    uri = urlsplit(handler.path)
    target = destination(uri.path)
    if not target:
        return False
    if os.environ.get("CENTRAL_OPERATIONS_ENABLED") != "1":
        handler.respond(503, {
            "ok": False,
            "erro": "Módulos operacionais não ativados na VPS. Os aplicativos originais permanecem intactos."
        })
        return True
    # Nenhum dado ou operação financeira passa sem uma sessão do navegador.
    if not handler.authorized():
        from .access import redirect_navigation
        if not redirect_navigation(handler, target[1]):
            handler.respond(401, {"ok": False, "erro":
                "Sessão não autorizada. Abra a Central a partir do navegador pareado."})
        return True
    backend, module, target_path = target
    prefix = "/central/modules/" + module
    method = handler.command
    origin = handler.headers.get("Origin", "")
    # Rejeita escrita cross-site antes de repassar o token de sessão do Contas.
    if method in ("POST", "PUT", "PATCH", "DELETE") and not _incoming_origin_allowed(origin):
        handler.respond(403, {"ok": False, "erro": "Origem não autorizada."})
        return True
    try:
        length = int(handler.headers.get("Content-Length") or 0)
    except ValueError:
        handler.respond(400, {"ok": False, "erro": "Content-Length inválido."})
        return True
    if length < 0 or length > MAX_REQUEST:
        handler.respond(413, {"ok": False, "erro": "Arquivo muito grande."})
        return True
    if method in ("POST", "PUT", "PATCH", "DELETE") and not handler.headers.get("Content-Length"):
        handler.respond(411, {"ok": False, "erro": "Envie Content-Length."})
        return True
    # JS/CSS já transformados são reutilizados durante a navegação.
    # Nunca guardar HTML, PDFs, faturas, API ou respostas de pagamentos.
    cached_key = (backend, module, target_path)
    is_asset = method == "GET" and not uri.query and safe_static_path(target_path)
    cache_hit = cached_asset(cached_key) if is_asset and         "no-cache" not in handler.headers.get("Cache-Control", "").lower() else None
    if cache_hit is not None:
        mime, content = cache_hit
        _send_asset(handler, 200, mime, content, max_age=75)
        return True
    try:
        host, port = _upstream(backend)
        origin_upstream = _requested_origin(backend)
        request_headers = {
            "Host": urlsplit(origin_upstream).netloc,
            "Accept-Encoding": "identity",
            "Connection": "close",
        }
        for name in ("Content-Type", "Accept", "User-Agent", "X-Local-Token",
                     "X-Agent-Token", "X-Paid-Date", "X-Receipt-Manual-Confirmed",
                     "X-Receipt-Auto-Verified", "X-Receipt-Eligible-Confirmed",
                     "X-Pdf-Name", "X-Ocr-Mode", "X-Requested-With"):
            value = handler.headers.get(name)
            if value:
                request_headers[name] = value
        if origin:
            request_headers["Origin"] = origin_upstream
        # Holerite com descontos comprometidos não pode ser removido no
        # CONTAS e deixar um vale reservado órfão na Central.
        account_delete=re.fullmatch(r"/api/accounts/(\d+)/delete",target_path)
        if backend=="contas" and method=="POST" and account_delete:
            try:
                from .vales_holerites import discounts_for_account
                if discounts_for_account(int(account_delete[1])):
                    handler.respond(409,{"ok":False,"error":
                        "Holerite possui vales vinculados. Revise a conciliação antes de excluir."})
                    return True
            except Exception:
                handler.respond(503,{"ok":False,"error":
                    "Não foi possível conferir os vales antes de excluir. Nenhuma conta foi apagada."})
                return True
        body = handler.rfile.read(length) if length else None
        if body is not None:
            request_headers["Content-Length"] = str(len(body))
        # O motor original recebe o MESMO JSON. A Central apenas valida a
        # cotação e, após uma resposta OK, guarda o vínculo das parcelas.
        plan = None
        integration_enabled = (
            backend == "contas" and method == "POST"
            and (target_path in ("/api/accounts","/api/import/commit")
                 or re.fullmatch(r"/api/accounts/\d+/edit",target_path))
            and (request_headers.get("Content-Type","").split(";")[0] == "application/json")
        )
        if integration_enabled and body:
            try:
                from .vales_holerites import prepare_submission, BridgeError
                payload = json.loads(body)
                account_edit=re.fullmatch(r"/api/accounts/(\d+)/edit",target_path)
                if payload.get("holerite")=="sim" or payload.get("nh_vales") or account_edit:
                    plan = prepare_submission(
                        payload,account_id=int(account_edit[1]) if account_edit else None)
            except (BridgeError,ValueError,UnicodeError,TypeError) as exc:
                handler.respond(409,{"ok":False,"error":str(exc)})
                return True
        upstream_uri = target_path + (("?" + uri.query) if uri.query else "")
        if backend == "contas" and target_path == "/":
            # A versão web do CONTAS redireciona celulares para um painel
            # diferente e reduzido. A Central deve manter o mesmo módulo
            # operacional responsivo, com todas as funções, em qualquer tela.
            query = upstream_uri.partition("?")[2]
            if not re.search(r"(?:^|&)desktop=1(?:&|$)", query):
                upstream_uri += ("&" if query else "?") + "desktop=1"
        connection = http.client.HTTPConnection(host, port, timeout=80)
        try:
            connection.request(method, upstream_uri, body=body, headers=request_headers)
            response = connection.getresponse()
            content_type = response.getheader("Content-Type", "application/octet-stream")
            if _stream_large_download(handler, response, content_type, method):
                return True
            data = response.read()
            if backend=="contas" and method=="POST" and 200<=response.status<300:
                # Associar vales somente DEPOIS que CONTAS confirmou a
                # gravação real. Nunca refazer POST do holerite no erro.
                if plan is not None:
                    try:
                        from .vales_holerites import after_submission
                        original=json.loads(data)
                        account_id=(int(target_path.split("/")[3])
                            if re.fullmatch(r"/api/accounts/\d+/edit",target_path)
                            else int(original.get("id") or original.get("account_id") or 0))
                        after_submission(plan,account_id)
                    except Exception:
                        # O lançamento no CONTAS já ocorreu; não responder
                        # "erro de cadastro", que levaria a reenviar o PDF.
                        original=json.loads(data)
                        original["aviso_integracao_vales"]=(
                            "Holerite salvo no CONTAS, mas a reserva dos vales precisa "
                            "de conferência. Não envie o mesmo PDF novamente.")
                        original["warning"]=original.get("warning") or original["aviso_integracao_vales"]
                        data=json.dumps(original,ensure_ascii=False).encode()
                # O CONTAS também permite pagar várias contas no mesmo
                # clique. Concilia somente as efetivamente confirmadas;
                # o restante fica pendente para a próxima abertura da Central.
                if target_path=="/api/batch/pay":
                    try:
                        from .vales_holerites import settle_account
                        batch=json.loads(data)
                        failed=[]
                        for account_id in (batch.get("paid") or [])[:20]:
                            result=settle_account(int(account_id))
                            if not result.get("ok"):failed.append(account_id)
                        if failed:
                            batch["aviso_integracao_vales"]=(
                                "Pagamentos efetuados, mas alguns descontos de vales "
                                "aguardam reconciliação. NÃO repita pagamentos.")
                            data=json.dumps(batch,ensure_ascii=False).encode()
                    except Exception:
                        # Não alterar resultado financeiro que já foi confirmado.
                        pass
                payment_match=re.fullmatch(r"/api/accounts/(\d+)/(?:pay|pay-with-receipt)",target_path)
                if payment_match:
                    try:
                        from .vales_holerites import settle_account
                        result=settle_account(int(payment_match[1]))
                        if not result.get("ok"):
                            original=json.loads(data)
                            original["aviso_integracao_vales"]=(
                                "Pagamento registrado, mas a baixa dos vales está "
                                "pendente de reconciliação. NÃO pague novamente.")
                            data=json.dumps(original,ensure_ascii=False).encode()
                    except Exception:
                        original=json.loads(data)
                        original["aviso_integracao_vales"]=(
                            "Pagamento confirmado no CONTAS; não foi possível conciliar "
                            "os vales. NÃO repita o pagamento.")
                        data=json.dumps(original,ensure_ascii=False).encode()
            if method in ("POST", "PUT", "PATCH", "DELETE") and 200 <= response.status < 400:
                # Atualiza os indicadores na próxima consulta sem criar novo
                # lançamento ou interromper a resposta de pagamento/upload.
                invalidate_summary()
            content_lower = content_type.lower()
            is_html = "text/html" in content_lower
            is_js = "javascript" in content_lower or upstream_uri.split("?")[0].endswith(".js")
            is_css = "text/css" in content_lower
            # Desabilita registro de SW original no gateway: futuro PWA será central.
            if backend == "controles" and target_path == "/static/pwa.js":
                data = b"/* PWA legado desabilitado apenas na Central. */"
                content_type = "text/javascript; charset=utf-8"
            elif is_html or is_js or is_css:
                source = data.decode("utf-8")
                if is_js:
                    source = adapt_legacy_script(backend, target_path, source)
                data = rewrite_text(
                    source,
                    prefix,
                    "html" if is_html else "js" if is_js else "css",
                ).encode("utf-8")
            # Compressão dos assets reescritos: reduz tráfego e evita reconstruir
            # as folhas e scripts a cada aba. Só código estático, nunca dados.
            asset_cacheable = (
                is_asset and response.status == 200 and (is_js or is_css)
                and response.getheader("Set-Cookie") is None
                and response.getheader("Content-Encoding", "identity").lower() == "identity"
                and len(data) <= 2 * 1024 * 1024
            )
            if asset_cacheable:
                save_asset(cached_key, content_type, data)
                _send_asset(handler, response.status, content_type, data, max_age=75)
                return True
            rewritten = is_html or is_js or is_css
            compress = (
                rewritten and response.status == 200 and len(data) >= 1024
                and "gzip" in handler.headers.get("Accept-Encoding", "").lower()
                and response.getheader("Content-Encoding", "identity").lower() == "identity"
            )
            if compress:
                data = gzip.compress(data, compresslevel=5)
            handler.send_response(response.status)
            forward = [
                "Content-Type", "Content-Disposition", "Cache-Control",
                "Last-Modified", "Set-Cookie", "Content-Security-Policy"
            ]
            # O ETag do servidor legado identifica bytes ANTES de reescrever
            # as URLs. Não enviar esse validador para HTML/JS/CSS transformados.
            if not rewritten:
                forward.append("ETag")
            if compress:
                handler.send_header("Content-Encoding", "gzip")
                handler.send_header("Vary", "Accept-Encoding")
            for name in forward:
                for value in response.headers.get_all(name, []):
                    if name == "Content-Security-Policy" and is_html and module == "contas":
                        # Apenas o módulo Contas pode mostrar PDF blob: dentro
                        # do próprio site. Manter frame-ancestors none e todas
                        # as demais restrições CSP originais intactas.
                        value = re.sub(
                            r"(?:^|;)\s*frame-src\s+[^;]*",
                            "",
                            value,
                            flags=re.IGNORECASE,
                        ).strip().strip(";")
                        value += "; frame-src 'self' blob:"
                    handler.send_header(name, value)
            location = response.getheader("Location")
            if location:
                handler.send_header("Location", rewrite_location(location, prefix))
            handler.send_header("Content-Length", str(len(data)))
            handler.send_header("X-Content-Type-Options", "nosniff")
            handler.send_header("Referrer-Policy", "no-referrer")
            handler.send_header("X-Frame-Options", "DENY")
            handler.end_headers()
            if method != "HEAD":
                handler.wfile.write(data)
        finally:
            connection.close()
    except (OSError, ValueError, UnicodeError, http.client.HTTPException):
        handler.respond(502, {
            "ok": False,
            "erro": "Motor interno indisponível. Os aplicativos originais não foram alterados."
        })
    return True
