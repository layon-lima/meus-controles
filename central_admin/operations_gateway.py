"""Gateway de operações completas sob um único domínio e uma navegação comum.

Preserva os servidores originais como motores: não migra ou recria dados.
Este módulo não deve ser exposto sem controle de acesso ao domínio.
"""
from __future__ import annotations

import http.client
import os
import re
from urllib.parse import urlsplit

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


def rewrite_text(text, prefix, kind):
    """Ajusta URLs dos módulos web para funcionar sob a mesma origem."""
    text = ABSOLUTE.sub(
        lambda match: match.group("q") + prefix + "/" + match.group("part"),
        text,
    )
    if kind == "html":
        # CSP do Contas permite scripts/estilos carregados da mesma origem.
        css = '<link rel="stylesheet" href="/central/operations.css">'
        js = '<script defer src="/central/operations.js"></script>'
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
        handler.respond(401, {"ok": False, "erro": "Sessão não autorizada. Abra a Central a partir do navegador pareado."})
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
                     "X-Requested-With", "If-None-Match"):
            value = handler.headers.get(name)
            if value:
                request_headers[name] = value
        if origin:
            request_headers["Origin"] = origin_upstream
        body = handler.rfile.read(length) if length else None
        if body is not None:
            request_headers["Content-Length"] = str(len(body))
        upstream_uri = target_path + (("?" + uri.query) if uri.query else "")
        connection = http.client.HTTPConnection(host, port, timeout=80)
        try:
            connection.request(method, upstream_uri, body=body, headers=request_headers)
            response = connection.getresponse()
            data = response.read()
            content_type = response.getheader("Content-Type", "application/octet-stream")
            content_lower = content_type.lower()
            is_html = "text/html" in content_lower
            is_js = "javascript" in content_lower or upstream_uri.split("?")[0].endswith(".js")
            is_css = "text/css" in content_lower
            # Desabilita registro de SW original no gateway: futuro PWA será central.
            if backend == "controles" and target_path == "/static/pwa.js":
                data = b"/* PWA legado desabilitado apenas na Central. */"
                content_type = "text/javascript; charset=utf-8"
            elif is_html or is_js or is_css:
                data = rewrite_text(
                    data.decode("utf-8"),
                    prefix,
                    "html" if is_html else "js" if is_js else "css",
                ).encode("utf-8")
            handler.send_response(response.status)
            forward = (
                "Content-Type", "Content-Disposition", "Cache-Control",
                "ETag", "Last-Modified", "Set-Cookie", "Content-Security-Policy"
            )
            for name in forward:
                for value in response.headers.get_all(name, []):
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
