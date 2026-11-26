"""Funcionários: somas de holerites, vales e contas sem dupla dedução."""
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from central_admin import funcionarios as f
from central_admin import vales_holerites as v
from central_admin.server import Handler


def source_vales():
    people=[
        {"id":10,"control_id":4,"name":"JOAO DA SILVA","active":1},
        {"id":11,"control_id":4,"name":"MARIA PEREIRA","active":1},
        {"id":12,"control_id":5,"name":"PEDRO SANTOS","active":1},
    ]
    plans=[
        {"id":101,"employee_id":10,"control_id":4,"title":"Adiantamento",
         "installment_number":1,"due_month":"2026-11","amount":"300.00","paid":"0.00"},
        {"id":102,"employee_id":10,"control_id":4,"title":"Compra na fazenda",
         "installment_number":1,"due_month":"2026-11","amount":"150.00","paid":"0.00"},
        {"id":103,"employee_id":11,"control_id":4,"title":"Vale de Maria",
         "installment_number":1,"due_month":"2026-11","amount":"85.00","paid":"0.00"},
        {"id":104,"employee_id":12,"control_id":5,"title":"Vale não vinculado",
         "installment_number":1,"due_month":"2026-11","amount":"40.00","paid":"0.00"},
        {"id":105,"employee_id":10,"control_id":4,"title":"Parcela antiga",
         "installment_number":3,"due_month":"2026-10","amount":"15.00","paid":"0.00"},
    ]
    return people,plans


class DashboardTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db=Path(self.tmp.name)/"contas.db"
        self.journal=Path(self.tmp.name)/"journal.db"
        env=patch.dict(os.environ,{
            "CENTRAL_CONTAS_DB":str(self.db),
            "CENTRAL_VALES_DB":str(self.journal),
        })
        env.start();self.addCleanup(env.stop)
        with closing(sqlite3.connect(self.db)) as con:
            con.executescript("""
              CREATE TABLE holerite_funcionarios(
                id INTEGER PRIMARY KEY,nome TEXT,chave_pix TEXT);
              CREATE TABLE holerite_lancamentos(
                conta_id INTEGER PRIMARY KEY,funcionario_id INTEGER,competencia TEXT);
              CREATE TABLE contas(
                id INTEGER PRIMARY KEY,fornecedor TEXT,documento TEXT,
                referencia TEXT,observacoes TEXT,valor NUMERIC,vencimento TEXT);
              CREATE TABLE pagamentos(id INTEGER PRIMARY KEY,conta_id INTEGER,
                data_pagamento TEXT);
              INSERT INTO holerite_funcionarios VALUES
                (1,'JOAO DA SILVA','12345678900'),
                (2,'MARIA PEREIRA','maria@example.com');
              INSERT INTO contas VALUES
                (1,'JOAO DA SILVA','HOLERITE 11','','',2550,'2026-11-30'),
                (2,'MARIA PEREIRA','HOLERITE 11','','',2100,'2026-11-30'),
                (3,'MARIA PEREIRA','HOLERITE PAGO','','',1600,'2026-11-10'),
                (4,'JOAO DA SILVA','Reembolso','','',99,'2026-11-19'),
                (5,'SUPERMERCADO ABC','Compra','','',120,'2026-11-22'),
                (6,'FORNECEDOR EXTERNO','Conta normal','','',1000,'2026-11-25'),
                (7,'JOAO DA SILVA','Holerite anterior','','',1800,'2026-10-30');
              INSERT INTO holerite_lancamentos VALUES
                (1,1,'2026-11'),(2,2,'2026-11'),(3,2,'2026-11'),(7,1,'2026-10');
              INSERT INTO pagamentos VALUES(1,3,'2026-11-11'),(2,7,'2026-11-01');
            """)
            con.commit()
        fake=patch.object(v,"read_controls",side_effect=source_vales)
        fake.start();self.addCleanup(fake.stop)
        with closing(v.journal()) as con:
            con.execute("INSERT INTO staff_links(vale_employee_id,contas_employee_id) VALUES(10,1),(11,2)")
            for installment,amt in ((101,"300.00"),(102,"150.00")):
                con.execute("""INSERT INTO discounts(
                    account_id,vale_installment_id,control_id,employee_id,
                    competence,original_amount,amount,status)
                    VALUES(1,?,?,1,'2026-11','3000.00',?,'reserved')""",
                    (installment,4,amt))

    def test_totals_no_double_discounts(self):
        report=f.dashboard("2026-11")
        k=report["indicadores"]
        self.assertEqual(k["funcionarios"],3)
        self.assertEqual(k["funcionarios_com_pagamentos"],2)
        self.assertEqual(k["holerites_mes"],3)
        self.assertEqual(k["holerites_pendentes_mes"],2)
        self.assertEqual(k["holerites_pagos_mes"],1)
        self.assertEqual(k["total_a_pagar"],"4650.00")
        self.assertEqual(k["total_holerites_pendentes"],"4650.00")
        self.assertEqual(k["total_outras_contas_pendentes"],"0.00")
        # Salário de João JÁ foi reduzido de R$ 3000 para R$ 2550.
        self.assertEqual(k["vales_a_descontar"],"125.00")
        self.assertEqual(k["vales_ja_reservados"],"450.00")
        self.assertEqual(k["vales_sem_vinculo"],1)
        joao=next(x for x in report["funcionarios"] if x["id"]==1)
        self.assertEqual(joao["chave_pix"],"12345678900")
        self.assertEqual(joao["totais"]["holerites_abertos"],"2550.00")
        self.assertEqual(joao["totais"]["vales_previstos"],"0.00")
        self.assertEqual(joao["totais"]["vales_atrasados"],"15.00")
        self.assertEqual(joao["totais"]["vales_reservados"],"450.00")
        self.assertEqual(len(joao["sugestoes"]),1)
        self.assertEqual(joao["sugestoes"][0]["id"],4)
        self.assertEqual(len(joao["holerites"]),2)
        self.assertEqual(len(joao["descontos"]),2)
        # Cadastro exclusivo de Vales não desaparece: vira ficha de
        # consulta, sem criar um empregado nem um Pix no CONTAS original.
        pedro=next(x for x in report["funcionarios"] if x["nome"]=="PEDRO SANTOS")
        self.assertLess(pedro["id"],0)
        self.assertEqual(pedro["origem_cadastro"],"vales")
        self.assertEqual(pedro["vales_ids"],[12])
        self.assertEqual(pedro["totais"]["vales_previstos"],"40.00")
        self.assertFalse(report["vales_sem_vinculo"])

    def test_paid_history_preserves_payment_dates_without_changing_open_totals(self):
        report=f.dashboard("2026-11")
        people={p["id"]:p for p in report["funcionarios"]}
        joao=next(h for h in people[1]["holerites"] if h["paga"])
        maria=next(h for h in people[2]["holerites"] if h["paga"])
        self.assertEqual((joao["competencia"],joao["data_pagamento"],joao["valor"]),
                         ("2026-10","2026-11-01","1800.00"))
        self.assertEqual((maria["data_pagamento"],maria["valor"]),("2026-11-11","1600.00"))
        self.assertEqual(report["indicadores"]["total_a_pagar"],"4650.00")
        self.assertTrue(all(not h["data_pagamento"] for p in people.values()
                            for h in p["holerites"] if not h["paga"]))

    def test_other_account_needs_confirmation(self):
        before=f.dashboard("2026-11")
        self.assertEqual(before["indicadores"]["total_a_pagar"],"4650.00")
        result=f.assign_account({"conta_id":5,"funcionario_id":1})
        self.assertTrue(result["ok"])
        after=f.dashboard("2026-11")
        self.assertEqual(after["indicadores"]["total_a_pagar"],"4770.00")
        self.assertEqual(after["indicadores"]["total_outras_contas_pendentes"],"120.00")
        joao=next(x for x in after["funcionarios"] if x["id"]==1)
        self.assertEqual(joao["outras_contas"][0]["id"],5)
        self.assertEqual(joao["totais"]["total_a_pagar"],"2670.00")
        # Um segundo funcionário não pode apropriar-se da mesma conta.
        with self.assertRaisesRegex(v.BridgeError,"outro funcionário"):
            f.assign_account({"conta_id":5,"funcionario_id":2})
        # Holerite não pode ser realocado fora do cadastro legítimo.
        with self.assertRaisesRegex(v.BridgeError,"Holerite já vinculado"):
            f.assign_account({"conta_id":1,"funcionario_id":2})

    def test_search_only_unlinked_normal_accounts(self):
        result=f.find_account_candidates("SUPER")
        self.assertEqual([x["id"] for x in result["contas"]],[5])
        result=f.find_account_candidates("JOAO")
        self.assertEqual([x["id"] for x in result["contas"]],[4])
        self.assertFalse(f.find_account_candidates("INEXISTENTE")["contas"])
        with self.assertRaisesRegex(v.BridgeError,"2 caracteres"):
            f.find_account_candidates("J")

    def test_competence_changes_payroll_without_hiding_other_accounts(self):
        f.assign_account({"conta_id":5,"funcionario_id":1})
        report=f.dashboard("2026-10")
        k=report["indicadores"]
        self.assertEqual(k["holerites_mes"],1)
        self.assertEqual(k["holerites_pagos_mes"],1)
        self.assertEqual(k["total_holerites_pendentes"],"0.00")
        self.assertEqual(k["total_outras_contas_pendentes"],"120.00")
        self.assertEqual(k["total_a_pagar"],"120.00")
        self.assertEqual(report["funcionarios"][0]["totais"]["vales_atrasados"],"0.00")

    def test_pix_edit_uses_original_employee_api_only(self):
        import json
        from unittest.mock import MagicMock
        conn=MagicMock()
        first=MagicMock(status=200)
        first.read.return_value=b'<script>window.__CONTAS_TOKEN__="test-token";</script>'
        second=MagicMock(status=200)
        second.read.return_value=b'{"ok":true,"id":1}'
        conn.getresponse.side_effect=[first,second]
        with patch.object(f.http.client,"HTTPConnection",return_value=conn):
            result=f.update_pix({"funcionario_id":1,
                "chave_pix":"new@example.com","chave_anterior":"12345678900"})
        self.assertEqual(result,{"ok":True,"funcionario_id":1})
        first_call,second_call=conn.request.call_args_list
        self.assertEqual(first_call.args[:2],("GET","/?desktop=1"))
        self.assertEqual(second_call.args[:2],("POST","/api/holerites/funcionarios"))
        self.assertEqual(json.loads(second_call.kwargs["body"]),
            {"id":1,"nome":"JOAO DA SILVA","chave_pix":"new@example.com"})
        self.assertEqual(second_call.kwargs["headers"]["X-Local-Token"],"test-token")
        with closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute("SELECT chave_pix FROM holerite_funcionarios WHERE id=1").fetchone()[0],"12345678900")
        with patch.object(f.http.client,"HTTPConnection") as network:
            with self.assertRaises(v.BridgeError):
                f.update_pix({"funcionario_id":1,"chave_pix":"x","chave_anterior":"stale"})
            with self.assertRaises(v.BridgeError):
                f.update_pix({"funcionario_id":999,"chave_pix":"x","chave_anterior":""})
            network.assert_not_called()

    def test_no_write_to_original_sqlite(self):
        f.assign_account({"conta_id":5,"funcionario_id":1})
        with closing(sqlite3.connect(self.db)) as con:
            rows=con.execute("SELECT COUNT(*) FROM contas").fetchone()
            self.assertEqual(rows[0],7)
            cols=con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            self.assertFalse(any("staff_account_links" in x[0] for x in cols))
        with closing(sqlite3.connect(self.journal)) as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM staff_account_links").fetchone()[0],1)


class NativeRouteTest(unittest.TestCase):
    def test_native_page_instead_of_legacy_contas(self):
        handler=object.__new__(Handler)
        handler.path="/modules/funcionarios/"
        handler.headers={"Accept-Encoding":"identity"}
        handler.authorized=lambda:True
        result=[]
        handler.respond=lambda *args,**kwargs:result.append((args,kwargs))
        with patch("central_admin.server.proxy",side_effect=AssertionError("legacy app")):
            Handler.do_GET(handler)
        self.assertEqual(result[0][0][0],200)
        html=result[0][0][1].decode()
        self.assertIn('id="staffList"',html)
        self.assertIn("/central/funcionarios.js",html)
        self.assertNotIn("/central/modules/funcionarios/app.js",html)
        self.assertNotIn("<iframe",html)

    def test_pix_has_dedicated_view_before_first_paint(self):
        handler=object.__new__(Handler)
        handler.path="/modules/funcionarios/?view=pix"
        handler.headers={"Accept-Encoding":"identity"}
        handler.authorized=lambda:True
        result=[]
        handler.respond=lambda *args,**kwargs:result.append((args,kwargs))
        Handler.do_GET(handler)
        self.assertEqual(result[0][0][0],200)
        html=result[0][0][1].decode()
        self.assertIn('class="central-operational nh-scope-funcionarios nhf-view-pix"',html)
        self.assertIn('id="managePix" aria-current="page"',html)
        self.assertIn('id="pixList"',html)

    def test_module_needs_authenticated_session(self):
        handler=object.__new__(Handler)
        handler.path="/modules/funcionarios/"
        handler.headers={}
        handler.authorized=lambda:False
        out=[]
        handler.respond=lambda *args,**kwargs:out.append((args,kwargs))
        with patch("central_admin.server.proxy",side_effect=AssertionError("legacy app")):
            Handler.do_GET(handler)
        self.assertEqual(out[0][0][0],401)

    def test_direct_browser_link_recovers_from_cross_site_cookie(self):
        handler=object.__new__(Handler)
        handler.path="/modules/funcionarios/?utm_source=chatgpt.com"
        handler.command="GET"
        handler.headers={"Accept":"text/html,application/xhtml+xml",
                         "Sec-Fetch-Mode":"navigate"}
        handler.authorized=lambda:False
        out=[]
        handler.respond=lambda *args,**kwargs:out.append(("json",args,kwargs))
        handler.send_response=lambda status:out.append(("status",status))
        handler.send_header=lambda key,value:out.append(("header",key,value))
        handler.end_headers=lambda:None
        with patch("central_admin.server.proxy",side_effect=AssertionError("legacy loaded")):
            Handler.do_GET(handler)
        self.assertIn(("status",303),out)
        self.assertIn(("header","Location","/central/?abrir=funcionarios"),out)
        self.assertFalse(any(row[0]=="json" for row in out))

    def test_data_endpoint_needs_session(self):
        class H:
            path="/api/funcionarios/painel?competencia=2026-11"
            command="GET"
            headers={}
            authorized=lambda self:False
            def respond(self,*args,**kwargs):self.status=args[0]
        h=H()
        self.assertTrue(f.handle(h))
        self.assertEqual(h.status,401)

    def test_write_requires_valid_origin(self):
        class H:
            path="/api/funcionarios/vincular-conta"
            command="POST"
            headers={"Origin":"https://attacker.invalid"}
            authorized=lambda self:True
            def respond(self,*args,**kwargs):self.status=args[0]
        h=H()
        self.assertTrue(f.handle(h))
        self.assertEqual(h.status,403)


if __name__=="__main__": unittest.main()
