"""Contrato real de Vales pela API original; NÃO exige DSN PostgreSQL.

A implantação antiga não configurava CENTRAL_CONTROLES_DSN e por isso a
tela Holerites ficava sem os vales. Este teste usa a forma exata da
resposta /api/state e /api/controls/:id/vales do Meus Controles.
"""
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from central_admin import vales_holerites as v
from central_admin import funcionarios as f


def vales_api(method,path,payload=None):
    assert method=="GET", "A consulta NÃO pode pagar ou alterar os Vales"
    if path=="/api/state":
        return {"boards":[{"id":1,"name":"Equipe"}],
                "controls":[{"id":9,"mode":"vale_funcionarios","name":"Vales de Funcionários"},
                            {"id":11,"mode":"recebimento","name":"Pedidos e produtos"}]}
    if path=="/api/controls/9/vales":
        return {
          "control_id":9,
          "employees":[
            {"id":20,"name":"ALBETIZA","active":True,
             "debts":[{"id":101,"title":"Vale com Angelita","description":"",
                "installments":[{"id":401,"debt_id":101,"installment_number":1,
                  "due_month":"2026-11","amount":"500.00","paid":"0.00",
                  "remaining":"500.00","status":"pendente"}]}]},
            {"id":21,"name":"MARIA","active":True,
             "debts":[{"id":102,"title":"Vale com Angelita",
               "installments":[{"id":402,"debt_id":102,"installment_number":2,
                 "due_month":"2026-11","amount":"500.00","paid":"0.00",
                 "remaining":"500.00","status":"pendente"}]}]},
            {"id":22,"name":"MARCELO","active":True,"debts":[]},
          ],
          "schedule":[],"totals":{"employees":3,"active":3,"debts":2}
        }
    raise AssertionError("Rota não prevista: "+path)


class LiveContractTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env=patch.dict(os.environ,{
            "CENTRAL_CONTAS_DB":str(Path(self.tmp.name)/"contas.db"),
            "CENTRAL_VALES_DB":str(Path(self.tmp.name)/"journal.db"),
        })
        self.env.start();self.addCleanup(self.env.stop)
        os.environ.pop("CENTRAL_CONTROLES_DSN",None)
        with sqlite3.connect(os.environ["CENTRAL_CONTAS_DB"]) as con:
            con.executescript("""
                CREATE TABLE holerite_funcionarios(
                    id INTEGER PRIMARY KEY,nome TEXT,chave_pix TEXT);
                CREATE TABLE holerite_lancamentos(
                    conta_id INTEGER PRIMARY KEY,funcionario_id INTEGER,
                    competencia TEXT);
                CREATE TABLE contas(id INTEGER PRIMARY KEY,fornecedor TEXT,
                    documento TEXT,referencia TEXT,observacoes TEXT,valor TEXT,
                    vencimento TEXT);
                CREATE TABLE pagamentos(id INTEGER PRIMARY KEY,conta_id INTEGER,
                    data_pagamento TEXT);
                INSERT INTO holerite_funcionarios VALUES
                  (1,'ALBETIZIA CIRQUEIRA DE ANDRADE CARVALHO','99984762090'),
                  (2,'MARIA PEREIRA','11900000000'),
                  (3,'MARCELO ALVES','11800000000');
                INSERT INTO contas VALUES
                  (90,'ALBETIZIA CIRQUEIRA DE ANDRADE CARVALHO',
                     'HOLERITE 11','','', '1635.02','2026-11-30');
                INSERT INTO holerite_lancamentos VALUES(90,1,'2026-11');
            """)
        self.api=patch.object(v,"_control_request",side_effect=vales_api)
        self.api.start();self.addCleanup(self.api.stop)

    def test_api_returns_actual_outstanding_installments_without_dsn(self):
        staff,rows=v.read_controls()
        self.assertEqual(len(staff),3)
        self.assertEqual([x["id"] for x in rows],[401,402])
        self.assertEqual(rows[0]["amount"],"500.00")
        self.assertEqual(rows[0]["paid"],"0.00")
        self.assertEqual(rows[0]["due_month"],"2026-11")
        self.assertEqual(rows[0]["employee_id"],20)
        self.assertEqual(rows[1]["employee_id"],21)

    def test_name_same_full_automatically_links_for_display_and_quote(self):
        # Mesmo nome completo, diferenças de maiúsculas e acentos removidas.
        persons=[{"id":99,"name":"MARIA PEREIRA"}]
        employees=[{"id":2,"nome":"Maria Pereira"}]
        self.assertEqual(v.unique_name_links(persons,employees,{}),{99:2})
        # Abreviação não faz desconto automaticamente: só sugestão segura.
        self.assertEqual(v.name_suggestions("ALBETIZA",
            [{"id":1,"nome":"ALBETIZIA CIRQUEIRA DE ANDRADE CARVALHO"}]),[1])

    def test_short_names_link_automatically_and_display_real_vales(self):
        report=f.dashboard("2026-11")
        self.assertFalse(report["vales_sem_vinculo"])
        expected={1:20,2:21,3:22}
        for conta_id,vale_id in expected.items():
            person=next(x for x in report["funcionarios"] if x["id"]==conta_id)
            self.assertEqual(person["vales_ids"],[vale_id])
        albetiza=next(x for x in report["funcionarios"] if x["id"]==1)
        self.assertEqual(albetiza["totais"]["vales_previstos"],"500.00")
        maria=next(x for x in report["funcionarios"] if x["id"]==2)
        self.assertEqual(maria["totais"]["vales_previstos"],"500.00")
        self.assertEqual(report["indicadores"]["total_a_pagar"],"1635.02")
        self.assertEqual(report["indicadores"]["vales_a_descontar"],"1000.00")
        # Nenhuma associação de consulta altera o líquido ou o banco original.
        with sqlite3.connect(os.environ["CENTRAL_CONTAS_DB"]) as con:
            self.assertEqual(con.execute("SELECT valor FROM contas WHERE id=90").fetchone()[0],
                             "1635.02")
        with sqlite3.connect(os.environ["CENTRAL_VALES_DB"]) as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM staff_links").fetchone()[0],0)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM discounts").fetchone()[0],0)

    def test_name_variants_only_match_when_unique(self):
        source=[
            {"id":10,"name":"Rafael"},
            {"id":11,"name":"João Pedro (Jorge)"},
            {"id":12,"name":"Dacilei Rocha"},
        ]
        targets=[
            {"id":2,"nome":"RAPHAEL DA SILVA"},
            {"id":3,"nome":"JOÃO PEDRO GOMES"},
            {"id":4,"nome":"DARCILEI DA ROCHA OLIVEIRA"},
        ]
        self.assertEqual(v.unique_name_links(source,targets,{}),{10:2,11:3,12:4})
        # Dois RAPHAELs: nunca escolher arbitrariamente.
        ambiguous=targets+[{"id":5,"nome":"RAPHAEL DOS SANTOS"}]
        self.assertNotIn(10,v.unique_name_links(source,ambiguous,{}))
        # Dois Vales chamados Rafael: nenhum se apropria do mesmo holerite.
        duplicate=source+[{"id":13,"name":"Rafael"}]
        paired=v.unique_name_links(duplicate,targets,{})
        self.assertNotIn(10,paired)
        self.assertNotIn(13,paired)
        # Associações antigas e confirmadas continuam prioritárias.
        self.assertEqual(v.unique_name_links(source,targets,{10:4})[10],4)

    def test_api_fails_closed_instead_of_claiming_employee_has_no_vales(self):
        with patch.object(v,"_control_request",side_effect=OSError("upstream offline")):
            with self.assertRaisesRegex(v.BridgeError,"API privada"):
                v.read_controls()
            with self.assertRaisesRegex(v.BridgeError,"API privada"):
                f.dashboard("2026-11")

    def test_fails_closed_on_invalid_summary(self):
        def incomplete(method,path,payload=None):
            if path=="/api/state":return {"controls":[{"id":9,"mode":"vale_funcionarios"}]}
            return {"control_id":9,"employees":None}
        with patch.object(v,"_control_request",side_effect=incomplete):
            with self.assertRaisesRegex(v.BridgeError,"não retornou os funcionários"):
                v.read_controls()


if __name__=="__main__":
    unittest.main()
