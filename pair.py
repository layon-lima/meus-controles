"""Acerto A × B — conta corrente bilateral, saldos líquidos e fechamentos."""
import csv
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
import re

CENT=Decimal("0.01")

def initialize(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS pair_settings(
      control_id INTEGER PRIMARY KEY REFERENCES controls(id) ON DELETE CASCADE,
      party_a TEXT NOT NULL, party_b TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pair_entries(
      id INTEGER PRIMARY KEY,
      control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
      entry_date TEXT NOT NULL,
      debtor TEXT NOT NULL CHECK(debtor IN ('A','B')),
      amount TEXT NOT NULL, description TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      entry_kind TEXT NOT NULL DEFAULT 'debt' CHECK(entry_kind IN ('debt','payment')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pair_entries ON pair_entries(control_id,entry_date,id);
    CREATE TABLE IF NOT EXISTS pair_closures(
      id INTEGER PRIMARY KEY,
      control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL,
      opening_balance TEXT NOT NULL, movement_balance TEXT NOT NULL,
      closing_balance TEXT NOT NULL, entry_count INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(control_id,start_date,end_date)
    );
    CREATE INDEX IF NOT EXISTS idx_pair_closures ON pair_closures(control_id,end_date DESC);
    """)
    # Migração não destrutiva: os registros existentes eram todos dívidas.
    fields={r["name"] for r in con.execute("PRAGMA table_info(pair_entries)")}
    if "entry_kind" not in fields:
        con.execute("""ALTER TABLE pair_entries ADD COLUMN entry_kind TEXT NOT NULL
                     DEFAULT 'debt' CHECK(entry_kind IN ('debt','payment'))""")

def label(v,name,maxlen=160):
    if not isinstance(v,str) or not v.strip() or len(v.strip())>maxlen:
        raise ValueError("Informe "+name+" válido.")
    return v.strip()

def number(v):
    if isinstance(v,bool) or v is None:raise ValueError("Informe um valor válido.")
    raw=str(v).strip().replace(" ","")
    if "," in raw:raw=raw.replace(".","").replace(",",".")
    try:n=Decimal(raw)
    except (InvalidOperation,ValueError):raise ValueError("Valor inválido.") from None
    if not n.is_finite() or n<=0 or n>Decimal("1000000000000"):
        raise ValueError("O valor deve ser maior que zero.")
    if n!=n.quantize(CENT):
        raise ValueError("Use no máximo duas casas decimais.")
    return n.quantize(CENT)

def money(value):return format(Decimal(value).quantize(CENT),"f")

def day(v):
    if not isinstance(v,str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",v):
        raise ValueError("Informe uma data válida.")
    try:date.fromisoformat(v)
    except ValueError:raise ValueError("Data inválida.") from None
    return v

def control(con,cid):
    row=con.execute("SELECT id,mode,name FROM controls WHERE id=?",(cid,)).fetchone()
    if row is None:raise LookupError("Controle não encontrado.")
    if row["mode"]!="acerto_ab":raise ValueError("Este controle não é do tipo A × B.")
    return dict(row)

def settings(con,cid):
    control(con,cid)
    row=con.execute("SELECT party_a,party_b FROM pair_settings WHERE control_id=?",(cid,)).fetchone()
    return dict(row) if row else {"party_a":"Pessoa A","party_b":"Pessoa B"}

def save_settings(con,cid,p):
    control(con,cid)
    if not isinstance(p,dict):raise ValueError("Configurações inválidas.")
    a=label(p.get("party_a"),"o nome da pessoa A")
    b=label(p.get("party_b"),"o nome da pessoa B")
    if a.casefold()==b.casefold():raise ValueError("Informe dois nomes diferentes.")
    con.execute("""INSERT INTO pair_settings(control_id,party_a,party_b)
      VALUES(?,?,?) ON CONFLICT(control_id) DO UPDATE SET
      party_a=excluded.party_a,party_b=excluded.party_b""",(cid,a,b))
    if "name" in p:
        con.execute("UPDATE controls SET name=? WHERE id=?",(label(p["name"],"o nome do controle",150),cid))
    return settings(con,cid)

def validate(p):
    if not isinstance(p,dict):raise ValueError("Dados do lançamento inválidos.")
    kind=p.get("kind","debt")
    if kind not in ("debt","payment"):raise ValueError("Selecione dívida ou pagamento real.")
    # Campo histórico 'debtor' indica quem contraiu a dívida ou quem fez
    # o pagamento real, dependendo de entry_kind. Nunca troca o sentido
    # ao reabrir/editar um lançamento antigo.
    debtor=p.get("debtor") if kind=="debt" else p.get("payer",p.get("debtor"))
    if debtor not in ("A","B"):
        raise ValueError("Selecione quem deve." if kind=="debt" else "Selecione quem pagou.")
    note=p.get("notes","")
    if not isinstance(note,str) or len(note)>1500:raise ValueError("Observações inválidas.")
    return {"entry_date":day(p.get("date")),"debtor":debtor,"amount":money(number(p.get("amount"))),
            "description":label(p.get("description"),"a descrição",220),"notes":note.strip(),
            "entry_kind":kind}

def kind_of(entry):
    # Fechamentos antigos podem conter snapshots sem o novo campo.
    return entry.get("entry_kind","debt")

def sign(entry):
    # Saldo positivo: B deve a A; negativo: A deve a B.
    # Dívida A->B reduz o saldo; pagamento real A->B aumenta o saldo.
    # Dívida B->A aumenta o saldo; pagamento real B->A reduz o saldo.
    direction=1 if entry["debtor"]=="B" else -1
    if kind_of(entry)=="payment":
        direction=-direction
    return Decimal(entry["amount"])*direction

def movement_totals(entries):
    total=lambda who,kind:money(sum(
        (Decimal(e["amount"]) for e in entries
         if e["debtor"]==who and kind_of(e)==kind),Decimal("0")))
    return {"a_to_b":total("A","debt"),"b_to_a":total("B","debt"),
            "payments_a_to_b":total("A","payment"),"payments_b_to_a":total("B","payment"),
            "debt_count":sum(kind_of(e)=="debt" for e in entries),
            "payment_count":sum(kind_of(e)=="payment" for e in entries)}

def settlement(balance,names):
    value=Decimal(balance)
    if value==0:
        return {"debtor":None,"creditor":None,"amount":"0.00","settled":True}
    return {"debtor":names["party_b"] if value>0 else names["party_a"],
            "creditor":names["party_a"] if value>0 else names["party_b"],
            "amount":money(abs(value)),"settled":False}

def recent_close(con,cid):
    r=con.execute("SELECT * FROM pair_closures WHERE control_id=? ORDER BY end_date DESC,id DESC LIMIT 1",(cid,)).fetchone()
    return dict(r) if r else None

def check_editable(con,cid,*dates):
    closed=recent_close(con,cid)
    if closed and any(d<=closed["end_date"] for d in dates):
        raise ValueError("Este lançamento pertence a período fechado e não pode ser alterado.")

def all_entries(con,cid,where="",params=()):
    return [dict(r) for r in con.execute(
       "SELECT * FROM pair_entries WHERE control_id=? "+where+
       " ORDER BY entry_date DESC,id DESC",(cid,*params))]

def summary(con,cid):
    names=settings(con,cid)
    last=recent_close(con,cid)
    current=all_entries(con,cid,"AND entry_date>?",(last["end_date"],)) if last else all_entries(con,cid)
    history=all_entries(con,cid)
    start_amount=Decimal(last["closing_balance"]) if last else Decimal("0")
    moved=sum((sign(e) for e in current),Decimal("0"))
    balance=start_amount+moved
    closures=[dict(r) for r in con.execute("""SELECT id,start_date,end_date,opening_balance,
      movement_balance,closing_balance,entry_count,created_at
      FROM pair_closures WHERE control_id=? ORDER BY end_date DESC,id DESC""",(cid,))]
    totals=movement_totals(current)
    return {"control_id":cid,"settings":names,
      "totals":{"balance":money(balance),"settlement":settlement(balance,names),
        "opening_balance":money(start_amount),"movement_balance":money(moved),
        **totals,
        "count":len(history),"current_count":len(current),"closures":len(closures)},
      "entries":current,"history":history,"closures":closures,
      "current_from":(date.fromisoformat(last["end_date"])+timedelta(days=1)).isoformat() if last else None}

def check_period(con,cid,start,end):
    control(con,cid)
    first=date.fromisoformat(day(start))
    final=date.fromisoformat(day(end))
    if first>final:raise ValueError("A data inicial é posterior à final.")
    if final>date.today():raise ValueError("Não é possível fechar datas futuras.")
    last=recent_close(con,cid)
    if last:
        required=(date.fromisoformat(last["end_date"])+timedelta(days=1)).isoformat()
        if start!=required:raise ValueError("O próximo fechamento deve começar em "+required+".")
    else:
        oldest=con.execute("SELECT MIN(entry_date) AS day FROM pair_entries WHERE control_id=?",(cid,)).fetchone()["day"]
        if oldest is None:raise ValueError("Registre ao menos um lançamento antes de fechar.")
        if start>oldest:raise ValueError("O primeiro fechamento precisa incluir o lançamento mais antigo.")
    selected=all_entries(con,cid,"AND entry_date>=? AND entry_date<=?",(start,end))
    if not selected:raise ValueError("Não há lançamentos nesse período para fechar.")
    opening=Decimal(last["closing_balance"]) if last else Decimal("0")
    movement=sum((sign(e) for e in selected),Decimal("0"))
    ending=opening+movement
    names=settings(con,cid)
    return {"start_date":start,"end_date":end,"opening_balance":money(opening),
        "movement_balance":money(movement),"closing_balance":money(ending),
        "settlement":settlement(ending,names),"count":len(selected),"entries":selected,
        "movement_totals":movement_totals(selected),"settings":names}

def preview(con,cid,start,end):
    result=check_period(con,cid,start,end)
    result["fingerprint"]=fingerprint(result)
    return result

def fingerprint(report):
    # Assinatura garante que mudanças feitas após a prévia invalidem o fechamento.
    canonical={key:report[key] for key in ("start_date","end_date","opening_balance",
                "closing_balance","movement_balance","entries","settings")}
    return hashlib.sha256(json.dumps(canonical,sort_keys=True,ensure_ascii=False).encode("utf-8")).hexdigest()

def close(con,cid,p):
    if not isinstance(p,dict):raise ValueError("Confirmação inválida.")
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    result=preview(con,cid,p.get("start"),p.get("end"))
    if p.get("fingerprint")!=result["fingerprint"]:
        raise ValueError("Os lançamentos mudaram. Confira a prévia antes de fechar.")
    row=con.execute("""INSERT INTO pair_closures(control_id,start_date,end_date,opening_balance,
       movement_balance,closing_balance,entry_count,snapshot_json)
       VALUES(?,?,?,?,?,?,?,?)""",(cid,result["start_date"],result["end_date"],
       result["opening_balance"],result["movement_balance"],result["closing_balance"],
       result["count"],json.dumps(result,ensure_ascii=False)))
    con.commit()
    return {"id":row.lastrowid,"closure":result}

def closure(con,id):
    row=con.execute("SELECT * FROM pair_closures WHERE id=?",(id,)).fetchone()
    if row is None:raise LookupError("Fechamento não encontrado.")
    control(con,row["control_id"])
    return {"id":id,"created_at":row["created_at"],**json.loads(row["snapshot_json"])}

def export_csv(con,id):
    data=closure(con,id)
    target=io.StringIO()
    w=csv.writer(target,delimiter=";")
    w.writerow(["Fechamento A × B",data["start_date"],data["end_date"]])
    w.writerow(["Saldo anterior",data["opening_balance"],"Movimentação",data["movement_balance"]])
    x=data["settlement"]
    w.writerow(["Devedor",x["debtor"] or "Quitado","Credor",x["creditor"] or "—","Saldo",x["amount"]])
    w.writerow([])
    w.writerow(["Data","Tipo","Devedor / Pagador","Credor / Recebedor","Descrição","Valor","Observações"])
    a=data["settings"]["party_a"];b=data["settings"]["party_b"]
    for entry in data["entries"]:
        kind=kind_of(entry)
        w.writerow([entry["entry_date"],"Pagamento real" if kind=="payment" else "Dívida / compensação",
            a if entry["debtor"]=="A" else b,
            b if entry["debtor"]=="A" else a,entry["description"],entry["amount"],entry["notes"]])
    return ("\ufeff"+target.getvalue()).encode("utf-8")

def handle(handler,con,method,url):
    root=re.fullmatch(r"/api/controls/(\d+)/pair(?:/(entries|settings|preview|closures))?",url)
    eroute=re.fullmatch(r"/api/pair-entries/(\d+)",url)
    cr=re.fullmatch(r"/api/pair-closures/(\d+)(/export\.csv)?",url)
    if root:
        cid=int(root[1]);action=root[2]
        control(con,cid)
        if method=="GET" and action is None:return handler.send(summary(con,cid))
        if method=="PUT" and action=="settings":
            payload=handler.input()
            con.execute("BEGIN IMMEDIATE")
            result=save_settings(con,cid,payload)
            con.commit()
            return handler.send(result)
        if method=="POST" and action=="entries":
            entry=validate(handler.input())
            con.execute("BEGIN IMMEDIATE")
            check_editable(con,cid,entry["entry_date"])
            created=con.execute("""INSERT INTO pair_entries
                (control_id,entry_date,debtor,amount,description,notes,entry_kind)
                VALUES(?,?,?,?,?,?,?)""",(cid,*entry.values()))
            con.commit()
            return handler.send({"id":created.lastrowid},201)
        if method=="POST" and action=="preview":
            req=handler.input()
            return handler.send(preview(con,cid,req.get("start"),req.get("end")))
        if method=="POST" and action=="closures":
            return handler.send(close(con,cid,handler.input()),201)
    if eroute and method in ("PUT","DELETE"):
        id=int(eroute[1])
        con.execute("BEGIN IMMEDIATE")
        old=con.execute("SELECT * FROM pair_entries WHERE id=?",(id,)).fetchone()
        if not old:raise LookupError("Lançamento não encontrado.")
        control(con,old["control_id"])
        check_editable(con,old["control_id"],old["entry_date"])
        if method=="PUT":
            p=validate(handler.input())
            check_editable(con,old["control_id"],p["entry_date"])
            con.execute("""UPDATE pair_entries SET entry_date=?,debtor=?,amount=?,description=?,notes=?,
                entry_kind=?,updated_at=CURRENT_TIMESTAMP WHERE id=?""",(*p.values(),id))
        else:con.execute("DELETE FROM pair_entries WHERE id=?",(id,))
        con.commit()
        return handler.send({"ok":True})
    if cr and method=="GET":
        cid=int(cr[1])
        if cr[2]:return handler.send(export_csv(con,cid),mime="text/csv; charset=utf-8")
        return handler.send(closure(con,cid))
    raise LookupError("Operação não encontrada.")
