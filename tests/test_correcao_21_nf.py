"""Ensaios da correção manual de 21 NF-e, sem inserir ou mudar lançamentos."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

import app

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"deploy"/"vps"/"CORRIGIR_21_NFS.py"
spec=importlib.util.spec_from_file_location("corrigir21",SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Correcao21NFTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.old=(app.DATA,app.DB)
        app.DATA=Path(self.temp.name)
        app.DB=app.DATA/"teste.sqlite"
        app.initialize()
        with app.db() as con:
            self.control=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'Recebimentos','recebimento','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'Outro','calculo','[]','[]','[]')""").lastrowid
            self.item=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",(
                    self.control,"PED-123","FORNECEDOR DO PEDIDO","Produto","t","400")).lastrowid
            self.other_item=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",(
                    self.other,"PED-456","FORNECEDOR EM OUTRO CONTROLE","Produto","t","400")).lastrowid
            self.ids={}
            for number,issuer,item in [
                ("40704","Errado",self.item),
                ("40.544","",self.item),
                ("48463","Outro nome",self.item),
                ("3911","Motta Agropecuária LTDA",self.item),
                ("48363","",self.item),
                ("999999","NÃO ALTERAR",self.item),
                ("40704","NÃO MEXER OUTRO CONTROLE",self.other_item),
            ]:
                rid=con.execute("""INSERT INTO purchase_receipts
                    (item_id,received_date,invoice_number,access_key,
                     invoice_issuer,received_qty,notes)
                    VALUES(?,?,?,?,?,?,?)""",(
                        item,"2026-11-05",number,"1"*44,issuer,"23.000",
                        "Observação original")).lastrowid
                self.ids[(number,item)]=rid
            self.before=[dict(r) for r in con.execute("SELECT * FROM purchase_receipts ORDER BY id")]

    def tearDown(self):
        app.DATA,app.DB=self.old
        self.temp.cleanup()

    def test_exactly_twenty_one_numbers_and_original_names(self):
        self.assertEqual(len(module.EMITENTES),21)
        self.assertEqual(module.EMITENTES["40558"],"Agro Industrial São Luiz LTDA")
        self.assertEqual(module.EMITENTES["48363"],"Mosaic Fertilizantes do Brasil LTDA")
        self.assertEqual(module.EMITENTES["3800"],"Motta Agropecuária LTDA")
        self.assertNotIn("48478",module.EMITENTES)
        self.assertEqual(module.numero_nf("40.544"),"40544")
        self.assertEqual(module.numero_nf("00040704"),"40704")
        self.assertIsNone(module.numero_nf("2,12611E+43"))

    def test_preview_does_not_modify_anything(self):
        with app.db() as con:
            outcome=module.conciliar(con,aplicar=False)
            self.assertEqual(outcome["pendentes_de_atualizacao"],4)
            self.assertEqual(outcome["registros_alterados"],0)
            self.assertEqual(outcome["ja_corretos"],1)
            self.assertEqual(outcome["numeros_encontrados"],5)
            self.assertEqual([dict(r) for r in con.execute(
                "SELECT * FROM purchase_receipts ORDER BY id")],self.before)

    def test_apply_replaces_existing_issuer_but_only_in_receivings(self):
        with app.db() as con:
            result=module.conciliar(con,aplicar=True)
            self.assertEqual(result["registros_alterados"],4)
            rows={r["id"]:dict(r) for r in con.execute("SELECT * FROM purchase_receipts")}
            for old in self.before:
                now=rows[old["id"]]
                for field in ("item_id","received_date","invoice_number","access_key",
                              "received_qty","notes","created_at"):
                    self.assertEqual(now[field],old[field])
            self.assertEqual(rows[self.ids[("40704",self.item)]]["invoice_issuer"],
                             "Agro Industrial São Luiz LTDA")
            self.assertEqual(rows[self.ids[("40.544",self.item)]]["invoice_issuer"],
                             "Agro Industrial São Luiz LTDA")
            self.assertEqual(rows[self.ids[("48463",self.item)]]["invoice_issuer"],
                             "Mosaic Fertilizantes do Brasil LTDA")
            self.assertEqual(rows[self.ids[("48363",self.item)]]["invoice_issuer"],
                             "Mosaic Fertilizantes do Brasil LTDA")
            self.assertEqual(rows[self.ids[("999999",self.item)]]["invoice_issuer"],
                             "NÃO ALTERAR")
            self.assertEqual(rows[self.ids[("40704",self.other_item)]]["invoice_issuer"],
                             "NÃO MEXER OUTRO CONTROLE")
            supplier=con.execute("SELECT supplier FROM purchase_items WHERE id=?",
                                 (self.item,)).fetchone()["supplier"]
            self.assertEqual(supplier,"FORNECEDOR DO PEDIDO")
            self.assertEqual(con.execute("SELECT COUNT(*) AS c FROM purchase_receipts")
                             .fetchone()["c"],len(self.before))
            again=module.conciliar(con,aplicar=True)
            self.assertEqual(again["registros_alterados"],0)
            self.assertEqual(again["ja_corretos"],5)

    def test_no_matching_receipts_aborts(self):
        with app.db() as con:
            con.execute("DELETE FROM purchase_receipts")
            with self.assertRaisesRegex(RuntimeError,"NENHUMA"):
                module.conciliar(con,aplicar=True)
            self.assertEqual(con.execute("SELECT COUNT(*) AS c FROM purchase_receipts")
                             .fetchone()["c"],0)


if __name__=="__main__":
    unittest.main()
