"""Prévia e confirmação de recebimentos a partir de XML NF-e, sem guardar o XML."""
import base64
from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher
import re
import unicodedata
from xml.etree import ElementTree as ET
import receiving

def initialize(con):
    con.executescript("""
      CREATE TABLE IF NOT EXISTS receiving_xml_pending(
        id INTEGER PRIMARY KEY,
        control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
        access_key TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        issued_date TEXT NOT NULL,
        supplier TEXT NOT NULL,
        cnpj TEXT NOT NULL DEFAULT '',
        line_index INTEGER NOT NULL,
        product TEXT NOT NULL,
        product_code TEXT NOT NULL DEFAULT '',
        quantity TEXT NOT NULL,
        unit TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(control_id,access_key,line_index)
      );
    """)

def child(parent,name):
    return next((e for e in parent.iter() if e.tag.rsplit("}",1)[-1]==name),None) if parent is not None else None

def val(parent,name):
    el=child(parent,name)
    return (el.text or "").strip() if el is not None else ""

def norm(value):
    value=unicodedata.normalize("NFKD",str(value).upper())
    value="".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"\s+"," ",re.sub(r"[^A-Z0-9 ]"," ",value)).strip()

IGNORE={"LTDA","EIRELI","SA","S","A","COMERCIO","INDUSTRIA","INDUSTRIAL","BRASIL",
        "DISTRIBUIDORA","DE","DA","DO","DOS","DAS","E","PRODUTOS","AGRICOLAS","AGRO"}
def product_name(value):
    value=norm(value)
    value=re.sub(r"\\b(?:LOTE|PESO|VALIDADE|FABRICACAO)\\b.*$", "", value).strip()
    return value

def similarity(a,b,supplier=False):
    a,b=(norm(a),norm(b)) if supplier else (product_name(a),product_name(b))
    if not a or not b:return 0.
    if a==b or (len(min(a,b,key=len))>=4 and (a.startswith(b+" ") or b.startswith(a+" "))):
        return 1. if a==b else .96
    if a==b:return 1.
    x=set(a.split())-IGNORE if supplier else set(a.split())
    y=set(b.split())-IGNORE if supplier else set(b.split())
    if not x or not y:return 0.
    overlap=len(x&y)/max(len(x),len(y))
    return round(max(overlap,SequenceMatcher(None,a,b).ratio()*.93),3)

UNITS={"KG":("mass",Decimal("1")),"KGM":("mass",Decimal("1")),
       "T":("mass",Decimal("1000")),"TON":("mass",Decimal("1000")),"TONELADA":("mass",Decimal("1000")),
       "G":("mass",Decimal(".001")),"GR":("mass",Decimal(".001")),
       "L":("volume",Decimal("1")),"LT":("volume",Decimal("1")),"LITRO":("volume",Decimal("1")),
       "ML":("volume",Decimal(".001")),
       "UN":("count",Decimal("1")),"UND":("count",Decimal("1")),"UNID":("count",Decimal("1"))}
def converted(quantity,from_unit,to_unit):
    a,b=UNITS.get(norm(from_unit).replace(" ","")),UNITS.get(norm(to_unit).replace(" ",""))
    if a and b and a[0]==b[0]:return (Decimal(str(quantity))*a[1]/b[1])
    if norm(from_unit)==norm(to_unit):return Decimal(str(quantity))
    return None

def parse(raw):
    if not isinstance(raw,bytes) or len(raw)>2_000_000 or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("XML de NF-e inválido ou maior que 2 MB.")
    try:root=ET.fromstring(raw)
    except ET.ParseError:raise ValueError("XML inválido.") from None
    inf=child(root,"infNFe")
    if inf is None:raise ValueError("O arquivo não contém uma NF-e.")
    ide=child(inf,"ide")
    emit=child(inf,"emit")
    supplier=val(emit,"xNome")
    cnpj=val(emit,"CNPJ") or val(emit,"CPF")
    number=val(ide,"nNF")
    issued=(val(ide,"dhEmi") or val(ide,"dEmi"))[:10]
    if not number or not supplier:raise ValueError("NF-e sem número ou emitente.")
    try:date.fromisoformat(issued)
    except ValueError:raise ValueError("NF-e sem data válida.") from None
    ident=inf.attrib.get("Id","")
    key=ident[3:] if ident.startswith("NFe") else ""
    if key and not re.fullmatch(r"\d{44}",key):key=""
    if not key:
        key=val(child(root,"protNFe"),"chNFe")
    if key and not re.fullmatch(r"\d{44}",key):
        raise ValueError("Chave de acesso da NF-e inválida.")
    lines=[]
    for det in [e for e in inf if e.tag.rsplit("}",1)[-1]=="det"]:
        prod=child(det,"prod")
        name=val(prod,"xProd")
        amount=val(prod,"qCom")
        unit=val(prod,"uCom")
        if not name or not amount or not unit:raise ValueError("Item da NF-e sem produto, unidade ou quantidade.")
        quantity=receiving.qty(amount)
        lines.append({"index":len(lines),"name":name,"code":val(prod,"cProd"),
                      "quantity":receiving.display(quantity),"unit":unit})
    if not lines:raise ValueError("NF-e sem produtos.")
    return {"invoice_number":number,"access_key":key,"date":issued,
            "supplier":supplier,"cnpj":cnpj,"lines":lines}

def candidates(orders,xml,line):
    rows=[]
    for item in orders:
        if item["closed"] or Decimal(item["remaining_qty"])<=0:continue
        q=converted(line["quantity"],line["unit"],item["unit"])
        if q is None or q<=0 or q>Decimal(item["remaining_qty"]):continue
        supp=similarity(xml["supplier"],item["supplier"],True)
        prod=similarity(line["name"],item["product"])
        eligible=supp>=.72 and prod>=.67
        rows.append({"id":item["id"],"order":item["order_number"],"supplier":item["supplier"],
                     "product":item["product"],"unit":item["unit"],"quantity":receiving.display(q),
                     "remaining":item["remaining_qty"],"supplier_score":supp,"product_score":prod,
                     "eligible":eligible,"score":round(supp*.43+prod*.57,3)})
    rows.sort(key=lambda r:(not r["eligible"],-r["score"],r["order"]))
    return rows[:30]

def preview(con,cid,payload):
    raw=payload.get("xml")
    if not isinstance(raw,str):raise ValueError("Envie um XML.")
    try:xml=parse(base64.b64decode(raw,validate=True))
    except (ValueError,TypeError) as exc:
        if isinstance(exc,ValueError) and "XML" in str(exc):raise
        raise ValueError("Arquivo XML inválido.") from None
    orders=receiving.summary(con,cid)["items"]
    for line in xml["lines"]:
        line["options"]=candidates(orders,xml,line)
        allowed=[o for o in line["options"] if o["eligible"]]
        line["suggested_id"]=allowed[0]["id"] if len(allowed)==1 and allowed[0]["score"]>=.88 else None
    return xml

def confirm(con,cid,payload):
    xml=parse(base64.b64decode(payload.get("xml",""),validate=True))
    selections=payload.get("selections")
    if not isinstance(selections,list) or len(selections)!=len(xml["lines"]):
        raise ValueError("Revise todos os itens antes de confirmar.")
    if not any(x is not None for x in selections):raise ValueError("Nenhum produto selecionado.")
    con.execute("BEGIN IMMEDIATE")
    orders={x["id"]:x for x in receiving.summary(con,cid)["items"]}
    chosen=[]
    pending=[]
    seen=set()
    # Verificar notas ja importadas antes de saldo, para informar duplicidade corretamente.
    selected_orders=set()
    for selected in selections:
        if type(selected) is int and selected in orders:
            item=orders[selected]
            selected_orders.add((item["order_number"],item["supplier"]))
    for order,supplier in selected_orders:
        receiving.ensure_invoice_unique_in_order(con,cid,order,xml["invoice_number"])
    for line,selected in zip(xml["lines"],selections):
        if selected=="pending":
            pending.append(line)
            continue
        if selected is None:raise ValueError("Escolha pedido ou Sem pedido para cada produto.")
        if type(selected) is not int or selected not in orders:raise ValueError("Pedido não encontrado.")
        item=orders[selected]
        if item["closed"]:raise ValueError("Pedido concluído: "+item["order_number"])
        quantity=converted(line["quantity"],line["unit"],item["unit"])
        if quantity is None:raise ValueError("Unidade incompatível: "+line["name"])
        key=selected
        already=sum(q for iid,q in chosen if iid==key)
        if quantity+Decimal(already)>Decimal(item["remaining_qty"]):
            raise ValueError("Quantidade superior ao saldo disponível: "+item["product"])
        chosen.append((selected,quantity))
        seen.add((item["order_number"],item["supplier"]))
    # Uma mesma NF-e pode ter vários itens no mesmo pedido: conferir duplicidade contra histórico,
    # sem proibir itens diferentes na própria importação.
    for order,supplier in seen:
        existing=next(i for i in orders.values() if i["order_number"]==order and i["supplier"]==supplier)
        receiving.ensure_invoice_unique_in_order(con,cid,order,xml["invoice_number"])
    for line in pending:
        if not xml["access_key"]:raise ValueError("Chave da NF-e necessária para guardar itens sem pedido.")
        if con.execute("SELECT id FROM receiving_xml_pending WHERE control_id=? AND access_key=? AND line_index=?",
          (cid,xml["access_key"],line["index"])).fetchone():
            raise ValueError("Este item já está em Sem pedido.")
    for iid,quantity in chosen:
        con.execute("""INSERT INTO purchase_receipts
            (item_id,received_date,invoice_number,received_qty,access_key,notes)
            VALUES(?,?,?,?,?,?)""",
            (iid,xml["date"],xml["invoice_number"],receiving.display(quantity),xml["access_key"],
             "Lançamento por XML NF-e"))
    for line in pending:
        con.execute("""INSERT INTO receiving_xml_pending
         (control_id,access_key,invoice_number,issued_date,supplier,cnpj,line_index,
          product,product_code,quantity,unit) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
         (cid,xml["access_key"],xml["invoice_number"],xml["date"],xml["supplier"],xml["cnpj"],
          line["index"],line["name"],line["code"],line["quantity"],line["unit"]))
    con.commit()
    return {"inserted":len(chosen),"pending":len(pending)}

def pending_list(con,cid):
    receiving.ensure_control(con,cid)
    return [dict(row) for row in con.execute(
        "SELECT * FROM receiving_xml_pending WHERE control_id=? ORDER BY id DESC",(cid,))]

def assign_pending(con,cid,pid,payload):
    iid=payload.get("item_id")
    if type(iid) is not int:raise ValueError("Selecione um pedido válido.")
    con.execute("BEGIN IMMEDIATE")
    row=con.execute("SELECT * FROM receiving_xml_pending WHERE control_id=? AND id=?",(cid,pid)).fetchone()
    if not row:raise LookupError("Lançamento pendente não encontrado.")
    item=receiving.get_item(con,iid)
    if item["control_id"]!=cid:raise ValueError("Pedido de outro controle.")
    amount=converted(row["quantity"],row["unit"],item["unit"])
    if amount is None:raise ValueError("Unidade incompatível.")
    receiving.ensure_capacity(con,iid,receiving.display(amount))
    receiving.ensure_invoice_unique_in_order(con,cid,item["order_number"],row["invoice_number"])
    con.execute("""INSERT INTO purchase_receipts
      (item_id,received_date,invoice_number,received_qty,access_key,notes)
      VALUES(?,?,?,?,?,?)""",(iid,row["issued_date"],row["invoice_number"],
      receiving.display(amount),row["access_key"],"Vinculado de Sem pedido (XML)"))
    con.execute("DELETE FROM receiving_xml_pending WHERE id=?",(pid,))
    con.commit()
    return {"ok":True}

def handle(handler,con,method,path):
    m=re.fullmatch(r"/api/controls/(\d+)/receiving/xml/(preview|confirm)",path)
    listing=re.fullmatch(r"/api/controls/(\\d+)/receiving/xml/pending",path)
    assigning=re.fullmatch(r"/api/controls/(\\d+)/receiving/xml/pending/(\\d+)/assign",path)
    if listing and method=="GET":
        return handler.send({"items":pending_list(con,int(listing[1]))})
    if assigning and method=="POST":
        return handler.send(assign_pending(con,int(assigning[1]),int(assigning[2]),handler.input()))
    if not m or method!="POST":raise LookupError("Operação não encontrada.")
    cid=int(m[1])
    receiving.ensure_control(con,cid)
    payload=handler.input(max_bytes=3_000_000)
    return handler.send(preview(con,cid,payload) if m[2]=="preview" else confirm(con,cid,payload))
