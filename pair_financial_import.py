"""Importação de dívidas e pagamentos do Acerto A × B, com prévia e confirmação.

Conserva linhas originais e separa corretamente dívida inicial (A deve B)
de pagamentos reais de A para B. Nenhuma informação financeira entra no Git.
"""
from decimal import Decimal
import hashlib
import json
import re
import unicodedata

import pair

FORMAT="central-pair-financial-v1"
MAX_ROWS=1500

def initialize(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS pair_financial_import_rows(
       id INTEGER PRIMARY KEY,
       control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
       batch_id TEXT NOT NULL,
       source_row INTEGER NOT NULL,
       entry_id INTEGER NOT NULL REFERENCES pair_entries(id) ON DELETE CASCADE,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(control_id,batch_id,source_row),
       UNIQUE(entry_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pair_financial_import
       ON pair_financial_import_rows(control_id,batch_id);
    """)

def norm(v):
    return " ".join(unicodedata.normalize("NFKC",str(v or "")).casefold().split())

def item(raw):
    if not isinstance(raw,dict):
        raise ValueError("Linha inválida no arquivo.")
    index=raw.get("source_row")
    if isinstance(index,bool) or not isinstance(index,int) or index<=0:
        raise ValueError("Número da linha original inválido.")
    kind=raw.get("kind")
    if kind not in ("debt","payment"):
        raise ValueError("Cada movimentação deve ser uma dívida ou um pagamento real.")
    who=raw.get("person")
    if who not in ("A","B"):
        raise ValueError("A movimentação precisa identificar Jonas ou Marcos.")
    orig=raw.get("original_type")
    if orig not in ("ENTRADA","SAÍDA"):
        raise ValueError("Tipo original inválido para a linha "+str(index)+".")
    if (orig=="ENTRADA" and kind!="debt") or (orig=="SAÍDA" and kind!="payment"):
        raise ValueError("A classificação financeira não corresponde à movimentação original.")
    d=raw.get("date")
    d=pair.day(d) if d else None
    description=pair.label(raw.get("description"),"a descrição da linha "+str(index),220)
    receiver=raw.get("original_receiver","")
    if not isinstance(receiver,str) or len(receiver)>160:
        raise ValueError("Nome do destinatário inválido.")
    reason=str(raw.get("date_raw") or "")
    if len(reason)>32:
        raise ValueError("Data original inválida.")
    return {
        "source_row":index,"date":d,"date_raw":reason,
        "kind":kind,"person":who,"amount":pair.money(pair.number(raw.get("amount"))),
        "description":description,"original_type":orig,
        "original_receiver":receiver.strip(),
        "original_balance":str(raw.get("original_balance") or "")[:50]
    }

def analyze(con,cid,payload):
    pair.control(con,cid)
    if not isinstance(payload,dict) or payload.get("format")!=FORMAT:
        raise ValueError("Arquivo incorreto. Selecione o JSON de dívidas e pagamentos.")
    t=payload.get("target")
    if not isinstance(t,dict):
        raise ValueError("O arquivo não informa o destino.")
    names=pair.settings(con,cid)
    # A direção financeira usa A=Jonas e B=Marcos.
    # Apenas comparar conjuntos seria perigoso se o cadastro fosse invertido.
    if (norm(t.get("party_a")),norm(t.get("party_b"))) != (norm(names["party_a"]),norm(names["party_b"])):
        raise ValueError("O controle precisa estar configurado na ordem JONAS (A) × MARCOS (B) para esta importação.")
    if not isinstance(payload.get("source_name"),str) or not payload["source_name"].strip():
        raise ValueError("Origem da planilha não informada.")
    movements=payload.get("movements")
    if not isinstance(movements,list) or not (1<=len(movements)<=MAX_ROWS):
        raise ValueError("O arquivo não contém movimentações válidas.")
    converted=[]
    seen=set()
    for row in movements:
        r=item(row)
        if r["source_row"] in seen:
            raise ValueError("A planilha possui números de linha repetidos.")
        seen.add(r["source_row"])
        converted.append(r)
    data=json.dumps({
      "target":sorted([norm(t.get("party_a")),norm(t.get("party_b"))]),
      "source_name":payload["source_name"].strip(),
      "movements":converted
    },sort_keys=True,ensure_ascii=False,separators=(",",":"))
    batch_id=hashlib.sha256(data.encode("utf-8")).hexdigest()
    imported={x["source_row"] for x in con.execute(
        "SELECT source_row FROM pair_financial_import_rows WHERE control_id=? AND batch_id=?",
        (cid,batch_id))}
    sum_debts=sum((Decimal(x["amount"]) for x in converted if x["kind"]=="debt"),Decimal("0"))
    sum_payments=sum((Decimal(x["amount"]) for x in converted if x["kind"]=="payment"),Decimal("0"))
    missing=[{"source_row":r["source_row"],"description":r["description"]} for r in converted if r["date"] is None]
    unusual=[{"source_row":r["source_row"],"date":r["date"],"description":r["description"]}
             for r in converted if r["date"] and r["date"]<"2000-01-01"]
    # Valores finais são saldo ilustrativo do lote, não o saldo do controle já existente.
    opening=pair.summary(con,cid)["totals"]
    return {
       "batch_id":batch_id,"source_name":payload["source_name"].strip(),
       "count":len(converted),"new_count":len(converted)-len(imported),
       "already_imported":len(imported),"debt_count":sum(r["kind"]=="debt" for r in converted),
       "payment_count":sum(r["kind"]=="payment" for r in converted),
       "debt_total":pair.money(sum_debts),"payment_total":pair.money(sum_payments),
       "net_of_file":pair.money(sum_payments-sum_debts),
       "missing_dates":missing,"unusual_dates":unusual,
       "current_balance":opening["balance"],"movements":converted,"imported":imported
    }

def preview(con,cid,payload):
    return {k:v for k,v in analyze(con,cid,payload).items() if k not in ("movements","imported")}

def corrected_date(row,dates):
    raw=dates.get(str(row["source_row"]))
    if raw:
        return pair.day(raw)
    return row["date"]

def confirm(con,cid,request):
    if not isinstance(request,dict) or not isinstance(request.get("payload"),dict):
        raise ValueError("Envie o arquivo validado na prévia.")
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    checked=analyze(con,cid,request["payload"])
    if checked["batch_id"]!=request.get("batch_id"):
        raise ValueError("O arquivo mudou desde a prévia. Verifique novamente.")
    dates=request.get("corrected_dates") or {}
    if not isinstance(dates,dict):
        raise ValueError("As datas corrigidas são inválidas.")
    allowed={str(r["source_row"]) for r in checked["movements"]}
    if set(dates)-allowed:
        raise ValueError("Há datas corrigidas para linhas inexistentes.")
    date_1900=bool(checked["unusual_dates"])
    if date_1900 and not request.get("accept_unusual_dates"):
        remaining=[r for r in checked["unusual_dates"] if not dates.get(str(r["source_row"]))]
        if remaining:
            raise ValueError("Confirme a data incomum de 1900 ou informe uma correção.")
    rows=[]
    for row in checked["movements"]:
        if row["source_row"] in checked["imported"]:
            continue
        actual_date=corrected_date(row,dates)
        if not actual_date:
            raise ValueError("Informe a data do crédito na linha "+str(row["source_row"])+".")
        pair.check_editable(con,cid,actual_date)
        fields={
          "entry_date":actual_date,
          "debtor":row["person"],
          "amount":row["amount"],
          "description":row["description"],
          "notes":"Importado da planilha original; linha "+str(row["source_row"])+
                  (", data original: "+row["date_raw"] if row["date_raw"] and actual_date!=row["date"] else "")+
                  (", destinatário original: "+row["original_receiver"] if row["original_receiver"] else ""),
          "entry_kind":row["kind"]
        }
        if len(fields["notes"])>1500:
            raise ValueError("Observações muito longas.")
        rows.append((row,fields))
    # A confirmação respeita lançamentos manuais pré-existentes.
    existing={(
        r["entry_date"],r["debtor"],r["amount"],r["description"],r["entry_kind"]
    ) for r in con.execute(
        "SELECT entry_date,debtor,amount,description,entry_kind FROM pair_entries WHERE control_id=?",(cid,))}
    manual_matches=sum((
        (f["entry_date"],f["debtor"],f["amount"],f["description"],f["entry_kind"]) in existing
    ) for _,f in rows)
    if manual_matches and not request.get("accept_matching_existing"):
        raise ValueError(str(manual_matches)+" lançamento(s) idêntico(s) já existem. Confira antes de importar.")
    inserted=0
    for row,fields in rows:
        cur=con.execute("""INSERT INTO pair_entries
          (control_id,entry_date,debtor,amount,description,notes,entry_kind)
          VALUES(?,?,?,?,?,?,?)""",(cid,*fields.values()))
        con.execute("""INSERT INTO pair_financial_import_rows
          (control_id,batch_id,source_row,entry_id) VALUES(?,?,?,?)""",
          (cid,checked["batch_id"],row["source_row"],cur.lastrowid))
        inserted+=1
    con.commit()
    updated=pair.summary(con,cid)["totals"]
    return {"inserted":inserted,"skipped":checked["count"]-inserted,
       "count":checked["count"],"balance":updated["balance"],"settlement":updated["settlement"],
       "batch_id":checked["batch_id"]}
