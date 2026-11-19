"""Serviço isolado da Central Administrativa, sem rotas de escrita."""
from __future__ import annotations

import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .core import snapshot

STATIC = Path(__file__).with_name("static")
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/app.css": ("app.css", "text/css; charset=utf-8"),
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
        # Consulta automática, somente leitura, quando explicitamente liberada
        # pelo administrador na configuração privada da VPS.
        if os.environ.get("CENTRAL_PUBLIC_READ") == "1":
            return True
        expected = os.environ.get("CENTRAL_TOKEN", "")
        header = self.headers.get("Authorization", "")
        return (len(expected) >= 32 and header.startswith("Bearer ")
                and hmac.compare_digest(header[7:], expected))

    def do_GET(self):
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
        self.respond(405, {"ok": False, "erro": "Operação não habilitada: somente leitura."})

    do_PUT = do_PATCH = do_DELETE = do_POST


def main():
    if len(os.environ.get("CENTRAL_TOKEN", "")) < 32:
        if os.environ.get("CENTRAL_PUBLIC_READ") != "1":
            raise RuntimeError("CENTRAL_TOKEN obrigatório (pelo menos 32 caracteres).")
    bind = os.environ.get("CENTRAL_BIND", "127.0.0.1")
    if bind != "127.0.0.1" and not (
        bind == "0.0.0.0" and os.environ.get("CENTRAL_ALLOW_CONTAINER_BIND") == "1"
    ):
        raise RuntimeError("Bind não autorizado: use loopback ou container isolado.")
    port = int(os.environ.get("CENTRAL_PORT", "18771"))
    print("Central Administrativa ativa em modo somente leitura.", flush=True)
    ThreadingHTTPServer((bind, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
