"""Regressão para regras manuais de emitente por produto no Recebimentos."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

import app

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"deploy"/"vps"/"CORRIGIR_PRODUTOS_EMITENTES.py"
spec=importlib.util.spec_from_file_location("corrigir_produtos_emitentes",SCRIPT)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class CorrigirProdutoEmitenteTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.prev=(app.DATA,app.DB)
        app.DATA=Path(self.temp.name)
        app.DB=app.DATA/"teste.sqlite"
        app.initialize()
        with app.db() as con:
            self.control=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'Recebimentos','recebimento','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls
                (board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'Não é recebimento','calculo','[]','[]','[]')""").lastrowid
            self.receipts={}
            def create(product,issuer="",control_id=None):
                control_id=self.control if control_id is None else control_id
                item=con.execute("""INSERT INTO purchase_items
                    (control_id,order_number,supplier,product,unit,ordered_qty)
                    VALUES(?,?,?,?,?,?)""",
                    (control_id,"PED-1","Fornecedor do pedido",product,"t","300")).lastrowid
                rec=con.execute("""INSERT INTO purchase_receipts
                    (item_id,received_date,invoice_number,access_key,invoice_issuer,
                     invoice_issuer_document,received_qty,notes)
                    VALUES(?,?,?,?,?,?,?,?)""",
                    (item,"2026-11-05",str(item),"1"*44,issuer,
                     "01234567890123","18.000","Nota original")).lastrowid
                self.receipts[(product,control_id)]=rec
            create("KCL 00-00-60","Emissor anterior")
            create(" kcl 00-00-60  ","EUROCHEIM")
            create("CALCARIO CALCITICO","Fornecedor incorreto")
            create("GESSO AGRÍCOLA")
            create("CALCÁRIO E GESSO","CALTINS CALCARIO TOCATINS LTDA")
            create("FERTILIZANTE KCL 00-00-60 GRANULADO")
            create("CALCARIOX","Não alterar")
            create("KCL 00-00-50","Não alterar")
            create("GESSO", "Não alterar outro controle",self.other)
            self.before={r["id"]:dict(r) for r in
                         con.execute("SELECT * FROM purchase_receipts")}
            self.supplier_before=[dict(r) for r in con.execute(
                "SELECT id,supplier,product FROM purchase_items ORDER BY id")]

    def tearDown(self):
        app.DATA,app.DB=self.prev
        self.temp.cleanup()

    def test_match_names_and_accents(self):
        self.assertEqual(mod.emitente_por_produto("KCL 00-00-60"),"EUROCHEIM")
        self.assertEqual(mod.emitente_por_produto("calCário"),"CALTINS CALCARIO TOCATINS LTDA")
        self.assertEqual(mod.emitente_por_produto("GESSO AGRÍCOLA"),"CALTINS CALCARIO TOCATINS LTDA")
        self.assertEqual(mod.emitente_por_produto("calcario e gesso"),"CALTINS CALCARIO TOCATINS LTDA")
        self.assertIsNone(mod.emitente_por_produto("CALCARIOX"))
        self.assertIsNone(mod.emitente_por_produto("KCL 00-00-50"))
        self.assertIsNone(mod.emitente_por_produto("S9"))

    def test_diagnostico_nao_altera_registros(self):
        with app.db() as con:
            preview=mod.corrigir(con,aplicar=False)
            self.assertEqual(preview["notas_encontradas"],6)
            self.assertEqual(preview["notas_a_corrigir"],4)
            self.assertEqual(preview["notas_ja_corretas"],2)
            self.assertEqual(preview["notas_alteradas"],0)
            atual={r["id"]:dict(r) for r in con.execute("SELECT * FROM purchase_receipts")}
            self.assertEqual(atual,self.before)

    def test_update_somente_emitente_existente(self):
        with app.db() as con:
            resultado=mod.corrigir(con,aplicar=True)
            self.assertEqual(resultado["notas_alteradas"],4)
            after={r["id"]:dict(r) for r in con.execute("SELECT * FROM purchase_receipts")}
            self.assertEqual(len(after),len(self.before))
            for (prod,control),rid in self.receipts.items():
                original=self.before[rid]
                final=after[rid]
                for field in ("id","item_id","received_date","invoice_number",
                              "access_key","invoice_issuer_document","received_qty","notes"):
                    self.assertEqual(final[field],original[field])
                expected=mod.emitente_por_produto(prod) if control==self.control else None
                self.assertEqual(final["invoice_issuer"],
                                 expected if expected else original["invoice_issuer"])
            suppliers=[dict(r) for r in con.execute(
                "SELECT id,supplier,product FROM purchase_items ORDER BY id")]
            self.assertEqual(suppliers,self.supplier_before)
            again=mod.corrigir(con,aplicar=True)
            self.assertEqual(again["notas_alteradas"],0)
            self.assertEqual(again["notas_ja_corretas"],6)

    def test_zero_matched_aborts_apply(self):
        with app.db() as con:
            con.execute("DELETE FROM purchase_receipts")
            with self.assertRaisesRegex(RuntimeError,"Nenhuma NF-e existente"):
                mod.corrigir(con,aplicar=True)


if __name__=="__main__":
    unittest.main()
