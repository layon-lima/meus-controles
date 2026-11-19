"""Servidor web único da Central Novo Horizonte, com sessões protegidas."""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from . import access
from .core import snapshot
from .operations_gateway import proxy

STATIC = Path(__file__).with_name("static")
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
    "/operations.css": ("operations.css", "text/css; charset=utf-8"),
    "/operations.js": ("operations.js", "text/javascript; charset=utf-8"),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "CentralNovoHorizonte"

    def log_message(self, *args):
        # Não registrar headers, chaves de acesso ou dados financeiros.
        return

    def respond(self, status, payload, mime="application/json; charset=utf-8"):
        body = (json.dumps(payload, ensure_ascii=False).encode("utf-8")
                if isinstance(payload, dict) else payload)
        self.send_response(status)
        for header, value in [
            ("Content-Type", mime),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "no-store"),
            ("X-Content-Type-Options", "nosniff"),
            ("Referrer-Policy", "no-referrer"),
            ("X-Frame-Options", "DENY"),
            ("Content-Security-Policy",
             "default-src 'none'; script-src 'self'; style-src 'self'; "
             "connect-src 'self'; img-src 'self'; base-uri 'none'; "
             "form-action 'none'; frame-ancestors 'none'"),
        ]:
            self.send_header(header, value)
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        return access.authenticated(self.headers)

    def pair(self):
        if not access.trusted_origin(self.headers.get("Origin", "")):
            self.respond(403, {"ok": False, "erro": "Origem não autorizada."})
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            self.respond(415, {"ok": False, "erro": "Formato inválido."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 2 <= size <= 512:
                raise ValueError()
            payload = json.loads(self.rfile.read(size))
            valid = isinstance(payload, dict) and access.verify_pair(payload.get("token"))
        except (ValueError, TypeError, UnicodeError):
            valid = False
        if not valid:
            self.respond(403, {"ok": False, "erro": "Pareamento não autorizado."})
            return
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Set-Cookie", access.issue_cookie())
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if proxy(self):
            return
        path = urlsplit(self.path).path
        if path == "/health":
            self.respond(200, {"ok": True, "servico": "central-administrativa"})
        elif path == "/api/resumo":
            if not self.authorized():
                self.respond(401, {"ok": False, "erro": "Acesso não autorizado."})
                return
            result = snapshot(os.environ.get("CENTRAL_CONTAS_DB"),
                              os.environ.get("CENTRAL_CONTROLES_DSN"))
            self.respond(200 if result["ok"] else 503, result)
        elif path in ASSETS:
            filename, mime = ASSETS[path]
            self.respond(200, (STATIC / filename).read_bytes(), mime)
        else:
            self.respond(404, {"ok": False, "erro": "Rota inexistente."})

    def do_POST(self):
        if urlsplit(self.path).path == "/api/pair":
            return self.pair()
        if proxy(self):
            return
        self.respond(405, {"ok": False, "erro": "Rota de escrita não habilitada."})

    do_PUT = do_PATCH = do_DELETE = do_POST


def main():
    if not access.ready():
        raise RuntimeError("CENTRAL_SESSION_SECRET e CENTRAL_PAIR_TOKEN precisam estar configurados.")
    bind = os.environ.get("CENTRAL_BIND", "127.0.0.1")
    if bind != "127.0.0.1" and not (
        bind == "0.0.0.0" and os.environ.get("CENTRAL_ALLOW_CONTAINER_BIND") == "1"
    ):
        raise RuntimeError("Bind não autorizado: use loopback ou container isolado.")
    port = int(os.environ.get("CENTRAL_PORT", "18771"))
    print("Central Novo Horizonte ativa. Acesso por sessão protegida.", flush=True)
    ThreadingHTTPServer((bind, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
