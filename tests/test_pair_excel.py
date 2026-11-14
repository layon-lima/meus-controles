"""Excel dos lançamentos Acerto A × B: escopo, valores, datas e segurança."""
from pathlib import Path
from tempfile import TemporaryDirectory
from xml.etree import ElementTree as ET
import io
import unittest
import zipfile

import app
import pair
import pair_excel

NS={"x":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def cell(sheet,address):
    found=sheet.find(".//x:c[@r='"+address+"']",NS)
    if found is None:return None,None
    text=found.find(".//x:t",NS)
    if text is not None:return text.text,found.get("t")
    value=found.find("x:v",NS)
    return (value.text if value is not None else None),found.get("t")


class PairExcelTests(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory()
        self.saved=app.DATA,app.DB
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"pair_export.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls
                 (board_id,name,mode,fields_json,rules_json,types_json)
                 VALUES(1,'ACERTO EDILEUSA','acerto_ab','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls
                 (board_id,name,mode,fields_json,rules_json,types_json)
                 VALUES(1,'OUTRO ACERTO','acerto_ab','[]','[]','[]')""").lastrowid
            pair.save_settings(con,self.cid,{"party_a":"JONAS","party_b":"EDILEUSA"})
            pair.save_settings(con,self.other,{"party_a":"JONAS","party_b":"OUTRO"})
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,notes,entry_kind)
                VALUES(?,?,?,?,?,?,?)""",
                (self.cid,"2026-01-02","A","1000.00","ANTIGO","Nota","debt"))
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,notes,entry_kind)
                VALUES(?,?,?,?,?,?,?)""",
                (self.cid,"2026-01-03","B","200.00","PAGAMENTO","Conferido","payment"))
            con.execute("""INSERT INTO pair_records
                (control_id,record_date,original_date,amount,from_name,to_name,description,notes)
                VALUES(?,?,?,?,?,?,?,?)""",
                (self.cid,"2026-01-20","20/01/2026","99.10","JONAS","BANCO",
                 "REGISTRO INFORMATIVO","Não afeta saldo"))
            previous=pair.preview(con,self.cid,"2026-01-01","2026-01-31")
            pair.close(con,self.cid,{"start":"2026-01-01","end":"2026-01-31",
                                    "fingerprint":previous["fingerprint"]})
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,notes,entry_kind)
                VALUES(?,?,?,?,?,?,?)""",
                (self.cid,"2026-02-02","B","125.50","=HYPERLINK('teste')",
                 "Observação nova","debt"))
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,notes,entry_kind)
                VALUES(?,?,?,?,?,?,?)""",
                (self.other,"2026-02-02","A","100000.00","SEGREDO","", "debt"))

    def tearDown(self):
        app.DATA,app.DB=self.saved
        self.tmp.cleanup()

    def test_open_period_is_numeric_and_includes_neutral_records(self):
        with app.db() as con:
            initial=pair.summary(con,self.cid)["totals"]
            blob=pair_excel.generate(con,self.cid)
            after=pair.summary(con,self.cid)["totals"]
        self.assertEqual(initial,after)
        with zipfile.ZipFile(io.BytesIO(blob)) as book:
            self.assertIsNone(book.testzip())
            for name in book.namelist():
                if name.endswith((".xml",".rels")):ET.fromstring(book.read(name))
            sheet=ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
            self.assertEqual([cell(sheet,c+"4")[0] for c in "ABCDEFGHI"],
                             list(pair_excel.HEADERS))
            self.assertEqual(cell(sheet,"B5")[0],"Dívida / compensação")
            self.assertEqual(cell(sheet,"C5")[0],"=HYPERLINK('teste')")
            self.assertEqual(cell(sheet,"D5")[0],"EDILEUSA")
            self.assertEqual(cell(sheet,"E5")[0],"JONAS")
            self.assertEqual(cell(sheet,"F5")[0],"125.5")
            self.assertIsNone(cell(sheet,"F5")[1])
            self.assertNotEqual(cell(sheet,"A5")[1],"inlineStr")
            self.assertEqual(cell(sheet,"H5")[0],"Período aberto")
            self.assertEqual(cell(sheet,"B6")[0],"Registro informativo (não altera saldo)")
            self.assertEqual(cell(sheet,"H6")[0],"Informativo")
            xml=book.read("xl/worksheets/sheet1.xml").decode("utf-8")
            self.assertNotIn("SEGREDO",xml)
            self.assertNotIn("<f>",xml)
            self.assertIn("autoFilter",xml)
            self.assertIn("pane",xml)
            self.assertIn("R$",book.read("xl/styles.xml").decode())

    def test_historical_export_contains_closed_and_payment(self):
        with app.db() as con:
            blob=pair_excel.generate(con,self.cid,True)
            data,rows=pair_excel.rows_for_export(con,self.cid,True)
        self.assertEqual(len(rows),4)
        self.assertEqual([r["type"] for r in rows].count("Pagamento real"),1)
        self.assertEqual([r["status"] for r in rows].count("Fechado"),2)
        with zipfile.ZipFile(io.BytesIO(blob)) as book:
            xml=book.read("xl/worksheets/sheet1.xml").decode("utf-8")
            for text in ("ANTIGO","PAGAMENTO","REGISTRO INFORMATIVO","EDILEUSA"):
                self.assertIn(text,xml)

    def test_invalid_control_and_flag_are_blocked(self):
        with app.db() as con:
            with self.assertRaises((ValueError,LookupError)):
                pair_excel.generate(con,self.other+10000)
            with self.assertRaises(ValueError):
                pair_excel.generate(con,self.cid,"true")
            rows=pair_excel.rows_for_export(con,self.other)
            self.assertEqual(len(rows[1]),1)

    def test_http_route_and_browser_download(self):
        appsrc=(Path(__file__).parents[1]/"app.py").read_text(encoding="utf-8")
        js=(Path(__file__).parents[1]/"static"/"pair.js").read_text(encoding="utf-8")
        self.assertIn("pair_excel.generate(",appsrc)
        self.assertIn("entries\\.xlsx",appsrc)
        self.assertIn('"acerto_lancamentos_"+pair_excel_route[1]+".xlsx"',appsrc)
        self.assertIn("pairExportExcel()",js)
        self.assertIn("JSON.stringify({include_history:!!this.s.pairAll})",js)
        self.assertIn("link.click()",js)


if __name__=="__main__":
    unittest.main()
