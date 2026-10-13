"""Mover controles entre pastas sem perder qualquer dado ou configuração."""
import tempfile
from pathlib import Path
import unittest
import app
import pair
import receiving

class Request:
    headers={"Host":"127.0.0.1"}
    def __init__(self,method,path,data=None):
        self.command=method
        self.path=path
        self.data=data or {}
    def input(self):return self.data
    def send(self,data,status=200,mime=None):return {"status":status,"payload":data}

class FolderMoveTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.original=(app.DATA,app.DB)
        app.DATA=Path(self.temp.name)
        app.DB=app.DATA/"controls.db"
        app.initialize()
        with app.db() as con:
            self.source=con.execute("INSERT INTO boards(name) VALUES('ORIGEM')").lastrowid
            self.target=con.execute("INSERT INTO boards(name) VALUES('DESTINO')").lastrowid
            self.generic=self.make_control(con,"financeiro","FINANCEIRO")
            self.pair_id=self.make_control(con,"acerto_ab","FULANO X SICRANO")
            pair.save_settings(con,self.pair_id,{"party_a":"Fulano","party_b":"Sicrano"})
            self.receiving_id=self.make_control(con,"recebimento","RECEBIMENTO")
            con.execute("""INSERT INTO entries(control_id,type_key,type_label,direction,category,notes,
                data_json,calculated_json,amount) VALUES(?,?,?,?,?,?,?,?,?)""",
                (self.generic,"entrada","Entrada",1,"Geral","Historico",
                 '{}','{}',"90.00"))
            con.execute("""INSERT INTO pair_entries(control_id,entry_date,debtor,amount,description)
                VALUES(?,?,?,?,?)""",(self.pair_id,"2026-10-10","B","210.00","Frete"))
            con.execute("""INSERT INTO purchase_items(control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",(self.receiving_id,"PED-123","Fornecedor","ADUBO","kg","100.000"))

    def make_control(self,con,mode,name):
        return con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
            VALUES(?,?,?,?,?,?)""",(self.source,name,mode,'[]','[]','[]')).lastrowid

    def tearDown(self):
        app.DATA,app.DB=self.original
        self.temp.cleanup()

    def request(self,method,path,data=None):
        return app.Handler.route(Request(method,path,data))

    def test_move_keeps_id_type_entries_and_parent_folder(self):
        for cid in (self.generic,self.pair_id,self.receiving_id):
            response=self.request("PATCH",f"/api/controls/{cid}/move",{"board_id":self.target})
            self.assertEqual(response["status"],200)
            self.assertEqual(response["payload"]["id"],cid)
            self.assertEqual(response["payload"]["board_id"],self.target)
            self.assertTrue(response["payload"]["moved"])
        with app.db() as con:
            controls={c["id"]:c for c in app.state(con)["controls"]}
            self.assertEqual(controls[self.generic]["board_id"],self.target)
            self.assertEqual(controls[self.generic]["summary"]["balance"],"90.00")
            self.assertEqual(controls[self.pair_id]["mode"],"acerto_ab")
            self.assertEqual(controls[self.pair_id]["summary"]["settlement"]["amount"],"210.00")
            self.assertEqual(pair.settings(con,self.pair_id),{"party_a":"Fulano","party_b":"Sicrano"})
            self.assertEqual(receiving.summary(con,self.receiving_id)["totals"]["items"],1)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM entries WHERE control_id=?",
                                         (self.generic,)).fetchone()[0],1)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pair_entries WHERE control_id=?",
                                         (self.pair_id,)).fetchone()[0],1)

    def test_nonexistent_folder_and_invalid_input_do_not_move(self):
        for target in (0,999999,True,"2",-1,None):
            response=self.request("PATCH",f"/api/controls/{self.generic}/move",{"board_id":target})
            self.assertEqual(response["status"],400)
            with app.db() as con:
                self.assertEqual(app.get_control(con,self.generic)["board_id"],self.source)
        not_found=self.request("PATCH","/api/controls/987654/move",{"board_id":self.target})
        self.assertEqual(not_found["status"],404)

    def test_same_destination_is_harmless_and_move_back_works(self):
        self.request("PATCH",f"/api/controls/{self.generic}/move",{"board_id":self.target})
        again=self.request("PATCH",f"/api/controls/{self.generic}/move",{"board_id":self.target})
        self.assertFalse(again["payload"]["moved"])
        back=self.request("PATCH",f"/api/controls/{self.generic}/move",{"board_id":self.source})
        self.assertTrue(back["payload"]["moved"])
        with app.db() as con:
            self.assertEqual(app.get_control(con,self.generic)["board_id"],self.source)

    def test_cannot_delete_folder_containing_controls(self):
        failed=self.request("DELETE",f"/api/boards/{self.source}")
        self.assertEqual(failed["status"],400)
        self.assertIn("Mova-os",failed["payload"]["error"])
        with app.db() as con:
            self.assertTrue(con.execute("SELECT 1 FROM boards WHERE id=?",(self.source,)).fetchone())
            self.assertTrue(con.execute("SELECT 1 FROM pair_entries WHERE control_id=?",(self.pair_id,)).fetchone())
        for cid in (self.generic,self.pair_id,self.receiving_id):
            self.request("PATCH",f"/api/controls/{cid}/move",{"board_id":self.target})
        done=self.request("DELETE",f"/api/boards/{self.source}")
        self.assertEqual(done["status"],200)
        with app.db() as con:
            self.assertFalse(con.execute("SELECT 1 FROM boards WHERE id=?",(self.source,)).fetchone())
            self.assertEqual(con.execute("SELECT COUNT(*) FROM controls WHERE board_id=?",
                                         (self.target,)).fetchone()[0],3)

if __name__=="__main__":
    unittest.main()
