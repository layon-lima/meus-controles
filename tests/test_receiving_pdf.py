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

    def test_order_master_and_supplier_on_next_line(self):
        lines=["PEDIDO MESTRE-0045022014","FORNECEDOR:","AGREX DO BRASIL LTDA","CNPJ: 00.000.000/0001-00"]
        self.assertEqual(receiving_pdf.find_order(lines),"0045022014")
        self.assertEqual(receiving_pdf.find_supplier(lines),"AGREX DO BRASIL LTDA")

    def test_product_code_is_separate_from_description(self):
        rows=receiving_pdf.parse_rows("1 123456 SEMENTE DE SOJA 150 KG")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["product"],"SEMENTE DE SOJA")
        self.assertEqual(rows[0]["product_code"],"123456")

    def test_order_must_not_be_invoice_or_date(self):
        self.assertEqual(receiving_pdf.find_order(["NOTA FISCAL PEDIDO: 12345","CNPJ: 12.345.678/0001-90"]),"")
        self.assertEqual(receiving_pdf.find_order(["PEDIDO: 27/10/2026"] ),"")

    def test_supplier_variants_are_same_group_but_distinct_brands_not_merged(self):
        self.assertEqual(receiving_pdf.supplier_alias_key("Ág Rex LTDA"),
                         receiving_pdf.supplier_alias_key("AGREX"))
        self.assertNotEqual(receiving_pdf.supplier_alias_key("AGREX"),
                            receiving_pdf.supplier_alias_key("AGREX MOSAIC"))

    def test_parses_brazilian_quantities_and_doses(self):
        rows=receiving_pdf.parse_rows("Assist 1.234,5 L\nBrady 18.606 DOS\nKCL 300 t")
        self.assertEqual([(p["ordered_qty"],p["unit"]) for p in rows],
                         [("1234.500","L"),("18606.000","DOS"),("300.000","t")])

    def test_quantity_before_description_is_recognized(self):
        rows=receiving_pdf.parse_rows("2.000 L Assist\n1.500 kg CALCARIO DOLOMITICO")
        self.assertEqual([(x["product"],x["ordered_qty"],x["unit"]) for x in rows],
            [("Assist","2000.000","L"),("CALCARIO DOLOMITICO","1500.000","kg")])

    def test_tabular_columns_recover_products_without_inline_units(self):
        import receiving_pdf_layout
        class Table:
            def extract(self):
                return [
                    ["CODIGO","DESCRIÇÃO DO PRODUTO","QUANTIDADE","UNID","VALOR"],
                    ["110","ASSIST","2.000","L","30.000,00"],
                    ["220","BRIGHT","2.220","kg","12.000,00"],
                    ["","","","","TOTAL"]
                ]
        class Page:
            def find_tables(self):
                return type("Result",(),{"tables":[Table()]})()
        items=receiving_pdf_layout.parse_table(Page(),receiving_pdf)
        self.assertEqual([(i["product"],i["ordered_qty"],i["unit"]) for i in items],
             [("ASSIST","2000.000","L"),("BRIGHT","2220.000","kg")])

    def test_fmc_qtde_column_is_not_packaging_size_or_price(self):
        import receiving_pdf_layout
        class Table:
            def extract(self):
                return [
                  ["NRO","Produto","Cultura","Tipo de Entrega","Qtde",
                   "","Data de","", "Preço Unitário","Sub-Total"],
                  ["000150","VELITREX_5L_BR","Soybeans","Normal Sales","300",
                   "16/10/26","","","305,00","91.500,00"],
                  ["000110","PRESENCE FULL_1KG_BR","Soybeans","Normal Sales","100",
                   "16/10/26","","","606,00","60.600,00"],
                  ["000130","SEED EVO_1L_BR","Soybeans","Free of Charge","12",
                   "16/10/26","","","127,68","1.532,11"]
                ]
        class Page:
            def find_tables(self):
                return type("Result",(),{"tables":[Table()]})()
        result=receiving_pdf_layout.parse_table(Page(),receiving_pdf)
        self.assertEqual([(r["ordered_qty"],r["unit"],r.get("source_line"))
                          for r in result],
                         [("300.000","un","000150"),
                          ("100.000","un","000110"),
                          ("12.000","un","000130")])
        self.assertEqual([r["product"] for r in result],
                         ["VELITREX_5L_BR","PRESENCE FULL_1KG_BR","SEED EVO_1L_BR"])

    def test_fmc_continuation_same_product_is_another_line(self):
        import receiving_pdf_layout
        class Table:
            def extract(self):
                return [["000140","PRESENCE FULL_1KG_BR","Soybeans",
                         "Free of Charge","5","16/10/26","640,87","3.204,35"]]
        class Page:
            def find_tables(self):
                return type("Result",(),{"tables":[Table()]})()
        result=receiving_pdf_layout.parse_table(Page(),receiving_pdf)
        self.assertEqual(result[0]["source_line"],"000140")
        self.assertEqual(result[0]["ordered_qty"],"5.000")
        self.assertEqual(result[0]["unit"],"un")

    def test_ocr_extracts_all_products_from_separate_table_columns(self):
        pdf=fitz.open()
        try:
            page=pdf.new_page()
            for text,x in (("PRODUTO",55),("QUANTIDADE",340),("UNID",455),("VALOR",530)):
                page.insert_text((x,55),text,fontsize=10)
            for y,product,qty,unit in (
                (81,"ASSIST","2.000","L"),
                (106,"BRIGHT","2.220","kg"),
                (131,"SULFATO DE AMONIO","500","t"),
            ):
                for label,x in ((product,55),(qty,340),(unit,455)):
                    page.insert_text((x,y),label,fontsize=10)
            raw=pdf.tobytes()
        finally:
            pdf.close()
        parsed=receiving_pdf.extract_pdf(raw)
        self.assertEqual(len(parsed["items"]),3,parsed)
        self.assertEqual([(i["product"],i["ordered_qty"],i["unit"])
                          for i in parsed["items"]],[
            ("ASSIST","2000.000","L"),("BRIGHT","2220.000","kg"),
            ("SULFATO DE AMONIO","500.000","t")])

    def test_manual_pdf_region_recovers_multiple_rows_without_any_ai(self):
        import receiving_pdf_region
        pdf=fitz.open()
        try:
            page=pdf.new_page()
            for name,x in (("PRODUTO",55),("QTD",340),("UNID",455)):
                page.insert_text((x,55),name,fontsize=10)
            for y,product,qty,unit in ((90,"ASSIST","1000","L"),
                                       (115,"BRIGHT","1500","kg")):
                for label,x in ((product,55),(qty,340),(unit,455)):
                    page.insert_text((x,y),label,fontsize=10)
            raw=pdf.tobytes()
        finally:
            pdf.close()
        fingerprint=__import__("hashlib").sha256(raw).hexdigest()
        data=base64.b64encode(raw).decode("ascii")
        with app.db() as con:
            receiving_pdf.preview(con,self.cid,{"filename":"pedido.pdf","base64":data})
        payload={"base64":data,"fingerprint":fingerprint,"page":0}
        with app.db() as con:
            rendered=receiving_pdf_region.page_preview(con,self.cid,payload)
            self.assertTrue(rendered["image"].startswith("data:image/png;base64,"))
            selected=receiving_pdf_region.read_region(con,self.cid,{
                **payload,"rect":{"x0":.06,"y0":.04,"x1":.9,"y1":.21}
            })
        self.assertEqual([p["product"] for p in selected["items"]],["ASSIST","BRIGHT"])
        self.assertEqual([p["unit"] for p in selected["items"]],["L","kg"])

    def test_marking_a_single_line_without_headers_is_understood(self):
        import receiving_pdf_layout
        words=[
          (60,85,100,95,"ASSIST"),
          (345,85,385,95,"2.000"),
          (460,85,468,95,"L")
        ]
        result=receiving_pdf_layout.parse_words(words,receiving_pdf)
        self.assertEqual(result,[{"product":"ASSIST","ordered_qty":"2000.000","unit":"L"}])

    def test_no_gpt_import_or_api_route_remains(self):
        source=(Path(__file__).resolve().parents[1]/"app.py").read_text(encoding="utf-8")
        viewer=(Path(__file__).resolve().parents[1]/"static"/"receiving_pdf.js").read_text(encoding="utf-8")
        self.assertNotIn("receiving_pdf_gpt",source)
        self.assertNotIn("receiving/pdf/gpt",source)
        self.assertNotIn("GPT",viewer)
        self.assertIn("receivingPdfMarkStart(event,fileIndex)",viewer)
        self.assertIn("receivingPdfReadMark(fileIndex)",viewer)

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
