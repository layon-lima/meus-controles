"""Servidor web único da Central Novo Horizonte, com sessões protegidas."""
from __future__ import annotations

import gzip
import json
import os
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from . import access
from .core import snapshot
from .performance import cached_snapshot
from .operations_gateway import proxy
from .vales_holerites import handle as handle_vales_holerites
from .funcionarios import handle as handle_funcionarios

STATIC = Path(__file__).with_name("static")
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
    "/operations.css": ("operations.css", "text/css; charset=utf-8"),
    "/horizon-theme.css": ("horizon-theme.css", "text/css; charset=utf-8"),
    "/horizon-logo.svg": ("horizon-logo.svg", "image/svg+xml"),
    "/operations.js": ("operations.js", "text/javascript; charset=utf-8"),
    "/launcher.css": ("launcher.css", "text/css; charset=utf-8"),
    "/launcher.js": ("launcher.js", "text/javascript; charset=utf-8"),
    "/entry-preflight.js": ("entry-preflight.js", "text/javascript; charset=utf-8"),
    "/route-preflight.js": ("route-preflight.js", "text/javascript; charset=utf-8"),
    "/recebimentos.html": ("recebimentos.html", "text/html; charset=utf-8"),
    "/recebimentos.css": ("recebimentos.css", "text/css; charset=utf-8"),
    "/recebimentos.js": ("recebimentos.js", "text/javascript; charset=utf-8"),
    "/recebimentos_imports.js": ("recebimentos_imports.js", "text/javascript; charset=utf-8"),
    "/contas_batch.css": ("contas_batch.css", "text/css; charset=utf-8"),
    "/contas_batch.js": ("contas_batch.js", "text/javascript; charset=utf-8"),
    "/contas_pdf_review.css": ("contas_pdf_review.css", "text/css; charset=utf-8"),
    "/contas_pdf_review.js": ("contas_pdf_review.js", "text/javascript; charset=utf-8"),
    "/vales_holerites.js": ("vales_holerites.js", "text/javascript; charset=utf-8"),
    "/vales_holerites.css": ("vales_holerites.css", "text/css; charset=utf-8"),
    "/holerites_vales.js": ("holerites_vales.js", "text/javascript; charset=utf-8"),
    "/holerites_vales.css": ("holerites_vales.css", "text/css; charset=utf-8"),
    "/funcionarios.html": ("funcionarios.html", "text/html; charset=utf-8"),
    "/funcionarios.js": ("funcionarios.js", "text/javascript; charset=utf-8"),
    "/funcionarios.css": ("funcionarios.css", "text/css; charset=utf-8"),
}

@lru_cache(maxsize=16)
def static_payload(filename, compress):
    """JS/CSS da Central já carregados e comprimidos no início da sessão."""
    data = (STATIC / filename).read_bytes()
    if compress and len(data) >= 1024:
        return gzip.compress(data, compresslevel=5), True
    return data, False


class Handler(BaseHTTPRequestHandler):
    server_version = "CentralNovoHorizonte"

    def log_message(self, *args):
        # Não registrar headers, chaves de acesso ou dados financeiros.
        return

    def respond(self, status, payload, mime="application/json; charset=utf-8",
                cache_control="no-store", encoded=False, csp=None):
        body = (json.dumps(payload, ensure_ascii=False).encode("utf-8")
                if isinstance(payload, dict) else payload)
        self.send_response(status)
        for header, value in [
            ("Content-Type", mime),
            ("Content-Length", str(len(body))),
            ("Cache-Control", cache_control),
            ("X-Content-Type-Options", "nosniff"),
            ("Referrer-Policy", "no-referrer"),
            ("X-Frame-Options", "DENY"),
            ("Content-Security-Policy",
             csp or ("default-src 'none'; script-src 'self'; style-src 'self'; "
                     "connect-src 'self'; img-src 'self'; base-uri 'none'; "
                     "form-action 'none'; frame-ancestors 'none'")),
        ]:
            self.send_header(header, value)
        if encoded:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
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
        path = urlsplit(self.path).path
        if path in ("/modules/funcionarios", "/modules/funcionarios/"):
            # Módulo nativo da Central: nenhum HTML, JS ou tela do Contas 4.
            if not self.authorized():
                if not access.redirect_navigation(self, "funcionarios"):
                    self.respond(401, {"ok":False,"erro":"Sessão não autorizada."})
                return
            body, compressed=static_payload("funcionarios.html",
                "gzip" in self.headers.get("Accept-Encoding","").lower())
            self.respond(200,body,"text/html; charset=utf-8",
                cache_control="no-store",encoded=compressed,
                csp=("default-src 'none'; script-src 'self'; style-src 'self'; "
                     "connect-src 'self'; img-src 'self' data:; "
                     "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"))
            return
        if path in ("/modules/recebimentos", "/modules/recebimentos/"):
            # Página autoral da Central. Nenhum HTML ou script do app antigo é
            # carregado: o módulo já nasce em Recebimentos, sem flash.
            if not self.authorized():
                if not access.redirect_navigation(self, "recebimentos"):
                    self.respond(401, {"ok": False, "erro": "Sessão não autorizada."})
                return
            body, compressed = static_payload(
                "recebimentos.html", "gzip" in self.headers.get("Accept-Encoding", "").lower()
            )
            self.respond(200, body, "text/html; charset=utf-8",
                         cache_control="no-store", encoded=compressed,
                         csp=("default-src 'none'; script-src 'self'; style-src 'self'; "
                              "connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; "
                              "form-action 'none'; frame-ancestors 'none'"))
            return
        if handle_funcionarios(self):
            return
        if handle_vales_holerites(self):
            return
        if proxy(self):
            return
        if path == "/health":
            self.respond(200, {"ok": True, "servico": "central-administrativa"})
        elif path == "/api/resumo":
            if not self.authorized():
                self.respond(401, {"ok": False, "erro": "Acesso não autorizado."})
                return
            result = cached_snapshot(os.environ.get("CENTRAL_CONTAS_DB"),
                                     os.environ.get("CENTRAL_CONTROLES_DSN"),
                                     snapshot)
            self.respond(200 if result["ok"] else 503, result)
        elif path in ASSETS:
            filename, mime = ASSETS[path]
            should_gzip = "gzip" in self.headers.get("Accept-Encoding", "").lower()
            body, compressed = static_payload(filename, should_gzip)
            cache = "private, max-age=60, must-revalidate" if filename != "index.html" else "no-store"
            self.respond(200, body, mime, cache_control=cache, encoded=compressed)
        else:
            self.respond(404, {"ok": False, "erro": "Rota inexistente."})

    def do_POST(self):
        if self.command == "POST" and urlsplit(self.path).path == "/api/pair":
            return self.pair()
        if handle_funcionarios(self):
            return
        if handle_vales_holerites(self):
            return
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
