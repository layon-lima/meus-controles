"""Regressoes dos 4 ajustes aprovados para o Controle de Fretes."""
import tempfile
from pathlib import Path
from decimal import Decimal
import unittest

import app
import truck
import truck_workflow


class FreightsV2Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.previous=(app.DATA,app.DB)
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"freights_v2.db"
        app.initialize()

    def tearDown(self):
        app.DATA,app.DB=self.previous
        self.tmp.cleanup()

    def upgraded(self):
        with app.db() as con:
            app.upgrade_default_freight_control(con)
            row=con.execute("SELECT id,mode FROM controls WHERE name='Controle de Fretes'").fetchone()
            self.assertEqual(row["mode"],"caminhao")
            return row["id"]

    def test_only_empty_seeded_control_upgraded(self):
        with app.db() as con:
            c=con.execute("SELECT id,mode FROM controls WHERE name='Controle de Fretes'").fetchone()
            self.assertEqual(c["mode"],"calculo")
        cid=self.upgraded()
        with app.db() as con:
            conf=truck.settings(con,cid)
            self.assertEqual(conf["price_basis"],"kg")
            self.assertEqual(conf["commission_pct"],"10")
            self.assertEqual(conf["freight_types"],["Frete Normal","Frete Jonas"])
            self.assertEqual(conf["categories"],[
                "Abastecimento","Manutenção","Pedágio",
                "Seguro do Caminhão","Outros Gastos"])
            self.assertTrue(truck_workflow.is_enabled(con,cid))
            app.upgrade_default_freight_control(con)
            self.assertEqual(con.execute("SELECT COUNT(*) AS n FROM truck_settings WHERE control_id=?",(cid,)).fetchone()["n"],1)

    def test_customized_seed_remains_untouched(self):
        with app.db() as con:
            con.execute("UPDATE controls SET name='Fretes Personalizados' WHERE name='Controle de Fretes'")
            app.upgrade_default_freight_control(con)
            self.assertEqual(con.execute("SELECT mode FROM controls WHERE name='Fretes Personalizados'").fetchone()["mode"],"calculo")

    def test_kg_freight_and_expenses_keep_balance_correct(self):
        cid=self.upgraded()
        with app.db() as con:
            base={"date":"2026-10-01","description":"Frete de soja","kind":"freight","notes":""}
            for name in ("Frete Normal","Frete Jonas"):
                vals=truck.compute_entry(con,cid,{**base,"category":name,"weight_kg":"1000","price_kg":"1,80"})
                self.assertEqual(vals[8],"1800.00")
                self.assertEqual(vals[9],"180.00")
                con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,
                    description,weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)""",vals)
            for name in ("Abastecimento","Manutenção","Pedágio","Seguro do Caminhão","Outros Gastos"):
                vals=truck.compute_entry(con,cid,{"date":"2026-10-02","kind":"expense",
                    "description":name,"category":name,"amount":"50","notes":""})
                con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,
                    description,weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)""",vals)
            vals=truck.compute_entry(con,cid,{"date":"2026-10-02","kind":"advance",
                "description":"Vale","category":"Vale motorista","amount":"100"})
            con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,
                description,weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",vals)
            report=truck.summary(con,cid)
            self.assertEqual(report["totals"]["freight"],"3600.00")
            self.assertEqual(report["totals"]["cash_out"],"350.00")
            self.assertEqual(report["totals"]["cash_balance"],"3250.00")
            self.assertEqual(report["totals"]["commission_earned"],"360.00")
            preview=truck_workflow.review_preview(con,cid,"2026-10-01","2026-10-10")
            self.assertEqual(preview["count"],8)
            self.assertEqual(len(preview["entries"]),8)

    def test_add_new_category_without_changing_existing_entries(self):
        cid=self.upgraded()
        with app.db() as con:
            vals=truck.compute_entry(con,cid,{"date":"2026-10-01","kind":"expense",
                "description":"Óleo","category":"Abastecimento","amount":"100"})
            con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,
                description,weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",vals)
            before=truck.summary(con,cid)["totals"]
            result=truck.add_category(con,cid,"Lavagem")
            self.assertIn("Lavagem",result["categories"])
            self.assertEqual(before,truck.summary(con,cid)["totals"])
            self.assertEqual(truck.compute_entry(con,cid,{"date":"2026-10-03","kind":"expense",
                "description":"Serviço","category":"Lavagem","amount":"60"})[8],"60.00")
            with self.assertRaisesRegex(ValueError,"existe"):
                truck.add_category(con,cid,"lavagem")
            self.assertIn("Lavagem",truck.settings(con,cid)["categories"])

    def test_existing_tonne_pricing_unchanged(self):
        with app.db() as con:
            cid=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'Antigo caminhão','caminhao','[]','[]','[]')""").lastrowid
            conf=truck.settings(con,cid)
            self.assertEqual(conf["price_basis"],"tonne")
            vals=truck.compute_entry(con,cid,{"date":"2026-10-01","kind":"freight",
                "category":"Frete Normal","description":"Teste antigo",
                "weight_kg":"1000","price_tonne":"150"})
            self.assertEqual(vals[8],"150.00")


if __name__=="__main__":
    unittest.main()
