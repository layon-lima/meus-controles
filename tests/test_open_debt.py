"""Modelo Dívidas sem valor fixo: soma ilimitada e isolamento do modelo antigo."""
import tempfile
from pathlib import Path
import unittest

import app
import debt
import open_debt

class FakeRequest:
    headers={"Host":"127.0.0.1"}
    def __init__(self,method,path,payload=None):
        self.command=method
        self.path=path
        self.data=payload or {}
    def input(self):
        return self.data
    def send(self,payload,status=200,mime=None):
        return {"status":status,"payload":payload,"mime":mime}

class OpenDebtTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.original=app.DATA,app.DB
        app.DATA=Path(self.temp.name)
        app.DB=app.DATA/"open-debt.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
               VALUES(1,'PAGAMENTOS SOLTOS','divida_sem_valor','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
               VALUES(1,'OUTROS PAGAMENTOS','divida_sem_valor','[]','[]','[]')""").lastrowid
            self.fixed=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
               VALUES(1,'DIVIDA FIXA','divida','[]','[]','[]')""").lastrowid
            debt.save_settings(con,self.fixed,{"opening_amount":"100.00"})

    def tearDown(self):
        app.DATA,app.DB=self.original
        self.temp.cleanup()

    def route(self,method,path,payload=None):
        return app.Handler.route(FakeRequest(method,path,payload))

    def add(self,cid,day,value,description="Pagamento",notes=""):
        response=self.route("POST",f"/api/controls/{cid}/open-debt/payments",{
            "date":day,"description":description,"amount":value,"notes":notes
        })
        self.assertEqual(response["status"],201,response)
        return response["payload"]["id"]

    def test_unbounded_accumulation_and_initial_zero(self):
        self.assertEqual(self.route("GET",f"/api/controls/{self.cid}/open-debt")["payload"]["totals"],
            {"paid":"0.00","count":0})
        self.add(self.cid,"2026-06-12","500","PIX 1")
        self.add(self.cid,"2026-06-13","300,50","PIX 2","Comprovante nº 23")
        self.add(self.cid,"2026-06","20000","Pagamento no mês")
        response=self.route("GET",f"/api/controls/{self.cid}/open-debt")
        self.assertEqual(response["payload"]["totals"],{"paid":"20800.50","count":3})
        self.assertNotIn("balance",response["payload"]["totals"])
        self.assertNotIn("paid_off",response["payload"]["totals"])
        self.assertTrue(any(x["payment_date"]=="2026-06" for x in response["payload"]["payments"]))
        self.assertTrue(any(x["notes"]=="Comprovante nº 23" for x in response["payload"]["payments"]))
        with app.db() as con:
            self.assertEqual(app.state(con)["controls"][-3]["summary"]["balance"],"20800.50")
            self.assertEqual(open_debt.summary(con,self.cid)["totals"]["paid"],"20800.50")

    def test_edit_delete_and_isolation_between_controls(self):
        first=self.add(self.cid,"2026-10-03","500","Adiantamento")
        second=self.add(self.cid,"2026-10-04","300","Depósito")
        self.add(self.other,"2026-10-05","1200","Outro controle")
        result=self.route("PUT",f"/api/open-debt-payments/{first}",{
            "date":"2026-10-03","description":"Pagamento corrigido","amount":"750,75","notes":"PIX"
        })
        self.assertEqual(result["status"],200)
        self.assertEqual(self.route("GET",f"/api/controls/{self.cid}/open-debt")["payload"]["totals"]["paid"],"1050.75")
        self.assertEqual(self.route("GET",f"/api/controls/{self.other}/open-debt")["payload"]["totals"]["paid"],"1200.00")
        self.assertEqual(self.route("DELETE",f"/api/open-debt-payments/{second}")["status"],200)
        view=self.route("GET",f"/api/controls/{self.cid}/open-debt")["payload"]
        self.assertEqual(view["totals"],{"paid":"750.75","count":1})
        self.assertEqual(view["payments"][0]["description"],"Pagamento corrigido")

    def test_fixed_debt_rules_and_wrong_route_guards_unchanged(self):
        self.add(self.cid,"2026-10-01","5000","Maior que a dívida fixa")
        with app.db() as con:
            self.assertEqual(debt.summary(con,self.fixed)["totals"]["balance"],"100.00")
        fixed_record=debt.validate_payment({"date":"2026-10-01","description":"Parcela",
            "amount":"50"})
        with app.db() as con:
            row=con.execute("""INSERT INTO debt_payments
              (control_id,payment_date,description,amount,notes) VALUES(?,?,?,?,?)""",
              (self.fixed,*fixed_record.values()))
            fixed_pid=row.lastrowid
            with self.assertRaisesRegex(ValueError,"ultrapassa"):
                debt.can_pay(con,self.fixed,"51")
        open_pid=self.route("GET",f"/api/controls/{self.cid}/open-debt")["payload"]["payments"][0]["id"]
        wrong=self.route("PUT",f"/api/open-debt-payments/{fixed_pid}",{
            "date":"2026-10-01","description":"Não alterar","amount":"999"
        })
        self.assertEqual(wrong["status"],400)
        wrong_old=self.route("PUT",f"/api/debt-payments/{open_pid}",{
            "date":"2026-10-01","description":"Não alterar","amount":"999"
        })
        self.assertEqual(wrong_old["status"],400)
        with app.db() as con:
            self.assertEqual(debt.summary(con,self.fixed)["totals"]["paid"],"50.00")
            self.assertEqual(open_debt.summary(con,self.cid)["totals"]["paid"],"5000.00")

    def test_validation_csv_settings_and_moving_folder(self):
        for value in ("0","-1","NaN","Infinity","texto"):
            result=self.route("POST",f"/api/controls/{self.cid}/open-debt/payments",{
                "date":"2026-09-18","description":"Teste","amount":value
            })
            self.assertEqual(result["status"],400)
        self.add(self.cid,"2026-09","1250","Pagamento do mês","Observação")
        result=self.route("GET",f"/api/controls/{self.cid}/open-debt/export.csv")
        self.assertEqual(result["status"],200)
        text=result["payload"].decode("utf-8-sig")
        self.assertIn("1250.00",text)
        self.assertIn("09/2026",text)
        self.assertIn("Observação",text)
        self.assertEqual(self.route("PUT",f"/api/controls/{self.cid}/open-debt/settings",
            {"name":"RECEBIMENTOS AVULSOS"})["status"],200)
        with app.db() as con:
            self.assertEqual(app.get_control(con,self.cid)["name"],"RECEBIMENTOS AVULSOS")
            otherfolder=con.execute("INSERT INTO boards(name) VALUES('DESTINO')").lastrowid
        self.assertEqual(self.route("PATCH",f"/api/controls/{self.cid}/move",
            {"board_id":otherfolder})["status"],200)
        with app.db() as con:
            self.assertEqual(app.get_control(con,self.cid)["board_id"],otherfolder)
            self.assertEqual(open_debt.summary(con,self.cid)["totals"]["paid"],"1250.00")

    def test_no_fixed_amount_required_when_creating_control(self):
        with app.db() as con:
            fields=[{"key":"data","label":"Data","type":"date","required":True},
                    {"key":"descricao","label":"Descrição","type":"text","required":True}]
            types=[{"key":"principal","label":"Pagamento","direction":1,"source":"manual"}]
            result=app.validate_config({"name":"NOVO CONTROLE LIVRE","mode":"divida_sem_valor",
                "board_id":1,"fields":fields,"types":types,"rules":[]})
            self.assertEqual(result[2],"divida_sem_valor")
            self.assertEqual(open_debt.summary(con,self.cid)["totals"]["paid"],"0.00")

if __name__=="__main__":
    unittest.main()
