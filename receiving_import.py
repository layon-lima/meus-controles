"""Importador local para Controle de Recebimento de Produtos.

Arquivo JSON permanece na máquina do usuário; a API recebe o conteúdo apenas
localmente. Preserva multiplicidade de itens iguais e não cria notas fiscais.
"""
from collections import Counter
import hashlib
import json
import re
import unicodedata
import receiving

FORMAT="central-controles-recebimento-v1"
MAX_ITEMS=800

def normalize(value):
    raw=unicodedata.normalize("NFKD",str(value or ""))
    return " ".join("".join(ch for ch in raw if not unicodedata.combining(ch)).casefold().split())

def initialize(con):
    con.execute("""CREATE TABLE IF NOT EXISTS receiving_imports(
      id INTEGER PRIMARY KEY,
      control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_count INTEGER NOT NULL,
      inserted_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(control_id,fingerprint)
    )""")

def prepare(con,cid,doc):
    control=receiving.ensure_control(con,cid)
    if not isinstance(doc,dict) or doc.get("format")!=FORMAT:
        raise ValueError("O arquivo não está no formato de importação de recebimentos.")
    source=receiving.text(doc.get("control"),"o nome do controle de destino",150)
    if normalize(source)!=normalize(control["name"]):
        raise ValueError("Este arquivo pertence ao controle '"+source+"', e não a '"+control["name"]+"'.")
    incoming=doc.get("items")
    if not isinstance(incoming,list) or not 1<=len(incoming)<=MAX_ITEMS:
        raise ValueError("O arquivo deve conter de 1 a 800 produtos.")
    items=[]
    for i,item in enumerate(incoming,1):
        if not isinstance(item,dict):
            raise ValueError("Produto "+str(i)+": registro inválido.")
        try:
            # Fornecedor não informado permanece vazio, sem nome inventado.
            validated={
              "order_number":receiving.text(item.get("order_number"),"a referência do pedido",100),
              "supplier":receiving.text(item.get("supplier",""),"o fornecedor",160,False),
              "product":receiving.text(item.get("product"),"o produto",160),
              "unit":receiving.text(item.get("unit"),"a unidade",12),
              "ordered_qty":receiving.display(receiving.qty(item.get("ordered_qty")))
            }
        except (TypeError,ValueError) as err:
            raise ValueError("Produto "+str(i)+": "+str(err)) from None
        items.append(validated)
    payload={"format":FORMAT,"control":normalize(source),"items":items}
    fingerprint=hashlib.sha256(json.dumps(payload,
      ensure_ascii=False,sort_keys=True,separators=(",",":")).encode("utf-8")).hexdigest()
    already=con.execute("""SELECT id FROM receiving_imports WHERE control_id=? AND fingerprint=?""",
      (cid,fingerprint)).fetchone() is not None

    # Multiconjunto: dois produtos iguais em um mesmo pedido são duas linhas.
    existing=Counter((row["order_number"],normalize(row["supplier"]),
        normalize(row["product"]),row["unit"],
        receiving.display(receiving.qty(row["ordered_qty"])))
      for row in con.execute("""SELECT order_number,supplier,product,unit,ordered_qty
        FROM purchase_items WHERE control_id=?""",(cid,)))
    to_insert=[]
    matched=0
    for item in items:
        key=(item["order_number"],normalize(item["supplier"]),normalize(item["product"]),
             item["unit"],item["ordered_qty"])
        if existing[key]>0:
            existing[key]-=1
            matched+=1
        else:
            to_insert.append(item)
    totals={}
    for item in items:
        totals[item["unit"]]=totals.get(item["unit"],0)+1
    return {
        "source":source,"count":len(items),"fingerprint":fingerprint,
        "matched":matched,
        "new_count":0 if already else len(to_insert),
        "already_imported":already,
        "can_import":not already and len(to_insert)>0,
        "items_by_unit":totals,
        "preview_items":items[:60],
        "unknown_suppliers":sum(1 for i in items if not i["supplier"]),
        "receipts_created":0,
        "_new_items":to_insert
    }

def preview(con,cid,doc):
    result=prepare(con,cid,doc)
    result.pop("_new_items")
    return result

def confirm(con,cid,doc,fingerprint):
    if not con.in_transaction:
        con.execute("BEGIN IMMEDIATE")
    report=prepare(con,cid,doc)
    if not isinstance(fingerprint,str) or fingerprint!=report["fingerprint"]:
        raise ValueError("Arquivo diferente da prévia. Confira os pedidos novamente.")
    if report["already_imported"]:
        return {"imported":0,"matched":report["count"],"already_imported":True}
    for row in report["_new_items"]:
        con.execute("""INSERT INTO purchase_items(control_id,order_number,supplier,product,unit,ordered_qty)
          VALUES(?,?,?,?,?,?)""",(cid,*row.values()))
    con.execute("""INSERT INTO receiving_imports(control_id,fingerprint,source_name,source_count,inserted_count)
      VALUES(?,?,?,?,?)""",(cid,fingerprint,report["source"],report["count"],len(report["_new_items"])))
    con.commit()
    return {"imported":len(report["_new_items"]),"matched":report["matched"],
      "already_imported":False}

def handle(handler,con,method,path):
    match=re.fullmatch(r"/api/controls/(\d+)/receiving/import/(preview|confirm)",path)
    if match is None or method!="POST":
        raise LookupError("Ação de importação inválida.")
    cid=int(match[1])
    data=handler.input()
    if not isinstance(data,dict):
        raise ValueError("Importação inválida.")
    doc=data.get("document")
    if match[2]=="preview":
        return handler.send(preview(con,cid,doc))
    return handler.send(confirm(con,cid,doc,data.get("fingerprint")),201)
