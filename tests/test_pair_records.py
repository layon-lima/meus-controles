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

    def test_edit_neutral_to_debt_and_back_preserves_audit_and_balance(self):
        with app.db() as con:
            record=pair_records.handle(Handler({
                "date":"2026-02-07","amount":"1500","from_name":"JONAS",
                "to_name":"MARCOS","description":"Vale", "notes":"Verificado"
            }),con,"POST",f"/api/controls/{self.cid}/pair/records")["data"]["id"]
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-500.00")
            output=pair_records.handle(Handler({
                "date":"2026-02-07","amount":"1500","description":"Vale",
                "notes":"Verificado","kind":"debt","debtor":"A"
            }),con,"PUT",f"/api/pair-records/{record}")["data"]
            self.assertEqual(output["new_kind"],"debt")
            new_id=output["new_id"]
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-2000.00")
            self.assertEqual(pair_records.get(con,self.cid),[])
            self.assertEqual(con.execute(
                "SELECT COUNT(*) FROM pair_transaction_changes").fetchone()[0],1)
            converted=pair.handle(Handler({
                "date":"2026-02-07","amount":"1500","description":"Vale",
                "notes":"Verificado","kind":"record","debtor":"B"
            }),con,"PUT",f"/api/pair-entries/{new_id}")["data"]
            self.assertEqual(converted["new_kind"],"record")
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-500.00")
            neutral=pair_records.get(con,self.cid)
            self.assertEqual(len(neutral),1)
            self.assertEqual(neutral[0]["from_name"],"MARCOS")
            self.assertEqual(neutral[0]["to_name"],"JONAS")
            self.assertEqual(neutral[0]["notes"],"Verificado")
            self.assertEqual(con.execute(
                "SELECT COUNT(*) FROM pair_transaction_changes").fetchone()[0],2)

    def test_neutral_to_payment_changes_balance_in_opposite_direction(self):
        with app.db() as con:
            rec=pair_records.handle(Handler({
                "date":"2026-02-06","amount":"200",
                "from_name":"MARCOS","to_name":"JONAS","description":"PIX"
            }),con,"POST",f"/api/controls/{self.cid}/pair/records")["data"]["id"]
        with app.db() as con:
            result=pair_records.handle(Handler({
                "date":"2026-02-06","amount":"200","kind":"payment",
                "payer":"B","description":"PIX","notes":"Comprovado"
            }),con,"PUT",f"/api/pair-records/{rec}")["data"]
            self.assertEqual(result["new_kind"],"payment")
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-700.00")
            saved=con.execute("SELECT * FROM pair_entries WHERE id=?",
                              (result["new_id"],)).fetchone()
            self.assertEqual(saved["entry_kind"],"payment")
            self.assertEqual(saved["debtor"],"B")

    def test_conversion_rejects_closed_period_and_invalid_direction_without_data_loss(self):
        with app.db() as con:
            rec=pair_records.handle(Handler({
                "date":"2026-02-05","amount":"100",
                "from_name":"JONAS","to_name":"MARCOS","description":"Anterior"
            }),con,"POST",f"/api/controls/{self.cid}/pair/records")["data"]["id"]
            with self.assertRaisesRegex(ValueError,"quem deve"):
                pair_records.handle(Handler({
                    "date":"2026-02-05","amount":"100",
                    "description":"Anterior","kind":"debt","debtor":"C"
                }),con,"PUT",f"/api/pair-records/{rec}")
        with app.db() as con:
            report=pair.preview(con,self.cid,"2026-02-01","2026-02-28")
            pair.close(con,self.cid,{"start":"2026-02-01","end":"2026-02-28",
                "fingerprint":report["fingerprint"]})
        with self.assertRaisesRegex(ValueError,"fechado"):
            with app.db() as con:
                pair_records.handle(Handler({
                    "date":"2026-03-02","amount":"100",
                    "description":"Anterior","kind":"debt","debtor":"A"
                }),con,"PUT",f"/api/pair-records/{rec}")
        with app.db() as con:
            self.assertEqual(len(pair_records.get(con,self.cid)),1)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pair_transaction_changes").fetchone()[0],0)
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-500.00")

    def test_imported_neutral_converted_to_financial_is_not_reimported(self):
        data=self.file()
        with app.db() as con:
            preview=pair_records.batch(con,self.cid,data)
            pair_records.handle(Handler({"payload":data,"batch_id":preview["batch_id"]}),
                con,"POST",f"/api/controls/{self.cid}/pair/import/confirm")
        with app.db() as con:
            first=next(r for r in pair_records.get(con,self.cid) if r["source_row"]==1)
            pair_records.handle(Handler({
                "date":"2026-02-06","amount":"114000","kind":"debt",
                "debtor":"A","description":"Bonificação conferida"
            }),con,"PUT",f"/api/pair-records/{first['id']}")
        with app.db() as con:
            preview=pair_records.batch(con,self.cid,data)
            self.assertEqual(preview["already_imported"],3)
            self.assertEqual(preview["new_count"],0)
            confirmation=pair_records.handle(Handler({
                "payload":data,"batch_id":preview["batch_id"]}),
                con,"POST",f"/api/controls/{self.cid}/pair/import/confirm")["data"]
            self.assertEqual(confirmation["inserted"],0)
            self.assertEqual(len(pair_records.get(con,self.cid)),2)
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-114500.00")

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
