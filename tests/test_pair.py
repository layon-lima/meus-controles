"""Testes financeiros e transacionais do modelo Acerto A x B."""
from datetime import date, timedelta
from pathlib import Path
import tempfile
import unittest

import app
import pair


class PairTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.original=app.DATA,app.DB
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"pair.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'FULANO X SICRANO','acerto_ab','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'OUTRO ACERTO','acerto_ab','[]','[]','[]')""").lastrowid
            pair.save_settings(con,self.cid,{"party_a":"Fulano","party_b":"Sicrano"})
            pair.save_settings(con,self.other,{"party_a":"Maria","party_b":"João"})

    def tearDown(self):
        app.DATA,app.DB=self.original
        self.tmp.cleanup()

    def add(self,debtor,amount,date_str="2026-01-05",description="Despesa",cid=None):
        cid=cid or self.cid
        with app.db() as con:
            payload=pair.validate({"date":date_str,"debtor":debtor,"amount":amount,
                "description":description})
            return con.execute("""INSERT INTO pair_entries(control_id,entry_date,debtor,amount,description,notes,entry_kind)
                VALUES(?,?,?,?,?,?,?)""",(cid,*payload.values())).lastrowid

    def test_opposite_debts_cancel_and_reverse_debtor(self):
        self.add("A","100.00",description="Fulano deve")
        self.add("B","200.00",description="Sicrano deve")
        with app.db() as con:
            data=pair.summary(con,self.cid)
            self.assertEqual(data["totals"]["balance"],"100.00")
            self.assertEqual(data["totals"]["settlement"],{
                "debtor":"Sicrano","creditor":"Fulano","amount":"100.00","settled":False})
            self.assertEqual(data["totals"]["a_to_b"],"100.00")
            self.assertEqual(data["totals"]["b_to_a"],"200.00")
            self.assertEqual(data["totals"]["count"],2)
        self.add("A","100.00",description="Ajuste")
        with app.db() as con:
            self.assertTrue(pair.summary(con,self.cid)["totals"]["settlement"]["settled"])
        self.add("A","50.00",description="Dívida adicional")
        with app.db() as con:
            debt=pair.summary(con,self.cid)["totals"]["settlement"]
            self.assertEqual((debt["debtor"],debt["creditor"],debt["amount"]),
                             ("Fulano","Sicrano","50.00"))

    def test_pays_and_descriptions_preserved_in_isolated_controls(self):
        self.add("A","20","2026-01-03","Pagamento de peças")
        self.add("B","25","2026-01-03","Frete",cid=self.other)
        with app.db() as con:
            data=pair.summary(con,self.cid)
            other=pair.summary(con,self.other)
            self.assertEqual(data["history"][0]["description"],"Pagamento de peças")
            self.assertEqual(other["history"][0]["description"],"Frete")
            self.assertEqual(other["totals"]["settlement"]["debtor"],"João")
            self.assertEqual(data["totals"]["count"],1)
            self.assertEqual(other["totals"]["count"],1)

    def test_close_carries_net_without_recounting_archived_entries(self):
        self.add("A","100.00","2026-01-05")
        self.add("B","200.00","2026-01-10")
        with app.db() as con:
            prev=pair.preview(con,self.cid,"2026-01-01","2026-01-31")
            self.assertEqual(prev["closing_balance"],"100.00")
            saved=pair.close(con,self.cid,{"start":"2026-01-01","end":"2026-01-31",
                    "fingerprint":prev["fingerprint"]})
            archive=pair.closure(con,saved["id"])
            self.assertEqual(archive["settlement"]["debtor"],"Sicrano")
            data=pair.summary(con,self.cid)
            self.assertEqual(data["totals"]["balance"],"100.00")
            self.assertEqual(data["totals"]["opening_balance"],"100.00")
            self.assertEqual(data["totals"]["movement_balance"],"0.00")
            self.assertEqual(data["totals"]["current_count"],0)
            self.assertEqual(data["totals"]["count"],2)
            self.assertEqual(data["current_from"],"2026-02-01")
        self.add("A","40.00","2026-02-06")
        with app.db() as con:
            data=pair.summary(con,self.cid)
            self.assertEqual(data["totals"]["balance"],"60.00")
            self.assertEqual(data["totals"]["current_count"],1)
            self.assertEqual(data["totals"]["a_to_b"],"40.00")
            prev=pair.preview(con,self.cid,"2026-02-01","2026-02-28")
            self.assertEqual(prev["opening_balance"],"100.00")
            self.assertEqual(prev["movement_balance"],"-40.00")
            self.assertEqual(prev["closing_balance"],"60.00")
            pair.close(con,self.cid,{"start":"2026-02-01","end":"2026-02-28",
                      "fingerprint":prev["fingerprint"]})
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"60.00")

    def test_old_entry_cannot_be_modified_and_stale_close_fails(self):
        self.add("B","200.00","2026-01-05")
        with app.db() as con:
            preview=pair.preview(con,self.cid,"2026-01-01","2026-01-31")
            con.execute("""INSERT INTO pair_entries(control_id,entry_date,debtor,amount,description)
                VALUES(?,?,?,?,?)""",(self.cid,"2026-01-09","A","10.00","Nova compra"))
            with self.assertRaisesRegex(ValueError,"mudaram"):
                pair.close(con,self.cid,{"start":"2026-01-01","end":"2026-01-31",
                    "fingerprint":preview["fingerprint"]})
        with app.db() as con:
            new=pair.preview(con,self.cid,"2026-01-01","2026-01-31")
            pair.close(con,self.cid,{"start":"2026-01-01","end":"2026-01-31",
                       "fingerprint":new["fingerprint"]})
            with self.assertRaisesRegex(ValueError,"fechado"):
                pair.check_editable(con,self.cid,"2026-01-05")
            with self.assertRaisesRegex(ValueError,"começar"):
                pair.preview(con,self.cid,"2026-01-30","2026-02-28")

    def test_closed_entry_edit_and_delete_guarded_via_api(self):
        class Handler:
            def __init__(self,data):self.data=data
            def input(self):return self.data
            def send(self,object,status=200,mime=None):return object
        entry=self.add("B","120","2026-01-05")
        with app.db() as con:
            previous=pair.preview(con,self.cid,"2026-01-01","2026-01-31")
            pair.close(con,self.cid,{"start":"2026-01-01","end":"2026-01-31",
                "fingerprint":previous["fingerprint"]})
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"fechado"):
                pair.handle(Handler({}),con,"DELETE","/api/pair-entries/"+str(entry))
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"fechado"):
                pair.handle(Handler({"date":"2026-01-06","debtor":"A","amount":"1",
                  "description":"Editar"}),con,"PUT","/api/pair-entries/"+str(entry))
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"120.00")
            self.assertEqual(pair.summary(con,self.cid)["totals"]["count"],1)

    def test_invalid_values_and_settings(self):
        for value in ("0","-1","NaN","Infinity","1.999","muito"):
            with self.assertRaises(ValueError):pair.number(value)
        with self.assertRaises(ValueError):
            pair.validate({"date":"2026-01-05","debtor":"C","amount":"2","description":"Teste"})
        with self.assertRaises(ValueError):
            pair.validate({"date":"2026-02-31","debtor":"B","amount":"2","description":"Teste"})
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"dois nomes"):
                pair.save_settings(con,self.cid,{"party_a":"Fulano","party_b":"FULANO"})

    def test_compensation_and_real_payments_both_deduct_correctly(self):
        class Handler:
            def __init__(self,p):self.payload=p
            def input(self):return self.payload
            def send(self,data,status=200,mime=None):return data

        def post(p):
            with app.db() as con:
                return pair.handle(Handler(p),con,"POST",
                    f"/api/controls/{self.cid}/pair/entries")["id"]

        post({"date":"2026-01-05","debtor":"A","amount":"1000",
              "description":"A pegou insumos"})
        post({"date":"2026-01-06","debtor":"B","amount":"200",
              "description":"B pegou peças"})
        paid=post({"date":"2026-01-07","kind":"payment","payer":"A",
                   "amount":"300","description":"A pagou a B por PIX"})
        with app.db() as con:
            data=pair.summary(con,self.cid)
            self.assertEqual(data["totals"]["balance"],"-500.00")
            self.assertEqual(data["totals"]["settlement"]["debtor"],"Fulano")
            self.assertEqual(data["totals"]["settlement"]["creditor"],"Sicrano")
            self.assertEqual(data["totals"]["settlement"]["amount"],"500.00")
            self.assertEqual(data["totals"]["a_to_b"],"1000.00")
            self.assertEqual(data["totals"]["b_to_a"],"200.00")
            self.assertEqual(data["totals"]["payments_a_to_b"],"300.00")
            self.assertEqual(data["totals"]["payments_b_to_a"],"0.00")
            self.assertEqual(data["totals"]["payment_count"],1)
            self.assertEqual(data["totals"]["debt_count"],2)
            self.assertEqual(next(x for x in data["entries"] if x["id"]==paid)["entry_kind"],"payment")
            card=next(x for x in app.state(con)["controls"] if x["id"]==self.cid)
            self.assertEqual(card["summary"]["balance"],"-500.00")
            self.assertEqual(card["summary"]["plus"],"500.00")
            self.assertEqual(card["summary"]["minus"],"1000.00")

        # Ao pagar a B, A reduz sua dívida; já o pagamento inverso aumenta
        # o quanto A deve a B (se B pagou a A).
        post({"date":"2026-01-08","kind":"payment","payer":"B",
              "amount":"100","description":"B pagou A"})
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-600.00")

    def test_real_payment_edit_changes_direction_and_preserves_kind(self):
        class Handler:
            def __init__(self,p):self.payload=p
            def input(self):return self.payload
            def send(self,data,status=200,mime=None):return data
        with app.db() as con:
            paid=pair.handle(Handler({"date":"2026-01-05","kind":"payment",
                "payer":"A","amount":"80.00","description":"Pago"}),
                con,"POST",f"/api/controls/{self.cid}/pair/entries")["id"]
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"80.00")
        with app.db() as con:
            pair.handle(Handler({"date":"2026-01-06","kind":"payment",
                "payer":"B","amount":"50.25","description":"Pago na outra direção"}),
                con,"PUT",f"/api/pair-entries/{paid}")
        with app.db() as con:
            report=pair.summary(con,self.cid)
            self.assertEqual(report["totals"]["balance"],"-50.25")
            self.assertEqual(report["totals"]["payments_b_to_a"],"50.25")
            self.assertEqual(report["totals"]["payment_count"],1)
        with app.db() as con:
            pair.handle(Handler({}),con,"DELETE",f"/api/pair-entries/{paid}")
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"0.00")

    def test_close_records_payment_type_csv_and_carries_net_balance(self):
        class Handler:
            def __init__(self,p):self.payload=p
            def input(self):return self.payload
            def send(self,data,status=200,mime=None):return data
        with app.db() as con:
            for entry in [
                {"date":"2026-01-05","debtor":"A","amount":"500","description":"A comprou"},
                {"date":"2026-01-06","debtor":"B","amount":"100","description":"B comprou"},
                {"date":"2026-01-07","kind":"payment","payer":"A","amount":"150",
                 "description":"A pagou"}]:
                pair.handle(Handler(entry),con,"POST",
                    f"/api/controls/{self.cid}/pair/entries")
        with app.db() as con:
            prev=pair.preview(con,self.cid,"2026-01-01","2026-01-31")
            self.assertEqual(prev["closing_balance"],"-250.00")
            self.assertEqual(prev["movement_totals"]["payment_count"],1)
            result=pair.close(con,self.cid,{"start":"2026-01-01",
                "end":"2026-01-31","fingerprint":prev["fingerprint"]})
            csv=pair.export_csv(con,result["id"]).decode("utf-8-sig")
            self.assertIn("Pagamento real",csv)
            self.assertIn("Dívida / compensação",csv)
            self.assertIn("Pagador",csv)
            with self.assertRaisesRegex(ValueError,"fechado"):
                pair.check_editable(con,self.cid,"2026-01-07")
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-250.00")
        with app.db() as con:
            pair.handle(Handler({"date":"2026-02-04","kind":"payment",
                "payer":"A","amount":"250","description":"A quitou"}),
                con,"POST",f"/api/controls/{self.cid}/pair/entries")
        with app.db() as con:
            data=pair.summary(con,self.cid)
            self.assertEqual(data["totals"]["balance"],"0.00")
            self.assertTrue(data["totals"]["settlement"]["settled"])
            self.assertEqual(data["totals"]["opening_balance"],"-250.00")
            self.assertEqual(data["totals"]["payments_a_to_b"],"250.00")
            self.assertEqual(data["totals"]["current_count"],1)

    def test_migration_keeps_entries_when_old_database_has_no_kind(self):
        with app.db() as con:
            # Simula um banco anterior ao recurso de pagamento real.
            con.execute("DROP TABLE pair_entries")
            con.execute("""CREATE TABLE pair_entries (
                id INTEGER PRIMARY KEY,
                control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
                entry_date TEXT NOT NULL,
                debtor TEXT NOT NULL CHECK(debtor IN ('A','B')),
                amount TEXT NOT NULL,
                description TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,notes)
                VALUES(?,?,?,?,?,?)""",
                (self.cid,"2026-01-05","A","123.45","Compra antiga","Observação preservada"))
            pair.initialize(con)
            pair.initialize(con)
            columns={x["name"] for x in con.execute("PRAGMA table_info(pair_entries)")}
            self.assertIn("entry_kind",columns)
            data=pair.summary(con,self.cid)
            self.assertEqual(data["totals"]["balance"],"-123.45")
            self.assertEqual(data["history"][0]["description"],"Compra antiga")
            self.assertEqual(data["history"][0]["notes"],"Observação preservada")
            self.assertEqual(data["history"][0]["entry_kind"],"debt")

    def test_invalid_payment_type_and_legacy_debts_stay_compatible(self):
        for invalid in ("bank","automatic","",None):
            with self.assertRaisesRegex(ValueError,"Selecione dívida ou pagamento real"):
                pair.validate({"date":"2026-01-08","kind":invalid,"payer":"A",
                               "amount":"1","description":"Teste"})
        with self.assertRaisesRegex(ValueError,"quem pagou"):
            pair.validate({"date":"2026-01-08","kind":"payment","payer":"C",
                           "amount":"1","description":"Teste"})
        self.assertEqual(pair.validate({"date":"2026-01-08","debtor":"A",
                           "amount":"1","description":"Antigo"})["entry_kind"],"debt")
        self.assertEqual(pair.sign({"amount":"100.00","debtor":"A"}),-100)
        with app.db() as con:
            con.execute("""INSERT INTO pair_entries
              (control_id,entry_date,debtor,amount,description)
              VALUES(?,?,?,?,?)""",(self.cid,"2026-01-08","A","75.00","Antigo"))
            record=pair.summary(con,self.cid)
            self.assertEqual(record["totals"]["balance"],"-75.00")
            self.assertEqual(record["history"][0]["entry_kind"],"debt")

    def test_csv_and_copy_empty_model(self):
        self.add("A","100.00","2026-01-05","Peças")
        with app.db() as con:
            prev=pair.preview(con,self.cid,"2026-01-01","2026-01-31")
            clos=pair.close(con,self.cid,{"start":"2026-01-01","end":"2026-01-31",
                "fingerprint":prev["fingerprint"]})
            raw=pair.export_csv(con,clos["id"]).decode("utf-8-sig")
            self.assertIn("Peças",raw)
            self.assertIn("Fulano",raw)
            self.assertIn("Sicrano",raw)
            self.assertIn("100.00",raw)
            self.assertEqual(app.state(con)["controls"][-2]["summary"]["settlement"]["amount"],"100.00")


if __name__=="__main__":
    unittest.main()
