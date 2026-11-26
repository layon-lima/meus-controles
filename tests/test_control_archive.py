"""Encerramento de controles: histórico consultável, sem exclusão ou edição."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import app


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        old=(app.DATA,app.DB)
        self.addCleanup(lambda: (setattr(app,"DATA",old[0]),setattr(app,"DB",old[1])))
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"test.db"
        app.initialize()
        with app.db() as con:
            self.bid=con.execute("INSERT INTO boards(name) VALUES(?)",("Teste histórico",)).lastrowid
            self.cid=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
              VALUES(?,?,'saldo','[]','[]','[]')""",(self.bid,"Controle finalizado")).lastrowid
            self.entry=con.execute("""INSERT INTO entries(control_id,type_key,type_label,direction,data_json,calculated_json,amount)
              VALUES(?,'x','Teste',1,'{}','{}','100.00')""",(self.cid,)).lastrowid
            self.rid=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
              VALUES(?,?,'recebimento','[]','[]','[]')""",(self.bid,"Recebimentos finalizados")).lastrowid
            self.item=con.execute("""INSERT INTO purchase_items(control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,'1','Fornecedor','Produto','kg','10.000')""",(self.rid,)).lastrowid
        self.server=ThreadingHTTPServer(("127.0.0.1",0),app.Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def api(self,path,method="GET",body=None):
        req=Request("http://127.0.0.1:"+str(self.server.server_port)+path,
                    data=json.dumps(body or {}).encode() if method!="GET" else None,
                    headers={"Content-Type":"application/json"},method=method)
        try:
            with urlopen(req,timeout=5) as r:
                return r.status,json.load(r)
        except HTTPError as e:
            return e.code,json.load(e)

    def test_close_preserves_entries_and_blocks_mutations(self):
        path="/api/controls/"+str(self.cid)
        self.assertEqual(self.api(path+"/close","POST")[0],200)
        status,state=self.api("/api/state")
        self.assertEqual(status,200)
        self.assertNotIn(self.cid,[c["id"] for c in state["controls"]])
        archived=next(c for c in state["archived_controls"] if c["id"]==self.cid)
        self.assertTrue(archived["closed_at"])
        self.assertEqual(archived["summary"]["balance"],"100.00")
        status,detail=self.api(path)
        self.assertEqual(status,200)
        self.assertEqual(detail["entries"][0]["id"],self.entry)
        for url,verb in ((path,"DELETE"),(path+"/rename","PATCH"),
                         (path+"/entries","POST"),("/api/entries/"+str(self.entry),"DELETE"),
                         (path+"/close","POST")):
            code,error=self.api(url,verb)
            self.assertEqual(code,400)
            self.assertIn("encerrado",error["error"])
        self.assertEqual(self.api(path)[1]["entries"][0]["id"],self.entry)

    def test_nested_receiving_records_are_read_only(self):
        path="/api/controls/"+str(self.rid)
        self.assertEqual(self.api(path+"/close","POST")[0],200)
        self.assertEqual(self.api(path+"/receiving")[0],200)
        self.assertEqual(self.api("/api/receiving-items/"+str(self.item),"DELETE")[0],400)
        self.assertEqual(self.api(path+"/receiving/items","POST")[0],400)
        with app.db() as con:
            self.assertIsNotNone(con.execute("SELECT id FROM purchase_items WHERE id=?",(self.item,)).fetchone())

if __name__=="__main__":
    unittest.main()
