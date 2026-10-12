"""Controle de Dívidas: saldo inicial, pagamentos descritos e saldo restante.

Tabelas isoladas por controle; sem fórmulas de usuário nem dependências externas.
"""
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import parse_qs, urlsplit
import csv
import io
import re

CENT = Decimal("0.01")
LIMIT = Decimal("1000000000000")

def amount(value, name="valor", *, positive=False):
    if value is None or isinstance(value,bool):
        raise ValueError("Informe "+name+".")
    s=str(value).strip().replace(" ","")
    if "," in s:
        s=s.replace(".","").replace(",",".")
    try:
        result=Decimal(s)
    except (InvalidOperation,ValueError):
        raise ValueError(name.capitalize()+" inválido.") from None
    if not result.is_finite() or result<0 or result>LIMIT:
        raise ValueError(name.capitalize()+" fora do limite permitido.")
    result=result.quantize(CENT,rounding=ROUND_HALF_UP)
    if positive and result<=0:
        raise ValueError(name.capitalize()+" deve ser maior que zero.")
    return result

def money(value):
    return str(Decimal(value).quantize(CENT,rounding=ROUND_HALF_UP))

def label(value,name,max_length=200,required=True):
    if not isinstance(value,str):
        raise ValueError(name.capitalize()+" inválido.")
    result=value.strip()
    if len(result)>max_length or (required and not result):
        raise ValueError("Informe "+name+" válido.")
    return result

def day(value):
    if not isinstance(value,str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",value):
        raise ValueError("Informe uma data de pagamento válida.")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError("Data de pagamento inválida.") from None
    return value

def initialize(con):
    con.executescript("""
      CREATE TABLE IF NOT EXISTS debt_settings(
        control_id INTEGER PRIMARY KEY REFERENCES controls(id) ON DELETE CASCADE,
        opening_amount TEXT NOT NULL DEFAULT '0.00'
      );
      CREATE TABLE IF NOT EXISTS debt_payments(
        id INTEGER PRIMARY KEY,
        control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
        payment_date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_debt_payments_control
        ON debt_payments(control_id,payment_date DESC,id DESC);
    """)

def control(con,cid):
    row=con.execute("SELECT id,name,board_id,mode FROM controls WHERE id=?",(cid,)).fetchone()
    if not row:
        raise LookupError("Controle de dívida não encontrado.")
    if row["mode"]!="divida":
        raise ValueError("Este controle não utiliza o modelo de dívida.")
    return dict(row)

def total_paid(con,cid,exclude_id=None):
    records=con.execute("SELECT id,amount FROM debt_payments WHERE control_id=?",(cid,)).fetchall()
    return sum((Decimal(x["amount"]) for x in records if x["id"]!=exclude_id),Decimal("0"))

def settings(con,cid):
    control(con,cid)
    row=con.execute("SELECT opening_amount FROM debt_settings WHERE control_id=?",(cid,)).fetchone()
    return {"opening_amount":row["opening_amount"] if row else "0.00"}

def save_settings(con,cid,payload):
    control(con,cid)
    if not isinstance(payload,dict):
        raise ValueError("Configurações inválidas.")
    initial=amount(payload.get("opening_amount"),"a dívida inicial")
    paid=total_paid(con,cid)
    if initial<paid:
        raise ValueError("A dívida inicial não pode ser menor que os pagamentos já registrados.")
    con.execute("""INSERT INTO debt_settings(control_id,opening_amount)
       VALUES(?,?) ON CONFLICT(control_id) DO UPDATE
       SET opening_amount=excluded.opening_amount""",(cid,money(initial)))
    if "name" in payload:
        name=label(payload["name"],"o nome do controle",150)
        con.execute("UPDATE controls SET name=? WHERE id=?",(name,cid))
    return settings(con,cid)

def summary(con,cid):
    control(con,cid)
    initial=Decimal(settings(con,cid)["opening_amount"])
    rows=[dict(x) for x in con.execute("""SELECT * FROM debt_payments WHERE control_id=?
         ORDER BY payment_date DESC,id DESC""",(cid,))]
    total=sum((Decimal(r["amount"]) for r in rows),Decimal("0"))
    balance=initial-total
    return {
      "control_id":cid,
      "settings":{"opening_amount":money(initial)},
      "totals":{"opening_amount":money(initial),"paid":money(total),
                "balance":money(balance),"count":len(rows),
                "paid_off":balance==0 and initial>0},
      "payments":rows
    }

def validate_payment(payload):
    if not isinstance(payload,dict):
        raise ValueError("Pagamento inválido.")
    return {
      "payment_date":day(payload.get("date")),
      "description":label(payload.get("description"),"a descrição",200),
      "amount":money(amount(payload.get("amount"),"o valor do pagamento",positive=True)),
      "notes":label(payload.get("notes",""),"as observações",1500,False)
    }

def payment(con,id):
    row=con.execute("SELECT * FROM debt_payments WHERE id=?",(id,)).fetchone()
    if not row:
        raise LookupError("Pagamento não encontrado.")
    control(con,row["control_id"])
    return dict(row)

def can_pay(con,cid,new_amount,exclude_id=None):
    initial=Decimal(settings(con,cid)["opening_amount"])
    total=total_paid(con,cid,exclude_id)
    if total+Decimal(new_amount)>initial:
        raise ValueError("O pagamento ultrapassa o saldo restante da dívida.")

def handle(handler,con,method,path):
    root=re.fullmatch(r"/api/controls/(\d+)/debt(?:/(payments|settings|export\.csv))?",path)
    by_id=re.fullmatch(r"/api/debt-payments/(\d+)",path)
    if root:
        cid=int(root[1]);action=root[2]
        control(con,cid)
        if method=="GET" and action is None:
            return handler.send(summary(con,cid))
        if method=="GET" and action=="export.csv":
            data=summary(con,cid)
            out=io.StringIO()
            w=csv.writer(out,delimiter=";")
            w.writerow(["Controle","Dívida inicial","Total pago","Saldo restante"])
            w.writerow([cid,data["totals"]["opening_amount"],data["totals"]["paid"],data["totals"]["balance"]])
            w.writerow([])
            w.writerow(["Data","Descrição","Valor R$","Observações"])
            for entry in data["payments"]:
                w.writerow([entry["payment_date"],entry["description"],entry["amount"],entry["notes"]])
            return handler.send(("\ufeff"+out.getvalue()).encode("utf-8"),
                                mime="text/csv; charset=utf-8")
        if method=="PUT" and action=="settings":
            params=handler.input()
            con.execute("BEGIN IMMEDIATE")
            result=save_settings(con,cid,params)
            con.commit()
            return handler.send(result)
        if method=="POST" and action=="payments":
            params=validate_payment(handler.input())
            con.execute("BEGIN IMMEDIATE")
            can_pay(con,cid,params["amount"])
            cur=con.execute("""INSERT INTO debt_payments
              (control_id,payment_date,description,amount,notes) VALUES(?,?,?,?,?)""",
              (cid,params["payment_date"],params["description"],params["amount"],params["notes"]))
            con.commit()
            return handler.send({"id":cur.lastrowid},201)
        raise LookupError("Ação de dívida não encontrada.")
    if by_id:
        pid=int(by_id[1])
        con.execute("BEGIN IMMEDIATE")
        current=payment(con,pid)
        cid=current["control_id"]
        if method=="PUT":
            params=validate_payment(handler.input())
            can_pay(con,cid,params["amount"],pid)
            con.execute("""UPDATE debt_payments SET payment_date=?,description=?,amount=?,notes=?,
              updated_at=CURRENT_TIMESTAMP WHERE id=?""",
              (params["payment_date"],params["description"],params["amount"],params["notes"],pid))
        elif method=="DELETE":
            con.execute("DELETE FROM debt_payments WHERE id=?",(pid,))
        else:
            raise LookupError("Ação de pagamento não encontrada.")
        con.commit()
        return handler.send({"ok":True})
    raise LookupError("Rota de dívida não encontrada.")
