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
        path = "/central/horizon-theme.css?v=20261124brand1"
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

    def test_modulos_sem_icones_diferentes(self):
        home = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertEqual(home.count('<span class="module-icon" aria-hidden="true"></span>'), 8)
        self.assertNotRegex(home, r'<span class="module-icon"><svg>')
        theme = (ROOT / "horizon-theme.css").read_text(encoding="utf-8")
        self.assertIn('.nh-start-tile-icon', theme)
        self.assertIn('.nh-start-trigger>.nh-start-icon', theme)
        self.assertIn('url("/central/horizon-logo.svg?v=1")', theme)
        self.assertIn('body .rx-brand-logo', theme)
        self.assertNotIn('#397ecc', theme)

    def test_vidro_discreto_sem_modificar_estados(self):
        theme = (ROOT / "horizon-theme.css").read_text(encoding="utf-8")
        for text in ("--hz-rose:", "--hz-coral:", "--hz-gold:",
                     "rgba(255,255,255,.78)", "backdrop-filter:blur",
                     "body.central-operational", "body.nh-native-screen",
                     "body .module-card", "body .nhf-avatar"):
            self.assertIn(text, theme)
        # Status Pago/Pendente/Parcial continuam semanticamente distintos.
        self.assertIn(':not(.complete):not(.partial):not(.pending)', theme)
        self.assertNotIn("fetch(", theme)


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
