"""Conferências e fechamentos exclusivos do CONTROLE CHAVE ERRADA.

O fechamento não apaga lançamentos: arquiva uma fotografia imutável, com
apuração por competência e a comissão histórica do motorista preservada.
"""
from __future__ import annotations
import csv
import hashlib
import io
import json
import re
from urllib.parse import parse_qs, urlsplit
from datetime import date, timedelta
from decimal import Decimal
import truck

TARGET_NAME = "CONTROLE CHAVE ERRADA"

def initialize(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS truck_workflow_controls(
       control_id INTEGER PRIMARY KEY REFERENCES controls(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS truck_reviews(
       id INTEGER PRIMARY KEY,
       control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
       start_date TEXT NOT NULL,
       end_date TEXT NOT NULL,
       entry_count INTEGER NOT NULL,
       fingerprint TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_truck_reviews_range
       ON truck_reviews(control_id,start_date,end_date);
    CREATE TABLE IF NOT EXISTS truck_closures(
       id INTEGER PRIMARY KEY,
       control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
       start_date TEXT NOT NULL,
       end_date TEXT NOT NULL,
       entry_count INTEGER NOT NULL,
       snapshot_json TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_truck_closures_range
       ON truck_closures(control_id,start_date,end_date);
    """)
    con.execute("""INSERT OR IGNORE INTO truck_workflow_controls(control_id)
        SELECT id FROM controls WHERE mode='caminhao' AND UPPER(TRIM(name))=?""",
        (TARGET_NAME,))

def is_enabled(con,cid):
    if con.execute("SELECT 1 FROM truck_workflow_controls WHERE control_id=?",(cid,)).fetchone():
        return True
    row=con.execute("SELECT mode,name FROM controls WHERE id=?",(cid,)).fetchone()
    if row and row["mode"]=="caminhao" and row["name"].strip().upper()==TARGET_NAME:
        con.execute("INSERT OR IGNORE INTO truck_workflow_controls(control_id) VALUES(?)",(cid,))
        return True
    return False

def require_enabled(con,cid):
    truck.check_control(con,cid)
    if not is_enabled(con,cid):
        raise ValueError("Conferências e fechamentos estão disponíveis somente no CONTROLE CHAVE ERRADA.")

def date_range(start,end):
    if not isinstance(start,str) or not isinstance(end,str):
        raise ValueError("Informe a data inicial e final.")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}",start) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",end):
        raise ValueError("Datas inválidas.")
    try:
        a,b=date.fromisoformat(start),date.fromisoformat(end)
    except ValueError:
        raise ValueError("Datas inválidas.") from None
    if a>b:
        raise ValueError("A data inicial precisa ser anterior ou igual à final.")
    if b>date.today():
        raise ValueError("Não é possível conferir ou fechar um período que ainda não terminou.")
    if (b-a).days>365:
        raise ValueError("O período não pode ultrapassar 366 dias.")
    return a,b

def next_day(value):
    return (date.fromisoformat(value)+timedelta(days=1)).isoformat()

def rows_in_range(con,cid,start,end):
    return [dict(r) for r in con.execute(
        "SELECT * FROM truck_entries WHERE control_id=? AND event_date BETWEEN ? AND ? ORDER BY event_date,id",
        (cid,start,end)).fetchall()]

def fingerprint(rows):
    payload=[{key:r[key] for key in ("id","event_date","kind","category","description","weight_kg",
              "price_tonne","commission_pct","amount","commission_amount","notes")} for r in rows]
    return hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,
                                    separators=(",",":")).encode("utf-8")).hexdigest()

def has_overlap(con,table,cid,start,end):
    return con.execute("SELECT 1 FROM "+table+
        " WHERE control_id=? AND start_date<=? AND end_date>=? LIMIT 1",
        (cid,end,start)).fetchone() is not None

def last_closure(con,cid):
    row=con.execute("SELECT * FROM truck_closures WHERE control_id=? ORDER BY end_date DESC,id DESC LIMIT 1",(cid,)).fetchone()
    return dict(row) if row else None

def assert_entry_editable(con,cid,*dates):
    if not is_enabled(con,cid):
        return
    last=last_closure(con,cid)
    for d in set(dates):
        if not d:continue
        if last and d<=last["end_date"]:
            raise ValueError("Esta data pertence ao histórico anterior ao último fechamento. Lance ajustes no capítulo atual.")
        if has_overlap(con,"truck_closures",cid,d,d):
            raise ValueError("Esse lançamento pertence a um fechamento. O histórico fechado não pode ser alterado.")
        if has_overlap(con,"truck_reviews",cid,d,d):
            raise ValueError("Esse período já foi conferido. Reabra a conferência antes de alterar lançamentos.")

def assert_settings_editable(con,cid,renamed_categories,opening_changed):
    if not is_enabled(con,cid):
        return
    if opening_changed and last_closure(con,cid):
        raise ValueError("Os saldos iniciais não podem ser modificados após um fechamento.")
    for name in renamed_categories:
        row=con.execute("""SELECT 1 FROM truck_entries t WHERE
            t.control_id=? AND t.kind='expense' AND t.category=? AND
            (EXISTS (SELECT 1 FROM truck_reviews r WHERE r.control_id=t.control_id AND t.event_date BETWEEN r.start_date AND r.end_date)
             OR EXISTS (SELECT 1 FROM truck_closures c WHERE c.control_id=t.control_id AND t.event_date BETWEEN c.start_date AND c.end_date))
            LIMIT 1""",(cid,name)).fetchone()
        if row:
            raise ValueError("A categoria possui lançamentos conferidos ou fechados. Reabra a conferência antes de renomear, quando não estiver fechada.")

def info(con,cid):
    if not is_enabled(con,cid):
        return {"enabled":False}
    checks=[dict(r) for r in con.execute(
        "SELECT id,start_date,end_date,entry_count,created_at FROM truck_reviews WHERE control_id=? ORDER BY start_date DESC,id DESC",
        (cid,))]
    closures=[]
    for row in con.execute(
        "SELECT id,start_date,end_date,entry_count,created_at,snapshot_json FROM truck_closures WHERE control_id=? ORDER BY end_date DESC,id DESC",
        (cid,)):
        item={k:row[k] for k in ("id","start_date","end_date","entry_count","created_at")}
        item["totals"]=json.loads(row["snapshot_json"])["totals"]
        closures.append(item)
    for check in checks:
        check["closed"]=any(c["start_date"]<=check["start_date"] and c["end_date"]>=check["end_date"] for c in closures)
    min_entry=con.execute("SELECT MIN(event_date) AS d FROM truck_entries WHERE control_id=?",(cid,)).fetchone()["d"]
    last=closures[0]["end_date"] if closures else None
    last_review=max((r["end_date"] for r in checks),default=None)
    return {
        "enabled":True,
        "checks":checks,
        "closures":closures,
        "last_closed_until":last,
        "last_checked_until":last_review,
        "pending_check_from":next_day(last_review) if last_review else (min_entry or date.today().isoformat()),
        "pending_close_from":next_day(last) if last else (min_entry or date.today().isoformat()),
        "current_from":next_day(last) if last else None
    }

def review_preview(con,cid,start,end):
    require_enabled(con,cid)
    date_range(start,end)
    if has_overlap(con,"truck_closures",cid,start,end):
        raise ValueError("Este período contém dias já fechados.")
    if has_overlap(con,"truck_reviews",cid,start,end):
        raise ValueError("Este período sobrepõe uma conferência existente. Consulte o histórico ou reabra-a.")
    rows=rows_in_range(con,cid,start,end)
    return {"start_date":start,"end_date":end,"entries":rows,"count":len(rows),
            "fingerprint":fingerprint(rows)}

def confirm_review(con,cid,payload):
    start,end=payload.get("start"),payload.get("end")
    if not isinstance(start,str) or not isinstance(end,str):
        raise ValueError("Informe o período.")
    if not con.in_transaction:
        con.execute("BEGIN IMMEDIATE")
    preview=review_preview(con,cid,start,end)
    ids=payload.get("checked_ids",[])
    expected=[e["id"] for e in preview["entries"]]
    if not isinstance(ids,list) or any(type(n) is not int for n in ids) or len(ids)!=len(set(ids)) or sorted(ids)!=sorted(expected):
        raise ValueError("Confira e marque todos os lançamentos do período antes de confirmar.")
    if payload.get("fingerprint")!=preview["fingerprint"]:
        raise ValueError("Os lançamentos mudaram desde a prévia. Recarregue a conferência.")
    result=con.execute("""INSERT INTO truck_reviews
       (control_id,start_date,end_date,entry_count,fingerprint) VALUES(?,?,?,?,?)""",
       (cid,start,end,len(expected),preview["fingerprint"]))
    con.commit()
    return {"id":result.lastrowid,"count":len(expected),"start_date":start,"end_date":end}

def reopen_review(con,check_id):
    if not con.in_transaction:
        con.execute("BEGIN IMMEDIATE")
    row=con.execute("SELECT * FROM truck_reviews WHERE id=?",(check_id,)).fetchone()
    if not row:
        raise LookupError("Conferência não encontrada.")
    cid=row["control_id"]
    require_enabled(con,cid)
    if has_overlap(con,"truck_closures",cid,row["start_date"],row["end_date"]):
        raise ValueError("Não é possível reabrir uma conferência de período já fechado.")
    con.execute("DELETE FROM truck_reviews WHERE id=?",(check_id,))
    con.commit()
    return {"ok":True}

def calc_totals(con,cid,start,end):
    rows=rows_in_range(con,cid,start,end)
    freight=expenses=advances=commission=Decimal("0")
    for row in rows:
        value=Decimal(row["amount"])
        if row["kind"]=="freight":
            freight+=value;commission+=Decimal(row["commission_amount"])
        elif row["kind"]=="expense":
            expenses+=value
        else:advances+=value
    base=truck.settings(con,cid)
    historic=con.execute("SELECT kind,amount,commission_amount FROM truck_entries WHERE control_id=? AND event_date<=?",(cid,end)).fetchall()
    due=Decimal(base["opening_commission"])
    for row in historic:
        if row["kind"]=="freight":due+=Decimal(row["commission_amount"])
        elif row["kind"]=="advance":due-=Decimal(row["amount"])
    return rows,{
      "freight":truck.money(freight),
      "operating_expenses":truck.money(expenses),
      "driver_advances":truck.money(advances),
      "cash_out":truck.money(expenses+advances),
      "operating_result":truck.money(freight-expenses-commission),
      "commission_earned":truck.money(commission),
      "driver_due_at_close":truck.money(due),
      "entry_count":len(rows)
    }

def close_preview(con,cid,start,end):
    require_enabled(con,cid)
    first,last=date_range(start,end)
    older=last_closure(con,cid)
    if older and first!=date.fromisoformat(older["end_date"])+timedelta(days=1):
        raise ValueError("O próximo fechamento deve começar em "+next_day(older["end_date"])+".")
    if has_overlap(con,"truck_closures",cid,start,end):
        raise ValueError("O período selecionado já possui fechamento.")
    reviews=con.execute("""SELECT * FROM truck_reviews
        WHERE control_id=? AND start_date<=? AND end_date>=?
        ORDER BY start_date""",(cid,end,start)).fetchall()
    cursor=first
    matched=[]
    for row in reviews:
        a=date.fromisoformat(row["start_date"])
        b=date.fromisoformat(row["end_date"])
        if b<cursor:continue
        if a>cursor:
            return {"ready":False,"start_date":start,"end_date":end,"missing_from":cursor.isoformat(),
                    "message":"Existem dias sem conferência a partir de "+cursor.strftime("%d/%m/%Y")+".","reviews":[]}
        if a<first or b>last:
            raise ValueError("Escolha um fechamento que comece e termine nos limites das conferências completas.")
        current=rows_in_range(con,cid,row["start_date"],row["end_date"])
        if fingerprint(current)!=row["fingerprint"] or len(current)!=row["entry_count"]:
            return {"ready":False,"start_date":start,"end_date":end,
                    "message":"Uma conferência possui lançamentos alterados. Reabra e confira novamente.","reviews":[]}
        matched.append(row["id"])
        cursor=b+timedelta(days=1)
        if cursor>last:break
    if cursor<=last:
        return {"ready":False,"start_date":start,"end_date":end,
                "missing_from":cursor.isoformat(),
                "message":"Falta conferir o período a partir de "+cursor.strftime("%d/%m/%Y")+".","reviews":[]}
    rows,totals=calc_totals(con,cid,start,end)
    return {"ready":True,"start_date":start,"end_date":end,"reviews":matched,"totals":totals,
            "entries":rows,"entry_count":len(rows),
            "fingerprint":fingerprint(rows)}

def confirm_close(con,cid,payload):
    start,end=payload.get("start"),payload.get("end")
    if not isinstance(start,str) or not isinstance(end,str):
        raise ValueError("Informe o período.")
    if not con.in_transaction:
        con.execute("BEGIN IMMEDIATE")
    report=close_preview(con,cid,start,end)
    if not report["ready"]:
        raise ValueError(report["message"])
    if payload.get("fingerprint")!=report["fingerprint"]:
        raise ValueError("O conteúdo mudou desde a prévia. Recarregue o fechamento.")
    archive={
      "start_date":start,"end_date":end,
      "totals":report["totals"],"entries":report["entries"],
      "reviews":report["reviews"]
    }
    saved=con.execute("""INSERT INTO truck_closures(control_id,start_date,end_date,entry_count,snapshot_json)
       VALUES(?,?,?,?,?)""",(cid,start,end,len(report["entries"]),json.dumps(archive,ensure_ascii=False)))
    con.commit()
    return {"id":saved.lastrowid,"entry_count":len(report["entries"]),"totals":report["totals"]}

def closure_detail(con,closure_id):
    row=con.execute("SELECT * FROM truck_closures WHERE id=?",(closure_id,)).fetchone()
    if not row:
        raise LookupError("Fechamento não encontrado.")
    require_enabled(con,row["control_id"])
    data=json.loads(row["snapshot_json"])
    return {"id":row["id"],"control_id":row["control_id"],"created_at":row["created_at"],**data}

def export_csv(con,closure_id):
    data=closure_detail(con,closure_id)
    writer_stream=io.StringIO()
    writer=csv.writer(writer_stream,delimiter=";")
    writer.writerow(["Fechamento",data["start_date"],data["end_date"]])
    writer.writerow(["Entradas",data["totals"]["freight"],"Saídas",data["totals"]["cash_out"]])
    writer.writerow(["Resultado",data["totals"]["operating_result"],"Comissão acumulada",data["totals"]["driver_due_at_close"]])
    writer.writerow([])
    writer.writerow(["ID","Data","Tipo","Categoria","Descrição","Peso kg","Preço/t","Valor R$","Comissão R$","Observações"])
    for row in data["entries"]:
        writer.writerow([row[x] for x in ("id","event_date","kind","category","description","weight_kg",
                           "price_tonne","amount","commission_amount","notes")])
    return ("\ufeff"+writer_stream.getvalue()).encode("utf-8")

def handle(handler,con,method,path):
    base=re.fullmatch(r"/api/controls/(\d+)/truck/(workflow|check-preview|checks|close-preview|closures)",path)
    check=re.fullmatch(r"/api/truck-checks/(\d+)",path)
    archive=re.fullmatch(r"/api/truck-closures/(\d+)(/export\.csv)?",path)
    if base:
        cid=int(base[1]);action=base[2]
        require_enabled(con,cid)
        params={k:v[0] for k,v in parse_qs(urlsplit(handler.path).query).items()}
        if method=="GET" and action=="workflow":
            return handler.send(info(con,cid))
        if method=="GET" and action=="check-preview":
            return handler.send(review_preview(con,cid,params.get("start",""),params.get("end","")))
        if method=="POST" and action=="checks":
            return handler.send(confirm_review(con,cid,handler.input()),201)
        if method=="GET" and action=="close-preview":
            return handler.send(close_preview(con,cid,params.get("start",""),params.get("end","")))
        if method=="POST" and action=="closures":
            return handler.send(confirm_close(con,cid,handler.input()),201)
    if check and method=="DELETE":
        return handler.send(reopen_review(con,int(check[1])))
    if archive:
        if method=="GET" and archive[2]:
            return handler.send(export_csv(con,int(archive[1])),mime="text/csv; charset=utf-8")
        if method=="GET":
            return handler.send(closure_detail(con,int(archive[1])))
    raise LookupError("Ação não encontrada.")
