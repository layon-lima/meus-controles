"""PWA instalável, rotas e privacidade do cache, em servidor SQLite isolado."""
import json
from pathlib import Path
import struct
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import urlopen

import app
from pwa_assets import icon_png


ROOT = Path(__file__).resolve().parents[1]


class PWATests(unittest.TestCase):
    def test_png_icons_have_required_sizes(self):
        for size in (192, 512):
            image = icon_png(size)
            self.assertEqual(image[:8], b"\x89PNG\r\n\x1a\n")
            width, height = struct.unpack(">II", image[16:24])
            self.assertEqual((width, height), (size, size))

    def test_manifest_links_and_sw_never_cache_api(self):
        manifest = json.loads((ROOT / "static/manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["display"], "standalone")
        self.assertEqual({i["sizes"] for i in manifest["icons"]}, {"192x192", "512x512"})
        html = (ROOT / "static/index.html").read_text(encoding="utf-8")
        self.assertIn('rel="manifest"', html)
        self.assertIn('/static/pwa.js', html)
        sw = (ROOT / "static/sw.js").read_text(encoding="utf-8")
        self.assertIn('url.pathname.startsWith("/api/")', sw)
        self.assertNotIn("indexedDB", sw)
        self.assertNotIn("POST", sw.split('event.respondWith(fetch(req)', 1)[0])

    def test_pwa_routes_and_sqlite_readiness(self):
        original = (app.DATA, app.DB, app.PORT)
        with tempfile.TemporaryDirectory() as temp:
            app.DATA = Path(temp)
            app.DB = app.DATA / "controles.db"
            app.initialize()
            server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
            app.PORT = server.server_address[1]
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for route, prefix in (
                    ("/api/ready", b'{"ok": true'),
                    ("/manifest.webmanifest", b"{"),
                    ("/pwa-icon-192.png", b"\x89PNG"),
                    ("/pwa-icon-512.png", b"\x89PNG"),
                    ("/sw.js", b"/* PWA"),
                    ("/static/pwa.js", b"/* Instala"),
                    ("/static/desktop_compact.css?v=20261022", b"/* CENTRAL"),
                ):
                    with self.subTest(route=route):
                        with urlopen(f"http://127.0.0.1:{app.PORT}{route}", timeout=10) as response:
                            self.assertEqual(response.status, 200)
                            self.assertTrue(response.read(50).startswith(prefix))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
                app.DATA, app.DB, app.PORT = original


if __name__ == "__main__":
    unittest.main()
