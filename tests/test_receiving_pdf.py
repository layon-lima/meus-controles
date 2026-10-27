"""Regressões do importador inteligente de pedidos PDF + OCR."""
import base64
from pathlib import Path
import tempfile
import unittest

import app
import receiving
import receiving_pdf

try:
    import fitz
except ImportError:
    fitz=None

def build_pdf(rows,scanned=False):
    if fitz is None:
        raise RuntimeError("PyMuPDF indisponível.")
    pdf=fitz.open()
    page=pdf.new_page()
    page.insert_text((45,60),"\n".join(rows),fontname="helv",fontsize=11,lineheight=1.5)
    data=pdf.tobytes()
    pdf.close()
    return data

class PdfSchemaMigrationTests(unittest.TestCase):
    def test_sqlite_auto_number_for_preview_batch(self):
        import sqlite3
        con=sqlite3.connect(":memory:")
        con.row_factory=sqlite3.Row
        try:
            receiving_pdf.initialize(con)
            con.execute("""INSERT INTO receiving_pdf_batches
                (control_id,fingerprint,filename,extracted_json)
                VALUES(1,'hash1','um.pdf','{}')""")
            con.execute("""INSERT INTO receiving_pdf_batches
                (control_id,fingerprint,filename,extracted_json)
                VALUES(1,'hash2','dois.pdf','{}')""")
            self.assertEqual([r["id"] for r in
                con.execute("SELECT id FROM receiving_pdf_batches ORDER BY id")],[1,2])
        finally:
            con.close()

    def test_postgres_legacy_column_without_default_is_repaired(self):
        class FakeCursor:
            def __init__(self,value=None):self.value=value
            def fetchone(self):return {"value":self.value}
        class FakePg:
            native=object()
            def __init__(self,value):
                self.default=value
                self.statements=[]
            def executescript(self,script):
                self.statements.append(("schema",script))
            def execute(self,statement):
                self.statements.append(("sql",statement))
                return FakeCursor(self.default)
        legacy=FakePg(None)
        receiving_pdf.initialize(legacy)
        sql=" ".join(v for typ,v in legacy.statements if typ=="sql")
        self.assertIn("CREATE SEQUENCE IF NOT EXISTS receiving_pdf_batches_id_seq",sql)
        self.assertIn("SET DEFAULT nextval('receiving_pdf_batches_id_seq')",sql)
        self.assertIn("ALTER SEQUENCE receiving_pdf_batches_id_seq",sql)
        self.assertIn("SELECT setval('receiving_pdf_batches_id_seq'",sql)
        modern=FakePg("nextval('receiving_pdf_batches_id_seq'::regclass)")
        receiving_pdf.initialize(modern)
        self.assertFalse(any("ALTER TABLE" in statement
            for typ,statement in modern.statements if typ=="sql"))

@unittest.skipIf(fitz is None,"PyMuPDF necessário no contêiner VPS")
class PdfReceivingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.saved=(app.DATA,app.DB)
        app.DATA=Path(self.tmp.name);app.DB=app.DATA/"pedidos_pdf.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'PEDIDOS','recebimento','[]','[]','[]')""").lastrowid
        self.sample=[
            "PEDIDO DE COMPRA: PED-2026-004",
            "FORNECEDOR: AG REX",
            "Produto | Qtde | UM",
            "1 Assist 2.000 L",
            "2 Bright 2.220 KG",
            "Data prevista de entrega: 30/11/2026"
        ]

    def tearDown(self):
        app.DATA,app.DB=self.saved
        self.tmp.cleanup()

    def pdf_preview(self,rows=None,raw_pdf=None):
        pdf=raw_pdf if raw_pdf is not None else build_pdf(rows or self.sample)
        with app.db() as con:
            return receiving_pdf.preview(con,self.cid,{
                "filename":"Pedido_Mestre_04.pdf",
                "base64":base64.b64encode(pdf).decode("ascii")})

    def test_parser_detects_supplier_order_items_and_units(self):
        parsed=receiving_pdf.extract_pdf(build_pdf(self.sample))
        self.assertEqual(parsed["order_number"],"PED-2026-004")
        self.assertEqual(parsed["supplier"],"AG REX")
        self.assertEqual(len(parsed["items"]),2)
        self.assertEqual([(p["product"],p["ordered_qty"],p["unit"]) for p in parsed["items"]],
                         [("Assist","2000.000","L"),("Bright","2220.000","kg")])

    def test_supplier_variants_are_same_group_but_distinct_brands_not_merged(self):
        self.assertEqual(receiving_pdf.supplier_alias_key("Ág Rex LTDA"),
                         receiving_pdf.supplier_alias_key("AGREX"))
        self.assertNotEqual(receiving_pdf.supplier_alias_key("AGREX"),
                            receiving_pdf.supplier_alias_key("AGREX MOSAIC"))

    def test_parses_brazilian_quantities_and_doses(self):
        rows=receiving_pdf.parse_rows("Assist 1.234,5 L\nBrady 18.606 DOS\nKCL 300 t")
        self.assertEqual([(p["ordered_qty"],p["unit"]) for p in rows],
                         [("1234.500","L"),("18606.000","DOS"),("300.000","t")])

    def test_existing_order_gains_new_rows_and_supplier_merges(self):
        with app.db() as con:
            con.execute("""INSERT INTO purchase_items(control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",(self.cid,"PED-2026-004","AGREX","Antigo","kg","100.000"))
        report=self.pdf_preview()
        rows=[{"index":i,"order_number":report["order_number"],
               "supplier":report["supplier"],**p} for i,p in enumerate(report["items"])]
        with app.db() as con:
            result=receiving_pdf.confirm(con,self.cid,{"files":[{
                "fingerprint":report["fingerprint"],"items":rows}]})
            self.assertEqual(result["imported"],2)
        with app.db() as con:
            loaded=receiving.summary(con,self.cid)
            self.assertEqual(len(loaded["items"]),3)
            self.assertEqual({x["order_number"] for x in loaded["items"]},{"PED-2026-004"})
            self.assertEqual(len({x["supplier"] for x in loaded["items"]}),1)
            self.assertEqual(loaded["totals"]["receipts"],0)
            with self.assertRaisesRegex(ValueError,"já foi importado"):
                receiving_pdf.confirm(con,self.cid,{"files":[{
                    "fingerprint":report["fingerprint"],"items":rows}]})
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],3)

    def test_fingerprint_blocks_repeated_upload(self):
        original=build_pdf(self.sample)
        first=self.pdf_preview(raw_pdf=original)
        self.assertFalse(first["already_imported"])
        same=self.pdf_preview(raw_pdf=original)
        self.assertEqual(first["fingerprint"],same["fingerprint"])
        with app.db() as con:
            receiving_pdf.confirm(con,self.cid,{"files":[{
                "fingerprint":same["fingerprint"],
                "items":[{"index":0,"order_number":"PED-X","supplier":"AGREX",
                          "product":"Assist","unit":"L","ordered_qty":"2000"}]}]})
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],1)
        after=self.pdf_preview(raw_pdf=original)
        self.assertTrue(after["already_imported"])
        self.assertEqual(after["items"],[])

    def test_missing_fields_do_not_insert_any_item(self):
        report=self.pdf_preview()
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"fornecedor"):
                receiving_pdf.confirm(con,self.cid,{"files":[{
                    "fingerprint":report["fingerprint"],
                    "items":[{"index":0,"order_number":"PED-2026-004","supplier":"",
                              "product":"Assist","unit":"L","ordered_qty":"2000"}]}]})
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],0)

    def test_not_found_items_have_manual_review_without_inventing_names(self):
        report=self.pdf_preview(["PEDIDO: ABC-22","FORNECEDOR: AGREX",
                                 "Nenhuma quantidade reconhecida neste documento"])
        self.assertTrue(report["needs_manual_review"])
        self.assertEqual(report["items"][0]["product"],"")
        self.assertEqual(report["items"][0]["ordered_qty"],"")

    def test_non_pdf_payload_is_rejected(self):
        with self.assertRaisesRegex(ValueError,"PDF válido"):
            receiving_pdf.extract_pdf(b"hello world")

if __name__=="__main__":
    unittest.main()
