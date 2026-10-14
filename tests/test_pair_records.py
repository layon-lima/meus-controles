"""Registro informativo e importação segura sem alterar o saldo A × B."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import app
import pair
import pair_records

class Handler:
    def __init__(self,payload=None):
        self.payload=payload
    def input(self):
        return self.payload
    def send(self,data,status=200,mime=None):
        return {"status":status,"data":data}

class PairRecordTests(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory()
        self.original=app.DATA,app.DB
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"pair_records.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'JONAS X MARCOS','acerto_ab','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'JONAS X RANGEL','acerto_ab','[]','[]','[]')""").lastrowid
            pair.save_settings(con,self.cid,{"party_a":"JONAS","party_b":"MARCOS"})
            pair.save_settings(con,self.other,{"party_a":"JONAS","party_b":"RANGEL"})
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,entry_kind)
                VALUES(?,?,?,?,?,?)""",(self.cid,"2026-02-01","A","500.00","Dívida inicial","debt"))
    def tearDown(self):
        app.DATA,app.DB=self.original
        self.tmp.cleanup()

    def file(self):
        return {"format":"central-pair-records-v1",
            "target":{"party_a":"JONAS","party_b":"MARCOS"},
            "source_name":"LANÇAMENTOS 2025-2026",
            "records":[
                {"date":None,"date_raw":"","amount":"114000.00","from_name":"",
                 "to_name":"FRIGENIO MOEIRA","description":"CRÉDITO DE BONIFICAÇÃO",
                 "original_type":"ENTRADA","original_balance":"114000.00","source_row":1},
                {"date":"2025-02-25","date_raw":"25/02/2025","amount":"4000.00","from_name":"",
                 "to_name":"","description":"SEM MOTIVO DESCRITO",
                 "original_type":"SAÍDA","original_balance":"113000.00","source_row":2},
                {"date":"1900-05-13","date_raw":"13/05/1900","amount":"134.90","from_name":"",
                 "to_name":"FRIGENIO MOEIRA","description":"COMPRA DE CIGARRO",
                 "original_type":"SAÍDA","original_balance":"22569.91","source_row":55},
            ]}

    def test_zero_impact_before_and_after_import(self):
        with app.db() as con:
            original=pair.summary(con,self.cid)["totals"]["balance"]
            preview=pair_records.handle(Handler(self.file()),con,"POST",
                f"/api/controls/{self.cid}/pair/import/preview")["data"]
            self.assertEqual(preview["new_count"],3)
            self.assertEqual(preview["count"],3)
            self.assertEqual(len(preview["warnings"]),2)
            self.assertEqual(original,"-500.00")
            result=pair_records.handle(Handler({"payload":self.file(),
                 "batch_id":preview["batch_id"]}),con,"POST",
                 f"/api/controls/{self.cid}/pair/import/confirm")["data"]
            self.assertEqual(result["inserted"],3)
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],original)
            records=pair_records.get(con,self.cid)
            self.assertEqual(len(records),3)
            self.assertEqual({r["original_type"] for r in records},{"SAÍDA","ENTRADA"})
            self.assertEqual(next(r for r in records if r["source_row"]==1)["record_date"],None)
            self.assertEqual(next(r for r in records if r["source_row"]==55)["original_date"],"13/05/1900")
            self.assertEqual(pair.summary(con,self.cid)["totals"]["current_count"],1)
            self.assertEqual(pair.preview(con,self.cid,"2026-01-01","2026-02-28")["closing_balance"],original)

    def test_reimport_is_idempotent_and_wrong_destination_is_blocked(self):
        with app.db() as con:
            payload=self.file()
            with self.assertRaisesRegex(ValueError,"JONAS × MARCOS"):
                pair_records.batch(con,self.other,payload)
            prev=pair_records.batch(con,self.cid,payload)
            pair_records.handle(Handler({"payload":payload,"batch_id":prev["batch_id"]}),
                con,"POST",f"/api/controls/{self.cid}/pair/import/confirm")
        with app.db() as con:
            new=pair_records.batch(con,self.cid,self.file())
            self.assertEqual(new["new_count"],0)
            self.assertEqual(new["already_imported"],3)
            again=pair_records.handle(Handler({"payload":self.file(),
                 "batch_id":new["batch_id"]}),con,"POST",
                 f"/api/controls/{self.cid}/pair/import/confirm")["data"]
            self.assertEqual(again["inserted"],0)
            self.assertEqual(again["skipped"],3)
            self.assertEqual(len(pair_records.get(con,self.cid)),3)

    def test_manual_add_edit_delete_changes_no_financial_value(self):
        with app.db() as con:
            saved=pair_records.handle(Handler({
                "date":"2026-02-04","amount":"1700","from_name":"JONAS",
                "to_name":"FUNCIONÁRIO","description":"SALÁRIO","notes":"Apenas registro"}),
                con,"POST",f"/api/controls/{self.cid}/pair/records")["data"]
        rid=saved["id"]
        with app.db() as con:
            edited=pair_records.handle(Handler({
                "date":"2026-02-05","amount":"1800","from_name":"JONAS",
                "to_name":"FUNCIONÁRIO","description":"SALÁRIO AJUSTADO","notes":"Registro"}),
                con,"PUT",f"/api/pair-records/{rid}")["data"]
            self.assertTrue(edited["ok"])
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-500.00")
            self.assertEqual(pair_records.record_by_id(con,rid)["amount"],"1800.00")
        with app.db() as con:
            pair_records.handle(Handler(),con,"DELETE",f"/api/pair-records/{rid}")
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-500.00")
            self.assertEqual(pair_records.get(con,self.cid),[])

    def test_bad_format_or_modified_confirmation_rejected(self):
        with app.db() as con:
            p=self.file()
            with self.assertRaisesRegex(ValueError,"Arquivo inválido"):
                pair_records.batch(con,self.cid,{"format":"outro","records":[]})
            before=pair_records.batch(con,self.cid,p)
            p["records"][0]["amount"]="1.00"
            with self.assertRaisesRegex(ValueError,"alterado"):
                pair_records.handle(Handler({"payload":p,"batch_id":before["batch_id"]}),
                    con,"POST",f"/api/controls/{self.cid}/pair/import/confirm")
        with app.db() as con:
            self.assertEqual(pair_records.get(con,self.cid),[])

if __name__=="__main__":
    unittest.main()
