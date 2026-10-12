"""Importação local de pagamentos de dívidas: datas parciais, idempotência e isolamento."""
import tempfile
import unittest
from pathlib import Path
from decimal import Decimal

import app
import debt
import debt_import

def file_for(control="CONTROLE EXEMPLO"):
    return {"format":"central-controles-divida-v1","control":control,
            "payments":[
              {"date":"2024-11","description":"PARCELA DE EXEMPLO A","amount":"125.00"},
              {"date":"2025-01","description":"PARCELA DE EXEMPLO B","amount":"125.00"},
              {"date":"2025-01","description":"PARCELA DE EXEMPLO C","amount":"125.00"},
              {"date":"2025-04","description":"TAXA ADMINISTRATIVA","amount":"25.50"}
            ]}

class DebtImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.original=(app.DATA,app.DB)
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"local.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls
              (board_id,name,mode,fields_json,rules_json,types_json)
              VALUES(1,'CONTROLE EXEMPLO','divida','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls
              (board_id,name,mode,fields_json,rules_json,types_json)
              VALUES(1,'OUTRA DÍVIDA','divida','[]','[]','[]')""").lastrowid
            debt.save_settings(con,self.cid,{"opening_amount":"1000"})
            debt.save_settings(con,self.other,{"opening_amount":"100"})
    def tearDown(self):
        app.DATA,app.DB=self.original
        self.tmp.cleanup()

    def test_month_only_dates_have_no_invented_day(self):
        self.assertEqual(debt.day("2024-11"),"2024-11")
        self.assertEqual(debt.day("2026-10-09"),"2026-10-09")
        for invalid in ("2025-13","2025-00","2026-99-01","01/2025","2025"):
            with self.assertRaises(ValueError):
                debt.day(invalid)
        payment=debt.validate_payment({"date":"2025-01","description":"Parcela","amount":"125"})
        self.assertEqual(payment["payment_date"],"2025-01")

    def test_preview_does_not_mutate_database_and_has_precise_total(self):
        with app.db() as con:
            pre=debt_import.preview(con,self.cid,file_for())
            self.assertEqual(pre["count"],4)
            self.assertEqual(pre["total"],"400.50")
            self.assertEqual(pre["new_count"],4)
            self.assertEqual(pre["current_balance"],"1000.00")
            self.assertEqual(pre["projected_balance"],"599.50")
            self.assertEqual(debt.summary(con,self.cid)["payments"],[])

    def test_commit_is_idempotent_and_keeps_labels(self):
        with app.db() as con:
            doc=file_for()
            pre=debt_import.preview(con,self.cid,doc)
            result=debt_import.commit(con,self.cid,doc,pre["fingerprint"])
            self.assertEqual(result["imported"],4)
            self.assertEqual(result["skipped"],0)
        with app.db() as con:
            view=debt.summary(con,self.cid)
            self.assertEqual(view["totals"]["paid"],"400.50")
            self.assertEqual(view["totals"]["balance"],"599.50")
            self.assertEqual(len(view["payments"]),4)
            self.assertTrue(any(p["payment_date"]=="2024-11" for p in view["payments"]))
            self.assertEqual(sum(p["description"]=="PARCELA DE EXEMPLO B" for p in view["payments"]),1)
            before=len(view["payments"])
            same=debt_import.commit(con,self.cid,doc,pre["fingerprint"])
            self.assertTrue(same["already_imported"])
            self.assertEqual(same["imported"],0)
            self.assertEqual(len(debt.summary(con,self.cid)["payments"]),before)

    def test_different_control_is_rejected(self):
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"pertence ao controle"):
                debt_import.preview(con,self.other,file_for())
            with self.assertRaisesRegex(ValueError,"pertence ao controle"):
                debt_import.preview(con,self.cid,file_for("OUTRA DÍVIDA"))
            self.assertEqual(debt.summary(con,self.other)["totals"]["count"],0)

    def test_avoids_double_counting_previously_registered_payments(self):
        with app.db() as con:
            # Mesmo mês, descrição e valor, com dia informado anteriormente.
            con.execute("""INSERT INTO debt_payments(control_id,payment_date,description,amount,notes)
              VALUES(?,?,?,?,?)""",(self.cid,"2024-11-17","PARCELA DE EXEMPLO A","125.00",""))
            doc=file_for()
            pre=debt_import.preview(con,self.cid,doc)
            self.assertEqual(pre["previously_recorded"],1)
            self.assertEqual(pre["new_count"],3)
            self.assertEqual(pre["projected_balance"],"599.50")
            debt_import.commit(con,self.cid,doc,pre["fingerprint"])
            view=debt.summary(con,self.cid)
            self.assertEqual(view["totals"]["count"],4)
            self.assertEqual(view["totals"]["paid"],"400.50")
            self.assertTrue(any(p["payment_date"]=="2024-11-17" for p in view["payments"]))

    def test_tampering_or_insufficient_debt_blocks_without_partial_records(self):
        with app.db() as con:
            pre=debt_import.preview(con,self.cid,file_for())
            with self.assertRaisesRegex(ValueError,"Arquivo alterado"):
                debt_import.commit(con,self.cid,file_for(),"wrong")
            self.assertEqual(debt.summary(con,self.cid)["totals"]["count"],0)
            debt.save_settings(con,self.cid,{"opening_amount":"100"})
            with self.assertRaisesRegex(ValueError,"insuficiente"):
                debt_import.commit(con,self.cid,file_for(),pre["fingerprint"])
            self.assertEqual(debt.summary(con,self.cid)["totals"]["count"],0)

    def test_never_reimports_after_user_deletes_a_payment(self):
        with app.db() as con:
            pre=debt_import.preview(con,self.cid,file_for())
            debt_import.commit(con,self.cid,file_for(),pre["fingerprint"])
            payment_id=con.execute("SELECT id FROM debt_payments WHERE control_id=? LIMIT 1",(self.cid,)).fetchone()["id"]
            con.execute("DELETE FROM debt_payments WHERE id=?",(payment_id,))
            second=debt_import.commit(con,self.cid,file_for(),pre["fingerprint"])
            self.assertTrue(second["already_imported"])
            self.assertEqual(debt.summary(con,self.cid)["totals"]["count"],3)

if __name__=="__main__":
    unittest.main()
