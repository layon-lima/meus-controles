"""Teste do controle de recebimento: pedidos, notas fiscais e saldos."""
import tempfile
from pathlib import Path
from decimal import Decimal
import unittest

import app
import receiving

class ReceivingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.saved=(app.DATA,app.DB)
        app.DATA=Path(self.tmp.name)
        app.DB=app.DATA/"receiving.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls
              (board_id,name,mode,fields_json,rules_json,types_json)
              VALUES(1,'RECEBIMENTO','recebimento','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls
              (board_id,name,mode,fields_json,rules_json,types_json)
              VALUES(1,'OUTRO RECEBIMENTO','recebimento','[]','[]','[]')""").lastrowid

    def tearDown(self):
        app.DATA,app.DB=self.saved
        self.tmp.cleanup()

    def item(self,product="Adubo",ordered="1000",unit="kg",cid=None,order="PED-123"):
        with app.db() as con:
            cid=cid or self.cid
            p=receiving.validate_item({
                "order_number":order,"supplier":"Fornecedor A",
                "product":product,"unit":unit,"ordered_qty":ordered
            })
            return con.execute("""INSERT INTO purchase_items
              (control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,?,?,?,?,?)""",(cid,*p.values())).lastrowid

    def deliver(self,item_id,invoice="NF-101",value="400",date="2026-10-12"):
        with app.db() as con:
            p=receiving.validate_receipt({
                "date":date,"invoice_number":invoice,"quantity":value,"notes":"Conferido"})
            receiving.ensure_capacity(con,item_id,p["received_qty"])
            receiving.ensure_not_duplicate(con,item_id,p)
            return con.execute("""INSERT INTO purchase_receipts
              (item_id,received_date,invoice_number,received_qty,access_key,notes)
              VALUES(?,?,?,?,?,?)""",
              (item_id,p["received_date"],p["invoice_number"],p["received_qty"],p["access_key"],p["notes"])).lastrowid

    def test_partial_receipts_by_invoice_reduce_balance(self):
        item=self.item()
        self.deliver(item,"NF-100","400")
        self.deliver(item,"NF-101","250")
        with app.db() as con:
            view=receiving.summary(con,self.cid)
            product=view["items"][0]
            self.assertEqual(product["ordered_qty"],"1000.000")
            self.assertEqual(product["received_qty"],"650.000")
            self.assertEqual(product["remaining_qty"],"350.000")
            self.assertEqual(product["status"],"partial")
            self.assertEqual(product["receipts_count"],2)
            self.assertEqual(view["totals"],{"items":1,"complete":0,"partial":1,"pending":0,"receipts":2})
            self.assertEqual([x["invoice_number"] for x in view["receipts"]],["NF-101","NF-100"])

    def test_completes_order_without_affecting_other_product_or_supplier(self):
        first=self.item("Adubo","10","t")
        self.item("Semente","800","sc")
        self.deliver(first,"NF-200","10")
        with app.db() as con:
            view=receiving.summary(con,self.cid)
            products={x["product"]:x for x in view["items"]}
            self.assertEqual(products["Adubo"]["status"],"complete")
            self.assertEqual(products["Adubo"]["remaining_qty"],"0.000")
            self.assertEqual(products["Semente"]["status"],"pending")
            self.assertEqual(view["totals"]["complete"],1)
            self.assertEqual(view["totals"]["pending"],1)

    def test_exceeding_remaining_quantity_is_rejected(self):
        item=self.item()
        self.deliver(item,"NF-100","900")
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"Disponível: 100.000 kg"):
                receiving.ensure_capacity(con,item,"100.001")
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],1)

    def test_receipt_edit_and_delete_recalculate(self):
        item=self.item(ordered="100")
        rid=self.deliver(item,"NF-101","30")
        with app.db() as con:
            receiving.ensure_capacity(con,item,"70",rid)
            values=receiving.validate_receipt({
                "date":"2026-10-11","invoice_number":"NF-102","quantity":"70","notes":""})
            con.execute("""UPDATE purchase_receipts SET received_date=?,invoice_number=?,received_qty=?,access_key=?,notes=?
                 WHERE id=?""",
                 (values["received_date"],values["invoice_number"],values["received_qty"],
                  values["access_key"],values["notes"],rid))
            self.assertEqual(receiving.summary(con,self.cid)["items"][0]["remaining_qty"],"30.000")
            con.execute("DELETE FROM purchase_receipts WHERE id=?",(rid,))
            self.assertEqual(receiving.summary(con,self.cid)["items"][0]["remaining_qty"],"100.000")

    def test_same_invoice_is_blocked_even_if_date_or_quantity_changes(self):
        item=self.item()
        rid=self.deliver(item,"NF-100","400")
        with app.db() as con:
            repeated=receiving.validate_receipt({
                "date":"2026-10-13","invoice_number":" nf-100 ","quantity":"100","notes":""})
            with self.assertRaisesRegex(ValueError,"nota fiscal .*já foi lançada no pedido PED-123"):
                receiving.ensure_not_duplicate(con,item,repeated)
            # Regravar a própria NF em edição é permitido.
            receiving.ensure_not_duplicate(con,item,repeated,exclude_id=rid)
            self.assertEqual(receiving.summary(con,self.cid)["items"][0]["received_qty"],"400.000")

    def test_invoice_cannot_repeat_across_products_of_same_order(self):
        first=self.item("Adubo")
        second=self.item("Semente",ordered="500")
        self.deliver(first,"2284","40")
        with app.db() as con:
            new_receipt=receiving.validate_receipt({
                "date":"2026-10-11","invoice_number":"002284","quantity":"75","notes":""})
            with self.assertRaisesRegex(ValueError,"nota fiscal .*já foi lançada no pedido PED-123"):
                receiving.ensure_not_duplicate(con,second,new_receipt)
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],1)

    def test_same_invoice_can_be_used_in_different_orders_or_controls(self):
        first=self.item("Adubo")
        different_order=self.item("Semente",ordered="400",order="PED-456")
        different_control=self.item("Calcário",ordered="200",cid=self.other)
        self.deliver(first,"2284","100")
        self.deliver(different_order,"002284","50")
        self.deliver(different_control,"2284","20")
        with app.db() as con:
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],2)
            self.assertEqual(receiving.summary(con,self.other)["totals"]["receipts"],1)

    def test_invoice_number_normalization(self):
        self.assertEqual(receiving.normalized_invoice(" 002284 "),receiving.normalized_invoice("2284"))
        self.assertEqual(receiving.normalized_invoice(" nf-2284 "),receiving.normalized_invoice("NF-2284"))
        self.assertEqual(receiving.normalized_order("ABC / 123"),receiving.normalized_order("abc/123"))

    def test_http_receipt_create_edit_and_order_move_do_not_bypass_lock(self):
        class Handler:
            def __init__(self,p):self.payload=p
            def input(self):return self.payload
            def send(self,result,status=200):return result
        item1=self.item("Adubo",ordered="1000")
        item2=self.item("Semente",ordered="500")
        item3=self.item("Calcário",ordered="700",order="PED-456")
        self.deliver(item3,"2284","35")
        with app.db() as con:
            first=receiving.handle(Handler({"date":"2026-10-10","invoice_number":"2284",
                "quantity":"100"}),con,"POST","/api/receiving-items/"+str(item1)+"/receipts")
            duplicate={"date":"2026-10-11","invoice_number":"002284","quantity":"50"}
            with self.assertRaisesRegex(ValueError,"já foi lançada no pedido PED-123"):
                receiving.handle(Handler(duplicate),con,"POST",
                                 "/api/receiving-items/"+str(item2)+"/receipts")
        # A transação anterior falhou; conexão nova permite continuar sem gravar duplicata.
        with app.db() as con:
            second=receiving.handle(Handler({"date":"2026-10-11","invoice_number":"777",
                "quantity":"50"}),con,"POST","/api/receiving-items/"+str(item2)+"/receipts")
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"já foi lançada no pedido PED-123"):
                receiving.handle(Handler({"date":"2026-10-12","invoice_number":"2284",
                    "quantity":"20"}),con,"PUT","/api/receiving-receipts/"+str(second["id"]))
        with app.db() as con:
            self.assertEqual(receiving.get_receipt(con,second["id"])["invoice_number"],"777")
            # Editar um item para entrar no pedido de uma NF idêntica também deve ser bloqueado.
            with self.assertRaisesRegex(ValueError,"já foi lançada no pedido PED-123"):
                receiving.handle(Handler({"order_number":"PED-123","supplier":"Fornecedor A",
                    "product":"Calcário","unit":"kg","ordered_qty":"700"}),con,
                    "PUT","/api/receiving-items/"+str(item3))
        # Manter íntegros os saldos e as notas anteriores.
        with app.db() as con:
            self.assertEqual(receiving.get_item(con,item3)["order_number"],"PED-456")
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],3)
            self.assertEqual(receiving.get_receipt(con,second["id"])["invoice_number"],"777")

    def test_cannot_reduce_order_below_received(self):
        item=self.item()
        self.deliver(item,value="750")
        with app.db() as con:
            proposed=receiving.validate_item({
                "order_number":"PED-123","supplier":"Fornecedor A",
                "product":"Adubo","unit":"kg","ordered_qty":"749.999"})
            self.assertLess(Decimal(proposed["ordered_qty"]),receiving.received_total(con,item))
            self.assertEqual(receiving.summary(con,self.cid)["items"][0]["ordered_qty"],"1000.000")

    def test_supplier_names_reuse_existing_spelling_without_fuzzy_merge(self):
        class Handler:
            def __init__(self,payload):self.payload=payload
            def input(self):return self.payload
            def send(self,result,status=200):return result

        # O nome canônico deve ficar restrito a cada controle.
        initial=self.item("Adubo original",order="PED-1")
        with app.db() as con:
            self.assertEqual(receiving.supplier_key(" FÓRNECEDOR   A "),
                             receiving.supplier_key("fornecedor a"))
            self.assertEqual(receiving.canonical_supplier(con,self.cid,"fórnecedor a"),
                             "Fornecedor A")
            self.assertEqual(receiving.canonical_supplier(con,self.other,"fórnecedor a"),
                             "fórnecedor a")
            new=receiving.handle(Handler({
                "order_number":"PED-2","supplier":"  FÓRNECEDOR    Á ",
                "product":"Semente","unit":"kg","ordered_qty":"10"}),con,
                "POST","/api/controls/"+str(self.cid)+"/receiving/items")
            self.assertEqual(receiving.get_item(con,new["id"])["supplier"],"Fornecedor A")
        with app.db() as con:
            distinct=receiving.handle(Handler({
                "order_number":"PED-3","supplier":"Fornecedor AB",
                "product":"Óleo","unit":"L","ordered_qty":"20"}),con,
                "POST","/api/controls/"+str(self.cid)+"/receiving/items")
            self.assertEqual(receiving.get_item(con,distinct["id"])["supplier"],"Fornecedor AB")
        with app.db() as con:
            receiving.handle(Handler({
                "order_number":"PED-3","supplier":"  fornecedor á ",
                "product":"Óleo","unit":"L","ordered_qty":"20"}),con,
                "PUT","/api/receiving-items/"+str(distinct["id"]))
            self.assertEqual(receiving.get_item(con,distinct["id"])["supplier"],"Fornecedor A")
            self.assertEqual(receiving.get_item(con,initial)["supplier"],"Fornecedor A")
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],3)

    def test_bulk_delete_is_atomic_and_blocks_receipts(self):
        class Handler:
            def __init__(self,payload):self.payload=payload
            def input(self):return self.payload
            def send(self,result,status=200):return result
        free_a=self.item("Adubo")
        delivered=self.item("Produto recebido")
        free_b=self.item("Semente")
        self.deliver(delivered)
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"entregas registradas"):
                receiving.handle(Handler({"ids":[free_a,delivered,free_b]}),con,
                                 "POST","/api/controls/"+str(self.cid)+"/receiving/bulk-delete")
        with app.db() as con:
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],3)
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],1)

    def test_bulk_delete_scopes_control_and_validates_selection(self):
        class Handler:
            def __init__(self,payload):self.payload=payload
            def input(self):return self.payload
            def send(self,result,status=200):return result
        a=self.item("Adubo")
        b=self.item("Semente")
        other=self.item("Outro controle",cid=self.other)
        url="/api/controls/"+str(self.cid)+"/receiving/bulk-delete"
        for ids in ([a,other],[a,a],[a,999999],[],[True],[a,"2"]):
            with app.db() as con:
                with self.assertRaises(ValueError):
                    receiving.handle(Handler({"ids":ids}),con,"POST",url)
        with app.db() as con:
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],2)
            self.assertEqual(receiving.summary(con,self.other)["totals"]["items"],1)
            result=receiving.handle(Handler({"ids":[a,b]}),con,"POST",url)
            self.assertEqual(result,{"deleted":2})
        with app.db() as con:
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],0)
            self.assertEqual(receiving.summary(con,self.other)["items"][0]["id"],other)

    def test_cannot_delete_item_with_receipts(self):
        item=self.item()
        self.deliver(item)
        with app.db() as con:
            self.assertGreater(receiving.received_total(con,item),0)
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["receipts"],1)

    def test_access_key_is_optional_for_legacy_but_validates_new_key(self):
        payload={"date":"2026-10-15","invoice_number":"12345","quantity":"50"}
        self.assertEqual(receiving.validate_receipt(payload)["access_key"],"")
        key="35261012345678000190550010000123451000012345"
        self.assertEqual(len(key),44)
        self.assertEqual(receiving.validate_receipt({**payload,"access_key":key})["access_key"],key)
        self.assertEqual(receiving.validate_receipt({**payload,
            "access_key":key[:22]+" "+key[22:]})["access_key"],key)
        for bad in ("123",key[:-1],"X"*44,12345):
            with self.assertRaisesRegex(ValueError,"chave"):
                receiving.validate_receipt({**payload,"access_key":bad})

    def test_key_is_saved_read_and_updated_without_affecting_balance(self):
        class Handler:
            def __init__(self,p):self.payload=p
            def input(self):return self.payload
            def send(self,result,status=200):return result
        iid=self.item(ordered="100")
        key="35261012345678000190550010000123451000012345"
        with app.db() as con:
            row=receiving.handle(Handler({"date":"2026-10-15","invoice_number":"321",
                "quantity":"30","access_key":key}),con,"POST",
                "/api/receiving-items/"+str(iid)+"/receipts")
        with app.db() as con:
            history=receiving.summary(con,self.cid)
            self.assertEqual(history["receipts"][0]["access_key"],key)
            self.assertEqual(history["items"][0]["remaining_qty"],"70.000")
            receiving.handle(Handler({"date":"2026-10-15","invoice_number":"321",
                "quantity":"35","access_key":key,"notes":""}),con,"PUT",
                "/api/receiving-receipts/"+str(row["id"]))
        with app.db() as con:
            self.assertEqual(receiving.summary(con,self.cid)["items"][0]["remaining_qty"],"65.000")
            self.assertEqual(receiving.get_receipt(con,row["id"])["access_key"],key)

    def test_legacy_invoice_schema_migrates_without_data_loss(self):
        import sqlite3
        db=sqlite3.connect(":memory:")
        db.row_factory=sqlite3.Row
        db.execute("""CREATE TABLE purchase_receipts (
            id INTEGER PRIMARY KEY,item_id INTEGER NOT NULL,received_date TEXT NOT NULL,
            invoice_number TEXT NOT NULL,received_qty TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
        db.execute("""INSERT INTO purchase_receipts(item_id,received_date,invoice_number,received_qty,notes)
            VALUES(3,'2026-10-16','999','49.940','documento antigo')""")
        receiving.initialize(db)
        row=db.execute("SELECT * FROM purchase_receipts").fetchone()
        self.assertEqual(row["access_key"],"")
        self.assertEqual(row["invoice_number"],"999")
        self.assertEqual(row["received_qty"],"49.940")
        self.assertEqual(row["notes"],"documento antigo")
        receiving.initialize(db)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM purchase_receipts").fetchone()[0],1)
        db.close()

    def test_invalid_inputs_and_precision(self):
        for value in ["0","-1","NaN","Infinity","2.1234","bad"]:
            with self.assertRaises(ValueError):receiving.qty(value)
        self.assertEqual(receiving.display(receiving.qty("1.250,5")),"1250.500")
        with self.assertRaisesRegex(ValueError,"nota fiscal"):
            receiving.validate_receipt({"date":"2026-10-12","invoice_number":"",
                                        "quantity":"50"})
        with self.assertRaises(ValueError):
            receiving.validate_receipt({"date":"2026-02-30","invoice_number":"12","quantity":"50"})
        with self.assertRaises(ValueError):
            receiving.validate_item({"order_number":"123","supplier":"F",
                                     "product":"P","ordered_qty":"0"})

    def test_controls_are_isolated(self):
        self.item(cid=self.other,product="Adubo",ordered="500")
        self.item(cid=self.cid,product="Adubo",ordered="900")
        with app.db() as con:
            self.assertEqual(receiving.summary(con,self.cid)["items"][0]["ordered_qty"],"900.000")
            self.assertEqual(receiving.summary(con,self.other)["items"][0]["ordered_qty"],"500.000")
            self.assertEqual(app.state(con)["controls"][-1]["summary"]["item_total"],1)

    def test_api_create_and_update_using_handler(self):
        class Handler:
            def __init__(self,p):self.payload=p
            def input(self):return self.payload
            def send(self,result,status=200):return result
        with app.db() as con:
            result=receiving.handle(Handler({
              "order_number":"PED-77","supplier":"Fornecedor B","product":"Calcário",
              "ordered_qty":"1500","unit":"t"}),con,"POST",
              "/api/controls/"+str(self.cid)+"/receiving/items")
            iid=result["id"]
        with app.db() as con:
            receipt=receiving.handle(Handler({"date":"2026-10-12","invoice_number":"12345",
             "quantity":"700","notes":"NF recebida"}),con,"POST",
              "/api/receiving-items/"+str(iid)+"/receipts")
            receipt_id=receipt["id"]
        with app.db() as con:
            view=receiving.handle(Handler({}),con,"GET",
              "/api/controls/"+str(self.cid)+"/receiving")
            self.assertEqual(view["items"][0]["remaining_qty"],"800.000")
            self.assertEqual(view["receipts"][0]["invoice_number"],"12345")
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"saldo do pedido"):
                receiving.handle(Handler({"date":"2026-10-12","invoice_number":"12346",
                  "quantity":"801"}),con,"POST",
                  "/api/receiving-items/"+str(iid)+"/receipts")
        with app.db() as con:
            receiving.handle(Handler({"date":"2026-10-13","invoice_number":"12345",
             "quantity":"500"}),con,"PUT","/api/receiving-receipts/"+str(receipt_id))
        with app.db() as con:
            self.assertEqual(receiving.summary(con,self.cid)["items"][0]["remaining_qty"],"1000.000")

if __name__=="__main__":
    unittest.main()
