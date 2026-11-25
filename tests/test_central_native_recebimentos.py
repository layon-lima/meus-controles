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

    def test_summary_xlsx_contains_numeric_values_and_safe_text(self):
        import io
        import zipfile
        import xml.etree.ElementTree as ET
        from central_admin.recebimentos_export import workbook, NS
        result = workbook([["Agrex", "001", "=1+1", "kg", 100.5, 90, 10.5]])
        with zipfile.ZipFile(io.BytesIO(result)) as z:
            self.assertIsNone(z.testzip())
            sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
            ns = {"s": NS}
            self.assertEqual(sheet.find(".//s:c[@r='B2']/s:is/s:t",ns).text, "001")
            self.assertEqual(sheet.find(".//s:c[@r='C2']/s:is/s:t",ns).text, "=1+1")
            self.assertIsNone(sheet.find(".//s:f",ns))
            self.assertEqual(sheet.find(".//s:c[@r='E2']/s:v",ns).text, "100.5")
            self.assertEqual(len(sheet.findall(".//s:row",ns)),2)
        with self.assertRaises(ValueError):
            workbook([["x","1","x","kg",float("inf"),1,1]])

    def test_summary_xlsx_requires_session_and_origin(self):
        from central_admin.recebimentos_export import export_summary
        handler = object.__new__(Handler)
        handler.headers = {"Origin":"https://attacker.invalid"}
        answer = []
        handler.respond=lambda *args,**kwargs:answer.append(args)
        handler.authorized=lambda:False
        export_summary(handler)
        self.assertEqual(answer[-1][0],401)
        handler.authorized=lambda:True
        export_summary(handler)
        self.assertEqual(answer[-1][0],403)

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
