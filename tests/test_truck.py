"""Casos de referência da planilha CONTROLE CHAVE ERRADA.
Comissão contabilizada no frete e vale como pagamento, sem despesa duplicada.
"""
import sqlite3
import unittest
from decimal import Decimal
from pathlib import Path
import tempfile
import app
import truck

class TruckModelTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old=(app.DATA,app.DB)
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"test.db"
        app.initialize()
        with app.db() as con:
            self.control=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
            VALUES(1,'CONTROLE CHAVE ERRADA','caminhao','[]','[]','[]')""").lastrowid
            truck.save_settings(con,self.control,{
                "commission_pct":"13","opening_commission":"10000","opening_cash":"0",
                "driver_name":"Motorista teste"})
            con.commit()

    def tearDown(self):
        app.DATA,app.DB=self.old
        self.tmp.cleanup()

    def add(self, **p):
        payload={"date":"2026-08-09","description":"Lançamento teste",**p}
        with app.db() as con:
            cols=truck.compute_entry(con,self.control,payload)
            con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,description,
                weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",cols)
            con.commit()

    def test_summary_category_counts_match_period_without_changing_totals(self):
        # Cada lançamento é contado uma vez, incluindo vale motorista.
        self.add(date="2026-08-02",kind="freight",category="Frete Normal",
                 weight_kg="1000",price_tonne="200",notes="")
        self.add(date="2026-08-03",kind="freight",category="Frete Normal",
                 weight_kg="1000",price_tonne="300",notes="")
        self.add(date="2026-08-04",kind="freight",category="Frete Morto",
                 weight_kg="1000",price_tonne="100",notes="")
        self.add(date="2026-08-05",kind="expense",category="Abastecimento",amount="20",notes="")
        self.add(date="2026-08-06",kind="expense",category="Abastecimento",amount="30",notes="")
        self.add(date="2026-08-07",kind="advance",category="Vale motorista",amount="15",notes="")
        self.add(date="2026-09-01",kind="expense",category="Abastecimento",amount="40",notes="")
        with app.db() as con:
            august=truck.summary(con,self.control,"2026-08")
            september=truck.summary(con,self.control,"2026-09")
            full=truck.summary(con,self.control,scope="all")
        freights={x["name"]:x for x in august["by_freight"]}
        expenses={x["name"]:x for x in august["by_expense"]}
        self.assertEqual(freights["Frete Normal"],{"name":"Frete Normal","total":"500.00","count":2})
        self.assertEqual(freights["Frete Morto"],{"name":"Frete Morto","total":"100.00","count":1})
        self.assertEqual(expenses["Abastecimento"],{"name":"Abastecimento","total":"50.00","count":2})
        self.assertEqual(expenses["Vale motorista"],{"name":"Vale motorista","total":"15.00","count":1})
        self.assertEqual(august["totals"]["freight"],"600.00")
        self.assertEqual(august["totals"]["cash_out"],"65.00")
        self.assertEqual(september["by_freight"],[])
        self.assertEqual(september["by_expense"][0]["count"],1)
        self.assertEqual(full["by_expense"][0]["count"],3)

    def test_tonnes_kg_and_thirteen_percent(self):
        self.add(kind="freight",category="Frete Morto",weight_kg="48000",price_tonne="215",notes="")
        with app.db() as con:
            view=truck.summary(con,self.control)
        t=view["totals"]
        self.assertEqual(t["freight"],"10320.00")
        self.assertEqual(t["commission_earned"],"1341.60")
        self.assertEqual(t["cash_balance"],"10320.00")
        self.assertEqual(t["operating_result"],"8978.40")
        self.assertEqual(t["driver_due"],"11341.60")
        self.assertEqual(view["entries"][0]["price_tonne"],"215")

    def test_expenses_and_advance_do_not_double_charge_commission(self):
        self.add(kind="freight",category="Frete Normal",weight_kg="48000",price_tonne="215",notes="")
        self.add(kind="expense",category="Abastecimento",amount="3000",notes="")
        self.add(kind="expense",category="Seguro do caminhão",amount="300",notes="")
        self.add(kind="advance",category="Vale motorista",amount="500",notes="")
        with app.db() as con:
            t=truck.summary(con,self.control)["totals"]
            cats={x["name"]:x["total"] for x in truck.summary(con,self.control)["by_expense"]}
        self.assertEqual(t["cash_out"],"3800.00")
        self.assertEqual(t["cash_balance"],"6520.00")
        self.assertEqual(t["operating_result"],"5678.40")
        self.assertEqual(t["driver_due"],"10841.60")
        self.assertEqual(cats["Seguro do caminhão"],"300.00")
        self.assertEqual(cats["Vale motorista"],"500.00")

    def test_freight_history_does_not_recalculate_when_default_changes(self):
        self.add(kind="freight",category="Frete Normal",weight_kg="1000",price_tonne="1000",notes="")
        with app.db() as con:
            truck.save_settings(con,self.control,{"commission_pct":"20","opening_commission":"10000","opening_cash":"0"})
            past=truck.summary(con,self.control)["entries"][0]
            self.assertEqual(past["commission_amount"],"130.00")
            new=truck.compute_entry(con,self.control,{
                "date":"2026-09-01","kind":"freight","category":"Frete Normal",
                "description":"Novo frete","weight_kg":"1000","price_tonne":"1000","notes":""})
            self.assertEqual(new[9],"200.00")

    def test_period_filter_keeps_driver_historical_balance(self):
        self.add(kind="freight",category="Frete Normal",weight_kg="1000",price_tonne="1000",notes="")
        with app.db() as con:
            monthly=truck.summary(con,self.control,"2026-09")
        self.assertEqual(monthly["totals"]["count"],0)
        self.assertEqual(monthly["totals"]["freight"],"0.00")
        self.assertEqual(monthly["totals"]["driver_due"],"10130.00")

    def test_validation_rejects_unsupported_expense_and_bad_values(self):
        with app.db() as con:
            with self.assertRaises(ValueError):
                truck.compute_entry(con,self.control,{
                    "date":"2026-08-10","kind":"expense","category":"Vale motorista",
                    "description":"Errado","amount":"100"})
            with self.assertRaises(ValueError):
                truck.compute_entry(con,self.control,{
                    "date":"2026-08-10","kind":"freight","category":"Frete Normal",
                    "description":"Frete","weight_kg":"500","price_tonne":"-1"})

    def test_independent_truck_controls(self):
        with app.db() as con:
            other=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
            VALUES(1,'SEGUNDO CAMINHÃO','caminhao','[]','[]','[]')""").lastrowid
            con.commit()
        self.add(kind="freight",category="Frete Normal",weight_kg="1000",price_tonne="200",notes="")
        with app.db() as con:
            self.assertEqual(truck.summary(con,other)["totals"]["freight"],"0.00")
            self.assertEqual(truck.summary(con,self.control)["totals"]["freight"],"200.00")


    def test_categories_are_configurable_per_truck(self):
        with app.db() as con:
            original=truck.settings(con,self.control)
            self.assertIn("Manutenção",original["categories"])
            values={**original,"categories":["Manutenção","Combustível","Pneus"]}
            saved=truck.save_settings(con,self.control,values)
            self.assertEqual(saved["categories"],["Manutenção","Combustível","Pneus"])
            payload={"date":"2026-08-10","kind":"expense","category":"pneus",
                     "description":"Pneu novo","amount":"900"}
            values=truck.compute_entry(con,self.control,payload)
            self.assertEqual(values[3],"Pneus")
            with self.assertRaisesRegex(ValueError,"categoria cadastrada"):
                truck.compute_entry(con,self.control,{**payload,"category":"Categoria inventada"})
            other=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'SEGUNDO CAMINHÃO','caminhao','[]','[]','[]')""").lastrowid
            self.assertNotIn("Pneus",truck.settings(con,other)["categories"])

    def test_category_rename_reclassifies_history_without_changing_money(self):
        self.add(kind="expense",category="Manutenção",amount="391",notes="")
        with app.db() as con:
            conf=truck.settings(con,self.control)
            edited=["Oficina" if name=="Manutenção" else name for name in conf["categories"]]
            result=truck.save_settings(con,self.control,{
                **conf,"categories":edited,
                "category_renames":[{"old":"Manutenção","new":"Oficina"}]
            })
            self.assertIn("Oficina",result["categories"])
            self.assertNotIn("Manutenção",result["categories"])
            report=truck.summary(con,self.control)
            self.assertEqual(report["totals"]["operating_expenses"],"391.00")
            self.assertEqual(report["entries"][0]["category"],"Oficina")
            self.assertEqual(report["by_expense"][0]["name"],"Oficina")

    def test_cannot_remove_in_use_category(self):
        self.add(kind="expense",category="Abastecimento",amount="100",notes="")
        with app.db() as con:
            conf=truck.settings(con,self.control)
            reduced=[name for name in conf["categories"] if name!="Abastecimento"]
            with self.assertRaisesRegex(ValueError,"possui lançamentos"):
                truck.save_settings(con,self.control,{**conf,"categories":reduced})
            self.assertIn("Abastecimento",truck.settings(con,self.control)["categories"])

    def test_category_validation_rejects_duplicates_reserved_empty(self):
        with self.assertRaises(ValueError):
            truck.validate_categories(["Manutenção","manutenção"])
        with self.assertRaises(ValueError):
            truck.validate_categories(["Vale motorista"])
        with self.assertRaises(ValueError):
            truck.validate_categories([])
        with self.assertRaises(ValueError):
            truck.validate_categories([""])

    def test_migration_preserves_categories_from_old_rows(self):
        with app.db() as con:
            con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,description,
                weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (self.control,"2026-08-15","expense","Conserto hidráulico","Teste",
                "0","0","0","150.00","0",""))
            con.execute("UPDATE truck_settings SET categories_json='' WHERE control_id=?",(self.control,))
            truck.init(con)
            conf=truck.settings(con,self.control)
            self.assertIn("Conserto hidráulico",conf["categories"])
            self.assertIn("Manutenção",conf["categories"])
            raw=con.execute("SELECT categories_json FROM truck_settings WHERE control_id=?",
                            (self.control,)).fetchone()["categories_json"]
            self.assertTrue(raw.startswith("["))

if __name__ == "__main__":
    unittest.main()
