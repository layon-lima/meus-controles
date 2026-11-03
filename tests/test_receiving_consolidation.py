"""Regressão: 32 controles PEDIDOS consolidados sem perder produtos ou entregas."""
import tempfile
import unittest
from pathlib import Path

import app
import receiving
import receiving_consolidation as migration


class ReceivingConsolidationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.old=(app.DATA,app.DB)
        app.DATA=Path(self.temp.name)
        app.DB=app.DATA/"consolidacao.db"
        app.initialize()
        with app.db() as con:
            self.bid=con.execute(
                "INSERT INTO boards(name) VALUES(?)",("RECEBIMENTOS",)).lastrowid
            self.primary=50
            con.execute("""INSERT INTO controls(id,board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(?,?,?,'recebimento','[]','[]','[]')""",
                (self.primary,self.bid,"RECEBIMENTO DE PRODUTOS"))
            for cid in range(11,43):
                con.execute("""INSERT INTO controls(id,board_id,name,mode,fields_json,rules_json,types_json)
                    VALUES(?,?,?,'recebimento','[]','[]','[]')""",
                    (cid,self.bid,"PEDIDOS"))
            con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",(self.primary,"MAIN","A","Produto principal","kg","100.000"))
            self.original_item=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",(11,"PED-1","B","Produto A","L","20.000")).lastrowid
            self.second_item=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",(12,"PED-2","C","Produto B","kg","10.000")).lastrowid
            self.receipt=con.execute("""INSERT INTO purchase_receipts
                (item_id,received_date,invoice_number,received_qty)
                VALUES(?,?,?,?)""",
                (self.original_item,"2026-10-01","NF-123","5.000")).lastrowid
            for cid in (11,12):
                con.execute("""INSERT INTO receiving_imports
                    (control_id,fingerprint,source_name,source_count,inserted_count)
                    VALUES(?,?,?,?,?)""",(cid,"digest-1","pedidos.json",1,1))
                con.execute("""INSERT INTO receiving_pdf_batches
                    (control_id,fingerprint,filename,extracted_json,status)
                    VALUES(?,?,?,?,'confirmed')""",(cid,"pdf-1","pedido.pdf","{}"))
                con.execute("""INSERT INTO receiving_xml_pending
                    (control_id,access_key,invoice_number,issued_date,supplier,
                     cnpj,line_index,product,product_code,quantity,unit)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                    (cid,"1"*44,"123","2026-10-01","Fornecedor","",1,
                     "Produto sem pedido","","3.000","kg"))

    def tearDown(self):
        app.DATA,app.DB=self.old
        self.temp.cleanup()

    def test_atomic_merge_keeps_ids_receipts_and_audit(self):
        with app.db() as con:
            preview=migration.consolidate(con)
            self.assertEqual(preview["controles_extras"],32)
            self.assertEqual(preview["produtos_para_mover"],2)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM controls WHERE name='PEDIDOS'").fetchone()[0],32)
            report=migration.consolidate(con,apply=True)
            self.assertEqual(report["produtos_principais_depois"],3)
            self.assertEqual(report["controles_removidos"],32)
            self.assertEqual(report["historicos_importacao"]["receiving_imports"]["repetidos_arquivados"],1)
            self.assertEqual(report["xml_pendentes"]["repetidos_arquivados"],1)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM controls WHERE board_id=?",(self.bid,)).fetchone()[0],1)
            self.assertEqual(con.execute("SELECT control_id FROM purchase_items WHERE id=?",(self.original_item,)).fetchone()[0],self.primary)
            self.assertEqual(con.execute("SELECT item_id FROM purchase_receipts WHERE id=?",(self.receipt,)).fetchone()[0],self.original_item)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM receiving_consolidation_archive").fetchone()[0],32)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM receiving_pdf_batches WHERE control_id=?",(self.primary,)).fetchone()[0],1)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM receiving_xml_pending WHERE control_id=?",(self.primary,)).fetchone()[0],1)
            self.assertEqual(migration.consolidate(con,apply=True)["controles_extras"],0)

    def test_unexpected_generic_entries_abort_without_deleting_controls(self):
        with app.db() as con:
            con.execute("""INSERT INTO entries
                (control_id,type_key,type_label,direction,data_json,calculated_json,amount)
                VALUES(?,'t','Tipo',1,'{}','{}','100.00')""",(11,))
        with self.assertRaisesRegex(ValueError,"dados inesperados"):
            with app.db() as con:
                migration.consolidate(con,apply=True)
        with app.db() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM controls WHERE name='PEDIDOS'").fetchone()[0],32)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM purchase_items WHERE control_id=?",(11,)).fetchone()[0],1)

    def test_conflicting_pending_xml_aborts_entire_merge(self):
        with app.db() as con:
            con.execute("UPDATE receiving_xml_pending SET product='Produto diferente' WHERE control_id=12")
        with self.assertRaisesRegex(ValueError,"Conflito em receiving_xml_pending"):
            with app.db() as con:
                migration.consolidate(con,apply=True)
        with app.db() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM controls WHERE name='PEDIDOS'").fetchone()[0],32)
            self.assertEqual(con.execute("SELECT control_id FROM purchase_items WHERE id=?",(self.original_item,)).fetchone()[0],11)

    def test_second_receiving_control_is_blocked_in_recebimentos(self):
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"já possui a central"):
                receiving.ensure_singleton_in_recebimentos(con,self.bid)
            receiving.ensure_singleton_in_recebimentos(con,1)


if __name__=="__main__":
    unittest.main()
