"""Garante entrada nativa de Recebimentos sem carregar o HTML do sistema antigo."""
from __future__ import annotations
import unittest
from unittest.mock import patch
from pathlib import Path

from central_admin.server import Handler


class NativeReceivingsTest(unittest.TestCase):
    def test_native_entry_served_before_any_legacy_proxy(self):
        handler = object.__new__(Handler)
        handler.path = "/modules/recebimentos/"
        handler.headers = {"Accept-Encoding": "identity"}
        handler.authorized = lambda: True
        answer = []
        handler.respond = lambda *args, **kwargs: answer.append((args, kwargs))
        with patch("central_admin.server.proxy", side_effect=AssertionError("legacy app loaded")):
            Handler.do_GET(handler)
        self.assertEqual(answer[0][0][0], 200)
        content = answer[0][0][1].decode("utf-8")
        self.assertIn("<h1>Recebimentos</h1>", content)
        self.assertIn("/central/recebimentos.js", content)
        self.assertIn("/central/recebimentos_imports.js", content)
        self.assertNotIn("static/app.js", content)
        self.assertNotIn("<iframe", content)
        self.assertEqual(answer[0][1]["cache_control"], "no-store")
        self.assertIn("img-src 'self' data:", answer[0][1]["csp"])

    def test_unauthorized_access_does_not_load_business_data(self):
        handler = object.__new__(Handler)
        handler.path = "/modules/recebimentos/"
        handler.headers = {}
        handler.authorized = lambda: False
        answer = []
        handler.respond = lambda *args, **kwargs: answer.append((args, kwargs))
        with patch("central_admin.server.proxy", side_effect=AssertionError("legacy accessed")):
            Handler.do_GET(handler)
        self.assertEqual(answer[0][0][0], 401)

    def test_all_current_operations_have_native_controls(self):
        root = Path(__file__).resolve().parents[1] / "central_admin" / "static"
        code = (root / "recebimentos.js").read_text(encoding="utf-8")
        imports = (root / "recebimentos_imports.js").read_text(encoding="utf-8")
        required = (
            "/receiving/items", "/receiving", "/xml/pending",
            "/invoice", "/gfarm/send", "/invoices.xlsx",
            "/api/receiving-receipts/", "/api/receiving-items/",
        )
        for route in required:
            with self.subTest(route=route):
                self.assertIn(route.replace("/receiving/items", "/items"), code)
        for name in ('route("/xml/preview")','route("/xml/confirm")',
                     'route("/pdf/preview")','route("/pdf/confirm")',
                     'route("/pdf/page")','route("/pdf/region")'):
            with self.subTest(name=name):
                self.assertIn(name, imports)


if __name__ == "__main__":
    unittest.main()
