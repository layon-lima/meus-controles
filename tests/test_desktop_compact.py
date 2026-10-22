"""Guarda a densidade exclusiva do desktop, sem rolamento horizontal nos controles."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CSS = ROOT / "static" / "desktop_compact.css"
HTML = ROOT / "static" / "index.html"
SW = ROOT / "static" / "sw.js"
SERVER = ROOT / "app.py"


class DesktopCompactTests(unittest.TestCase):
    def test_loaded_after_all_modular_stylesheets(self):
        html = HTML.read_text(encoding="utf-8")
        self.assertEqual(html.count('href="/static/desktop_compact.css?v=20261022-conferencia-1-conferencia-1"'), 1)
        self.assertGreater(html.index('href="/static/desktop_compact.css'),
                           html.index('href="/static/receiving_import.css'))
        server = SERVER.read_text(encoding="utf-8")
        self.assertIn('url=="/static/desktop_compact.css"', server)
        worker = SW.read_text(encoding="utf-8")
        self.assertIn('/static/desktop_compact.css?v=20261022-conferencia-1', worker)
        self.assertIn('central-de-controles-shell-v20261022-conferencia-1', worker)

    def test_desktop_rules_stay_inside_media_queries(self):
        css = re.sub(r"/\*.*?\*/", "", CSS.read_text(encoding="utf-8"), flags=re.S)
        # Nenhuma regra global fora dos breakpoints desktop: mobile intacto.
        depth = 0
        last = 0
        for match in re.finditer(r"[{}]", css):
            if match.group() == "{":
                if depth == 0:
                    self.assertRegex(css[last:match.start()], r"^\s*@media\s*\(min-width:\s*(?:821|1250)px\)(?:\s+and\s+\(max-width:\s*1100px\))?\s*$")
                depth += 1
            else:
                depth -= 1
                self.assertGreaterEqual(depth, 0)
                if depth == 0:
                    last = match.end()
        self.assertEqual(depth, 0)
        self.assertFalse(css[last:].strip())

    def test_vertical_density_and_horizontal_wrap(self):
        css = CSS.read_text(encoding="utf-8")
        for required in (
            "max-width:none",  # largura da area de trabalho
            "min-height:57px",  # header compacto
            "width:190px",  # menu lateral compacto
            ".stat-foot{display:none}",
            "min-height:58px",  # KPIs
            "grid-template-columns:minmax(0,1fr)",  # historico largura total
            "repeat(2,minmax(0,1fr))",  # resumos lado a lado
            "table-layout:fixed",  # tabelas fluidas
            "overflow-x:hidden",  # sem rolagem horizontal
            "min-width:0!important",  # grades antes limitadas a 1200px
            "flex-wrap:wrap",  # botões/tabs cabem na largura
            "max-height:calc(100dvh - 36px)",
        ):
            self.assertIn(required, css, required)

    def test_all_financial_control_modes_get_compact_style(self):
        css = CSS.read_text(encoding="utf-8")
        for selector in (".truck-toolbar", ".debt-metric", ".ab-balance",
                         ".receiving-kpi", ".open-debt-total",
                         ".truck-workflow-metric", ".board-card",
                         ".control-card", ".form-grid"):
            self.assertIn(selector, css, selector)


if __name__ == "__main__":
    unittest.main()
