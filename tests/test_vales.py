"""Regressões do controle de vales: meses, centavos, quitação e histórico."""
import tempfile
import unittest
from pathlib import Path
from decimal import Decimal

import app
import vales
import control_types


class EmployeeAdvancesTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.original=(app.DATA,app.DB)
        app.DATA=Path(self.temp.name)
        app.DB=app.DATA/"vales.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'VALES FUNCIONÁRIOS','vale_funcionarios','[]','[]','[]')""").lastrowid

    def tearDown(self):
        app.DATA,app.DB=self.original
        self.temp.cleanup()

    def employee(self,name="MARIA"):
        with app.db() as con:
            return vales.create_employee(con,self.cid,name)["id"]

    def debt(self,eid,amount="100.00",count=3,start="2026-12",description="Vale"):
        with app.db() as con:
            return vales.create_debt(con,eid,{"description":description,"amount":amount,
                "first_month":start,"count":count})["id"]

    def test_short_employee_name_is_valid(self):
        eid=self.employee("Zé")
        with app.db() as con:
            self.assertEqual(vales.employee(con,eid)["name"],"Zé")

    def test_debt_title_and_optional_description_are_separate(self):
        eid=self.employee("João")
        with app.db() as con:
            did=vales.create_debt(con,eid,{
                "title":"Compra de bicicleta","description":"Adiantamento solicitado em outubro",
                "amount":"345.90","first_month":"2026-11","count":3})["id"]
            result=vales.get_summary(con,self.cid)
            d=result["employees"][0]["debts"][0]
            self.assertEqual(d["id"],did)
            self.assertEqual(d["title"],"Compra de bicicleta")
            self.assertEqual(d["description"],"Adiantamento solicitado em outubro")
            self.assertEqual(result["schedule"][0]["debt_title"],"Compra de bicicleta")
            vales.create_debt(con,eid,{
                "title":"Almoço","description":"",
                "amount":"25.00","first_month":"2026-12","count":1})
            records=vales.get_summary(con,self.cid)["employees"][0]["debts"]
            self.assertEqual(records[0]["title"],"Almoço")
            self.assertEqual(records[0]["description"],"")

    def test_title_changes_after_payments_without_changing_money(self):
        eid=self.employee("Pedro")
        with app.db() as con:
            did=vales.create_debt(con,eid,{
                "title":"Vale inicial","amount":"300.00",
                "first_month":"2026-11","count":3})["id"]
            installment=vales.all_installments(con,did)[0]
            vales.payment(con,installment["id"],{
                "month":"2026-11","amount":"50.00"})
            before=vales.get_summary(con,self.cid)
            vales.update_debt_details(con,did,{
                "title":"Vale de farmácia","description":"Medicamentos"})
            after=vales.get_summary(con,self.cid)
            self.assertEqual(after["employees"][0]["debts"][0]["title"],"Vale de farmácia")
            self.assertEqual(after["employees"][0]["debts"][0]["description"],"Medicamentos")
            self.assertEqual(after["totals"],before["totals"])
            self.assertEqual(vales.all_installments(con,did),vales.all_installments(con,did))
            history=vales.payments(con,self.cid)
            self.assertEqual(history[0]["title"],"Vale de farmácia")
            self.assertEqual(history[0]["amount"],"50.00")
            with self.assertRaisesRegex(ValueError,"título"):
                vales.update_debt_details(con,did,{"title":"","description":"Sem título"})

    def test_old_vale_migration_adds_title_and_preserves_financial_values(self):
        import sqlite3
        db=sqlite3.connect(":memory:")
        db.row_factory=sqlite3.Row
        try:
            db.execute("""CREATE TABLE vale_debts(
                id INTEGER PRIMARY KEY,control_id INTEGER NOT NULL,
                employee_id INTEGER NOT NULL,amount TEXT NOT NULL,
                description TEXT NOT NULL,first_month TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
            db.execute("""INSERT INTO vale_debts
                (control_id,employee_id,amount,description,first_month)
                VALUES(1,1,'580.75','Vale existente','2026-10')""")
            vales.initialize(db)
            data=dict(db.execute("SELECT * FROM vale_debts").fetchone())
            self.assertEqual(data["title"],"Vale existente")
            self.assertEqual(data["description"],"Vale existente")
            self.assertEqual(data["amount"],"580.75")
            self.assertEqual(data["first_month"],"2026-10")
            vales.initialize(db)
            self.assertEqual(db.execute("SELECT title FROM vale_debts").fetchone()["title"],
                "Vale existente")
        finally:
            db.close()

    def test_suggest_equal_installments_with_cents_and_month_rollover(self):
        self.assertEqual(vales.schedule("100.00","2026-12",3),[
            {"month":"2026-12","amount":"33.34"},
            {"month":"2027-01","amount":"33.33"},
            {"month":"2027-02","amount":"33.33"}])
        self.assertEqual(vales.schedule("100.00","2027-01",1),[
            {"month":"2027-01","amount":"100.00"}])
        self.assertEqual(vales.schedule("100.00","2027-01",3,"30.00")[-1],
            {"month":"2027-03","amount":"40.00"})

    def test_custom_schedule_rejects_mismatches_and_duplicate_months(self):
        with self.assertRaisesRegex(ValueError,"soma"):
            vales.verify_plan([{"month":"2026-11","amount":"40.00"}],"100")
        with self.assertRaisesRegex(ValueError,"ordem"):
            vales.verify_plan([{"month":"2026-11","amount":"50.00"},
                               {"month":"2026-11","amount":"50.00"}],"100")
        with self.assertRaises(ValueError):
            vales.schedule("1.00","2026-12",102)

    def test_employee_multiple_debts_and_partial_payment(self):
        eid=self.employee()
        first=self.debt(eid,"100.00",3,"2026-12")
        second=self.debt(eid,"50.00",1,"2027-02","Segundo vale")
        with app.db() as con:
            data=vales.get_summary(con,self.cid)
            self.assertEqual(data["totals"]["lent"],"150.00")
            self.assertEqual(data["totals"]["remaining"],"150.00")
            self.assertEqual(data["totals"]["debts"],2)
            i=data["employees"][0]["debts"][1]["installments"][0] if data["employees"][0]["debts"][0]["id"]==second else data["employees"][0]["debts"][0]["installments"][0]
            self.assertEqual(i["debt_id"],first)
            vales.payment(con,i["id"],{"month":"2027-01","amount":"10.00"})
            result=vales.get_summary(con,self.cid)
            self.assertEqual(result["totals"]["paid"],"10.00")
            self.assertEqual(result["totals"]["remaining"],"140.00")
            with self.assertRaisesRegex(ValueError,"supera"):
                vales.payment(con,i["id"],{"month":"2027-01","amount":"99.00"})

    def test_replan_allowed_only_before_any_payment(self):
        eid=self.employee()
        did=self.debt(eid)
        with app.db() as con:
            vales.replan_debt(con,did,{"installments":[
                {"month":"2027-02","amount":"40.00"},
                {"month":"2027-03","amount":"60.00"}]})
            plan=vales.all_installments(con,did)
            self.assertEqual([r["amount"] for r in plan],["40.00","60.00"])
            self.assertEqual(plan[0]["due_month"],"2027-02")
            vales.payment(con,plan[0]["id"],{"month":"2027-02","amount":"10.00"})
            with self.assertRaisesRegex(ValueError,"descontos"):
                vales.replan_debt(con,did,{"installments":[{"month":"2027-04","amount":"100.00"}]})

    def test_full_payoff_and_undo_restore_balance(self):
        eid=self.employee()
        did=self.debt(eid,"100.00",3)
        with app.db() as con:
            settled=vales.settle_debt(con,did,{"month":"2027-01"})
            self.assertEqual(settled["paid"],"100.00")
            self.assertEqual(settled["installments"],3)
            self.assertEqual(vales.get_summary(con,self.cid)["totals"]["remaining"],"0.00")
            with self.assertRaisesRegex(ValueError,"quitado"):
                vales.settle_debt(con,did,{"month":"2027-01"})
            last=vales.payments(con,self.cid)[0]
            vales.delete_payment(con,last["id"])
            self.assertGreater(Decimal(vales.get_summary(con,self.cid)["totals"]["remaining"]),0)

    def test_decimal_precision_when_paying_in_small_parts(self):
        eid=self.employee()
        did=self.debt(eid,"0.30",1,"2027-01")
        with app.db() as con:
            i=vales.all_installments(con,did)[0]
            vales.payment(con,i["id"],{"month":"2027-01","amount":"0.10"})
            vales.payment(con,i["id"],{"month":"2027-01","amount":"0.20"})
            status=vales.get_summary(con,self.cid)
            self.assertEqual(status["totals"]["remaining"],"0.00")
            self.assertEqual(status["employees"][0]["debts"][0]["installments"][0]["status"],"pago")
            self.assertEqual(status["employees"][0]["debts"][0]["installments"][0]["remaining"],"0.00")

    def test_archive_keeps_history_but_prevents_new_debt(self):
        eid=self.employee()
        self.debt(eid)
        with app.db() as con:
            vales.archive_employee(con,eid,False)
            summary=vales.get_summary(con,self.cid)
            self.assertEqual(summary["totals"]["active"],0)
            self.assertEqual(summary["totals"]["remaining"],"100.00")
            with self.assertRaisesRegex(ValueError,"Reative"):
                vales.create_debt(con,eid,{"description":"Outro","amount":"50",
                    "first_month":"2026-12","count":1})
            vales.archive_employee(con,eid,True)
            self.assertEqual(vales.get_summary(con,self.cid)["totals"]["active"],1)

    def test_duplicate_person_blocked_and_debt_with_payment_never_deleted(self):
        eid=self.employee()
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"já cadastrado"):
                vales.create_employee(con,self.cid,"maria")
        did=self.debt(eid)
        with app.db() as con:
            i=vales.all_installments(con,did)[0]
            vales.payment(con,i["id"],{"month":"2027-01","amount":"5.00"})
            with self.assertRaisesRegex(ValueError,"descontos"):
                vales.delete_debt(con,did)

    def test_change_type_advertises_new_model(self):
        with app.db() as con:
            info=control_types.preview(con,self.cid)
            self.assertTrue(any(m["mode"]=="vale_funcionarios" for m in info["models"]))
            self.assertEqual(info["counts"]["vales"],0)


if __name__=="__main__":
    unittest.main()
