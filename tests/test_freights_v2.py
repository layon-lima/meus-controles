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
            self.assertEqual(conf["price_basis"],"tonne")
            self.assertEqual(conf["commission_pct"],"13")
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
                vals=truck.compute_entry(con,cid,{**base,"category":name,"weight_kg":"1000","price_tonne":"1800"})
                self.assertEqual(vals[8],"1800.00")
                self.assertEqual(vals[9],"234.00")
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
            self.assertEqual(report["totals"]["commission_earned"],"468.00")
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

    def test_previously_installed_ten_percent_fixed_once_preserving_history(self):
        cid=self.upgraded()
        with app.db() as con:
            con.execute("UPDATE truck_settings SET commission_pct='10' WHERE control_id=?",(cid,))
            old=truck.compute_entry(con,cid,{
                "date":"2026-10-02","kind":"freight","category":"Frete Jonas",
                "description":"Frete antigo, comissão original 10%",
                "weight_kg":"1000","price_tonne":"2000","notes":""})
            self.assertEqual(old[9],"200.00")
            con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,
                description,weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",old)
            before=con.execute("SELECT * FROM truck_entries WHERE control_id=?",(cid,)).fetchone()
            app.fix_seeded_freight_commission(con)
            self.assertEqual(truck.settings(con,cid)["commission_pct"],"13")
            saved=con.execute("SELECT * FROM truck_entries WHERE control_id=?",(cid,)).fetchone()
            self.assertEqual(dict(saved),dict(before))
            fresh=truck.compute_entry(con,cid,{
                "date":"2026-10-03","kind":"freight","category":"Frete Normal",
                "description":"Novo frete", "weight_kg":"1000","price_tonne":"2000"})
            self.assertEqual(fresh[9],"260.00")
            # A correção é única; um ajuste posterior feito pelo usuário é respeitado.
            con.execute("UPDATE truck_settings SET commission_pct='12' WHERE control_id=?",(cid,))
            app.fix_seeded_freight_commission(con)
            self.assertEqual(truck.settings(con,cid)["commission_pct"],"12")

    def test_non_default_truck_not_affected_by_commission_fix(self):
        with app.db() as con:
            cid=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'Outro controle','caminhao','[]','[]','[]')""").lastrowid
            truck.save_settings(con,cid,{"commission_pct":"10"})
            app.fix_seeded_freight_commission(con)
            self.assertEqual(truck.settings(con,cid)["commission_pct"],"10")

    def test_fix_wrong_per_kg_calcario_entries_once_with_audit(self):
        cid=self.upgraded()
        expected=[
            ("2026-10-15","47000","10105.00","1313.65"),
            ("2026-10-10","47610","10236.15","1330.70"),
            ("2026-10-06","48380","10401.70","1352.22"),
        ]
        with app.db() as con:
            con.execute("UPDATE truck_settings SET price_basis='kg' WHERE control_id=?",(cid,))
            original={}
            for day,weight,amount,commission in expected:
                values=truck.compute_entry(con,cid,{"date":day,"kind":"freight",
                    "category":"Frete Jonas","description":"CALCARIO JONAS",
                    "weight_kg":weight,"price_kg":"215"})
                record=con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,
                    description,weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)""",values)
                original[record.lastrowid]=values
            app.correct_freight_tonne_unit(con)
            self.assertEqual(truck.settings(con,cid)["price_basis"],"tonne")
            after=con.execute("SELECT * FROM truck_entries WHERE control_id=? ORDER BY event_date DESC",(cid,)).fetchall()
            self.assertEqual(len(after),3)
            for entry,(_,weight,amount,commission) in zip(after,expected):
                self.assertEqual(entry["weight_kg"],weight)
                self.assertEqual(entry["price_tonne"],"215")
                self.assertEqual(entry["amount"],amount)
                self.assertEqual(entry["commission_amount"],commission)
                self.assertEqual(entry["commission_pct"],"13")
                self.assertEqual(entry["description"],"CALCARIO JONAS")
                self.assertEqual(entry["category"],"Frete Jonas")
            before=[dict(row) for row in after]
            app.correct_freight_tonne_unit(con)
            again=[dict(row) for row in con.execute(
                "SELECT * FROM truck_entries WHERE control_id=? ORDER BY event_date DESC",(cid,))]
            self.assertEqual(before,again)
            audit=con.execute("SELECT value FROM settings WHERE key=?",
                ("freight_tonne_215_fix_v1_"+str(cid),)).fetchone()
            self.assertIsNotNone(audit)
            self.assertEqual(len(__import__("json").loads(audit["value"])),3)
            totals=truck.summary(con,cid)["totals"]
            self.assertEqual(totals["freight"],"30742.85")
            self.assertEqual(totals["commission_earned"],"3996.57")

    def test_existing_conference_protects_financial_history_from_auto_fix(self):
        cid=self.upgraded()
        with app.db() as con:
            con.execute("UPDATE truck_settings SET price_basis='kg' WHERE control_id=?",(cid,))
            values=truck.compute_entry(con,cid,{"date":"2026-10-06","kind":"freight",
                "category":"Frete Jonas","description":"CALCARIO JONAS",
                "weight_kg":"48380","price_kg":"215"})
            con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,
                description,weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",values)
            pre=truck_workflow.review_preview(con,cid,"2026-10-06","2026-10-06")
            truck_workflow.confirm_review(con,cid,{
                "start":"2026-10-06","end":"2026-10-06",
                "fingerprint":pre["fingerprint"],
                "checked_ids":[entry["id"] for entry in pre["entries"]]})
        with app.db() as con:
            app.correct_freight_tonne_unit(con)
            self.assertEqual(truck.settings(con,cid)["price_basis"],"kg")
            entry=con.execute("SELECT amount,price_tonne FROM truck_entries WHERE control_id=?",(cid,)).fetchone()
            self.assertEqual(entry["amount"],"10401700.00")
            self.assertEqual(entry["price_tonne"],"215000")
            self.assertIsNone(con.execute("SELECT value FROM settings WHERE key=?",
                ("freight_tonne_215_fix_v1_"+str(cid),)).fetchone())

    def test_other_unrelated_freights_unchanged_by_fix(self):
        cid=self.upgraded()
        with app.db() as con:
            con.execute("UPDATE truck_settings SET price_basis='kg' WHERE control_id=?",(cid,))
            vals=truck.compute_entry(con,cid,{"date":"2026-10-03","kind":"freight",
                "category":"Frete Normal","description":"Outro frete",
                "weight_kg":"1000","price_kg":"0,5"})
            con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,
                description,weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",vals)
            before=dict(con.execute("SELECT * FROM truck_entries WHERE control_id=?",(cid,)).fetchone())
            app.correct_freight_tonne_unit(con)
            after=dict(con.execute("SELECT * FROM truck_entries WHERE control_id=?",(cid,)).fetchone())
            self.assertEqual(before,after)
            self.assertEqual(truck.settings(con,cid)["price_basis"],"tonne")

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
