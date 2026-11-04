"""Registros neutros do A × B (não modificam o saldo) e importação segura em lote."""
from datetime import date
from decimal import Decimal
import hashlib
import json
import re
import unicodedata

import pair

FORMAT="central-pair-records-v1"
MAX_ROWS=1500

def initialize(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS pair_records (
       id INTEGER PRIMARY KEY,
       control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
       record_date TEXT,
       original_date TEXT NOT NULL DEFAULT '',
       amount TEXT NOT NULL,
       from_name TEXT NOT NULL DEFAULT '',
       to_name TEXT NOT NULL DEFAULT '',
       description TEXT NOT NULL,
       notes TEXT NOT NULL DEFAULT '',
       original_type TEXT NOT NULL DEFAULT '',
       original_balance TEXT NOT NULL DEFAULT '',
       batch_id TEXT,
       source_row INTEGER,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(control_id,batch_id,source_row)
    );
    CREATE INDEX IF NOT EXISTS idx_pair_records_control_date
       ON pair_records(control_id,record_date,id);
    CREATE TABLE IF NOT EXISTS pair_transaction_changes (
       id INTEGER PRIMARY KEY,
       control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
       from_kind TEXT NOT NULL,
       from_id INTEGER NOT NULL,
       to_kind TEXT NOT NULL,
       to_id INTEGER NOT NULL,
       previous_json TEXT NOT NULL,
       source_batch_id TEXT,
       source_row INTEGER,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pair_transaction_changes_import
       ON pair_transaction_changes(control_id,source_batch_id,source_row);
    """)

def normalized(value):
    return " ".join(unicodedata.normalize("NFKC",str(value or "")).casefold().split())

def clean(value,key,limit=250):
    if not isinstance(value,str) or len(value)>limit:
        raise ValueError("Campo inválido: "+key+".")
    return value.strip()

def valid_record(raw,allow_undated=False):
    if not isinstance(raw,dict):
        raise ValueError("Registro inválido.")
    d=raw.get("date")
    if d is None or d=="":
        if not allow_undated:
            raise ValueError("Informe uma data para o registro.")
        d=None
    else:
        d=pair.day(d)
    value=pair.money(pair.number(raw.get("amount")))
    description=pair.label(raw.get("description"),"a descrição",220)
    from_name=clean(raw.get("from_name",""),"origem",160)
    to_name=clean(raw.get("to_name",""),"destino",160)
    if not from_name and not to_name and not allow_undated:
        raise ValueError("Informe quem enviou ou quem recebeu.")
    return {
        "record_date":d,
        "original_date":clean(raw.get("date_raw") or (d or ""),"data original",32),
        "amount":value,
        "from_name":from_name,
        "to_name":to_name,
        "description":description,
        "notes":clean(raw.get("notes",""),"observações",1500),
        "original_type":clean(raw.get("original_type",""),"tipo original",30),
        "original_balance":clean(raw.get("original_balance",""),"saldo original",50),
    }

def get(con,cid):
    pair.control(con,cid)
    return [dict(row) for row in con.execute(
        "SELECT * FROM pair_records WHERE control_id=? ORDER BY "
        "CASE WHEN record_date IS NULL THEN 1 ELSE 0 END, record_date DESC, id DESC",
        (cid,))]

def record_by_id(con,rid):
    row=con.execute("SELECT * FROM pair_records WHERE id=?",(rid,)).fetchone()
    if row is None:
        raise LookupError("Registro não encontrado.")
    pair.control(con,row["control_id"])
    return dict(row)

def audit_type_change(con,old,from_kind,to_kind,new_id):
    """Guarda o registro original antes da transferência entre tabelas."""
    con.execute("""INSERT INTO pair_transaction_changes
      (control_id,from_kind,from_id,to_kind,to_id,previous_json,source_batch_id,source_row)
      VALUES(?,?,?,?,?,?,?,?)""",(
      old["control_id"],from_kind,old["id"],to_kind,new_id,
      json.dumps(old,ensure_ascii=False,default=str),
      old.get("batch_id"),old.get("source_row")))

def convert_record_to_financial(con,old,payload):
    """Registro neutro -> dívida ou pagamento; operação atômica sem lançamento duplo."""
    kind=payload.get("kind")
    if kind not in ("debt","payment"):
        raise ValueError("Selecione dívida ou pagamento real.")
    # A origem dos registros antigos pode ser terceiro: exigir direção A/B
    # explícita em vez de inferir a partir do nome cadastrado.
    entry=pair.validate(payload)
    con.execute("BEGIN IMMEDIATE")
    pair.check_editable(con,old["control_id"],entry["entry_date"],
                        *([old["record_date"]] if old["record_date"] else []))
    cur=con.execute("""INSERT INTO pair_entries
      (control_id,entry_date,debtor,amount,description,notes,entry_kind)
      VALUES(?,?,?,?,?,?,?)""",(old["control_id"],*entry.values()))
    audit_type_change(con,old,"record",kind,cur.lastrowid)
    con.execute("DELETE FROM pair_records WHERE id=?",(old["id"],))
    con.commit()
    return {"ok":True,"control_id":old["control_id"],"type_changed":True,
            "new_id":cur.lastrowid,"new_kind":kind}

def convert_financial_to_record(con,old,payload):
    """Dívida/pagamento -> registro informativo, retirando o impacto no saldo."""
    if payload.get("kind")!="record":
        raise ValueError("Tipo de lançamento inválido.")
    names=pair.settings(con,old["control_id"])
    actor=names["party_a"] if old["debtor"]=="A" else names["party_b"]
    counterpart=names["party_b"] if old["debtor"]=="A" else names["party_a"]
    record=valid_record({
      "date":payload.get("date"),"amount":payload.get("amount"),
      "from_name":actor,"to_name":counterpart,
      "description":payload.get("description"),"notes":payload.get("notes",""),
    })
    con.execute("BEGIN IMMEDIATE")
    pair.check_editable(con,old["control_id"],old["entry_date"],record["record_date"])
    cur=con.execute("""INSERT INTO pair_records
        (control_id,record_date,original_date,amount,from_name,to_name,description,notes,
         original_type,original_balance)
        VALUES(?,?,?,?,?,?,?,?,?,?)""",(old["control_id"],*record.values()))
    audit_type_change(con,old,old.get("entry_kind","debt"),"record",cur.lastrowid)
    con.execute("DELETE FROM pair_entries WHERE id=?",(old["id"],))
    con.commit()
    return {"ok":True,"control_id":old["control_id"],"type_changed":True,
            "new_id":cur.lastrowid,"new_kind":"record"}

def batch(con,cid,payload):
    pair.control(con,cid)
    if isinstance(payload,dict) and payload.get("format")=="central-pair-mixed-v1":
        raise ValueError("Este arquivo contém dívidas, pagamentos e salários neutros. A versão atual do aplicativo precisa ser atualizada. No painel da Central, clique em Atualizar tudo e recarregue a página (Ctrl+F5) para usar Importar lançamentos.")
    if isinstance(payload,dict) and payload.get("format")=="central-pair-financial-v1":
        raise ValueError("Este arquivo contém dívidas e pagamentos reais. Use 'Importar dívidas e pagamentos', não 'Importar registros sem saldo'.")
    if not isinstance(payload,dict) or payload.get("format")!=FORMAT:
        raise ValueError("Arquivo inválido. Utilize a importação de registros sem saldo A × B.")
    target=payload.get("target")
    if not isinstance(target,dict):
        raise ValueError("O arquivo não informa o controle de destino.")
    names=pair.settings(con,cid)
    source_names={normalized(target.get("party_a")),normalized(target.get("party_b"))}
    dest_names={normalized(names["party_a"]),normalized(names["party_b"])}
    if source_names!=dest_names:
        raise ValueError("O arquivo é destinado a JONAS × MARCOS. Abra esse controle para importar.")
    source=clean(payload.get("source_name",""),"identificação do arquivo",170)
    if not source:
        raise ValueError("O arquivo não informa sua origem.")
    raw=payload.get("records")
    if not isinstance(raw,list) or not 1<=len(raw)<=MAX_ROWS:
        raise ValueError("Quantidade de linhas inválida no arquivo.")
    parsed=[]
    source_rows=set()
    warnings=[]
    for i,item in enumerate(raw,1):
        row=valid_record(item,allow_undated=True)
        index=item.get("source_row")
        if isinstance(index,bool) or not isinstance(index,int) or index<=0 or index in source_rows:
            raise ValueError("Linha de origem inválida ou repetida.")
        source_rows.add(index)
        row["source_row"]=index
        if not row["record_date"]:
            warnings.append("Linha "+str(index)+": sem data na planilha original.")
        elif row["record_date"]<"2000-01-01":
            warnings.append("Linha "+str(index)+": data "+row["original_date"]+" incomum; preservada sem correção.")
        if not row["from_name"]:
            # Nunca presume que Jonas ou Marcos enviaram o dinheiro.
            pass
        parsed.append(row)
    canonical=json.dumps({"source":source,"target":sorted(source_names),"records":parsed},
                        sort_keys=True,ensure_ascii=False,separators=(",",":"))
    batch_id=hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    duplicates={r["source_row"] for r in con.execute(
        "SELECT source_row FROM pair_records WHERE control_id=? AND batch_id=?",(cid,batch_id))}
    # Registros importados convertidos para dívidas/pagamentos continuam
    # reconhecidos como importados e nunca são duplicados por reimportação.
    duplicates.update(r["source_row"] for r in con.execute(
        """SELECT source_row FROM pair_transaction_changes
           WHERE control_id=? AND source_batch_id=? AND source_row IS NOT NULL""",
        (cid,batch_id)))
    total=sum((Decimal(r["amount"]) for r in parsed),Decimal("0"))
    return {"source_name":source,"batch_id":batch_id,"records":parsed,
            "count":len(parsed),"already_imported":len(duplicates),
            "new_count":len(parsed)-len(duplicates),"total_recorded":pair.money(total),
            "warnings":warnings}

def handle(handler,con,method,url):
    root=re.fullmatch(r"/api/controls/(\d+)/pair/(records|import/(?:preview|confirm))",url)
    record_url=re.fullmatch(r"/api/pair-records/(\d+)",url)
    if root:
        cid=int(root[1]);op=root[2]
        pair.control(con,cid)
        if op=="records" and method=="GET":
            return handler.send({"records":get(con,cid)})
        if op=="records" and method=="POST":
            r=valid_record(handler.input(),allow_undated=False)
            con.execute("BEGIN IMMEDIATE")
            cur=con.execute("""INSERT INTO pair_records
                (control_id,record_date,original_date,amount,from_name,to_name,description,notes,
                 original_type,original_balance)
                VALUES(?,?,?,?,?,?,?,?,?,?)""",(cid,*r.values()))
            con.commit()
            return handler.send({"id":cur.lastrowid},201)
        if op=="import/preview" and method=="POST":
            p=batch(con,cid,handler.input())
            return handler.send({k:v for k,v in p.items() if k!="records"})
        if op=="import/confirm" and method=="POST":
            req=handler.input()
            if not isinstance(req,dict) or not isinstance(req.get("payload"),dict):
                raise ValueError("Envie o arquivo validado na prévia.")
            con.execute("BEGIN IMMEDIATE")
            p=batch(con,cid,req["payload"])
            if req.get("batch_id")!=p["batch_id"]:
                raise ValueError("O arquivo foi alterado após a prévia. Confira novamente.")
            inserted=0
            duplicates={r["source_row"] for r in con.execute(
                "SELECT source_row FROM pair_records WHERE control_id=? AND batch_id=?",
                (cid,p["batch_id"]))}
            duplicates.update(r["source_row"] for r in con.execute(
                """SELECT source_row FROM pair_transaction_changes
                   WHERE control_id=? AND source_batch_id=? AND source_row IS NOT NULL""",
                (cid,p["batch_id"])))
            for r in p["records"]:
                if r["source_row"] in duplicates:
                    continue
                fields={k:v for k,v in r.items() if k!="source_row"}
                cur=con.execute("""INSERT OR IGNORE INTO pair_records
                  (control_id,record_date,original_date,amount,from_name,to_name,description,notes,
                   original_type,original_balance,batch_id,source_row)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (cid,*fields.values(),p["batch_id"],r["source_row"]))
                inserted+=cur.rowcount
            con.commit()
            return handler.send({"inserted":inserted,"skipped":p["count"]-inserted,
                                 "total_records":p["count"],"batch_id":p["batch_id"]},201)
    if record_url and method in ("PUT","DELETE"):
        rid=int(record_url[1])
        con.execute("BEGIN IMMEDIATE")
        existing=record_by_id(con,rid)
        if method=="PUT":
            payload=handler.input()
            if payload.get("kind","record") in ("debt","payment"):
                return handler.send(convert_record_to_financial(con,existing,payload))
            if payload.get("kind","record")!="record":
                raise ValueError("Tipo de lançamento inválido.")
            r=valid_record(payload,allow_undated=True)
            # Uma correção mantém o ID; não destrói o recibo original do lote.
            con.execute("""UPDATE pair_records SET record_date=?,original_date=?,amount=?,
                from_name=?,to_name=?,description=?,notes=?,original_type=?,original_balance=?,
                updated_at=CURRENT_TIMESTAMP WHERE id=?""",(*r.values(),rid))
        else:
            con.execute("DELETE FROM pair_records WHERE id=?",(rid,))
        con.commit()
        return handler.send({"ok":True,"control_id":existing["control_id"]})
    raise LookupError("Ação de registro não encontrada.")
