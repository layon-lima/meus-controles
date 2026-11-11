"""Prévia e confirmação de recebimentos a partir de XML NF-e, sem guardar o XML."""
import base64
from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher
import re
import unicodedata
from xml.etree import ElementTree as ET
import receiving
import receiving_gfarm
import json

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
    receiving_gfarm.initialize(con)

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
    value=re.sub(r"\b(?:LOTE|PESO|VALIDADE|FABRICACAO)\b.*$", "", value).strip()
    # KCL é a abreviação comercial de cloreto de potássio.
    # Normalizar o sinônimo ajuda a propor pedidos sem equivaler produtos distintos.
    value=re.sub(r"\bKCL\b", "CLORETO POTASSIO", value)
    value=re.sub(r"\b(?:DE|DO|DA)\b", " ", value)
    return " ".join(value.split())

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
       "T":("mass",Decimal("1000")),"TO":("mass",Decimal("1000")),"TON":("mass",Decimal("1000")),"TONELADA":("mass",Decimal("1000")),
       "G":("mass",Decimal(".001")),"GR":("mass",Decimal(".001")),
       "L":("volume",Decimal("1")),"LT":("volume",Decimal("1")),"LITRO":("volume",Decimal("1")),
       "ML":("volume",Decimal(".001")),
       "UN":("count",Decimal("1")),"UND":("count",Decimal("1")),"UNID":("count",Decimal("1"))}
def converted(quantity,from_unit,to_unit):
    a,b=UNITS.get(norm(from_unit).replace(" ","")),UNITS.get(norm(to_unit).replace(" ",""))
    if a and b and a[0]==b[0]:return (Decimal(str(quantity))*a[1]/b[1])
    if norm(from_unit)==norm(to_unit):return Decimal(str(quantity))
    return None

def quantity_in_order_unit(xml_quantity,xml_unit,order_unit,manual_quantity=None):
    """Conversão conhecida é automática; unidades incompatíveis exigem equivalência informada.
    O valor manual representa o TOTAL da linha da NF-e na unidade cadastrada, não um fator.
    """
    amount=converted(xml_quantity,xml_unit,order_unit)
    if amount is not None:
        if manual_quantity is not None:
            raise ValueError("Esta unidade já possui conversão automática. Retire a equivalência manual.")
        return amount,False
    if manual_quantity is None or str(manual_quantity).strip()=="":
        raise ValueError(
            "Unidades incompatíveis: informe quanto "+str(xml_quantity)+" "+str(xml_unit)+
            " equivalem na unidade cadastrada ("+str(order_unit)+").")
    return receiving.qty(manual_quantity,"a quantidade equivalente na unidade cadastrada"),True

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
    serie=val(ide,"serie")
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
        rastro=child(prod,"rastro")
        lines.append({"index":len(lines),"name":name,"code":val(prod,"cProd"),
                      "quantity":receiving.display(quantity),"unit":unit,
                      "total_value":val(prod,"vProd"),"unit_price":val(prod,"vUnCom"),
                      "cfop":val(prod,"CFOP"),"ncm":val(prod,"NCM"),
                      "lote":val(rastro,"nLote"),"validade":val(rastro,"dVal")})
    if not lines:raise ValueError("NF-e sem produtos.")
    return {"invoice_number":number,"access_key":key,"date":issued,
            "serie":serie,"supplier":supplier,"cnpj":cnpj,"lines":lines}

def candidates(orders,xml,line):
    rows=[]
    for item in orders:
        if item["closed"] or Decimal(item["remaining_qty"])<=0:continue
        q=converted(line["quantity"],line["unit"],item["unit"])
        supp=similarity(xml["supplier"],item["supplier"],True)
        prod=similarity(line["name"],item["product"])
        selectable=q is not None and q>0 and q<=Decimal(item["remaining_qty"])
        # Produtos realmente semelhantes aparecem mesmo com saldo/unidade
        # incompatíveis, com a razão do bloqueio, em vez de sumirem da busca.
        if not selectable and prod<.52:continue
        reason="" if selectable else (
            "Unidade incompatível" if q is None else "Saldo insuficiente")
        eligible=selectable and supp>=.72 and prod>=.67
        rows.append({"id":item["id"],"order":item["order_number"],"supplier":item["supplier"],
                     "product":item["product"],"unit":item["unit"],
                     "quantity":receiving.display(q) if q is not None else None,
                     "remaining":item["remaining_qty"],"supplier_score":supp,"product_score":prod,
                     "selectable":selectable,"reason":reason,
                     "eligible":eligible,"score":round(supp*.15+prod*.85,3)})
    # Prioridade para o PRODUTO do XML; um fornecedor diferente não deve esconder
    # um KCL correspondente abaixo de dezenas de pedidos de outros produtos.
    rows.sort(key=lambda r:(-r["product_score"],-r["supplier_score"],r["order"],r["id"]))
    return rows[:120]

def ensure_new_access_key(con,cid,key):
    """A mesma chave nao pode ser importada duas vezes, nem em outro pedido."""
    if not re.fullmatch(r"\d{44}",key or ""):
        raise ValueError("Chave de acesso da NF-e de 44 dígitos obrigatória.")
    receipt=con.execute("""SELECT r.id FROM purchase_receipts r
      JOIN purchase_items i ON i.id=r.item_id
      WHERE i.control_id=? AND r.access_key=? LIMIT 1""",(cid,key)).fetchone()
    waiting=con.execute("""SELECT id FROM receiving_xml_pending
      WHERE control_id=? AND access_key=? LIMIT 1""",(cid,key)).fetchone()
    if receipt or waiting:
        raise ValueError("NF-e duplicada: esta chave de acesso já foi lançada ou está em Sem pedido. Nenhum produto foi importado.")


def preview(con,cid,payload):
    raw=payload.get("xml")
    if not isinstance(raw,str):raise ValueError("Envie um XML.")
    try:xml=parse(base64.b64decode(raw,validate=True))
    except (ValueError,TypeError) as exc:
        if isinstance(exc,ValueError) and "XML" in str(exc):raise
        raise ValueError("Arquivo XML inválido.") from None
    ensure_new_access_key(con,cid,xml["access_key"])
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
    manual_quantities=payload.get("manual_quantities")
    if manual_quantities is None:
        manual_quantities=[None]*len(xml["lines"])
    if not isinstance(manual_quantities,list) or len(manual_quantities)!=len(xml["lines"]):
        raise ValueError("Equivalências das unidades inválidas. Confira cada produto.")
    con.execute("BEGIN IMMEDIATE")
    ensure_new_access_key(con,cid,xml["access_key"])
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
    for line,selected,manual in zip(xml["lines"],selections,manual_quantities):
        if selected=="pending":
            pending.append(line)
            continue
        if selected is None:raise ValueError("Escolha pedido ou Sem pedido para cada produto.")
        if type(selected) is not int or selected not in orders:raise ValueError("Pedido não encontrado.")
        item=orders[selected]
        if item["closed"]:raise ValueError("Pedido concluído: "+item["order_number"])
        quantity,is_manual=quantity_in_order_unit(
            line["quantity"],line["unit"],item["unit"],manual)
        key=selected
        already=sum(q for iid,q,_,_ in chosen if iid==key)
        if quantity+already>Decimal(item["remaining_qty"]):
            raise ValueError("Quantidade superior ao saldo disponível: "+item["product"])
        note="Lançamento por XML NF-e"
        if is_manual:
            note+=". Conversão manual: "+line["quantity"]+" "+line["unit"]+(
                " = "+receiving.display(quantity)+" "+item["unit"])
        chosen.append((selected,quantity,note,line))
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
    # Várias linhas do mesmo produto no XML viram um único recebimento,
    # com custo médio ponderado na unidade do pedido.
    grouped={}
    for iid,quantity,note,line in chosen:
        g=grouped.setdefault(iid,{"quantity":Decimal("0"),"total":Decimal("0"),
                                   "lines":0,"line":line,"notes":[]})
        g["quantity"]+=quantity
        g["lines"]+=1
        if note not in g["notes"]:g["notes"].append(note)
        try:
            total=Decimal(line["total_value"] or "0")
        except Exception:
            total=Decimal("0")
        g["total"]+=total
    for iid,g in grouped.items():
        line=g["line"]
        fiscal={
            "serie":xml["serie"],"data_emissao":xml["date"],
            "fornecedor":xml["supplier"],"documento_fornecedor":xml["cnpj"],
            "codigo_produto":line["code"],"valor_unitario":str(g["total"]/g["quantity"]),
            "valor_total":str(g["total"]),"cfop":line["cfop"],"ncm":line["ncm"],
            "lote":line["lote"],"validade":line["validade"],"origem_arquivo":"xml",
            "descricao_xml":line["name"],"unidade_xml":line["unit"]
        }
        notes=" | ".join(g["notes"])
        if g["lines"]>1:notes+=" | "+str(g["lines"])+" linhas da NF-e somadas"
        cur=con.execute("""INSERT INTO purchase_receipts
            (item_id,received_date,invoice_number,received_qty,access_key,notes,
             invoice_issuer,invoice_issuer_document,fiscal_json)
            VALUES(?,?,?,?,?,?,?,?,?)""",
            (iid,xml["date"],xml["invoice_number"],receiving.display(g["quantity"]),xml["access_key"],
             notes,xml["supplier"],xml["cnpj"],json.dumps(fiscal,ensure_ascii=False)))
        receiving_gfarm.queue(con,cur.lastrowid)
    for line in pending:
        fiscal={"serie":xml["serie"],"data_emissao":xml["date"],
                "fornecedor":xml["supplier"],"documento_fornecedor":xml["cnpj"],
                "codigo_produto":line["code"],"valor_unitario":line["unit_price"],
                "valor_total":line["total_value"],"cfop":line["cfop"],
                "ncm":line["ncm"],"lote":line["lote"],"validade":line["validade"],
                "origem_arquivo":"xml","descricao_xml":line["name"],"unidade_xml":line["unit"]}
        con.execute("""INSERT INTO receiving_xml_pending
         (control_id,access_key,invoice_number,issued_date,supplier,cnpj,line_index,
          product,product_code,quantity,unit,fiscal_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
         (cid,xml["access_key"],xml["invoice_number"],xml["date"],xml["supplier"],xml["cnpj"],
          line["index"],line["name"],line["code"],line["quantity"],line["unit"],
          json.dumps(fiscal,ensure_ascii=False)))
    con.commit()
    return {"inserted":len(grouped),"pending":len(pending)}

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
    amount,is_manual=quantity_in_order_unit(
        row["quantity"],row["unit"],item["unit"],payload.get("manual_quantity"))
    receiving.ensure_capacity(con,iid,receiving.display(amount))
    # A nota pode estar parcialmente registrada para outros produtos.
    # Bloquear apenas este mesmo pedido/produto da mesma NF-e.
    receiving.ensure_invoice_product_unique(
        con,cid,item["order_number"],item["product"],row["invoice_number"])
    note="Vinculado de Sem pedido (XML)"
    if is_manual:
        note+=". Conversão manual: "+row["quantity"]+" "+row["unit"]+(
            " = "+receiving.display(amount)+" "+item["unit"])
    fiscal=json.loads(row["fiscal_json"] or "{}")
    if fiscal.get("valor_total") not in (None,""):
        fiscal["valor_unitario"]=str(Decimal(fiscal["valor_total"])/amount)
    cur=con.execute("""INSERT INTO purchase_receipts
      (item_id,received_date,invoice_number,received_qty,access_key,notes,
       invoice_issuer,invoice_issuer_document,fiscal_json)
      VALUES(?,?,?,?,?,?,?,?,?)""",(iid,row["issued_date"],row["invoice_number"],
      receiving.display(amount),row["access_key"],note,row["supplier"],row["cnpj"],
      json.dumps(fiscal,ensure_ascii=False)))
    receiving_gfarm.queue(con,cur.lastrowid)
    con.execute("DELETE FROM receiving_xml_pending WHERE id=?",(pid,))
    con.commit()
    return {"ok":True}

def restore_invoice_issuer(con,cid,payload):
    """Recupera o emitente de notas antigas pelo XML ORIGINAL, sem recriar recebimentos.

    Só altera linhas do mesmo controle com a MESMA chave de 44 dígitos
    e número da nota. Nunca usa o fornecedor do pedido como emitente.
    """
    receiving.ensure_control(con,cid)
    if not isinstance(payload,dict) or not isinstance(payload.get("xml"),str):
        raise ValueError("Envie o XML original da NF-e.")
    try:
        xml=parse(base64.b64decode(payload["xml"],validate=True))
    except (ValueError,TypeError):
        raise ValueError("XML inválido para recuperar o emitente.") from None
    key=xml["access_key"]
    if not key:
        raise ValueError("O XML deve possuir chave de acesso válida para identificar a nota.")
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    rows=list(con.execute("""SELECT r.id,r.invoice_issuer,r.invoice_issuer_document
        FROM purchase_receipts r JOIN purchase_items i ON i.id=r.item_id
        WHERE i.control_id=? AND r.access_key=? AND r.invoice_number=?""",
        (cid,key,xml["invoice_number"])))
    if not rows:
        raise ValueError("Não existe nota registrada com esta chave e número neste controle.")
    updated=0
    for row in rows:
        if row["invoice_issuer"] and row["invoice_issuer_document"]:
            continue
        con.execute("""UPDATE purchase_receipts
            SET invoice_issuer=?,invoice_issuer_document=?,updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND (invoice_issuer='' OR invoice_issuer_document='')""",
            (row["invoice_issuer"] or xml["supplier"],
             row["invoice_issuer_document"] or xml["cnpj"],row["id"]))
        updated+=1
    con.commit()
    return {"matched":len(rows),"updated":updated,"issuer":xml["supplier"],
            "invoice_number":xml["invoice_number"]}


def handle(handler,con,method,path):
    issuer_route=re.fullmatch(r"/api/controls/(\d+)/receiving/xml/issuer",path)
    if issuer_route and method=="POST":
        return handler.send(restore_invoice_issuer(
            con,int(issuer_route[1]),handler.input(max_bytes=3_000_000)))
    m=re.fullmatch(r"/api/controls/(\d+)/receiving/xml/(preview|confirm)",path)
    listing=re.fullmatch(r"/api/controls/(\d+)/receiving/xml/pending",path)
    assigning=re.fullmatch(r"/api/controls/(\d+)/receiving/xml/pending/(\d+)/assign",path)
    if listing and method=="GET":
        return handler.send({"items":pending_list(con,int(listing[1]))})
    if assigning and method=="POST":
        return handler.send(assign_pending(con,int(assigning[1]),int(assigning[2]),handler.input()))
    if not m or method!="POST":raise LookupError("Operação não encontrada.")
    cid=int(m[1])
    receiving.ensure_control(con,cid)
    payload=handler.input(max_bytes=3_000_000)
    return handler.send(preview(con,cid,payload) if m[2]=="preview" else confirm(con,cid,payload))
