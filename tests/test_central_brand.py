"""Identidade única da Central — regressão de rotas, ícone e tema.
O teste não abre conexões, não consulta nem modifica bancos de dados.
"""
from pathlib import Path
import base64
import re
import unittest
from xml.etree import ElementTree

from central_admin.operations_gateway import rewrite_text
from central_admin.server import ASSETS

ROOT = Path(__file__).resolve().parents[1] / "central_admin" / "static"

class HorizonThemeTests(unittest.TestCase):
    def test_logo_original_embutido_e_local(self):
        icon = (ROOT / "horizon-logo.svg").read_text(encoding="utf-8")
        root = ElementTree.fromstring(icon)
        self.assertEqual(root.tag, "{http://www.w3.org/2000/svg}svg")
        image = root.find("{http://www.w3.org/2000/svg}image")
        self.assertIsNotNone(image)
        data = image.attrib["href"]
        self.assertTrue(data.startswith("data:image/webp;base64,"))
        binary = base64.b64decode(data.partition(",")[2], validate=True)
        self.assertGreater(len(binary), 1000)
        self.assertEqual(binary[:4], b"RIFF")
        self.assertEqual(binary[8:12], b"WEBP")
        self.assertEqual(ASSETS["/horizon-logo.svg"][1], "image/svg+xml")
        self.assertEqual(ASSETS["/horizon-theme.css"][1], "text/css; charset=utf-8")

    def test_uma_folha_de_estilo_em_todos_modulos(self):
        path = "/central/horizon-theme.css?v=20261125detail3"
        for name in ("index", "recebimentos", "funcionarios"):
            html = (ROOT / (name + ".html")).read_text(encoding="utf-8")
            with self.subTest(name=name):
                self.assertIn(path, html)
                self.assertIn("/central/horizon-logo.svg?v=1", html)
                self.assertLess(html.index(path), html.index("</head>"))
        for module in ("controles", "transportadoras", "relatorios", "contas", "documentos"):
            with self.subTest(module=module):
                page = rewrite_text("<html><head></head><body></body></html>",
                                    "/central/modules/" + module, "html")
                self.assertIn(path, page)
                self.assertIn("/central/horizon-logo.svg?v=1", page)
                self.assertEqual(page.count(path), 1)

    def test_marcas_legadas_em_todos_os_modulos(self):
        for module in ("contas", "documentos", "controles", "transportadoras",
                       "relatorios", "recebimentos", "funcionarios"):
            prefix = "/central/modules/" + module
            source = (
                '<html><head><link rel="icon" type="image/svg+xml" href="/icons/brand.svg"></head><body>'
                '<div class="brand"><img src="/icons/brand.svg" alt=""></div>'
                '<span class="brand-icon"><svg class="ui-icon" aria-hidden="true">'
                '<use href="/static/icons.svg#logo"></use></svg></span>'
                '<span class="mr-logo" aria-hidden="true">MC</span>'
                '<button><svg><use href="/static/icons.svg#search"></use></svg></button>'
                '<span class="avatar">AB</span></body></html>'
            )
            with self.subTest(module=module):
                page = rewrite_text(source, prefix, "html")
                self.assertNotIn(prefix + "/icons/brand.svg", page)
                self.assertNotIn("/static/icons.svg#logo", page)
                self.assertEqual(page.count('src="/central/horizon-logo.svg?v=1"'), 3)
                self.assertEqual(page.count('rel="icon"'), 1)
                self.assertIn(prefix + "/static/icons.svg#search", page)
                self.assertIn('<span class="avatar">AB</span>', page)

    def test_marca_separada_dos_icones_indicativos(self):
        home = (ROOT / "index.html").read_text(encoding="utf-8")
        icons = re.findall(r'<span class="module-icon" aria-hidden="true"><svg><use href="#i-([a-z]+)"', home)
        self.assertEqual(icons, ["wallet", "package", "sliders", "truck", "users", "doc", "link", "chart"])
        theme = (ROOT / "horizon-theme.css").read_text(encoding="utf-8")
        self.assertIn("body .brand-mark,body .nhf-mark,body .central-mark", theme)
        self.assertIn('url("/central/horizon-logo.svg?v=1")', theme)
        self.assertIn("body .rx-brand-logo", theme)
        self.assertIn("body .module-icon svg,body .nh-start-tile-icon .nh-start-icon {display:block", theme)
        self.assertNotIn(".ui-icon {display:none", theme)
        launcher = (ROOT / "launcher.js").read_text(encoding="utf-8")
        self.assertIn("badge.appendChild(icon(mod.icon))", launcher)
        self.assertIn('trigger.appendChild(icon("grid"))', launcher)
        self.assertIn("body.central-operational .nh-start-trigger>.nh-start-icon {display:block", theme)
        closed = theme.split(".nh-start-menu:not(.nh-start-open) {", 1)[1].split("}", 1)[0]
        self.assertIn("border-radius:20px", closed)
        self.assertNotIn("horizon-logo", closed)

    def test_tema_neutro_sem_vidro_nem_gradiente(self):
        theme = (ROOT / "horizon-theme.css").read_text(encoding="utf-8")
        for token in ("--hz-surface:#ffffff", "--hz-bg:#f5f6f8",
                      "backdrop-filter:none!important", "background:#fff!important",
                      "body.central-operational", "body.nh-native-screen",
                      ".module-card", ".nhf-avatar"):
            self.assertIn(token, theme)
        for kind in ("linear", "radial", "conic"):
            self.assertNotIn(kind + "-gradient(", theme)
        self.assertNotIn("backdrop-filter:blur", theme)
        self.assertNotIn("fetch(", theme)
        self.assertIn("Cores semânticas de alerta", theme)

    def test_instalador_valida_recursos_por_tipo(self):
        import os
        import subprocess
        import tempfile
        script = (ROOT.parent / "deploy" / "ATUALIZAR_VPS.sh").read_text(encoding="utf-8")
        start = script.index("for asset in launcher.js launcher.css horizon-theme.css horizon-logo.svg; do")
        end = script.index("# Verificar HTML e recursos", start)
        validation = script[start:end]
        # Exercitar o MESMO trecho bash do instalador com os arquivos reais,
        # simulando apenas o HTTP. Um grep errado no SVG deve falhar no CI.
        harness = r'''
set -Eeuo pipefail
fail(){ echo "$*" >&2; exit 1; }
curl(){
  local body="" headers="" url="" mime=""
  while (($#)); do
    case "$1" in
      -o) body="$2"; shift 2 ;;
      -D) headers="$2"; shift 2 ;;
      -w|--max-time) shift 2 ;;
      http://*) url="$1"; shift ;;
      *) shift ;;
    esac
  done
  local asset="${url##*/}"
  case "$asset" in
    *.css) mime="text/css; charset=utf-8" ;;
    *.svg) mime="image/svg+xml" ;;
    *.js) mime="text/javascript; charset=utf-8" ;;
  esac
  cp "$APP/static/$asset" "$body"
  printf 'HTTP/1.0 200 OK\r\nContent-Type: %s\r\n\r\n' "$mime" > "$headers"
  printf 200
}
'''
        with tempfile.TemporaryDirectory() as td:
            result = subprocess.run(
                ["bash", "-c", harness + "\n" + validation],
                env={**os.environ, "APP": str(ROOT.parent), "TMP": td},
                capture_output=True, text=True, timeout=10,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("byte a byte", result.stdout)
        self.assertIn('cmp -s "$APP/static/$asset" "$TMP/public-asset"', script)

if __name__ == "__main__":
    unittest.main()
