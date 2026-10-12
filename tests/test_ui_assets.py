"""Garantias de interface compacta e iconografia vetorial local."""
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"

class LayoutAssetsTests(unittest.TestCase):
    def test_home_has_no_bloated_intro(self):
        source = (STATIC / "app.js").read_text(encoding="utf-8")
        home = source.split('if(this.s.route==="home"){', 1)[1].split('} else if(this.s.route==="board"){', 1)[0]
        self.assertNotIn("PAINEL DE GESTÃO", home)
        self.assertNotIn("stat-grid", home)
        self.assertIn("Seus quadros", home)
        self.assertIn("Controles", home)

    def test_no_sidebar_create_control_button(self):
        markup = (STATIC / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("sidebar-new", markup)
        self.assertIn('class="sidebar-version"', markup)
        self.assertIn('onclick="App.newControl()"', markup)

    def test_icons_are_real_svg_symbols(self):
        tree = ET.parse(STATIC / "icons.svg")
        elements = tree.findall("{http://www.w3.org/2000/svg}symbol")
        names = {el.get("id") for el in elements}
        for name in ("dashboard", "folder", "truck", "plus",
                     "search", "arrow-right", "settings", "download", "logo"):
            self.assertIn(name, names)
        for symbol in elements:
            self.assertGreater(len(list(symbol)), 0)
        app = (STATIC / "app.js").read_text(encoding="utf-8")
        self.assertIn("/static/icons.svg#", app)

if __name__ == "__main__":
    unittest.main()
