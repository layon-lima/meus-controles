"""Testes isolados do gateway operacional: nenhuma escrita em produção."""
from __future__ import annotations

import io
import os
import unittest
from unittest.mock import patch

from central_admin.operations_gateway import (
    adapt_legacy_script, destination, proxy, rewrite_location, rewrite_text,
)


class _FakeResponse:
    status = 200
    headers = {"Content-Type": "text/html; charset=utf-8"}
    def read(self):
        return b'<html><head></head><body><script src="/app.js"></script></body></html>'
    def getheader(self, name, default=None):
        return self.headers.get(name, default)
    @property
    def headers(self):
        class _Headers:
            def get_all(self, name, default):
                return []
        return _Headers()


class _Connection:
    last = None
    def __init__(self, host, port, timeout):
        _Connection.last = self
        self.host, self.port, self.timeout = host, port, timeout
    def request(self, method, uri, body=None, headers=None):
        self.method, self.uri, self.body, self.headers = method, uri, body, headers
    def getresponse(self):
        class Response:
            status = 200
            def read(self):
                return b'<html><head></head><body><script src="/app.js"></script></body></html>'
            def getheader(self, name, default=None):
                return "text/html; charset=utf-8" if name == "Content-Type" else default
            @property
            def headers(self):
                class Headers:
                    def get_all(self, name, default):
                        return []
                return Headers()
        return Response()
    def close(self):
        pass


class _Handler:
    def __init__(self, path, method="GET", headers=None, body=b""):
        self.path, self.command = path, method
        self.headers = headers or {}
        self.rfile, self.wfile = io.BytesIO(body), io.BytesIO()
        self.status, self.response_headers, self.json_error = None, {}, None
    def authorized(self):
        return True
    def respond(self, code, body):
        self.status, self.json_error = code, body
    def send_response(self, code):
        self.status = code
    def send_header(self, name, value):
        self.response_headers[name] = value
    def end_headers(self):
        pass


class GatewayTests(unittest.TestCase):
    def test_every_module_is_same_origin_backend(self):
        expected = {
            "controles": "controles",
            "recebimentos": "controles",
            "transportadoras": "controles",
            "relatorios": "controles",
            "contas": "contas",
            "funcionarios": "contas",
            "documentos": "contas",
        }
        for name, backend in expected.items():
            with self.subTest(module=name):
                self.assertEqual(destination("/modules/" + name + "/api/accounts")[0], backend)
                self.assertEqual(destination("/modules/" + name + "/api/accounts")[2], "/api/accounts")

    def test_never_expose_internal_shutdown_or_agent(self):
        for path in (
            "/modules/controles/api/internal/shutdown",
            "/modules/contas/api/control/stop",
            "/modules/contas/api/agent/pdf/123",
            "/modules/contas/auth/callback",
            "/modules/contas/../../admin",
            "/modules/other/api/accounts",
        ):
            self.assertIsNone(destination(path))

    def test_rewrite_scripts_assets_and_keep_external_urls(self):
        original = "<html><head></head><body><script src=\"/app.js\"></script>" \
                   "<a href=\"https://example.org/docs\">Ajuda</a></body></html>"
        updated = rewrite_text(original, "/central/modules/contas", "html")
        self.assertIn('src="/central/modules/contas/app.js"', updated)
        self.assertIn('/central/operations.css', updated)
        self.assertIn('/central/operations.js', updated)
        self.assertIn('/central/launcher.css', updated)
        self.assertIn('/central/launcher.js', updated)
        self.assertIn('class="central-operational nh-scope-contas"', updated)
        self.assertIn("https://example.org/docs", updated)
        code = "fetch('/api/accounts');fetch('/?_contas_session_refresh=1');"
        self.assertIn("fetch('/central/modules/contas/api/accounts')",
                      rewrite_text(code, "/central/modules/contas", "js"))
        self.assertIn("fetch('/central/modules/contas/?_contas_session_refresh=1')",
                      rewrite_text(code, "/central/modules/contas", "js"))
        self.assertEqual(rewrite_location("/mobile/", "/central/modules/contas"),
                         "/central/modules/contas/mobile/")

    def test_native_desktop_operates_on_mobile_only_inside_central(self):
        original = ('if(!window.matchMedia("(max-width: 820px), '
                    '(hover: none) and (pointer: coarse)").matches){App.load();}')
        adapted = adapt_legacy_script("controles", "/static/app.js", original)
        self.assertIn("if(true){App.load();}", adapted)
        self.assertEqual(adapt_legacy_script("contas", "/app.js", original), original)
        self.assertEqual(
            adapt_legacy_script("controles", "/static/receiving_mobile.js", "if(media.matches)doMobile();").count("doMobile"),
            0
        )

    def test_operations_default_disabled(self):
        handler = _Handler("/modules/contas/api/accounts")
        with patch.dict(os.environ, {"CENTRAL_OPERATIONS_ENABLED": "0"}):
            self.assertTrue(proxy(handler))
        self.assertEqual(handler.status, 503)

    def test_reject_post_without_correct_browser_origin(self):
        for origin in ("", "https://evil.example"):
            handler = _Handler("/modules/contas/api/accounts", "POST", {
                "Content-Length": "2", "Content-Type": "application/json",
                "Origin": origin,
            }, b"{}")
            with patch.dict(os.environ, {"CENTRAL_OPERATIONS_ENABLED": "1",
                                          "CENTRAL_PUBLIC_ORIGIN": "https://controles.fazendanovohorizonte.com"}):
                self.assertTrue(proxy(handler))
            self.assertEqual(handler.status, 403)


    def test_auth_blocks_all_operations_without_browser_session(self):
        handler = _Handler("/modules/contas/api/accounts")
        handler.authorized = lambda: False
        with patch.dict(os.environ, {"CENTRAL_OPERATIONS_ENABLED": "1"}):
            self.assertTrue(proxy(handler))
        self.assertEqual(handler.status, 401)

    def test_session_pairing_cookie_and_expiration(self):
        from central_admin import access
        config = {
            "CENTRAL_SESSION_SECRET": "s" * 64,
            "CENTRAL_PAIR_TOKEN": "a" * 64,
            "CENTRAL_PUBLIC_ORIGIN": "https://controles.fazendanovohorizonte.com",
        }
        with patch.dict(os.environ, config, clear=True):
            self.assertTrue(access.verify_pair("a" * 64))
            self.assertFalse(access.verify_pair("b" * 64))
            self.assertTrue(access.trusted_origin("https://controles.fazendanovohorizonte.com"))
            self.assertFalse(access.trusted_origin("https://bad.example"))
            cookie_header = access.issue_cookie(now=1000)
            self.assertIn("HttpOnly", cookie_header)
            self.assertIn("Secure", cookie_header)
            self.assertIn("SameSite=Strict", cookie_header)
            value = cookie_header.split(";",1)[0]
            self.assertTrue(access.authenticated({"Cookie": value}, now=1001))
            self.assertFalse(access.authenticated({"Cookie": value}, now=1000+access.MAX_AGE+1))

    def test_contas_mobile_receives_same_complete_desktop_module(self):
        handler = _Handler("/modules/funcionarios/", headers={"User-Agent": "Android"})
        with patch.dict(os.environ, {
            "CENTRAL_OPERATIONS_ENABLED": "1",
            "CENTRAL_CONTAS_UPSTREAM": "http://contas-web:8767"
        }):
            with patch("central_admin.operations_gateway.http.client.HTTPConnection", _Connection):
                self.assertTrue(proxy(handler))
        self.assertEqual(handler.status, 200)
        self.assertEqual(_Connection.last.uri, "/?desktop=1")

    def test_live_page_and_script_pass_through_same_gateway(self):
        handler = _Handler("/modules/contas/?desktop=1", headers={"User-Agent": "Test"})
        with patch.dict(os.environ, {
            "CENTRAL_OPERATIONS_ENABLED": "1",
            "CENTRAL_CONTAS_UPSTREAM": "http://contas-web:8767"
        }):
            with patch("central_admin.operations_gateway.http.client.HTTPConnection", _Connection):
                self.assertTrue(proxy(handler))
        self.assertEqual(handler.status, 200)
        self.assertEqual(_Connection.last.uri, "/?desktop=1")
        self.assertIn("central/modules/contas/app.js", handler.wfile.getvalue().decode())
        self.assertEqual(handler.response_headers["X-Frame-Options"], "DENY")


if __name__ == "__main__":
    unittest.main()
