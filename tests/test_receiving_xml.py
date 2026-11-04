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
        self.assertEqual(receiving_xml.converted("48","TO","t"),48)
        self.assertEqual(receiving_xml.converted("48","TO","kg"),48000)
        self.assertIsNone(receiving_xml.converted("20","sc","t"))
    def test_strict_supplier_product_and_open_capacity(self):
        with app.db() as con:
            report=receiving_xml.preview(con,self.cid,{"xml":base64.b64encode(sample()).decode()})
            candidate=report["lines"][0]["options"][0]
            self.assertEqual(candidate["quantity"],"20.000")
            self.assertTrue(candidate["eligible"])
            self.assertEqual(report["lines"][0]["suggested_id"],self.iid)
            over=receiving_xml.preview(con,self.cid,{"xml":base64.b64encode(sample(q="30000")).decode()})
            self.assertEqual(over["lines"][0]["options"][0]["id"],self.iid)
            self.assertFalse(over["lines"][0]["options"][0]["selectable"])
            self.assertEqual(over["lines"][0]["options"][0]["reason"],"Saldo insuficiente")
            bad=receiving_xml.preview(con,self.cid,{"xml":base64.b64encode(sample(name="OLEO MOTOR")).decode()})
            self.assertFalse(bad["lines"][0]["options"][0]["eligible"])
    def test_confirm_is_atomic_and_invoice_is_not_double_imported(self):
        raw=base64.b64encode(sample()).decode()
        with app.db() as con:
            result=receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":[self.iid]})
            self.assertEqual(result["inserted"],1)
            self.assertEqual(receiving.summary(con,self.cid)["items"][0]["remaining_qty"],"5.000")
            with self.assertRaisesRegex(ValueError,"duplicada"):
                receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":[self.iid]})
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],1)
    def test_nfe_history_uses_xml_issuer_not_supplier_from_purchase_order(self):
        raw=base64.b64encode(sample()).decode()
        with app.db() as con:
            receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":[self.iid]})
            result=receiving.summary(con,self.cid)
            self.assertEqual(result["items"][0]["supplier"],"AGREX BRASIL")
            r=result["receipts"][0]
            self.assertEqual(r["supplier"],"AGREX DO BRASIL LTDA")
            self.assertEqual(r["invoice_issuer"],"AGREX DO BRASIL LTDA")
            self.assertEqual(r["invoice_issuer_document"],"12345678000190")
            self.assertEqual(r["order_supplier"],"AGREX BRASIL")

    def test_existing_receipt_issuer_recovers_only_from_same_original_xml(self):
        raw=base64.b64encode(sample()).decode()
        with app.db() as con:
            rid=con.execute("""INSERT INTO purchase_receipts
              (item_id,received_date,invoice_number,received_qty,access_key,notes)
              VALUES(?,?,?,?,?,?)""",(self.iid,"2026-10-27","34567","10.000","1"*44,
              "Lançamento por XML NF-e")).lastrowid
            before=receiving.summary(con,self.cid)["receipts"][0]
            self.assertEqual(before["supplier"],"")
            self.assertEqual(before["order_supplier"],"AGREX BRASIL")
            self.assertEqual(before["invoice_issuer"],"")
            ret=receiving_xml.restore_invoice_issuer(con,self.cid,{"xml":raw})
            self.assertEqual(ret["updated"],1)
            self.assertEqual(ret["matched"],1)
            self.assertEqual(ret["issuer"],"AGREX DO BRASIL LTDA")
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],1)
            row=con.execute("SELECT * FROM purchase_receipts WHERE id=?",(rid,)).fetchone()
            self.assertEqual(row["invoice_issuer"],"AGREX DO BRASIL LTDA")
            self.assertEqual(row["invoice_issuer_document"],"12345678000190")
            self.assertEqual(row["received_qty"],"10.000")
            second=receiving_xml.restore_invoice_issuer(con,self.cid,{"xml":raw})
            self.assertEqual(second["updated"],0)
            self.assertEqual(second["matched"],1)
            with self.assertRaisesRegex(ValueError,"Não existe nota"):
                receiving_xml.restore_invoice_issuer(
                    con,self.cid,{"xml":base64.b64encode(sample().replace(
                        b"<nNF>34567</nNF>",b"<nNF>12345</nNF>")).decode()})
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],1)

    def test_assign_pending_preserves_original_xml_issuer(self):
        raw=base64.b64encode(sample()).decode()
        with app.db() as con:
            receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":["pending"]})
            pending=receiving_xml.pending_list(con,self.cid)
            receiving_xml.assign_pending(con,self.cid,pending[0]["id"],{"item_id":self.iid})
            receipt=receiving.summary(con,self.cid)["receipts"][0]
            self.assertEqual(receipt["supplier"],"AGREX DO BRASIL LTDA")
            self.assertEqual(receipt["invoice_issuer_document"],"12345678000190")
            self.assertEqual(receipt["order_supplier"],"AGREX BRASIL")

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

    def test_supplier_alias_and_lot_suffix_match(self):
        self.assertGreater(receiving_xml.similarity("AGREX DO BRASIL LTDA","AGREX",True),.90)
        self.assertGreater(receiving_xml.similarity("TORINO 5L - Lote: 0052513600 - Peso:","Torino"),.90)

    def test_xml_kcl_tonelada_to_finds_similar_registered_product(self):
        with app.db() as con:
            matched=con.execute("""INSERT INTO purchase_items
              (control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,?,?,?,?,?)""",(self.cid,"PED-488","AGRO INDUSTRIAL",
                "CLORETO DE POTASSIO 60 GR","t","100")).lastrowid
            report=receiving_xml.preview(con,self.cid,{
                "xml":base64.b64encode(sample(q="48",u="TO",name="KCL 60 GR")).decode()})
            self.assertEqual(report["lines"][0]["options"][0]["id"],matched)
            self.assertEqual(report["lines"][0]["options"][0]["quantity"],"48.000")
            self.assertTrue(report["lines"][0]["options"][0]["selectable"])
            self.assertIsNone(report["lines"][0]["suggested_id"])

    def test_xml_kcl_suggested_above_unrelated_supplier_orders(self):
        with app.db() as con:
            for i in range(45):
                con.execute("""INSERT INTO purchase_items
                  (control_id,order_number,supplier,product,unit,ordered_qty)
                  VALUES(?,?,?,?,?,?)""",(self.cid,f"AG-{i}","AGREX BRASIL",
                    "Assist" if i%2 else "Bright","t","100"))
            match=con.execute("""INSERT INTO purchase_items
              (control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,?,?,?,?,?)""",(self.cid,"KCL-2026","FORNECEDOR DIFERENTE",
                "Cloreto de Potássio 60 GR","t","100")).lastrowid
            report=receiving_xml.preview(con,self.cid,{
                "xml":base64.b64encode(sample(q="48",u="TON",name="KCL 60 GR")).decode()})
            self.assertEqual(report["lines"][0]["options"][0]["id"],match)
            self.assertGreater(report["lines"][0]["options"][0]["product_score"],.8)
            self.assertTrue(report["lines"][0]["options"][0]["selectable"])
            self.assertFalse(report["lines"][0]["options"][0]["eligible"])
            # Fornecedor diferente: aparece como sugestão, sem lançar sozinho.
            self.assertIsNone(report["lines"][0]["suggested_id"])

    def test_similar_xml_product_with_incompatible_unit_is_visible_but_blocked(self):
        with app.db() as con:
            mismatch=con.execute("""INSERT INTO purchase_items
              (control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,?,?,?,?,?)""",(self.cid,"KCL-UN","AGREX BRASIL",
                "KCL 60 GR","L","500")).lastrowid
            report=receiving_xml.preview(con,self.cid,{
                "xml":base64.b64encode(sample(q="48",u="TON",name="KCL 60 GR")).decode()})
            option=next(x for x in report["lines"][0]["options"] if x["id"]==mismatch)
            self.assertFalse(option["selectable"])
            self.assertEqual(option["reason"],"Unidade incompatível")
            self.assertFalse(option["eligible"])

    def test_manual_quantity_equivalence_is_required_and_audited(self):
        raw=base64.b64encode(sample(q="200",u="SC")).decode()
        with app.db() as con:
            target=con.execute("""INSERT INTO purchase_items
              (control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,?,?,?,?,?)""",(self.cid,"SC-200","AGREX BRASIL",
                "UREIA AGRICOLA","kg","5000")).lastrowid

        # O sistema não deve adivinhar equivalência de sacas com kg.
        for conversion,error in [
            (None,"equivalem"),("0","quantidade positiva"),("5001","saldo disponível"),
            ("1.1234","três casas"),("texto","Quantidade")
        ]:
            payload={"xml":raw,"selections":[target]}
            if conversion is not None:payload["manual_quantities"]=[conversion]
            with self.assertRaisesRegex(ValueError,error):
                with app.db() as con:
                    receiving_xml.confirm(con,self.cid,payload)
        with app.db() as con:
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],0)

        with app.db() as con:
            result=receiving_xml.confirm(con,self.cid,{
                "xml":raw,"selections":[target],"manual_quantities":["400,500"]})
            self.assertEqual(result,{"inserted":1,"pending":0})
            note=receiving.summary(con,self.cid)["receipts"][0]
            self.assertEqual(note["received_qty"],"400.500")
            self.assertIn("Conversão manual: 200.000 SC = 400.500 kg",note["notes"])
            self.assertEqual(note["access_key"],"1"*44)
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],1)

    def test_manual_conversion_does_not_override_known_units(self):
        raw=base64.b64encode(sample()).decode()
        with self.assertRaisesRegex(ValueError,"conversão automática"):
            with app.db() as con:
                receiving_xml.confirm(con,self.cid,{
                    "xml":raw,"selections":[self.iid],"manual_quantities":["1"]})

    def test_pending_manual_equivalence_and_capacity(self):
        raw=base64.b64encode(sample(q="200",u="SC")).decode()
        with app.db() as con:
            receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":["pending"]})
            pending=receiving_xml.pending_list(con,self.cid)[0]
            target=con.execute("""INSERT INTO purchase_items
              (control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,?,?,?,?,?)""",(self.cid,"SC-201","AGREX BRASIL",
                "UREIA AGRICOLA","kg","500")).lastrowid
        for manual,expected in [(None,"equivalem"),("600","saldo"),("0","quantidade positiva")]:
            with self.assertRaisesRegex(ValueError,expected):
                with app.db() as con:
                    receiving_xml.assign_pending(con,self.cid,pending["id"],{
                        "item_id":target,"manual_quantity":manual})
        with app.db() as con:
            self.assertEqual(len(receiving_xml.pending_list(con,self.cid)),1)
            receiving_xml.assign_pending(con,self.cid,pending["id"],{
                "item_id":target,"manual_quantity":"350,500"})
            self.assertEqual(len(receiving_xml.pending_list(con,self.cid)),0)
            receipt=receiving.summary(con,self.cid)["receipts"][0]
            self.assertEqual(receipt["received_qty"],"350.500")
            self.assertIn("Conversão manual: 200.000 SC = 350.500 kg",receipt["notes"])

    def test_mixed_invoice_pending_and_later_assign(self):
        xml=sample().decode().replace("</infNFe>", """
<det nItem="2"><prod><cProd>789</cProd><xProd>OUTRO PRODUTO</xProd><uCom>KG</uCom><qCom>500</qCom></prod></det>
</infNFe>""")
        raw=base64.b64encode(xml.encode()).decode()
        with app.db() as con:
            result=receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":[self.iid,"pending"]})
            self.assertEqual(result,{"inserted":1,"pending":1})
            pending=receiving_xml.pending_list(con,self.cid)
            self.assertEqual(len(pending),1)
            another=con.execute("""INSERT INTO purchase_items
              (control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,?,?,?,?,?)""",(self.cid,"45022014","AGREX BRASIL","OUTRO PRODUTO","kg","1000")).lastrowid
            con.commit()
            self.assertTrue(receiving_xml.assign_pending(con,self.cid,pending[0]["id"],{"item_id":another})["ok"])
            self.assertEqual(receiving_xml.pending_list(con,self.cid),[])
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],2)

    def test_same_access_key_cannot_be_imported_into_different_order(self):
        raw=base64.b64encode(sample()).decode()
        with app.db() as con:
            second=con.execute("""INSERT INTO purchase_items
              (control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,?,?,?,?,?)""",(self.cid,"OUTRO-999","AGREX BRASIL","UREIA AGRICOLA","t","30")).lastrowid
            con.commit()
            receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":[self.iid]})
            with self.assertRaisesRegex(ValueError,"duplicada"):
                receiving_xml.preview(con,self.cid,{"xml":raw})
            with self.assertRaisesRegex(ValueError,"duplicada"):
                receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":[second]})
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],1)

    def test_pending_invoice_routes_list_and_assign_saved_note(self):
        """A API real deve listar a NF-e sem pedido e permitir vinculá-la."""
        class DummyHandler:
            def __init__(self,payload=None):
                self.payload=payload or {}
            def input(self,**kwargs):
                return self.payload
            def send(self,data,*args,**kwargs):
                return data

        raw=base64.b64encode(sample()).decode()
        with app.db() as con:
            confirmed=receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":["pending"]})
            self.assertEqual(confirmed,{"inserted":0,"pending":1})
            listing=receiving_xml.handle(
                DummyHandler(),con,"GET",
                f"/api/controls/{self.cid}/receiving/xml/pending")
            self.assertEqual(len(listing["items"]),1)
            note=listing["items"][0]
            self.assertEqual(note["invoice_number"],"34567")
            self.assertEqual(note["product"],"UREIA AGRICOLA")
            self.assertEqual(note["access_key"],"1"*44)
            result=receiving_xml.handle(
                DummyHandler({"item_id":self.iid}),con,"POST",
                f"/api/controls/{self.cid}/receiving/xml/pending/{note['id']}/assign")
            self.assertEqual(result,{"ok":True})
            after=receiving_xml.handle(
                DummyHandler(),con,"GET",
                f"/api/controls/{self.cid}/receiving/xml/pending")
            self.assertEqual(after["items"],[])
            order=receiving.summary(con,self.cid)
            self.assertEqual(order["totals"]["receipts"],1)
            self.assertEqual(order["receipts"][0]["access_key"],"1"*44)
            self.assertEqual(order["receipts"][0]["invoice_number"],"34567")

    def test_pending_access_key_blocks_reimport_even_if_order_differs(self):
        raw=base64.b64encode(sample()).decode()
        with app.db() as con:
            result=receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":["pending"]})
            self.assertEqual(result["pending"],1)
            with self.assertRaisesRegex(ValueError,"duplicada"):
                receiving_xml.confirm(con,self.cid,{"xml":raw,"selections":[self.iid]})
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],0)
            self.assertEqual(len(receiving_xml.pending_list(con,self.cid)),1)

    def test_external_entities_rejected(self):
        with self.assertRaisesRegex(ValueError,"XML"):
            receiving_xml.parse(b'<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><foo>&x;</foo>')

if __name__=="__main__":unittest.main()
