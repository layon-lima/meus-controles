"""Excel da aba Notas fiscais: filtros, dados exatos, integridade e isolamento."""
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import app
import receiving_invoices_excel


NS={"x":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def xml_cell(sheet,address):
    cell=sheet.find(".//x:c[@r='"+address+"']",NS)
    if cell is None:return None,None
    txt=cell.find(".//x:t",NS)
    if txt is not None:return txt.text,cell.get("t")
    value=cell.find("x:v",NS)
    return (value.text if value is not None else None),cell.get("t")


class ReceiptInvoiceExcelTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.prev=(app.DATA,app.DB)
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"invoices.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'RECEBIMENTO DE PRODUTOS','recebimento','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'OUTRO RECEBIMENTO','recebimento','[]','[]','[]')""").lastrowid
            p1=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",
                (self.cid,"AGREX S9","AGREX","S9","t","100")).lastrowid
            p2=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",
                (self.cid,"AGREX KCL","AGREX","KCL","t","100")).lastrowid
            other_item=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",
                (self.other,"OTHER","SEGREDO","PRODUTO X","kg","500")).lastrowid
            con.execute("""INSERT INTO purchase_receipts
                (item_id,received_date,invoice_number,access_key,received_qty,notes,
                 invoice_issuer,invoice_issuer_document)
                VALUES(?,?,?,?,?,?,?,?)""",
                (p1,"2026-10-30","0048478","2"*44,"38.000","",
                 "MOSAIC FERTILIZANTES DO BRASIL LTDA","12345678000199"))
            con.execute("""INSERT INTO purchase_receipts
                (item_id,received_date,invoice_number,access_key,received_qty,notes,
                 invoice_issuer,invoice_issuer_document)
                VALUES(?,?,?,?,?,?,?,?)""",
                (p2,"2026-10-28","40704","3"*44,"48.500","","",""))
            con.execute("""INSERT INTO purchase_receipts
                (item_id,received_date,invoice_number,access_key,received_qty,notes,
                 invoice_issuer,invoice_issuer_document)
                VALUES(?,?,?,?,?,?,?,?)""",
                (other_item,"2026-10-30","999","4"*44,"10","","SEGREDO",""))
        with app.db() as con:
            self.initial=con.execute("SELECT COUNT(*) AS n FROM purchase_receipts").fetchone()["n"]

    def tearDown(self):
        app.DATA,app.DB=self.prev
        self.tmp.cleanup()

    def test_xlsx_contains_screen_columns_in_original_order(self):
        with app.db() as con:
            blob=receiving_invoices_excel.generate(con,self.cid)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            self.assertIsNone(z.testzip())
            for path in z.namelist():
                if path.endswith((".xml",".rels")):
                    ET.fromstring(z.read(path))
            sheet=ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
            self.assertEqual(
                [xml_cell(sheet,col+"4")[0] for col in "ABCDEFG"],
                list(receiving_invoices_excel.HEADERS))
            self.assertEqual(xml_cell(sheet,"B5")[0],"0048478")
            self.assertEqual(xml_cell(sheet,"C5")[0],"2"*44)
            self.assertEqual(xml_cell(sheet,"D5")[0],"AGREX S9")
            self.assertEqual(xml_cell(sheet,"F5")[0],"MOSAIC FERTILIZANTES DO BRASIL LTDA")
            self.assertEqual(xml_cell(sheet,"F6")[0],"Emitente não registrado")
            self.assertEqual(xml_cell(sheet,"G5")[0],"38.0")
            self.assertNotEqual(xml_cell(sheet,"A5")[1],"inlineStr")
            self.assertNotEqual(xml_cell(sheet,"G5")[1],"inlineStr")
            self.assertNotIn("SEGREDO",z.read("xl/worksheets/sheet1.xml").decode())
            self.assertIn(" t",z.read("xl/styles.xml").decode())
            self.assertIn("autoFilter",z.read("xl/worksheets/sheet1.xml").decode())

    def test_search_filters_server_side_by_visible_fields(self):
        for query,expected in [
            ("mosaic",["0048478"]),
            ("FERTILIZANTES",["0048478"]),
            ("  fértIlizantes ",["0048478"]),
            ("AGREX KCL",["40704"]),
            ("40704",["40704"]),
            ("3"*44,["40704"]),
            ("",["0048478","40704"]),
        ]:
            with self.subTest(query=query),app.db() as con:
                rows=receiving_invoices_excel.invoice_rows(con,self.cid,query)
                self.assertEqual([r["invoice_number"] for r in rows],expected)

    def test_export_does_not_change_database_and_rejects_wrong_control(self):
        with app.db() as con:
            receiving_invoices_excel.generate(con,self.cid,"mosaic")
            self.assertEqual(con.execute("SELECT COUNT(*) AS n FROM purchase_receipts")
                             .fetchone()["n"],self.initial)
            with self.assertRaisesRegex(ValueError,"Nenhuma nota"):
                receiving_invoices_excel.generate(con,self.cid,"SEM RESULTADO")
            with self.assertRaises(ValueError):
                receiving_invoices_excel.generate(con,self.cid,query="a"*201)
            with self.assertRaises((ValueError,LookupError)):
                receiving_invoices_excel.generate(con,99999)

    def test_browser_download_route_and_filter_uses_correct_post(self):
        app_code=(Path(__file__).parents[1]/"app.py").read_text(encoding="utf-8")
        js=(Path(__file__).parents[1]/"static"/"receiving.js").read_text(encoding="utf-8")
        self.assertIn('receiving_invoices_excel.generate(',app_code)
        self.assertIn("notas_fiscais_recebimentos.xlsx",app_code)
        self.assertIn("receivingExportInvoices()",js)
        self.assertIn("activeTab===\"notas\"?",js)
        self.assertIn('this.s.receivingSearch.queries?.notas',js)
        self.assertIn('JSON.stringify({query})',js)


if __name__=="__main__":
    unittest.main()
