"""Prévia e confirmação de recebimentos a partir de XML NF-e, sem guardar o XML."""
import base64
from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher
import re
import unicodedata
from xml.etree import ElementTree as ET
import receiving

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
def similarity(a,b,supplier=False):
    a,b=norm(a),norm(b)
    if not a or not b:return 0.
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
    seen=set()
    for line,selected in zip(xml["lines"],selections):
        if selected is None:continue
        if type(selected) is not int or selected not in orders:raise ValueError("Pedido não encontrado.")
        item=orders[selected]
        if item["closed"]:raise ValueError("Pedido concluído: "+item["order_number"])
        quantity=converted(line["quantity"],line["unit"],item["unit"])
        if quantity is None:raise ValueError("Unidade incompatível: "+line["name"])
        key=selected
        already=seen_count= sum(q for iid,q in chosen if iid==key)
        if quantity+Decimal(already)>Decimal(item["remaining_qty"]):
            raise ValueError("Quantidade superior ao saldo disponível: "+item["product"])
        chosen.append((selected,quantity))
        seen.add((item["order_number"],item["supplier"]))
    # Uma mesma NF-e pode ter vários itens no mesmo pedido: conferir duplicidade contra histórico,
    # sem proibir itens diferentes na própria importação.
    for order,supplier in seen:
        existing=next(i for i in orders.values() if i["order_number"]==order and i["supplier"]==supplier)
        receiving.ensure_invoice_unique_in_order(con,cid,order,xml["invoice_number"])
    for iid,quantity in chosen:
        con.execute("""INSERT INTO purchase_receipts
            (item_id,received_date,invoice_number,received_qty,access_key,notes)
            VALUES(?,?,?,?,?,?)""",
            (iid,xml["date"],xml["invoice_number"],receiving.display(quantity),xml["access_key"],
             "Lançamento por XML NF-e"))
    con.commit()
    return {"inserted":len(chosen)}

def handle(handler,con,method,path):
    m=re.fullmatch(r"/api/controls/(\d+)/receiving/xml/(preview|confirm)",path)
    if not m or method!="POST":raise LookupError("Operação não encontrada.")
    cid=int(m[1])
    receiving.ensure_control(con,cid)
    payload=handler.input(max_bytes=3_000_000)
    return handler.send(preview(con,cid,payload) if m[2]=="preview" else confirm(con,cid,payload))
