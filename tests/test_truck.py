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

if __name__ == "__main__":
    unittest.main()
