"""Testa conciliação conservadora de emitentes, sem alterações financeiras."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

import app

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"deploy/vps/CONCILIAR_EMITENTES_NF.py"
spec=importlib.util.spec_from_file_location("conciliar_emitentes_nf",SCRIPT)
reconcile_module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(reconcile_module)


def key(number,cnpj,month="2610"):
    result="21"+month+cnpj+"55"+"001"+f"{number:09d}"+"1"+"12345678"+"0"
    assert len(result)==44
    return result


class IssuerReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.original=(app.DATA,app.DB)
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"reconcile.db"
        app.initialize()
        self.source=reconcile_module.load_source()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls
               (board_id,name,mode,fields_json,rules_json,types_json)
               VALUES(1,'RECEBIMENTO DE PRODUTOS','recebimento','[]','[]','[]')""").lastrowid
            self.item=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",
                (self.cid,"AGREX S9","AGREX","S9","t","500")).lastrowid
            def add(number,cnpj,issuer="",month="2610",date="2026-10-30"):
                return con.execute("""INSERT INTO purchase_receipts
                  (item_id,received_date,invoice_number,access_key,received_qty,
                   notes,invoice_issuer,invoice_issuer_document)
                  VALUES(?,?,?,?,?,'Lançamento original',?,'')""",
                  (self.item,date,str(number),key(number,cnpj,month),"38.000",issuer)).lastrowid
            self.mosaic=add(48477,"61156501010038")
            self.agro=add(40704,"95865572003246")
            self.known=add(48478,"61156501010038","Emitente original do XML")
            self.wrong=add(48463,"95865572003246")
            self.month_mismatch=add(48462,"61156501010038",month="2611")

    def tearDown(self):
        app.DATA,app.DB=self.original
        self.tmp.cleanup()

    def test_source_mapping_covers_fifty_real_notes(self):
        self.assertEqual(len(self.source),50)
        self.assertEqual(self.source[("48477","61156501010038","2610")]["issuer"],
                         "MOSAIC FERTILIZANTES DO BRASIL LTDA")
        self.assertEqual(self.source[("40704","95865572003246","2610")]["issuer"],
                         "Agro Industrial São Luiz LTDA")

    def test_preview_is_read_only_and_validates_cnpj_from_original_access_key(self):
        with app.db() as con:
            preview=reconcile_module.reconcile(con,self.source,apply=False)
            self.assertEqual(preview["candidatos"],2)
            self.assertEqual(preview["ja_preenchidos"],1)
            self.assertEqual(preview["sem_correspondencia"],2)
            self.assertEqual(con.execute("""SELECT COUNT(*) AS n FROM purchase_receipts
                WHERE invoice_issuer!=''""").fetchone()["n"],1)

    def test_apply_changes_only_issuer_and_writes_audit_atomically(self):
        with app.db() as con:
            result=reconcile_module.reconcile(con,self.source,apply=True)
            self.assertEqual(result["aplicadas"],2)
        with app.db() as con:
            rows={r["id"]:dict(r) for r in con.execute("SELECT * FROM purchase_receipts")}
            self.assertEqual(rows[self.mosaic]["invoice_issuer"],"MOSAIC FERTILIZANTES DO BRASIL LTDA")
            self.assertEqual(rows[self.mosaic]["invoice_issuer_document"],"61156501010038")
            self.assertEqual(rows[self.agro]["invoice_issuer"],"Agro Industrial São Luiz LTDA")
            self.assertEqual(rows[self.known]["invoice_issuer"],"Emitente original do XML")
            self.assertEqual(rows[self.wrong]["invoice_issuer"],"")
            self.assertEqual(rows[self.month_mismatch]["invoice_issuer"],"")
            self.assertTrue(all(r["received_qty"]=="38.000" for r in rows.values()))
            self.assertTrue(all(r["notes"]=="Lançamento original" for r in rows.values()))
            self.assertEqual(con.execute("""SELECT COUNT(*) AS n FROM
                nf_issuer_reconciliation_audit""").fetchone()["n"],2)
            rerun=reconcile_module.reconcile(con,self.source,apply=True)
            self.assertEqual(rerun["aplicadas"],0)
            self.assertEqual(con.execute("""SELECT COUNT(*) AS n FROM
                nf_issuer_reconciliation_audit""").fetchone()["n"],2)

    def test_invalid_short_key_is_never_matched_by_invoice_number_alone(self):
        with app.db() as con:
            con.execute("UPDATE purchase_receipts SET access_key=? WHERE id=?",
                        ("2,12611E+43",self.mosaic))
            preview=reconcile_module.reconcile(con,self.source)
            self.assertEqual(preview["chave_invalida"],1)
            self.assertEqual(preview["candidatos"],1)


if __name__=="__main__":
    unittest.main()
