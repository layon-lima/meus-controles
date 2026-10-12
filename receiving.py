"""Pedidos de produtos e recebimentos parciais por nota fiscal.

Cada item pertence a um controle e tem quantidade/unidade próprias.
Saldo do item = quantidade pedida - soma das entregas registradas.
"""
from datetime import date
from decimal import Decimal, InvalidOperation
import re

MAX_QTY=Decimal("1000000000000")
PRECISION=Decimal("0.001")
UNITS=("un","kg","t","L","sc","cx","pct","m","m²","m³")

def initialize(con):
    con.executescript("""
      CREATE TABLE IF NOT EXISTS purchase_items(
        id INTEGER PRIMARY KEY,
        control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
        order_number TEXT NOT NULL,
        supplier TEXT NOT NULL,
        product TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'un',
        ordered_qty TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_items
        ON purchase_items(control_id,id DESC);
      CREATE TABLE IF NOT EXISTS purchase_receipts(
        id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL REFERENCES purchase_items(id) ON DELETE CASCADE,
        received_date TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        received_qty TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_receipts
        ON purchase_receipts(item_id,received_date DESC,id DESC);
    """)

def text(value, description, max_length=150, required=True):
    if not isinstance(value,str):
        raise ValueError("Informe "+description+".")
    value=value.strip()
    if (required and not value) or len(value)>max_length:
        raise ValueError("Informe "+description+" válido(a).")
    return value

def qty(value,description="a quantidade"):
    if value is None or isinstance(value,bool):
        raise ValueError("Informe "+description+".")
    raw=str(value).strip().replace(" ","")
    if "," in raw:raw=raw.replace(".","").replace(",",".")
    try:n=Decimal(raw)
    except (InvalidOperation,ValueError):
        raise ValueError("Quantidade inválida.") from None
    if not n.is_finite() or n<=0 or n>MAX_QTY:
        raise ValueError("Informe uma quantidade positiva válida.")
    if n.as_tuple().exponent < -3 and n!=n.quantize(PRECISION):
        raise ValueError("Use no máximo três casas decimais na quantidade.")
    return n.quantize(PRECISION)

def display(n):
    return format(n.quantize(PRECISION),"f")

def receive_date(value):
    if not isinstance(value,str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",value):
        raise ValueError("Informe a data da entrega.")
    try:date.fromisoformat(value)
    except ValueError:raise ValueError("Data da entrega inválida.") from None
    return value

def ensure_control(con,cid):
    row=con.execute("SELECT id,name,mode FROM controls WHERE id=?",(cid,)).fetchone()
    if row is None:
        raise LookupError("Controle não encontrado.")
    if row["mode"]!="recebimento":
        raise ValueError("Este controle não é de recebimento de produtos.")
    return dict(row)

def get_item(con,item_id):
    row=con.execute("SELECT * FROM purchase_items WHERE id=?",(item_id,)).fetchone()
    if row is None:raise LookupError("Item de pedido não encontrado.")
    ensure_control(con,row["control_id"])
    return dict(row)

def get_receipt(con,receipt_id):
    row=con.execute("""SELECT r.*,i.control_id FROM purchase_receipts r
      JOIN purchase_items i ON i.id=r.item_id WHERE r.id=?""",(receipt_id,)).fetchone()
    if row is None:raise LookupError("Recebimento não encontrado.")
    ensure_control(con,row["control_id"])
    return dict(row)

def validate_item(payload):
    if not isinstance(payload,dict):raise ValueError("Dados do pedido inválidos.")
    unit=text(payload.get("unit","un"),"a unidade de medida",12)
    return {
      "order_number":text(payload.get("order_number"),"o número do pedido",100),
      "supplier":text(payload.get("supplier",""),"o fornecedor",160,False),
      "product":text(payload.get("product"),"o produto",160),
      "unit":unit,
      "ordered_qty":display(qty(payload.get("ordered_qty"),"a quantidade pedida"))
    }

def validate_receipt(payload):
    if not isinstance(payload,dict):raise ValueError("Dados da entrega inválidos.")
    return {
      "received_date":receive_date(payload.get("date")),
      "invoice_number":text(payload.get("invoice_number"),"o número da nota fiscal",100),
      "received_qty":display(qty(payload.get("quantity"),"a quantidade recebida")),
      "notes":text(payload.get("notes",""),"as observações",1200,False)
    }

def received_total(con,item_id,exclude_id=None):
    values=con.execute("SELECT id,received_qty FROM purchase_receipts WHERE item_id=?",(item_id,))
    return sum((Decimal(row["received_qty"]) for row in values if row["id"]!=exclude_id),Decimal("0"))

def ensure_capacity(con,item_id,amount,exclude_id=None):
    item=get_item(con,item_id)
    paid=received_total(con,item_id,exclude_id)
    if paid+Decimal(amount)>Decimal(item["ordered_qty"]):
        remaining=Decimal(item["ordered_qty"])-paid
        raise ValueError("Entrega maior que o saldo do pedido. Disponível: "+display(remaining)+" "+item["unit"]+".")

def ensure_not_duplicate(con,item_id,values,exclude_id=None):
    for row in con.execute("""SELECT id,received_date,invoice_number,received_qty FROM purchase_receipts
      WHERE item_id=?""",(item_id,)):
        if row["id"]!=exclude_id and row["received_date"]==values["received_date"] and \
           row["invoice_number"].casefold()==values["invoice_number"].casefold() and \
           Decimal(row["received_qty"])==Decimal(values["received_qty"]):
            raise ValueError("Esta mesma nota, data e quantidade já foram lançadas neste produto.")

def summary(con,cid):
    ensure_control(con,cid)
    items=[dict(row) for row in con.execute(
        "SELECT * FROM purchase_items WHERE control_id=? ORDER BY id DESC",(cid,))]
    history=[]
    complete=partial=pending=0
    for item in items:
        receipts=[dict(row) for row in con.execute("""SELECT * FROM purchase_receipts
          WHERE item_id=? ORDER BY received_date DESC,id DESC""",(item["id"],))]
        got=sum((Decimal(r["received_qty"]) for r in receipts),Decimal("0"))
        ordered=Decimal(item["ordered_qty"])
        rest=ordered-got
        item["received_qty"]=display(got)
        item["remaining_qty"]=display(rest)
        item["receipts_count"]=len(receipts)
        item["status"]="complete" if rest==0 else ("partial" if got>0 else "pending")
        if rest==0:complete+=1
        elif got>0:partial+=1
        else:pending+=1
        for receipt in receipts:
            history.append({**receipt,
                "order_number":item["order_number"],"supplier":item["supplier"],
                "product":item["product"],"unit":item["unit"]})
    history.sort(key=lambda row:(row["received_date"],row["id"]),reverse=True)
    return {
      "control_id":cid,
      "totals":{"items":len(items),"complete":complete,"partial":partial,
        "pending":pending,"receipts":len(history)},
      "items":items,"receipts":history
    }

def handle(handler,con,method,path):
    root=re.fullmatch(r"/api/controls/(\d+)/receiving(?:/(items))?",path)
    itemroute=re.fullmatch(r"/api/receiving-items/(\d+)(?:/(receipts))?",path)
    receiptroute=re.fullmatch(r"/api/receiving-receipts/(\d+)",path)
    if root:
        cid=int(root[1]);ensure_control(con,cid)
        if method=="GET" and root[2] is None:
            return handler.send(summary(con,cid))
        if method=="POST" and root[2]=="items":
            row=validate_item(handler.input())
            con.execute("BEGIN IMMEDIATE")
            cur=con.execute("""INSERT INTO purchase_items(control_id,order_number,supplier,product,unit,ordered_qty)
              VALUES(?,?,?,?,?,?)""",(cid,*row.values()))
            con.commit()
            return handler.send({"id":cur.lastrowid},201)
    if itemroute:
        iid=int(itemroute[1]);item=get_item(con,iid)
        if method=="POST" and itemroute[2]=="receipts":
            row=validate_receipt(handler.input())
            con.execute("BEGIN IMMEDIATE")
            ensure_capacity(con,iid,row["received_qty"])
            ensure_not_duplicate(con,iid,row)
            cur=con.execute("""INSERT INTO purchase_receipts
              (item_id,received_date,invoice_number,received_qty,notes) VALUES(?,?,?,?,?)""",
              (iid,*row.values()))
            con.commit()
            return handler.send({"id":cur.lastrowid},201)
        if itemroute[2] is None and method in ("PUT","DELETE"):
            con.execute("BEGIN IMMEDIATE")
            if method=="DELETE":
                if received_total(con,iid)>0:
                    raise ValueError("Este produto possui recebimentos. Exclua as entregas antes de excluir o item.")
                con.execute("DELETE FROM purchase_items WHERE id=?",(iid,))
            else:
                row=validate_item(handler.input())
                if Decimal(row["ordered_qty"])<received_total(con,iid):
                    raise ValueError("A quantidade pedida não pode ser menor que a quantidade já recebida.")
                con.execute("""UPDATE purchase_items SET order_number=?,supplier=?,product=?,unit=?,ordered_qty=?,
                  updated_at=CURRENT_TIMESTAMP WHERE id=?""",(*row.values(),iid))
            con.commit()
            return handler.send({"ok":True})
    if receiptroute and method in ("PUT","DELETE"):
        rid=int(receiptroute[1])
        existing=get_receipt(con,rid)
        con.execute("BEGIN IMMEDIATE")
        if method=="DELETE":
            con.execute("DELETE FROM purchase_receipts WHERE id=?",(rid,))
        else:
            row=validate_receipt(handler.input())
            ensure_capacity(con,existing["item_id"],row["received_qty"],rid)
            ensure_not_duplicate(con,existing["item_id"],row,rid)
            con.execute("""UPDATE purchase_receipts SET received_date=?,invoice_number=?,received_qty=?,notes=?,
              updated_at=CURRENT_TIMESTAMP WHERE id=?""",(*row.values(),rid))
        con.commit()
        return handler.send({"ok":True})
    raise LookupError("Operação não encontrada.")
