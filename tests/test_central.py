import json
import tempfile
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
import app

class CentralTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old=(app.DATA,app.DB,app.PORT)
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"test.db"
        app.initialize()

    def tearDown(self):
        app.DATA,app.DB,app.PORT=self.old
        self.tmp.cleanup()

    def test_freight_formula_and_precise_money(self):
        with app.db() as con:
            c=app.get_control(con,1)
        self.assertEqual(c["name"],"Controle de Fretes")
        data={"data":"2026-10-10","motorista":"Motorista teste",
              "peso":"32000","valor_kg":"0,35","comissao":"10"}
        values,calc,amount,typ=app.evaluate(c,data,"frete")
        self.assertEqual(calc["valor_frete"],"11200.00")
        self.assertEqual(calc["comissao_valor"],"1120.00")
        self.assertEqual(calc["resultado"],"10080.00")
        self.assertEqual(amount,"11200.00")
        self.assertEqual(typ["direction"],1)

    def test_negative_manual_amount_rejected(self):
        with app.db() as con:
            c=app.get_control(con,1)
        data={"data":"2026-10-10","motorista":"A","peso":"1000",
              "valor_kg":"0.5","comissao":"10"}
        with self.assertRaises(ValueError):
            app.evaluate(c,data,"abatimento","-25")

    def test_zero_entries_on_first_run(self):
        with app.db() as con:
            st=app.state(con)
        self.assertEqual(len(st["boards"]),1)
        self.assertEqual(len(st["controls"]),1)
        self.assertEqual(st["controls"][0]["summary"]["count"],0)

    def test_configuration_rejects_unsafe_rule(self):
        with app.db() as con:
            c=app.get_control(con,1)
        invalid=dict(c)
        invalid["rules"]=[{"key":"bad","label":"Invalido",
                           "op":"execute","a":"peso","b":"valor_kg"}]
        with self.assertRaises(ValueError):
            app.validate_config(invalid)

    def test_http_lifecycle_and_summary(self):
        server=ThreadingHTTPServer(("127.0.0.1",0),app.Handler)
        app.PORT=server.server_address[1]
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        base=f"http://127.0.0.1:{app.PORT}"
        def request(path,method="GET",payload=None):
            raw=None if payload is None else json.dumps(payload).encode()
            req=Request(base+path,data=raw,method=method,
                        headers={"Content-Type":"application/json"} if raw else {})
            with urlopen(req,timeout=3) as response:
                return json.loads(response.read())
        try:
            st=request("/api/state")
            self.assertEqual(st["controls"][0]["name"],"Controle de Fretes")
            entry=request("/api/controls/1/entries","POST",{
                "type_key":"frete","category":"Soja","notes":"Teste",
                "data":{"data":"2026-10-10","motorista":"A",
                        "peso":"10000","valor_kg":"0.5","comissao":"8"}})
            self.assertGreater(entry["id"],0)
            d=request("/api/controls/1")
            self.assertEqual(d["summary"]["balance"],"5000.00")
            self.assertEqual(d["summary"]["by_category"][0]["name"],"Soja")
            request("/api/entries/"+str(entry["id"]),"DELETE")
            self.assertEqual(request("/api/controls/1")["summary"]["count"],0)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

if __name__=="__main__":
    unittest.main()
