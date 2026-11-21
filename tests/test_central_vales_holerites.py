"""Cenários reais de Vales ↔ Holerites sem acessar os bancos de produção."""
import json
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from decimal import Decimal
from pathlib import Path

from central_admin import vales_holerites as v


def fake_vales():
    staff=[{"id":7,"control_id":4,"name":"JOAO DA SILVA","active":1},
           {"id":8,"control_id":5,"name":"MARIA PEREIRA","active":1}]
    items=[
      {"id":71,"due_month":"2026-11","amount":"300.00","control_id":4,
       "employee_id":7,"title":"Adiantamento","debt_id":11,
       "installment_number":1,"paid":"0.00"},
      {"id":72,"due_month":"2026-11","amount":"150.00","control_id":4,
       "employee_id":7,"title":"Compra na fazenda","debt_id":12,
       "installment_number":2,"paid":"0.00"},
      {"id":73,"due_month":"2026-10","amount":"100.00","control_id":4,
       "employee_id":7,"title":"Vale atrasado","debt_id":12,
       "installment_number":1,"paid":"0.00"},
      {"id":81,"due_month":"2026-11","amount":"500.00","control_id":5,
       "employee_id":8,"title":"Outra pessoa","debt_id":16,
       "installment_number":1,"paid":"0.00"},
    ]
    return staff,items


class IntegrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.sqlite=Path(self.tmp.name)/"contas.db"
        self.journal=Path(self.tmp.name)/"journal.db"
        self.env=patch.dict(os.environ,{"CENTRAL_CONTAS_DB":str(self.sqlite),
            "CENTRAL_VALES_DB":str(self.journal)})
        self.env.start();self.addCleanup(self.env.stop)
        con=sqlite3.connect(self.sqlite)
        con.executescript("""
            CREATE TABLE holerite_funcionarios(id INTEGER PRIMARY KEY,nome TEXT);
            CREATE TABLE holerite_lancamentos(conta_id INTEGER PRIMARY KEY,
                funcionario_id INTEGER, competencia TEXT);
            CREATE TABLE contas(id INTEGER PRIMARY KEY,valor TEXT,fornecedor TEXT);
            CREATE TABLE pagamentos(id INTEGER PRIMARY KEY,conta_id INTEGER,
                data_pagamento TEXT);
            INSERT INTO holerite_funcionarios VALUES(1,'JOAO DA SILVA');
            INSERT INTO holerite_funcionarios VALUES(2,'MARIA PEREIRA');
            INSERT INTO contas VALUES(90,'2550.00','JOAO DA SILVA');
            INSERT INTO holerite_lancamentos VALUES(90,1,'2026-11');
        """)
        con.commit();con.close()
        self.data=patch.object(v,"read_controls",side_effect=fake_vales)
        self.data.start();self.addCleanup(self.data.stop)

    def link(self):
        result=v.assign_link({"vale_employee_id":7,"contas_employee_id":1})
        self.assertTrue(result["ok"])

    def test_link_proposal_and_exact_month_quote(self):
        suggestions=v.staff_view()
        source=suggestions["funcionarios_vales"]
        self.assertEqual(source[0]["suggested_contas_employee_id"],1)
        self.assertEqual(source[1]["suggested_contas_employee_id"],2)
        self.link()
        quoted=v.quote(1,"2026-11","3000.00")
        self.assertEqual(quoted["desconto"],"450.00")
        self.assertEqual(quoted["valor_pagar"],"2550.00")
        self.assertEqual(quoted["selecionadas"],[71,72])
        self.assertEqual([x["id"] for x in quoted["atrasadas"]],[73])
        self.assertNotIn(81,[x["id"] for x in quoted["parcelas"]])

    def test_save_reserves_without_discounting_origin(self):
        self.link()
        data={"holerite":"sim","funcionario_id":"1","competencia":"2026-11",
            "valor":"2550.00","fornecedor":"JOAO DA SILVA",
            "nh_vales":json.dumps({"original":"3000.00","selecionadas":[71,72]})}
        plan=v.prepare_submission(data)
        self.assertEqual(plan["quote"]["desconto"],"450.00")
        v.after_submission(plan,90)
        self.assertEqual(len(v.discounts_for_account(90)),2)
        self.assertEqual({x["status"] for x in v.discounts_for_account(90)},{"reserved"})
        # Ainda não há lançamento de vale_payments no sistema original.
        self.assertEqual(v.settle_account(90)["status"],"aguardando_pagamento")
        self.assertEqual(v.quote(1,"2026-11","3000.00")["parcelas"],[])
        # Retry de callback de gravação não pode reservar novamente.
        v.after_submission(plan,90)
        self.assertEqual(len(v.discounts_for_account(90)),2)

    def test_payment_applied_once_and_reconciled(self):
        self.link()
        plan=v.prepare_submission({"holerite":"sim","funcionario_id":"1",
            "competencia":"2026-11","valor":"2550.00",
            "nh_vales":json.dumps({"original":"3000.00","selecionadas":[71,72]})})
        v.after_submission(plan,90)
        with sqlite3.connect(self.sqlite) as con:
            con.execute("INSERT INTO pagamentos(conta_id,data_pagamento) VALUES(90,'2026-11-23')")
        posts=[]
        def controls(method,path,payload=None):
            if method=="GET":
                return [{"id":i+1000,"installment_id":int(p["path"].split("/")[3]),
                         "notes":p["payload"]["notes"]}
                        for i,p in enumerate(posts)]
            posts.append({"path":path,"payload":payload})
            return {"id":1000+len(posts)}
        with patch.object(v,"_control_request",side_effect=controls):
            result=v.settle_account(90)
            self.assertTrue(result["ok"])
            self.assertEqual(result["baixados"],2)
            self.assertEqual(len(posts),2)
            self.assertTrue(all(p["payload"]["notes"].startswith("CENTRAL-NH/HOLERITE:90:")
                                for p in posts))
            twice=v.settle_account(90)
            self.assertEqual(twice["baixados"],0)
            self.assertEqual(len(posts),2)
            self.assertEqual(len(v.reconcile_paid_pending()["concluidos"]),0)
        self.assertEqual({x["status"] for x in v.discounts_for_account(90)},{"settled"})

    def test_retry_after_partial_failure_uses_marker_not_double_post(self):
        self.link()
        plan=v.prepare_submission({"holerite":"sim","funcionario_id":"1",
            "competencia":"2026-11","valor":"2550.00",
            "nh_vales":json.dumps({"original":"3000.00","selecionadas":[71,72]})})
        v.after_submission(plan,90)
        with sqlite3.connect(self.sqlite) as con:
            con.execute("INSERT INTO pagamentos(conta_id,data_pagamento) VALUES(90,'2026-11-23')")
        records={}
        calls=[]
        def remote(method,path,payload=None):
            if method=="GET":return list(records.values())
            installment=int(path.split("/")[3])
            calls.append(installment)
            if installment==71:
                records[71]={"id":1171,"installment_id":71,"notes":payload["notes"]}
                # A API confirmou a gravação, mas a resposta foi perdida.
                raise OSError("conexão interrompida após gravação")
            records[72]={"id":1172,"installment_id":72,"notes":payload["notes"]}
            return {"id":1172}
        with patch.object(v,"_control_request",side_effect=remote):
            first=v.settle_account(90)
            self.assertFalse(first["ok"])
            self.assertEqual(first["pendentes"],1)
            second=v.settle_account(90)
            self.assertTrue(second["ok"])
            self.assertEqual(calls.count(71),1,"Marcador evita nova baixa da parcela 71")
        self.assertEqual({x["status"] for x in v.discounts_for_account(90)},{"settled"})

    def test_fail_closed_when_payroll_without_discounts(self):
        self.link()
        with self.assertRaisesRegex(v.BridgeError,"Há vales vinculados"):
            v.prepare_submission({"holerite":"sim","funcionario_id":"1",
                "competencia":"2026-11","valor":"3000.00"})
        with self.assertRaisesRegex(v.BridgeError,"Valor do holerite mudou"):
            v.prepare_submission({"holerite":"sim","funcionario_id":"1",
                "competencia":"2026-11","valor":"3000.00",
                "nh_vales":json.dumps({"original":"3000.00","selecionadas":[71,72]})})
        with self.assertRaisesRegex(v.BridgeError,"seleção"):
            v.quote(1,"2026-11","3000.00",selected=[81])

    def test_vales_more_than_payroll_can_be_selected_manually(self):
        self.link()
        q=v.quote(1,"2026-11","300.00")
        self.assertEqual(q["selecionadas"],[])
        self.assertEqual(len(q["parcelas"]),2)
        one=v.quote(1,"2026-11","300.00",selected=[71])
        self.assertEqual(one["valor_pagar"],"0.00")
        with self.assertRaisesRegex(v.BridgeError,"excedem"):
            v.quote(1,"2026-11","300.00",selected=[71,72])

    def test_different_employee_cannot_get_existing_vale(self):
        self.link()
        with self.assertRaisesRegex(v.BridgeError,"outro funcionário"):
            v.quote(2,"2026-11","3000.00",vale_employee_id=7)
        with self.assertRaisesRegex(v.BridgeError,"outro funcionário"):
            v.assign_link({"vale_employee_id":7,"contas_employee_id":2})
            v.quote(1,"2026-11","3000.00",vale_employee_id=7)


if __name__=="__main__":
    unittest.main()
