"""Garantias de velocidade sem mudar operações financeiras ou motores antigos."""
from __future__ import annotations

import gzip
import io
import os
import unittest
from unittest.mock import patch

from central_admin import performance
from central_admin.operations_gateway import _send_asset, _stream_large_download, proxy


class FakeHandler:
    def __init__(self, path, headers=None):
        self.path = path
        self.command = "GET"
        self.headers = headers or {}
        self.wfile = io.BytesIO()
        self.status = None
        self.response_headers = {}
    def authorized(self):
        return True
    def send_response(self, status):
        self.status = status
    def send_header(self, key, value):
        self.response_headers[key] = value
    def end_headers(self):
        pass
    def respond(self, status, value):
        self.status = status


class PerformanceTests(unittest.TestCase):
    def setUp(self):
        performance.reset_caches()

    def tearDown(self):
        performance.reset_caches()

    def test_summary_cached_for_burst_without_changing_result(self):
        calls = []
        def source(*args):
            calls.append(args)
            return {"ok": True, "fontes":{
                "contas":{"disponivel":True},
                "controles":{"disponivel":True}
            }}
        first = performance.cached_snapshot("test.db", "postgres://private", source)
        second = performance.cached_snapshot("test.db", "postgres://private", source)
        self.assertIs(first, second)
        self.assertEqual(len(calls), 1)
        performance.cached_snapshot("another.db", "postgres://private", source)
        self.assertEqual(len(calls), 2)

    def test_failure_never_stale_caches(self):
        calls = []
        def source(*args):
            calls.append(True)
            return {"ok": False, "fontes":{
                "contas":{"disponivel":False},
                "controles":{"disponivel":True}
            }}
        performance.cached_snapshot(None, None, source)
        performance.cached_snapshot(None, None, source)
        self.assertEqual(len(calls), 2)

    def test_only_static_js_css_cached(self):
        for safe in ("/app.js", "/static/app.js", "/static/style.css"):
            self.assertTrue(performance.safe_static_path(safe), safe)
        for forbidden in (
            "/api/contas", "/static/invoice.pdf", "/static/invoice.xml",
            "/static/user.js?uid=1", "/static/../private.js",
            "/receipts", "/contas/statement.csv", "/payroll.html"
        ):
            self.assertFalse(performance.safe_static_path(forbidden), forbidden)
        data = b"window.example=true"
        performance.save_asset(("contas","contas","/app.js"), "text/javascript", data)
        self.assertEqual(performance.cached_asset(("contas","contas","/app.js")), ("text/javascript", data))
        self.assertIsNone(performance.cached_asset(("contas","contas","/api/contas")))

    def test_gzip_static_includes_correct_headers(self):
        handler = FakeHandler("/modules/contas/app.js", {"Accept-Encoding":"gzip, br"})
        original = b"let value=42;\n"*500
        _send_asset(handler, 200, "text/javascript", original)
        self.assertEqual(handler.status, 200)
        self.assertEqual(handler.response_headers.get("Content-Encoding"), "gzip")
        self.assertIn("private", handler.response_headers.get("Cache-Control"))
        self.assertEqual(gzip.decompress(handler.wfile.getvalue()), original)

    def test_large_pdf_streamed_without_reading_all_into_memory(self):
        data = b"PDF" * 400000
        class Headers:
            def get_all(self, name, default):
                return ["application/pdf"] if name == "Content-Type" else []
        class Response:
            status = 200
            headers = Headers()
            def __init__(self): self.fp = io.BytesIO(data);self.chunks=[]
            def getheader(self, name, default=None):
                return {
                    "Content-Type":"application/pdf",
                    "Content-Length":str(len(data))
                }.get(name,default)
            def read(self, amount=-1):
                self.chunks.append(amount)
                return self.fp.read(amount)
        handler, response = FakeHandler("/modules/contas/api/file"), Response()
        self.assertTrue(_stream_large_download(handler, response, "application/pdf", "GET"))
        self.assertEqual(handler.wfile.getvalue(), data)
        self.assertEqual(set(response.chunks), {65536})
        self.assertEqual(handler.response_headers["Content-Length"], str(len(data)))

    def test_upstream_static_loaded_once_per_module(self):
        requested=[]
        source = b"/* js module */\n" * 90
        class Headers:
            def get_all(self, name, default):
                return []
        class Response:
            status = 200
            headers = Headers()
            def getheader(self, name, default=None):
                return "text/javascript" if name == "Content-Type" else default
            def read(self): return source
        class Connection:
            def __init__(self, host, port, timeout): pass
            def request(self, method, path, body=None, headers=None):
                requested.append(path)
            def getresponse(self): return Response()
            def close(self): pass
        env={"CENTRAL_OPERATIONS_ENABLED":"1", "CENTRAL_CONTAS_UPSTREAM":"http://contas-web:8767"}
        with patch.dict(os.environ, env):
            with patch("central_admin.operations_gateway.http.client.HTTPConnection", Connection):
                one = FakeHandler("/modules/contas/app.js")
                two = FakeHandler("/modules/contas/app.js")
                self.assertTrue(proxy(one))
                self.assertTrue(proxy(two))
        self.assertEqual(len(requested), 1)
        self.assertEqual(one.wfile.getvalue(), two.wfile.getvalue())
        self.assertEqual(one.status, 200)
        self.assertEqual(two.status, 200)


if __name__ == "__main__":
    unittest.main()
