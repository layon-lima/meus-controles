"""Importação local de pedidos com notas/recebimentos inicialmente vazios."""
import tempfile
from pathlib import Path
import unittest
import app
import receiving
import receiving_import

def sample(name="RECEBIMENTO DE DEFENSIVOS"):
    return {
      "format":"central-controles-recebimento-v1",
      "control":name,
      "items":[
        {"order_number":"00181030 / 00249394","supplier":"",
         "product":"UNIZEB GOLD 15KG","unit":"KG","ordered_qty":"14700.00"},
        {"order_number":"00181030 / 00249394","supplier":"",
         "product":"UNIZEB GOLD 15KG","unit":"KG","ordered_qty":"7350.00"},
        {"order_number":"00184796 / 00250412","supplier":"",
         "product":"MIB BORO 8% K GRAN BG 1000KG","unit":"KG","ordered_qty":"123000.00"},
        {"order_number":"00181112 / 00244765","supplier":"",
         "product":"FERT KCL 00.00.60 BB","unit":"TON","ordered_qty":"1225.00"},
      ]
    }

class ReceivingImportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.before=(app.DATA,app.DB)
        app.DATA=Path(self.temp.name)
        app.DB=app.DATA/"import.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'RECEBIMENTO DE DEFENSIVOS','recebimento','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'OUTRO RECEBIMENTO','recebimento','[]','[]','[]')""").lastrowid
    def tearDown(self):
        app.DATA,app.DB=self.before
        self.temp.cleanup()

    def test_preview_does_not_write_and_keeps_zero_receipts(self):
        with app.db() as con:
            info=receiving_import.preview(con,self.cid,sample())
            self.assertEqual(info["count"],4)
            self.assertEqual(info["new_count"],4)
            self.assertEqual(info["unknown_suppliers"],4)
            self.assertEqual(info["items_by_unit"],{"KG":3,"TON":1})
            self.assertTrue(info["can_import"])
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],0)

    def test_import_keeps_duplicates_separate_and_preserves_identifiers(self):
        with app.db() as con:
            pre=receiving_import.preview(con,self.cid,sample())
            result=receiving_import.confirm(con,self.cid,sample(),pre["fingerprint"])
            self.assertEqual(result["imported"],4)
        with app.db() as con:
            status=receiving.summary(con,self.cid)
            self.assertEqual(status["totals"],
                {"items":4,"complete":0,"partial":0,"pending":4,"receipts":0})
            self.assertTrue(all(item["supplier"]=="" for item in status["items"]))
            self.assertTrue(all(item["received_qty"]=="0.000" for item in status["items"]))
            self.assertTrue(all(item["remaining_qty"]==item["ordered_qty"] for item in status["items"]))
            unizeb=[x for x in status["items"] if x["product"]=="UNIZEB GOLD 15KG"]
            self.assertEqual(len(unizeb),2)
            self.assertEqual(sorted(x["ordered_qty"] for x in unizeb),["14700.000","7350.000"])
            self.assertTrue(all(x["order_number"]=="00181030 / 00249394" for x in unizeb))

    def test_reimport_same_file_does_not_duplicate(self):
        with app.db() as con:
            p=receiving_import.preview(con,self.cid,sample())
            receiving_import.confirm(con,self.cid,sample(),p["fingerprint"])
        with app.db() as con:
            p=receiving_import.preview(con,self.cid,sample())
            self.assertTrue(p["already_imported"])
            self.assertEqual(p["new_count"],0)
            result=receiving_import.confirm(con,self.cid,sample(),p["fingerprint"])
            self.assertEqual(result["imported"],0)
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],4)

    def test_existing_manual_products_are_skipped_without_overwriting(self):
        with app.db() as con:
            first=sample()["items"][0]
            con.execute("""INSERT INTO purchase_items(control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",(self.cid,*(
                first[k] for k in ("order_number","supplier","product","unit","ordered_qty"))))
            p=receiving_import.preview(con,self.cid,sample())
            self.assertEqual(p["matched"],1)
            self.assertEqual(p["new_count"],3)
            receiving_import.confirm(con,self.cid,sample(),p["fingerprint"])
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],4)

    def test_identical_duplicate_rows_use_multiset_counts(self):
        doc=sample()
        doc["items"][1]=dict(doc["items"][0])
        with app.db() as con:
            p=receiving_import.preview(con,self.cid,doc)
            receiving_import.confirm(con,self.cid,doc,p["fingerprint"])
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],4)
            self.assertEqual(sum(1 for x in receiving.summary(con,self.cid)["items"] if
                x["product"]=="UNIZEB GOLD 15KG"),2)

    def test_wrong_control_invalid_quantity_and_changed_fingerprint(self):
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"pertence ao controle"):
                receiving_import.preview(con,self.other,sample())
            bad=sample()
            bad["items"][0]["ordered_qty"]="0"
            with self.assertRaises(ValueError):
                receiving_import.preview(con,self.cid,bad)
            with self.assertRaisesRegex(ValueError,"diferente da prévia"):
                receiving_import.confirm(con,self.cid,sample(),"abc")
            self.assertEqual(receiving.summary(con,self.cid)["totals"]["items"],0)

if __name__=="__main__":
    unittest.main()
