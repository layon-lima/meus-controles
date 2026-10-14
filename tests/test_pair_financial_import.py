"""Importação financeira real de A x B: prévia, duplicidade, datas, saldo e fechamentos."""
from pathlib import Path
from tempfile import TemporaryDirectory
from decimal import Decimal
import unittest
import app
import pair
import pair_financial_import as importer
import pair_records

class FinancialImportTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory()
        self.old=(app.DATA,app.DB)
        app.DATA=Path(self.temp.name)
        app.DB=app.DATA/"finance.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls
              (board_id,name,mode,fields_json,rules_json,types_json)
              VALUES(1,'JONAS X MARCOS','acerto_ab','[]','[]','[]')""").lastrowid
            self.reversed=con.execute("""INSERT INTO controls
              (board_id,name,mode,fields_json,rules_json,types_json)
              VALUES(1,'MARCOS X JONAS','acerto_ab','[]','[]','[]')""").lastrowid
            pair.save_settings(con,self.cid,{"party_a":"JONAS","party_b":"MARCOS"})
            pair.save_settings(con,self.reversed,{"party_a":"MARCOS","party_b":"JONAS"})
    def tearDown(self):
        app.DATA,app.DB=self.old
        self.temp.cleanup()

    @staticmethod
    def sample():
        return {"format":"central-pair-financial-v1",
                "target":{"party_a":"JONAS","party_b":"MARCOS"},
                "source_name":"PLANILHA TESTE 2025",
                "movements":[
                    {"source_row":1,"date":None,"date_raw":"",
                     "kind":"debt","person":"A","amount":"114000.00",
                     "description":"FRIGENIO MOEIRA - CRÉDITO REFERENTE A BONIFICAÇÃO %",
                     "original_type":"ENTRADA","original_receiver":"FRIGENIO MOEIRA",
                     "original_balance":"114000.00"},
                    {"source_row":2,"date":"2025-02-25","date_raw":"25/02/2025",
                     "kind":"payment","person":"A","amount":"4000.00",
                     "description":"DESTINATÁRIO NÃO INFORMADO - SEM MOTIVO DESCRITO",
                     "original_type":"SAÍDA","original_receiver":"",
                     "original_balance":"113000.00"},
                    {"source_row":55,"date":"1900-05-13","date_raw":"13/05/1900",
                     "kind":"payment","person":"A","amount":"134.90",
                     "description":"FRIGENIO MOEIRA - COMPRA DE CIGARRO",
                     "original_type":"SAÍDA","original_receiver":"FRIGENIO MOEIRA",
                     "original_balance":"22569.91"}]}

    def test_preview_shows_debt_payment_counts_and_original_dates(self):
        with app.db() as con:
            p=importer.preview(con,self.cid,self.sample())
            self.assertEqual(p["count"],3)
            self.assertEqual(p["debt_count"],1)
            self.assertEqual(p["payment_count"],2)
            self.assertEqual(p["debt_total"],"114000.00")
            self.assertEqual(p["payment_total"],"4134.90")
            self.assertEqual(p["net_of_file"],"-109865.10")
            self.assertEqual(len(p["missing_dates"]),1)
            self.assertEqual(len(p["unusual_dates"]),1)
            self.assertEqual(p["current_balance"],"0.00")
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"0.00")

    def test_no_confirmation_without_missing_credit_date_and_date_1900_consent(self):
        with app.db() as con:
            p=importer.preview(con,self.cid,self.sample())
            with self.assertRaisesRegex(ValueError,"Informe a data do crédito"):
                importer.confirm(con,self.cid,{"payload":self.sample(),"batch_id":p["batch_id"],
                                               "accept_unusual_dates":True})
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"1900"):
                importer.confirm(con,self.cid,{"payload":self.sample(),"batch_id":p["batch_id"],
                  "corrected_dates":{"1":"2025-02-24"}})
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"0.00")

    def test_confirm_creates_real_debt_and_payments_without_auto_closing(self):
        with app.db() as con:
            p=importer.preview(con,self.cid,self.sample())
            result=importer.confirm(con,self.cid,{
                "payload":self.sample(),"batch_id":p["batch_id"],
                "corrected_dates":{"1":"2025-02-24","55":"2025-05-13"}
            })
            self.assertEqual(result["inserted"],3)
            data=pair.summary(con,self.cid)
            self.assertEqual(data["totals"]["balance"],"-109865.10")
            self.assertEqual(data["totals"]["a_to_b"],"114000.00")
            self.assertEqual(data["totals"]["payments_a_to_b"],"4134.90")
            self.assertEqual(data["totals"]["settlement"]["debtor"],"JONAS")
            self.assertEqual(data["totals"]["settlement"]["creditor"],"MARCOS")
            self.assertEqual(data["totals"]["closures"],0)
            records=con.execute("""SELECT entry_kind,description,entry_date
                FROM pair_entries WHERE control_id=? ORDER BY id""",(self.cid,)).fetchall()
            self.assertEqual([r["entry_kind"] for r in records],["debt","payment","payment"])
            self.assertEqual(records[1]["description"],"DESTINATÁRIO NÃO INFORMADO - SEM MOTIVO DESCRITO")
            self.assertEqual(records[2]["entry_date"],"2025-05-13")
        with app.db() as con:
            check=importer.preview(con,self.cid,self.sample())
            self.assertEqual(check["new_count"],0)
            repeated=importer.confirm(con,self.cid,{
                "payload":self.sample(),"batch_id":check["batch_id"],
                "corrected_dates":{"1":"2025-02-24","55":"2025-05-13"}})
            self.assertEqual(repeated["inserted"],0)
            self.assertEqual(repeated["skipped"],3)
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-109865.10")

    def test_preserves_existing_entries_and_blocks_wrong_orientation(self):
        with app.db() as con:
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,entry_kind)
                VALUES(?,?,?,?,?,?)""",
                (self.cid,"2025-01-10","B","550.00","Existing debt B to A","debt"))
            p=importer.preview(con,self.cid,self.sample())
            with self.assertRaisesRegex(ValueError,"ordem JONAS"):
                importer.preview(con,self.reversed,self.sample())
            importer.confirm(con,self.cid,{
                "payload":self.sample(),"batch_id":p["batch_id"],
                "corrected_dates":{"1":"2025-02-24","55":"2025-05-13"}})
        with app.db() as con:
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-109315.10")
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pair_entries WHERE control_id=?",(self.cid,)).fetchone()[0],4)

    def test_manual_duplicate_requires_explicit_confirmation(self):
        with app.db() as con:
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,entry_kind)
                VALUES(?,?,?,?,?,?)""",
                (self.cid,"2025-02-25","A","4000.00",
                 "DESTINATÁRIO NÃO INFORMADO - SEM MOTIVO DESCRITO","payment"))
            p=importer.preview(con,self.cid,self.sample())
            with self.assertRaisesRegex(ValueError,"idêntico"):
                importer.confirm(con,self.cid,{"payload":self.sample(),"batch_id":p["batch_id"],
                     "corrected_dates":{"1":"2025-02-24","55":"2025-05-13"}})
        with app.db() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pair_entries WHERE control_id=?",(self.cid,)).fetchone()[0],1)

    def test_closed_period_is_never_rewritten(self):
        with app.db() as con:
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,entry_kind)
                VALUES(?,?,?,?,?,?)""",
                (self.cid,"2025-02-24","A","100.00","Old credit","debt"))
            close=pair.preview(con,self.cid,"2025-02-24","2025-02-24")
            pair.close(con,self.cid,{"start":"2025-02-24","end":"2025-02-24","fingerprint":close["fingerprint"]})
        with app.db() as con:
            p=importer.preview(con,self.cid,self.sample())
            with self.assertRaisesRegex(ValueError,"fechado"):
                importer.confirm(con,self.cid,{"payload":self.sample(),"batch_id":p["batch_id"],
                     "corrected_dates":{"1":"2025-02-24","55":"2025-05-13"}})
        with app.db() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pair_financial_import_rows WHERE control_id=?",(self.cid,)).fetchone()[0],0)

    def test_neutral_import_reports_correct_button_instead_of_generic_error(self):
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"Importar dívidas e pagamentos"):
                pair_records.batch(con,self.cid,self.sample())

if __name__=="__main__":
    unittest.main()
