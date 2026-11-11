"""Regressões do envio de recebimentos ao GFARM, sem conexão externa."""
import base64
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from decimal import Decimal

import app
import receiving
import receiving_gfarm
import receiving_xml


class IntegracaoGfarmTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = (app.DATA, app.DB)
        app.DATA = Path(self.temp.name)
        app.DB = app.DATA / "test.db"
        app.initialize()
        with app.db() as con:
            self.cid = con.execute("""
              INSERT INTO controls (board_id,name,mode,fields_json,rules_json,types_json)
              VALUES (1,'RECEBIMENTOS','recebimento','[]','[]','[]')
            """).lastrowid
            self.iid = con.execute("""
              INSERT INTO purchase_items(control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES (?,?,?,?,?,?)
            """, (self.cid, "PED-1", "AGREX", "UREIA AGRICOLA", "KG", "5000")).lastrowid

    def tearDown(self):
        app.DATA, app.DB = self.old
        self.temp.cleanup()

    def test_manual_produces_queue_and_weighted_cost(self):
        payload = {
            "date":"2026-11-11","invoice_number":"123","access_key":"1"*44,
            "serie":"1","data_emissao":"2026-11-10",
            "fornecedor":"AGREX","documento_fornecedor":"12345678000190",
            "items":[
                {"item_id":self.iid,"quantity":"100","valor_unitario":"5.50"},
                {"item_id":self.iid,"quantity":"200","valor_unitario":"6.00"},
            ]
        }
        with app.db() as con:
            result = receiving.save_manual_invoice(con,self.cid,payload)
            self.assertEqual(result["inserted"],1)
            receipt = con.execute("SELECT * FROM purchase_receipts").fetchone()
            self.assertEqual(Decimal(receipt["received_qty"]),Decimal("300"))
            fiscal=json.loads(receipt["fiscal_json"])
            self.assertEqual(Decimal(fiscal["valor_total"]),Decimal("1750.00"))
            self.assertEqual(Decimal(fiscal["valor_unitario"]),Decimal("1750.00")/Decimal("300.000"))
            status=con.execute("SELECT remote_status FROM receiving_gfarm_queue").fetchone()
            self.assertEqual(status["remote_status"],"AGUARDANDO_ENVIO")
            payload=receiving_gfarm._payload(con,receipt["id"])
            self.assertEqual(Decimal(payload["valor_total"]),Decimal("1750.00"))
            self.assertEqual(payload["origem_id"],"controles:receipt:"+str(receipt["id"]))

    def test_manual_blocks_missing_fiscal_fields(self):
        with app.db() as con:
            with patch.dict("os.environ", {
                "GFARM_RECEBIMENTOS_URL":"http://gfarm-app-1:8000/api/integracoes/recebimentos",
                "GFARM_RECEBIMENTOS_TOKEN":"a"*48,
            }):
                with self.assertRaisesRegex(ValueError,"série"):
                    receiving.save_manual_invoice(con,self.cid,{
                    "date":"2026-11-11","invoice_number":"123","access_key":"1"*44,
                    "items":[{"item_id":self.iid,"quantity":"10"}],
                })
            self.assertEqual(con.execute("SELECT COUNT(*) FROM purchase_receipts").fetchone()[0],0)

    def test_xml_extracts_per_item_fiscal_and_queues_once(self):
        xml = ('''<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
          <NFe><infNFe Id="NFe'''+"2"*44+'''">
          <ide><nNF>456</nNF><serie>7</serie><dhEmi>2026-11-10T12:00:00-03:00</dhEmi></ide>
          <emit><xNome>AGREX</xNome><CNPJ>12345678000190</CNPJ></emit>
          <det nItem="1"><prod><cProd>A1</cProd><xProd>UREIA AGRICOLA</xProd>
            <qCom>50</qCom><uCom>KG</uCom><vUnCom>3.5</vUnCom><vProd>175</vProd>
            <CFOP>5102</CFOP><NCM>31021010</NCM></prod></det>
          <det nItem="2"><prod><cProd>A1</cProd><xProd>UREIA AGRICOLA</xProd>
            <qCom>100</qCom><uCom>KG</uCom><vUnCom>4</vUnCom><vProd>400</vProd>
            <CFOP>5102</CFOP><NCM>31021010</NCM></prod></det>
          </infNFe></NFe></nfeProc>''').encode()
        with app.db() as con:
            result=receiving_xml.confirm(con,self.cid,{
                "xml":base64.b64encode(xml).decode("ascii"),
                "selections":[self.iid,self.iid],
            })
            self.assertEqual(result["inserted"],1)
            receipt=con.execute("SELECT * FROM purchase_receipts").fetchone()
            self.assertEqual(Decimal(receipt["received_qty"]),Decimal("150"))
            fiscal=json.loads(receipt["fiscal_json"])
            self.assertEqual(fiscal["serie"],"7")
            self.assertEqual(fiscal["cfop"],"5102")
            self.assertEqual(fiscal["valor_total"],"575")
            self.assertEqual(con.execute("SELECT COUNT(*) FROM receiving_gfarm_queue").fetchone()[0],1)


if __name__=="__main__":
    unittest.main()
