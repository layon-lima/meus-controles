"""Regressão: módulos da Central usam a área útil de telas grandes.

Não testa/alterar dados reais e não afeta os sites legados fora de /central/.
"""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]/"central_admin"

class CentralFullWidthTest(unittest.TestCase):
    def test_css_delimiters_and_layout_rules(self):
        from central_admin.css_validation import validate_directory, validate_css
        self.assertGreater(validate_directory(ROOT / "static"), 5)
        with self.assertRaises(ValueError):
            validate_css("@supports not (backdrop-filter:none{ .a{color:red} } .b{color:blue}")
        css=(ROOT/"static"/"operations.css").read_text(encoding="utf-8")
        self.assertRegex(css,r"\.nh-controls-brand img\{[^}]*width:40px;height:40px")
        self.assertRegex(css,r"\.nh-controls-metrics\{display:grid")
        self.assertRegex(css,r"\.nh-controls-table td small\{display:block")

    def check_selector(self,file,pattern):
        css=(ROOT/"static"/file).read_text(encoding="utf-8")
        self.assertRegex(css,re.compile(pattern,re.S),file)

    def test_recebimentos_uses_all_available_width(self):
        self.check_selector("recebimentos.css",
            r"\.rx-app\s*\{[^}]*width:100%;[^}]*max-width:none;[^}]*padding:10px 16px 64px")
        html=(ROOT/"static"/"recebimentos.html").read_text(encoding="utf-8")
        self.assertIn('recebimentos.css?v=20261125detail3',html)

    def test_funcionarios_width_and_aligned_header(self):
        self.check_selector("funcionarios.css",
            r"\.nhf-main\s*\{[^}]*width:100%;[^}]*max-width:none;")
        css=(ROOT/"static"/"funcionarios.css").read_text(encoding="utf-8")
        self.assertIn("padding:14px clamp(14px,1.55vw,30px);",css)
        self.assertIn("@media(max-width:720px)",css)
        self.assertIn('funcionarios.css?v=20261125detail3',
            (ROOT/"static"/"funcionarios.html").read_text(encoding="utf-8"))

    def test_central_home_full_width(self):
        for selector in ("content","site-footer"):
            self.check_selector("app.css",
                r"\."+selector+r"\{[^}]*max-width:none;[^}]*width:100%;")
        self.assertIn("app.css?v=20261125detail3",
            (ROOT/"static"/"index.html").read_text(encoding="utf-8"))

    def test_proxied_modules_and_documents_full_width(self):
        css=(ROOT/"static"/"operations.css").read_text(encoding="utf-8")
        self.assertRegex(css,r"body\.central-operational #main\{max-width:none!important;")
        self.assertRegex(css,r"\.nh-documents\{width:100%;max-width:none;")
        self.assertNotIn("max-width:1540px",css)
        self.assertIn("padding:0 clamp(14px,1.55vw,30px)",css)
        gateway=(ROOT/"operations_gateway.py").read_text(encoding="utf-8")
        self.assertIn('operations.css?v=20261125detail3',gateway)
        # Não modificar as páginas hospedadas fora do prefixo da Central.
        self.assertIn('body.central-operational',css)

if __name__=="__main__":
    unittest.main()
