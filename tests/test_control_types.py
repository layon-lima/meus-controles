"""Troca reversível de modelos: identidade, saldos e históricos preservados."""
import unittest
import tempfile
from pathlib import Path
import app
import control_types
import debt
import pair
import truck

class ControlTypeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.old=(app.DATA,app.DB)
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"types.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls
              (board_id,name,mode,fields_json,rules_json,types_json)
              VALUES(1,'MINHAS CONTAS','divida_sem_valor','[]','[]','[]')""").lastrowid
            con.execute("""INSERT INTO debt_payments(control_id,payment_date,description,amount,notes)
              VALUES(?,?,?,?,?)""",(self.cid,"2026-10-01","PIX 1","500.00","Teste"))
            con.execute("""INSERT INTO debt_payments(control_id,payment_date,description,amount,notes)
              VALUES(?,?,?,?,?)""",(self.cid,"2026-10-02","PIX 2","300.00",""))
    def tearDown(self):
        app.DATA,app.DB=self.old
        self.tmp.cleanup()

    def convert(self,mode,**kwargs):
        with app.db() as con:
            return control_types.change(con,self.cid,{"mode":mode,**kwargs})

    def test_switch_fixed_and_unlimited_preserves_payments_without_loss(self):
        self.assertEqual(self.convert("divida",opening_amount="2000")["changed"],True)
        with app.db() as con:
            fixed=debt.summary(con,self.cid)
            self.assertEqual(fixed["totals"]["balance"],"1200.00")
            self.assertEqual(fixed["totals"]["count"],2)
        self.convert("divida_sem_valor")
        with app.db() as con:
            import open_debt
            free=open_debt.summary(con,self.cid)
            self.assertEqual(free["totals"]["paid"],"800.00")
            self.assertEqual(free["totals"]["count"],2)
        self.convert("divida")
        with app.db() as con:
            self.assertEqual(debt.settings(con,self.cid)["opening_amount"],"2000.00")
            self.assertEqual(debt.summary(con,self.cid)["totals"]["balance"],"1200.00")

    def test_switch_to_other_model_keeps_hidden_records_and_restores(self):
        self.convert("acerto_ab",pair_settings={"party_a":"Jonas","party_b":"Rangel"})
        with app.db() as con:
            con.execute("""INSERT INTO pair_entries
              (control_id,entry_date,debtor,amount,description,entry_kind)
              VALUES(?,?,?,?,?,?)""",(self.cid,"2026-10-03","A","100.00","Peças","debt"))
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-100.00")
            before=control_types.preview(con,self.cid)
            self.assertEqual(before["counts"]["debt"],2)
            self.assertEqual(before["counts"]["pair"],1)
        self.convert("recebimento")
        with app.db() as con:
            con.execute("""INSERT INTO purchase_items
              (control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,?,?,?,?,?)""",(self.cid,"PED-1","Fornecedor","Produto","kg","100.000"))
        self.convert("caminhao")
        with app.db() as con:
            self.assertEqual(truck.settings(con,self.cid)["commission_pct"],"13")
            self.assertEqual(control_types.preview(con,self.cid)["counts"]["receiving"],1)
        self.convert("acerto_ab")
        with app.db() as con:
            self.assertEqual(pair.settings(con,self.cid)["party_a"],"Jonas")
            self.assertEqual(pair.summary(con,self.cid)["totals"]["balance"],"-100.00")
        self.convert("divida_sem_valor")
        with app.db() as con:
            import open_debt
            self.assertEqual(open_debt.summary(con,self.cid)["totals"]["paid"],"800.00")
            self.assertEqual(control_types.preview(con,self.cid)["counts"]["pair"],1)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM control_type_changes WHERE control_id=?",
                                        (self.cid,)).fetchone()[0],5)

    def test_invalid_conversion_rolls_back_and_keeps_records(self):
        with self.assertRaisesRegex(ValueError,"dívida inicial"):
            self.convert("divida")
        with app.db() as con:
            self.assertEqual(control_types.control(con,self.cid)["mode"],"divida_sem_valor")
        with self.assertRaisesRegex(ValueError,"dívida inicial"):
            self.convert("divida",opening_amount="200")
        with app.db() as con:
            self.assertEqual(control_types.control(con,self.cid)["mode"],"divida_sem_valor")
            self.assertEqual(control_types.preview(con,self.cid)["counts"]["debt"],2)
        with self.assertRaisesRegex(ValueError,"duas pessoas"):
            self.convert("acerto_ab")
        with app.db() as con:
            self.assertEqual(control_types.control(con,self.cid)["mode"],"divida_sem_valor")

    def test_type_switch_to_generic_preserves_config_and_history(self):
        self.convert("financeiro")
        self.convert("calculo")
        self.convert("saldo")
        with app.db() as con:
            self.assertEqual(control_types.control(con,self.cid)["mode"],"saldo")
            self.assertEqual(control_types.preview(con,self.cid)["counts"]["debt"],2)
            self.assertEqual(control_types.preview(con,self.cid)["recent_changes"][0]["new_mode"],"saldo")

if __name__=="__main__":
    unittest.main()
