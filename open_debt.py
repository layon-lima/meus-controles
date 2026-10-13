"""Dívidas sem valor fixo: registro ilimitado de pagamentos recebidos.

Reutiliza a tabela debt_payments, com isolamento por modo/controle;
nao ha limite, valor inicial, quitacao ou saldo devedor.
"""
from decimal import Decimal
import csv
import io
import re
import debt

MODE="divida_sem_valor"

def control(con,cid):
    row=con.execute("SELECT id,name,board_id,mode FROM controls WHERE id=?",(cid,)).fetchone()
    if row is None:
        raise LookupError("Controle de pagamentos não encontrado.")
    if row["mode"]!=MODE:
        raise ValueError("Este controle não é do tipo Dívidas sem valor fixo.")
    return dict(row)

def summary(con,cid):
    control(con,cid)
    rows=[dict(r) for r in con.execute("""SELECT * FROM debt_payments
      WHERE control_id=? ORDER BY payment_date DESC,id DESC""",(cid,))]
    total=sum((Decimal(r["amount"]) for r in rows),Decimal("0"))
    return {"control_id":cid,
      "totals":{"paid":debt.money(total),"count":len(rows)},
      "payments":rows}

def payment(con,pid):
    row=con.execute("SELECT * FROM debt_payments WHERE id=?",(pid,)).fetchone()
    if row is None:
        raise LookupError("Pagamento não encontrado.")
    control(con,row["control_id"])
    return dict(row)

def export_csv(con,cid):
    data=summary(con,cid)
    out=io.StringIO()
    w=csv.writer(out,delimiter=";")
    w.writerow(["Dívidas sem valor fixo","Total acumulado","Quantidade de pagamentos"])
    w.writerow([cid,data["totals"]["paid"],data["totals"]["count"]])
    w.writerow([])
    w.writerow(["Data","Descrição","Valor pago (R$)","Observações"])
    for row in data["payments"]:
        d=row["payment_date"]
        display=d[5:7]+"/"+d[:4] if len(d)==7 else d[8:10]+"/"+d[5:7]+"/"+d[:4]
        w.writerow([display,row["description"],row["amount"],row["notes"]])
    return ("\ufeff"+out.getvalue()).encode("utf-8")

def handle(handler,con,method,path):
    root=re.fullmatch(r"/api/controls/(\d+)/open-debt(?:/(payments|settings|export\.csv))?",path)
    by_id=re.fullmatch(r"/api/open-debt-payments/(\d+)",path)
    if root:
        cid=int(root[1]);action=root[2]
        control(con,cid)
        if method=="GET" and action is None:
            return handler.send(summary(con,cid))
        if method=="GET" and action=="export.csv":
            return handler.send(export_csv(con,cid),mime="text/csv; charset=utf-8")
        if method=="PUT" and action=="settings":
            payload=handler.input()
            if not isinstance(payload,dict):
                raise ValueError("Configurações inválidas.")
            name=debt.label(payload.get("name"),"o nome do controle",150)
            con.execute("BEGIN IMMEDIATE")
            con.execute("UPDATE controls SET name=? WHERE id=?",(name,cid))
            con.commit()
            return handler.send({"name":name})
        if method=="POST" and action=="payments":
            record=debt.validate_payment(handler.input())
            con.execute("BEGIN IMMEDIATE")
            # Nunca chama can_pay: pagamentos somam sem teto.
            cur=con.execute("""INSERT INTO debt_payments
              (control_id,payment_date,description,amount,notes)
              VALUES(?,?,?,?,?)""",
              (cid,record["payment_date"],record["description"],
               record["amount"],record["notes"]))
            con.commit()
            return handler.send({"id":cur.lastrowid},201)
        raise LookupError("Ação não encontrada.")
    if by_id and method in ("PUT","DELETE"):
        pid=int(by_id[1])
        con.execute("BEGIN IMMEDIATE")
        existing=payment(con,pid)
        if method=="PUT":
            record=debt.validate_payment(handler.input())
            con.execute("""UPDATE debt_payments
              SET payment_date=?,description=?,amount=?,notes=?,updated_at=CURRENT_TIMESTAMP
              WHERE id=?""",
              (record["payment_date"],record["description"],
               record["amount"],record["notes"],pid))
        else:
            con.execute("DELETE FROM debt_payments WHERE id=?",(pid,))
        con.commit()
        return handler.send({"ok":True,"control_id":existing["control_id"]})
    raise LookupError("Ação não encontrada.")
