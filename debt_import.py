"""Importação local auditável para controles de dívidas.

O arquivo de pagamentos fica exclusivamente no computador do usuário e
nunca é publicado no repositório. Importação transacional e idempotente.
"""
from collections import Counter
from decimal import Decimal
import hashlib
import json
import re
import unicodedata
import debt

FORMAT="central-controles-divida-v1"
MAX_ROWS=500

def normalize(text):
    value=unicodedata.normalize("NFKD",str(text or ""))
    value="".join(ch for ch in value if not unicodedata.combining(ch))
    return " ".join(value.casefold().split())

def initialize(con):
    con.execute("""CREATE TABLE IF NOT EXISTS debt_imports(
       id INTEGER PRIMARY KEY,
       control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
       fingerprint TEXT NOT NULL,
       source_name TEXT NOT NULL,
       source_count INTEGER NOT NULL,
       inserted_count INTEGER NOT NULL,
       imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(control_id,fingerprint)
    )""")

def prepare(con,cid,document):
    ctl=debt.control(con,cid)
    if not isinstance(document,dict) or document.get("format")!=FORMAT:
        raise ValueError("Arquivo de importação não reconhecido.")
    source_name=debt.label(document.get("control"),"o nome do controle de destino",150)
    target=normalize(source_name).removeprefix("controle ")
    actual=normalize(ctl["name"]).removeprefix("controle ")
    if target!=actual:
        raise ValueError("Este arquivo pertence ao controle '"+source_name+"', não a '"+ctl["name"]+"'.")
    raw=document.get("payments")
    if not isinstance(raw,list) or not 1<=len(raw)<=MAX_ROWS:
        raise ValueError("O arquivo deve conter entre 1 e 500 pagamentos.")
    payments=[]
    for index,item in enumerate(raw,1):
        try:
            validated=debt.validate_payment(item)
        except (ValueError,TypeError,KeyError) as exc:
            raise ValueError("Pagamento "+str(index)+": "+str(exc)) from None
        payments.append(validated)
    # Hash de conteúdo canônico, não do nome local do arquivo.
    canonical={"control":normalize(source_name),"payments":payments,"format":FORMAT}
    fingerprint=hashlib.sha256(json.dumps(
        canonical,ensure_ascii=False,sort_keys=True,separators=(",",":")
    ).encode("utf-8")).hexdigest()
    done=con.execute("SELECT inserted_count FROM debt_imports WHERE control_id=? AND fingerprint=?",
                     (cid,fingerprint)).fetchone()
    seen=Counter((p["payment_date"][:7],normalize(p["description"]),p["amount"])
                 for p in con.execute("SELECT payment_date,description,amount FROM debt_payments WHERE control_id=?",
                                      (cid,)))
    to_insert=[]
    matching=0
    for item in payments:
        key=(item["payment_date"][:7],normalize(item["description"]),item["amount"])
        if seen[key]>0:
            seen[key]-=1
            matching+=1
        else:
            to_insert.append(item)
    total=sum((Decimal(p["amount"]) for p in payments),Decimal("0"))
    fresh_total=sum((Decimal(p["amount"]) for p in to_insert),Decimal("0"))
    opening=Decimal(debt.settings(con,cid)["opening_amount"])
    existing=debt.total_paid(con,cid)
    remaining=opening-existing
    return {
      "fingerprint":fingerprint,
      "source":source_name,
      "count":len(payments),
      "total":debt.money(total),
      "previously_recorded":matching,
      "new_count":0 if done else len(to_insert),
      "new_total":debt.money(0 if done else fresh_total),
      "initial_debt":debt.money(opening),
      "current_balance":debt.money(remaining),
      "projected_balance":debt.money(remaining-(Decimal(0) if done else fresh_total)),
      "already_imported":done is not None,
      "can_import":(done is None and remaining>=fresh_total),
      "_rows":to_insert
    }

def preview(con,cid,document):
    report=prepare(con,cid,document)
    report.pop("_rows")
    return report

def commit(con,cid,document,fingerprint):
    if not con.in_transaction:
        con.execute("BEGIN IMMEDIATE")
    report=prepare(con,cid,document)
    if not isinstance(fingerprint,str) or fingerprint!=report["fingerprint"]:
        raise ValueError("Arquivo alterado desde a conferência. Faça a prévia novamente.")
    if report["already_imported"]:
        return {"already_imported":True,"imported":0,"skipped":report["count"],"total":report["total"]}
    if not report["can_import"]:
        raise ValueError("O saldo restante desta dívida é insuficiente para os pagamentos não registrados. Confira o valor inicial nos Ajustes, sem alterar os pagamentos.")
    for item in report["_rows"]:
        con.execute("""INSERT INTO debt_payments(control_id,payment_date,description,amount,notes)
            VALUES(?,?,?,?,?)""",(cid,item["payment_date"],item["description"],item["amount"],item["notes"]))
    con.execute("""INSERT INTO debt_imports(control_id,fingerprint,source_name,source_count,inserted_count)
      VALUES(?,?,?,?,?)""",(cid,report["fingerprint"],report["source"],report["count"],len(report["_rows"])))
    con.commit()
    return {"already_imported":False,"imported":len(report["_rows"]),
            "skipped":report["previously_recorded"],"total":report["total"]}

def handle(handler,con,method,path):
    route=re.fullmatch(r"/api/controls/(\d+)/debt/import/(preview|confirm)",path)
    if not route or method!="POST":
        raise LookupError("Ação de importação não encontrada.")
    cid=int(route[1])
    payload=handler.input()
    doc=payload.get("document")
    if route[2]=="preview":
        return handler.send(preview(con,cid,doc))
    result=commit(con,cid,doc,payload.get("fingerprint"))
    return handler.send(result,201)
