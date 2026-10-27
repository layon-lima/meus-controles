"""Regressões XML NF-e e correspondência segura de recebimento."""
import base64
import tempfile
from pathlib import Path
import unittest
import app, receiving, receiving_xml

def sample(q="20000",u="KG",name="UREIA AGRICOLA"):
    xml=f'''<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
<NFe><infNFe Id="NFe{'1'*44}">
<ide><nNF>34567</nNF><dhEmi>2026-10-27T11:00:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000190</CNPJ><xNome>AGREX DO BRASIL LTDA</xNome></emit>
<det nItem="1"><prod><cProd>456</cProd><xProd>{name}</xProd><uCom>{u}</uCom><qCom>{q}</qCom></prod></det>
</infNFe></NFe></nfeProc>'''
    return xml.encode()

class XMLTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.old=(app.DATA,app.DB)
        app.DATA=Path(self.temp.name);app.DB=app.DATA/"test.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
            VALUES(1,'Produtos','recebimento','[]','[]','[]')""").lastrowid
            self.iid=con.execute("""INSERT INTO purchase_items(control_id,order_number,supplier,product,unit,ordered_qty)
            VALUES(?,?,?,?,?,?)""",(self.cid,"45022014","AGREX BRASIL","UREIA AGRICOLA","t","25")).lastrowid
    def tearDown(self):
        app.DATA,app.DB=self.old
        self.temp.cleanup()
    def test_xml_parser_and_unit_conversion(self):
        xml=receiving_xml.parse(sample())
        self.assertEqual(xml["invoice_number"],"34567")
        self.assertEqual(xml["lines"][0]["quantity"],"20000.000")
        self.assertEqual(receiving_xml.converted("20000","KG","t"),20)
        self.assertIsNone(receiving_xml.converted("20","sc","t"))
    def test_strict_supplier_product_and_open_capacity(self):
        with app.db() as con:
            report=receiving_xml.preview(con,self.cid,{"xml":base64.b64encode(sample()).decode()})
            candidate=report["lines"][0]["options"][0]
            self.assertEqual(candidate["quantity"],"20.000")
            self.assertTrue(candidate["eligible"])
            self.assertEqual(report["lines"][0]["suggested_id"],self.iid)
            over=receiving_xml.preview(con,self.cid,{"xml":base64.b64encode(sample(q="30000")).decode()})
            self.assertFalse(over["lines"][0]["options"])
            bad=receiving_xml.preview(con,self.cid,{"xml":base64.b64encode(sample(name="OLEO MOTOR")).decode()})
            self.assertFalse(bad["lines"][0]["options"][0]["eligible"])
    def test_confirm_is_atomic_and_invoice_is_not_double_imported(self):
        raw=base64.b64encode(sample()).decode()
        with app.db() as con:
            result=receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":[self.iid]})
            self.assertEqual(result["inserted"],1)
            self.assertEqual(receiving.summary(con,self.cid)["items"][0]["remaining_qty"],"5.000")
            with self.assertRaisesRegex(ValueError,"já foi lançada"):
                receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":[self.iid]})
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],1)
    def test_closed_orders_are_not_available(self):
        with app.db() as con:
            con.execute("UPDATE purchase_items SET closed=1 WHERE id=?",(self.iid,))
            con.commit()
            result=receiving_xml.preview(con,self.cid,{"xml":base64.b64encode(sample()).decode()})
            self.assertFalse(result["lines"][0]["options"])
            with self.assertRaisesRegex(ValueError,"concluído"):
                receiving_xml.confirm(con,self.cid,{"xml":base64.b64encode(sample()).decode(),"selections":[self.iid]})
    def test_access_key_fallback_from_protocol(self):
        raw=sample().decode()
        raw=raw.replace(" Id=\"NFe"+("1"*44)+"\"","")
        raw=raw.replace("</nfeProc>","<protNFe><infProt><chNFe>"+("2"*44)+"</chNFe></infProt></protNFe></nfeProc>")
        result=receiving_xml.parse(raw.encode())
        self.assertEqual(result["access_key"],"2"*44)

    def test_external_entities_rejected(self):
        with self.assertRaisesRegex(ValueError,"XML"):
            receiving_xml.parse(b'<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><foo>&x;</foo>')

if __name__=="__main__":unittest.main()
