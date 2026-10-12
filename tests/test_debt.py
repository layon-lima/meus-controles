"""Testes do modelo pronto Controle de Dívidas."""
import csv
from decimal import Decimal
from io import BytesIO
from pathlib import Path
import tempfile
import unittest

import app
import debt

class DebtControlTests(unittest.TestCase):
    def setUp(self):
        self.work=tempfile.TemporaryDirectory()
        self.original=(app.DATA,app.DB)
        app.DATA=Path(self.work.name)
        app.DB=app.DATA/"debts.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls
             (board_id,name,mode,fields_json,rules_json,types_json)
             VALUES(1,'VAN X SPRINTER - JONAS E PEDRO','divida','[]','[]','[]')""").lastrowid
            debt.save_settings(con,self.cid,{"opening_amount":"90000"})
            con.commit()

    def tearDown(self):
        app.DATA,app.DB=self.original
        self.work.cleanup()

    def add(self,when,description,amount):
        with app.db() as con:
            data=debt.validate_payment({"date":when,"description":description,"amount":amount})
            debt.can_pay(con,self.cid,data["amount"])
            cur=con.execute("""INSERT INTO debt_payments
              (control_id,payment_date,description,amount,notes) VALUES(?,?,?,?,?)""",
              (self.cid,data["payment_date"],data["description"],data["amount"],data["notes"]))
            return cur.lastrowid

    def test_spreadsheet_example_four_payments(self):
        examples=[("2026-07-02","Pagamento 1","15000"),
                  ("2026-07-24","Pagamento 2","15000"),
                  ("2026-09-06","Pagamento 3","15000"),
                  ("2026-10-09","Pagamento 4","15000")]
        for dt,name,value in examples:
            self.add(dt,name,value)
        with app.db() as con:
            result=debt.summary(con,self.cid)
            self.assertEqual(result["totals"]["opening_amount"],"90000.00")
            self.assertEqual(result["totals"]["paid"],"60000.00")
            self.assertEqual(result["totals"]["balance"],"30000.00")
            self.assertEqual(result["totals"]["count"],4)
            self.assertEqual(result["payments"][0]["description"],"Pagamento 4")
            self.assertEqual(app.state(con)["controls"][-1]["summary"]["balance"],"30000.00")

    def test_description_and_payment_validation(self):
        with self.assertRaisesRegex(ValueError,"descrição"):
            debt.validate_payment({"date":"2026-10-09","description":"  ","amount":"500"})
        with self.assertRaises(ValueError):
            debt.validate_payment({"date":"2026-99-01","description":"Teste","amount":"500"})
        with self.assertRaises(ValueError):
            debt.validate_payment({"date":"2026-10-09","description":"Teste","amount":"0"})
        with self.assertRaises(ValueError):
            debt.validate_payment({"date":"2026-10-09","description":"Teste","amount":"NaN"})
        record=debt.validate_payment({"date":"2026-10-09","description":" Pagamento da van ",
                                      "amount":"1.500,25","notes":" pix "})
        self.assertEqual(record["description"],"Pagamento da van")
        self.assertEqual(record["amount"],"1500.25")
        self.assertEqual(record["notes"],"pix")

    def test_overpayment_rejected(self):
        self.add("2026-07-02","Entrada", "80000")
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"ultrapassa"):
                debt.can_pay(con,self.cid,Decimal("15000"))
            result=debt.summary(con,self.cid)
            self.assertEqual(result["totals"]["balance"],"10000.00")

    def test_payment_edit_and_delete_recalculate(self):
        first=self.add("2026-07-02","Primeira parcela","15000")
        second=self.add("2026-07-24","Segunda parcela","15000")
        with app.db() as con:
            debt.can_pay(con,self.cid,"20000",first)
            con.execute("UPDATE debt_payments SET amount=?,description=? WHERE id=?",
                        ("20000.00","Parcela editada",first))
            summary=debt.summary(con,self.cid)
            self.assertEqual(summary["totals"]["balance"],"55000.00")
            self.assertTrue(any(p["description"]=="Parcela editada" for p in summary["payments"]))
            con.execute("DELETE FROM debt_payments WHERE id=?",(second,))
            self.assertEqual(debt.summary(con,self.cid)["totals"]["balance"],"70000.00")

    def test_opening_amount_cannot_be_less_than_paid(self):
        self.add("2026-07-02","Parcela","15000")
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"menor"):
                debt.save_settings(con,self.cid,{"opening_amount":"10000"})
            self.assertEqual(debt.settings(con,self.cid)["opening_amount"],"90000.00")

    def test_separate_controls_do_not_mix_balances(self):
        self.add("2026-07-02","Parcela da Van","15000")
        with app.db() as con:
            other=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
              VALUES(1,'OUTRA DÍVIDA','divida','[]','[]','[]')""").lastrowid
            debt.save_settings(con,other,{"opening_amount":"3000"})
            self.assertEqual(debt.summary(con,other)["totals"]["balance"],"3000.00")
            self.assertEqual(debt.summary(con,self.cid)["totals"]["balance"],"75000.00")

    def test_paid_off_and_no_negative_balance(self):
        self.add("2026-10-09","Pagamento integral","90000")
        with app.db() as con:
            view=debt.summary(con,self.cid)
            self.assertTrue(view["totals"]["paid_off"])
            self.assertEqual(view["totals"]["balance"],"0.00")
            with self.assertRaises(ValueError):
                debt.can_pay(con,self.cid,"0.01")

if __name__=="__main__":
    unittest.main()
