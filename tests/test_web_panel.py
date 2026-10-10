import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path
from controller import server as panel

class WebPanelTests(unittest.TestCase):
    def test_distinct_service_identity(self):
        self.assertEqual(panel.PANEL_URL, "http://127.0.0.1:18764")
        self.assertEqual(panel.APP_URL, "http://127.0.0.1:18765")
        self.assertNotEqual(panel.PANEL_ID,panel.APP_ID)
        self.assertEqual(panel.REPO_NAME,"layon-lima/meus-controles")

    def test_web_panel_contains_update_everything(self):
        html=(panel.PANEL_ROOT/"static"/"index.html").read_text(encoding="utf-8")
        self.assertIn("Atualizar tudo",html)
        self.assertIn("/api/update",html)
        self.assertIn("Abrir aplicativo",html)

    def test_health_id_and_write_protection(self):
        http=ThreadingHTTPServer(("127.0.0.1",0),panel.Handler)
        http.daemon_threads=True
        worker=threading.Thread(target=http.serve_forever,daemon=True)
        worker.start()
        root="http://127.0.0.1:"+str(http.server_address[1])
        try:
            req=Request(root+"/api/health",headers={"Host":"127.0.0.1:18764"})
            with urlopen(req,timeout=3) as resp:
                body=json.loads(resp.read())
                self.assertEqual(body["app_id"],panel.PANEL_ID)
            req=Request(root+"/api/update",method="POST",data=b"{}",
                        headers={"Host":"127.0.0.1:18764"})
            with self.assertRaises(HTTPError) as denied:
                urlopen(req,timeout=3)
            self.assertEqual(denied.exception.code,403)
        finally:
            http.shutdown()
            http.server_close()
            worker.join(timeout=2)

if __name__=="__main__":
    unittest.main()
