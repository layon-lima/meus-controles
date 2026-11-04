"""Relatórios Excel multi-controle: dados, isolamento, ZIP/XML e proteção financeira."""
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import app
import reports_excel


class ReportExcelTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.original=(app.DATA,app.DB)
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"excel.db"
        app.initialize()
        with app.db() as con:
            self.folder=con.execute("INSERT INTO boards(name) VALUES(?)",("FUNCIONÁRIOS",)).lastrowid
            self.pair=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(?,?,'acerto_ab','[]','[]','[]')""",
                (self.folder,"JOÃO PEDRO EMPREITA PLANTIO")).lastrowid
            con.execute("INSERT INTO pair_settings(control_id,party_a,party_b) VALUES(?,?,?)",
                        (self.pair,"JONAS","JOÃO PEDRO"))
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,notes,entry_kind)
                VALUES(?,?,?,'8000','Empreita de plantio','','debt')""",
                (self.pair,"2026-10-01","A"))
            con.execute("""INSERT INTO pair_records
                (control_id,record_date,amount,description,from_name,to_name,notes)
                VALUES(?,?,?,?,?,?,?)""",
                (self.pair,"2026-10-30","1500","VALE PEGO COM JONAS","JONAS","JOÃO PEDRO",""))
            self.receiving=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(?,?,'recebimento','[]','[]','[]')""",
                (self.folder,"RECEBIMENTO DE PRODUTOS")).lastrowid
            iid=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",
                (self.receiving,"00022","Fornecedor","KCL 60 GR","TO","100.000")).lastrowid
            con.execute("""INSERT INTO purchase_receipts
                (item_id,received_date,invoice_number,access_key,received_qty,notes)
                VALUES(?,?,?,?,'48.000','Conferido')""",
                (iid,"2026-11-01","40550","1"*44))
            con.execute("""INSERT INTO receiving_xml_pending
                (control_id,access_key,invoice_number,issued_date,supplier,cnpj,
                 line_index,product,product_code,quantity,unit)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (self.receiving,"2"*44,"40551","2026-11-02","Fornecedor","",1,"KCL","",
                 "12.000","TO"))
            self.truck=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(?,?,'caminhao','[]','[]','[]')""",
                (self.folder,"TRANSPORTADORA")).lastrowid
            con.execute("""INSERT INTO truck_entries
                (control_id,event_date,kind,category,description,amount)
                VALUES(?,?,?,? ,?,?)""",
                (self.truck,"2026-10-29","advance","Vale motorista","Vale para motorista","1000"))
            self.generic=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(?,?,'financeiro',?,'[]','[]')""",
                (self.folder,"FINANCEIRO",json.dumps([
                    {"key":"dia","type":"date"},{"key":"nome","type":"text"}]))).lastrowid
            con.execute("""INSERT INTO entries
                (control_id,type_key,type_label,direction,category,notes,data_json,calculated_json,amount)
                VALUES(?,?,?,?,?,?,?,?,?)""",
                (self.generic,"entrada","Entrada",1,"Geral","",
                 json.dumps({"dia":"2026-11-02","nome":"=HYPERLINK('malicioso')"}),"{}","125.50"))

    def tearDown(self):
        app.DATA,app.DB=self.original
        self.tmp.cleanup()

    def test_multi_control_excel_in_one_sheet_with_green_blocks_and_totals(self):
        with app.db() as con:
            summaries,rows,grouped=reports_excel.report_data(con,[
                self.pair,self.receiving,self.truck,self.generic])
            self.assertEqual([r[3] for r in summaries],[2,3,1,1])
            self.assertEqual(len(rows),7)
            self.assertEqual(summaries[1][4],1)
            content=reports_excel.generate(con,[self.pair,self.receiving,self.truck,self.generic])
        with zipfile.ZipFile(io.BytesIO(content)) as workbook:
            self.assertEqual(workbook.testzip(),None)
            names=workbook.namelist()
            self.assertEqual(len([x for x in names if x.startswith("xl/worksheets/sheet")]),1)
            for path in names:
                if path.endswith(".xml") or path.endswith(".rels"):
                    ET.fromstring(workbook.read(path))
            sheet=workbook.read("xl/worksheets/sheet1.xml").decode()
            for value in ("JOÃO PEDRO EMPREITA PLANTIO","RECEBIMENTO DE PRODUTOS",
                          "TRANSPORTADORA","FINANCEIRO",
                          "Registro informativo (não altera saldo)",
                          "NF-e sem pedido (pendente)",
                          "Vale motorista (abatimento da comissão)",
                          "TOTAIS","Saldo"):
                if value=="Saldo":continue
                self.assertIn(value,sheet)
            self.assertIn("=HYPERLINK",sheet)
            self.assertNotIn("<f>",sheet)
            self.assertNotIn("<autoFilter",sheet)
            namespace={"x":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            xml_sheet=ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
            def cell(address):
                return xml_sheet.find(".//x:c[@r='"+address+"']",namespace)
            def value(address):
                c=cell(address)
                self.assertIsNotNone(c,address)
                texts=[x.text or "" for x in c.findall(".//x:t",namespace)]
                return "".join(texts) if texts else c.find("x:v",namespace).text
            # Modelo A × B do arquivo arualizada.xlsx: somente A:E.
            self.assertEqual(value("A2"),"JOÃO PEDRO EMPREITA PLANTIO")
            self.assertEqual([value(letter+"3") for letter in "ABCDE"],[
                "Data","Tipo","Descrição","Origem / destino","Valor (R$)"])
            self.assertEqual(value("B4"),"Registro informativo (não altera saldo)")
            self.assertEqual(value("B5"),"Dívida / compensação")
            self.assertEqual(value("D6"),"Total Em aberto")
            self.assertEqual(float(value("E6")),-8000)
            # Linhas 7 e 8 vazias, antes do próximo controle.
            self.assertIsNone(cell("A7"))
            self.assertIsNone(cell("A8"))
            self.assertEqual(value("A9"),"RECEBIMENTO DE PRODUTOS")
            self.assertEqual(value("G9"),"Quantidade")
            self.assertEqual(float(value("G13")),48)
            self.assertNotEqual(cell("A4").get("t"),"inlineStr")  # data real Excel
            self.assertNotEqual(cell("E4").get("t"),"inlineStr")  # moeda numérica
            self.assertIn("dd/mm/yy",workbook.read("xl/styles.xml").decode())
            self.assertIn("R$",workbook.read("xl/styles.xml").decode())
            self.assertIn("00AD64",workbook.read("xl/styles.xml").decode())
            self.assertIn("92D050",workbook.read("xl/styles.xml").decode())

    def test_two_ab_controls_follow_exact_a_to_e_template(self):
        with app.db() as con:
            second=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(?,?,'acerto_ab','[]','[]','[]')""",
                (self.folder,"KENNEDY EMPREITA PLANTIO")).lastrowid
            con.execute("INSERT INTO pair_settings(control_id,party_a,party_b) VALUES(?,?,?)",
                        (second,"JONAS","KENNEDY"))
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,notes,entry_kind)
                VALUES(?,?,?,'6500','EMPREITA PLANTIO','','debt')""",
                (second,"2026-10-01","A"))
            con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,notes,entry_kind)
                VALUES(?,?,?,'240','VALE PEGO COM JONAS','','payment')""",
                (second,"2026-10-30","A"))
            blob=reports_excel.generate(con,[self.pair,second])
        with zipfile.ZipFile(io.BytesIO(blob)) as workbook:
            xml=ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
            ns={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            def value(where):
                c=xml.find(".//s:c[@r='"+where+"']",ns)
                if c is None:return None
                t=c.find(".//s:t",ns)
                if t is not None:return t.text
                v=c.find("s:v",ns)
                return v.text if v is not None else None
            self.assertEqual(value("A2"),"JOÃO PEDRO EMPREITA PLANTIO")
            self.assertEqual(value("A3"),"Data")
            self.assertEqual(value("E3"),"Valor (R$)")
            self.assertEqual(value("D6"),"Total Em aberto")
            self.assertEqual(float(value("E6")),-8000)
            self.assertIsNone(value("A7"))
            self.assertIsNone(value("A8"))
            self.assertEqual(value("A9"),"KENNEDY EMPREITA PLANTIO")
            self.assertEqual(value("A10"),"Data")
            self.assertEqual(value("D13"),"Total Em aberto")
            self.assertEqual(float(value("E13")),-6260)
            self.assertIsNone(value("F3"))
            self.assertIsNone(value("F10"))
            self.assertIn("92D050",workbook.read("xl/styles.xml").decode())

    def test_totals_dont_double_count_money_or_units(self):
        with app.db() as con:
            _,_,grouped=reports_excel.report_data(con,[self.pair,self.receiving,self.truck])
        totals={c["mode"]:reports_excel.block_totals(rows,c["mode"]) for c,rows in grouped}
        self.assertEqual(totals["acerto_ab"][0][1],-8000)
        self.assertEqual(totals["recebimento"][0][1],48)
        self.assertIn("não somados",totals["recebimento"][0][2])
        self.assertEqual(totals["caminhao"][0][1],0)
        self.assertEqual(totals["caminhao"][3][1],1000)
        with app.db() as con:
            item=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",(self.receiving,"B-4","Fornecedor","URÉIA","KG","100")).lastrowid
            con.execute("""INSERT INTO purchase_receipts
                (item_id,received_date,invoice_number,received_qty)
                VALUES(?,?,?,?)""",(item,"2026-11-03","40552","30"))
            _,_,groups=reports_excel.report_data(con,[self.receiving])
        mixed=reports_excel.block_totals(groups[0][1],"recebimento")
        self.assertIsNone(mixed[0][1])
        self.assertEqual({x[0]:x[1] for x in mixed[1:]},
                         {"Recebido · KG":30,"Recebido · TO":48})

    def test_no_mixing_of_currency_and_quantity(self):
        with app.db() as con:
            _,rows,_=reports_excel.report_data(con,[self.receiving,self.truck])
        receipt=next(x for x in rows if x[4]=="Recebimento NF-e")
        self.assertIsNone(receipt[9])
        self.assertEqual(receipt[11],48)
        self.assertEqual(receipt[12],"TO")
        advance=next(x for x in rows if x[4].startswith("Vale motorista"))
        self.assertEqual(advance[9],1000)
        self.assertIsNone(advance[10])  # NÃO contabilizar vale como gasto operacional

    def test_neutral_pair_records_have_zero_balance_effect(self):
        with app.db() as con:
            _,rows,_=reports_excel.report_data(con,[self.pair])
        neutral=next(x for x in rows if "informativo" in x[4])
        debt=next(x for x in rows if x[4]=="Dívida / compensação")
        self.assertEqual(neutral[10],0)
        self.assertEqual(debt[10],-8000)

    def test_invalid_ids_rejected_and_query_does_not_modify_data(self):
        with app.db() as con:
            for ids in ([],[self.pair,self.pair],[self.pair,999999],["1"],[True],
                        list(range(1,82))):
                with self.assertRaises(ValueError):
                    reports_excel.generate(con,ids)
            self.assertEqual(con.execute(
                "SELECT COUNT(*) AS n FROM pair_entries WHERE control_id=?",
                (self.pair,)).fetchone()["n"],1)

    def test_long_and_duplicate_sheet_names_safely_truncated(self):
        used=set()
        names=[reports_excel.unique_sheet_name("Relatório / Muito Longo [Pessoa]*",used)
               for _ in range(3)]
        self.assertEqual(len(set(names)),3)
        self.assertTrue(all(len(x)<=31 for x in names))
        self.assertFalse(any("[" in x or "/" in x for x in names))


if __name__=="__main__":
    unittest.main()
