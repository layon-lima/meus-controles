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
            self.assertEqual(status["remote_status"],"NAO_ENVIADO")
            payload=receiving_gfarm._payload(con,receipt["id"])
            self.assertEqual(Decimal(payload["valor_total"]),Decimal("1750.00"))
            self.assertEqual(payload["origem_id"],"controles:receipt:"+str(receipt["id"]))

    def test_manual_without_fiscal_is_saved_locally_not_sent(self):
        with app.db() as con:
            with patch.dict("os.environ", {
                "GFARM_RECEBIMENTOS_URL":"http://gfarm-app-1:8000/api/integracoes/recebimentos",
                "GFARM_RECEBIMENTOS_TOKEN":"a"*48,
            }):
                receiving.save_manual_invoice(con,self.cid,{
                    "date":"2026-11-11","invoice_number":"123","access_key":"1"*44,
                    "items":[{"item_id":self.iid,"quantity":"10"}],
                })
            row=con.execute("SELECT sent_at,requested_at,remote_status FROM receiving_gfarm_queue").fetchone()
            self.assertEqual(row["remote_status"],"NAO_ENVIADO")
            self.assertIsNone(row["requested_at"])
            self.assertIsNone(row["sent_at"])

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


    def test_send_only_selected_note_and_include_all_its_products(self):
        with app.db() as con:
            other_item=con.execute("""
                INSERT INTO purchase_items(control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES (?,?,?,?,?,?)
            """,(self.cid,"PED-1","AGREX","PRODUTO B","KG","2000")).lastrowid
            first=receiving.save_manual_invoice(con,self.cid,{
                "date":"2026-11-11","invoice_number":"101","access_key":"1"*44,
                "items":[
                    {"item_id":self.iid,"quantity":"10","valor_unitario":"4"},
                    {"item_id":other_item,"quantity":"20","valor_unitario":"6"},
                ],
            })
            second=receiving.save_manual_invoice(con,self.cid,{
                "date":"2026-11-11","invoice_number":"102","access_key":"2"*44,
                "items":[{"item_id":self.iid,"quantity":"15","valor_unitario":"4"}],
            })
            with patch.dict("os.environ",{
                "GFARM_RECEBIMENTOS_URL":"http://gfarm-app-1:8000/api/integracoes/recebimentos",
                "GFARM_RECEBIMENTOS_TOKEN":"a"*48,
            }):
                result=receiving_gfarm.send_selected(con,self.cid,[first["ids"][0]])
                self.assertEqual((result["notas"],result["itens"]),(1,2))
                selected=con.execute("""
                    SELECT remote_status,requested_at FROM receiving_gfarm_queue
                    WHERE receipt_id IN (?,?) ORDER BY receipt_id
                """,tuple(first["ids"])).fetchall()
                self.assertEqual([r["remote_status"] for r in selected],
                                 ["AGUARDANDO_ENVIO","AGUARDANDO_ENVIO"])
                self.assertTrue(all(r["requested_at"] for r in selected))
                untouched=con.execute("""
                    SELECT remote_status,requested_at FROM receiving_gfarm_queue
                    WHERE receipt_id=?
                """,(second["ids"][0],)).fetchone()
                self.assertEqual(untouched["remote_status"],"NAO_ENVIADO")
                self.assertIsNone(untouched["requested_at"])
                with patch.object(receiving_gfarm,"_request",return_value={"status":"PENDENTE"}) as request:
                    receiving_gfarm.dispatch_one(con,second["ids"][0])
                    request.assert_not_called()
                    receiving_gfarm.dispatch_one(con,first["ids"][0])
                    self.assertEqual(request.call_count,1)
                    self.assertEqual(request.call_args.args[2],"POST")
                with self.assertRaisesRegex(ValueError,"fila"):
                    receiving_gfarm.send_selected(con,self.cid,[first["ids"][0]])
                second_selection=receiving_gfarm.send_selected(con,self.cid,[second["ids"][0]])
                self.assertEqual((second_selection["notas"],second_selection["itens"]),(1,1))

    def test_cross_control_and_duplicate_ids_never_send(self):
        with app.db() as con:
            another=con.execute("""
                INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES (1,'OUTRO','recebimento','[]','[]','[]')
            """).lastrowid
            other_item=con.execute("""
                INSERT INTO purchase_items(control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)
            """,(another,"PED-2","OUTRO","PRODUTO C","KG","20")).lastrowid
            outside=receiving.save_manual_invoice(con,another,{
                "date":"2026-11-11","invoice_number":"400","access_key":"3"*44,
                "items":[{"item_id":other_item,"quantity":"10"}],
            })
            with patch.dict("os.environ",{
                "GFARM_RECEBIMENTOS_URL":"http://gfarm-app-1:8000/api/integracoes/recebimentos",
                "GFARM_RECEBIMENTOS_TOKEN":"a"*48,
            }):
                rid=outside["ids"][0]
                with self.assertRaisesRegex(ValueError,"controle"):
                    receiving_gfarm.send_selected(con,self.cid,[rid])
                with self.assertRaisesRegex(ValueError,"repetições"):
                    receiving_gfarm.send_selected(con,another,[rid,rid])
                state=con.execute("SELECT remote_status,requested_at FROM receiving_gfarm_queue WHERE receipt_id=?",(rid,)).fetchone()
                self.assertEqual(state["remote_status"],"NAO_ENVIADO")
                self.assertIsNone(state["requested_at"])

    def test_restart_does_not_send_legacy_queue(self):
        with app.db() as con:
            res=receiving.save_manual_invoice(con,self.cid,{
                "date":"2026-11-11","invoice_number":"55","access_key":"4"*44,
                "items":[{"item_id":self.iid,"quantity":"15"}],
            })
            rid=res["ids"][0]
            con.execute("""
                UPDATE receiving_gfarm_queue SET remote_status='AGUARDANDO_ENVIO',
                    requested_at=NULL,sent_at=NULL WHERE receipt_id=?
            """,(rid,))
            receiving_gfarm.initialize(con)
            status=con.execute("""
                SELECT remote_status,requested_at FROM receiving_gfarm_queue WHERE receipt_id=?
            """,(rid,)).fetchone()
            self.assertEqual(status["remote_status"],"NAO_ENVIADO")
            self.assertIsNone(status["requested_at"])
            with patch.object(receiving_gfarm,"_connection",return_value=("http://gfarm-app-1:8000/api/integracoes/recebimentos","a"*48)),\
                 patch.object(receiving_gfarm,"_request") as request:
                receiving_gfarm.dispatch_one(con,rid)
                request.assert_not_called()


if __name__=="__main__":
    unittest.main()
