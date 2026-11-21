"""Integração auditável de vales de funcionários com holerites da Central.

Bancos originais nunca são alterados diretamente. Consultas ao SQLite do
CONTAS e PostgreSQL do Meus Controles são RO; desconto efetivo no vale usa
o endpoint original após o pagamento estar confirmado no CONTAS.

O journal SQLite da CENTRAL é independente. Se uma das APIs falhar, a
pendência fica reconciliável, sem repetir pagamentos no CONTAS.
"""
from __future__ import annotations

from contextlib import closing
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from datetime import datetime
import hashlib
import http.client
import json
import os
import re
import sqlite3
import threading
import unicodedata

from . import access

LOCK = threading.RLock()
CENT = Decimal("0.01")
PAID_NOTE = "CENTRAL-NH/HOLERITE:"
DB = os.environ.get("CENTRAL_VALES_DB", "/central-data/vales_holerites.db")


class BridgeError(ValueError):
    pass


def dec(value):
    try:
        result = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, TypeError, ValueError):
        raise BridgeError("Valor monetário inválido.") from None
    if not result.is_finite() or result < 0 or result > 1_000_000_000 or result != result.quantize(CENT):
        raise BridgeError("Valor monetário deve ter duas casas decimais e não pode ser negativo.")
    return result


def money(value):
    return str(Decimal(value).quantize(CENT))


def name_key(value):
    raw = unicodedata.normalize("NFKD", str(value or "").strip().upper())
    return " ".join("".join(c for c in raw if not unicodedata.combining(c)).split())


def valid_month(value):
    if not isinstance(value, str) or not re.fullmatch(r"20\d{2}-(?:0[1-9]|1[0-2])", value):
        raise BridgeError("Informe uma competência no formato AAAA-MM.")
    return value


def positive_id(raw):
    if isinstance(raw, bool):
        raise BridgeError("Identificador inválido.")
    try:
        number = int(raw)
    except (TypeError, ValueError):
        raise BridgeError("Identificador inválido.") from None
    if number < 1 or number > 2**63 - 1:
        raise BridgeError("Identificador inválido.")
    return number


def sqlite_accounts():
    path = os.environ.get("CENTRAL_CONTAS_DB", "")
    if not path or not Path(path).is_file():
        raise BridgeError("Banco do CONTAS indisponível. Operação cancelada.")
    conn = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


def read_staff():
    with closing(sqlite_accounts()) as con:
        names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "holerite_funcionarios" not in names:
            return []
        return [dict(r) for r in con.execute(
            "SELECT id,nome FROM holerite_funcionarios ORDER BY nome COLLATE NOCASE")]


def read_account(account_id):
    with closing(sqlite_accounts()) as con:
        row = con.execute("""SELECT c.id,c.valor,c.fornecedor,
              h.funcionario_id,h.competencia,
              CASE WHEN EXISTS (SELECT 1 FROM pagamentos p WHERE p.conta_id=c.id
              AND p.data_pagamento IS NOT NULL AND TRIM(p.data_pagamento)!='')
              THEN 1 ELSE 0 END AS paga
              FROM contas c LEFT JOIN holerite_lancamentos h ON h.conta_id=c.id
              WHERE c.id=?""", (account_id,)).fetchone()
        if not row:
            raise BridgeError("Conta não encontrada no CONTAS.")
        return dict(row)


def read_controls():
    dsn = os.environ.get("CENTRAL_CONTROLES_DSN", "")
    if not dsn:
        raise BridgeError("Banco dos Vales não configurado.")
    try:
        import psycopg
        from psycopg.rows import dict_row
        with psycopg.connect(
            dsn, connect_timeout=6, options="-c default_transaction_read_only=on",
            row_factory=dict_row
        ) as con:
            with con.cursor() as cur:
                cur.execute("""SELECT e.id,e.control_id,e.name,e.active
                  FROM vale_employees e JOIN controls c ON c.id=e.control_id
                  WHERE c.mode='vale_funcionarios' ORDER BY e.name,e.id""")
                staff = cur.fetchall()
                cur.execute("""SELECT i.id,i.due_month,i.amount,d.control_id,
                    d.employee_id,d.title,d.id AS debt_id,i.installment_number,
                    COALESCE(SUM(p.amount::numeric),0) AS paid
                  FROM vale_installments i
                  JOIN vale_debts d ON d.id=i.debt_id
                  JOIN controls c ON c.id=d.control_id AND c.mode='vale_funcionarios'
                  LEFT JOIN vale_payments p ON p.installment_id=i.id
                  GROUP BY i.id,i.due_month,i.amount,d.control_id,
                    d.employee_id,d.title,d.id,i.installment_number
                  ORDER BY i.due_month,i.id""")
                plans = cur.fetchall()
        return [dict(r) for r in staff], [dict(r) for r in plans]
    except Exception as exc:
        raise BridgeError("Não foi possível consultar as parcelas de Vales.") from exc


def journal():
    path = Path(os.environ.get("CENTRAL_VALES_DB", DB))
    if not path.parent.is_dir():
        raise BridgeError("Diretório privado da integração não foi preparado na VPS.")
    conn = sqlite3.connect(str(path), timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("""CREATE TABLE IF NOT EXISTS staff_links(
        vale_employee_id INTEGER PRIMARY KEY,
        contas_employee_id INTEGER NOT NULL,
        confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS discounts(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        vale_installment_id INTEGER NOT NULL,
        control_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        competence TEXT NOT NULL,
        original_amount TEXT NOT NULL,
        amount TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'reserved',
        vale_payment_id INTEGER,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        settled_at TEXT,
        UNIQUE(account_id,vale_installment_id)
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_central_vales_status ON discounts(status,account_id)")
    conn.execute("""CREATE TABLE IF NOT EXISTS events(
        id INTEGER PRIMARY KEY,
        account_id INTEGER,
        vale_installment_id INTEGER,
        event TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    return conn


def event(con, title, account_id=None, installment_id=None, detail=""):
    con.execute("""INSERT INTO events(account_id,vale_installment_id,event,details)
      VALUES(?,?,?,?)""", (account_id, installment_id,title,str(detail)[:500]))


def linked(con):
    return {int(row["vale_employee_id"]):int(row["contas_employee_id"])
            for row in con.execute("SELECT vale_employee_id,contas_employee_id FROM staff_links")}


def available_allocations(con):
    pending={}
    for row in con.execute("SELECT vale_installment_id,amount FROM discounts WHERE status IN ('reserved','error')"):
        key=row["vale_installment_id"]
        pending[key]=pending.get(key,Decimal("0"))+dec(row["amount"])
    return pending


def staff_view():
    people, _ = read_controls()
    employees = read_staff()
    with closing(journal()) as con:
        links=linked(con)
    staff_ids={int(p["id"]) for p in employees}
    result=[]
    for val in people:
        cid=links.get(int(val["id"]))
        if cid not in staff_ids:
            cid=None
        unique=[p for p in employees if name_key(p["nome"])==name_key(val["name"])]
        result.append({
            "id":int(val["id"]),"name":val["name"],"control_id":int(val["control_id"]),
            "active":bool(val["active"]),"contas_employee_id":cid,
            "suggested_contas_employee_id":unique[0]["id"] if len(unique)==1 and not cid else None
        })
    return {"funcionarios_contas":employees,"funcionarios_vales":result}


def assign_link(payload):
    vale_id=positive_id(payload.get("vale_employee_id"))
    contas_id=positive_id(payload.get("contas_employee_id"))
    vales,_=read_controls()
    people=read_staff()
    if vale_id not in {int(e["id"]) for e in vales}:
        raise BridgeError("Funcionário de Vales inexistente.")
    if contas_id not in {int(e["id"]) for e in people}:
        raise BridgeError("Funcionário do CONTAS inexistente.")
    with LOCK,closing(journal()) as con:
        con.execute("BEGIN IMMEDIATE")
        former=con.execute("SELECT contas_employee_id FROM staff_links WHERE vale_employee_id=?",
                           (vale_id,)).fetchone()
        con.execute("""INSERT INTO staff_links(vale_employee_id,contas_employee_id)
          VALUES(?,?) ON CONFLICT(vale_employee_id) DO UPDATE SET
          contas_employee_id=excluded.contas_employee_id,
          confirmed_at=CURRENT_TIMESTAMP""",(vale_id,contas_id))
        event(con,"vinculo_confirmado",None,None,
              f"vale={vale_id};contas={contas_id};anterior={former[0] if former else 'sem'}")
        con.commit()
    return {"ok":True,"vale_employee_id":vale_id,"contas_employee_id":contas_id}


def quote(employee_id, competence, original, *, account_id=None, selected=None, vale_employee_id=None):
    competence=valid_month(competence)
    employee_id=positive_id(employee_id) if employee_id else None
    vale_employee_id=positive_id(vale_employee_id) if vale_employee_id else None
    original=dec(original)
    existing_id=positive_id(account_id) if account_id else None
    staff,installments=read_controls()
    staff_by_id={int(x["id"]):x for x in staff}
    with closing(journal()) as con:
        links=linked(con)
        reserved=available_allocations(con)
        own={}
        if existing_id:
            for row in con.execute("SELECT vale_installment_id,amount FROM discounts WHERE account_id=?",
                                   (existing_id,)):
                own[int(row["vale_installment_id"])]=dec(row["amount"])
    if vale_employee_id is not None:
        if vale_employee_id not in staff_by_id:
            raise BridgeError("Funcionário de Vales não encontrado.")
        if employee_id is not None and links.get(vale_employee_id) not in (None,employee_id):
            raise BridgeError("O vale está associado a outro funcionário do CONTAS.")
        # Se funcionário ainda não foi criado no CONTAS, sua identidade
        # será validada após o cadastro pelo nome completo confirmado.
        vales_ids={vale_employee_id}
    else:
        vales_ids={eid for eid,linked_id in links.items() if employee_id and linked_id==employee_id}
    rows=[]
    arrears=[]
    for item in installments:
        eid=int(item["employee_id"])
        if eid not in vales_ids:continue
        remain=dec(item["amount"])-dec(item["paid"])-reserved.get(int(item["id"]),Decimal("0"))+own.get(int(item["id"]),Decimal("0"))
        if remain<=0:continue
        entry={
            "id":int(item["id"]),"control_id":int(item["control_id"]),
            "vale_employee_id":eid,"title":str(item["title"]),
            "installment":int(item["installment_number"]),
            "due_month":item["due_month"],"amount":money(remain)
        }
        if item["due_month"]==competence:rows.append(entry)
        elif item["due_month"]<competence:arrears.append(entry)
    # Vales passados são informativos: nunca incluir atrasados automaticamente.
    if selected is None:
        selected={int(x["id"]) for x in rows}
    else:
        if not isinstance(selected,list) or len(selected)>120:
            raise BridgeError("Seleção de parcelas inválida.")
        selected={positive_id(i) for i in selected}
        if not selected.issubset({int(x["id"]) for x in rows}):
            raise BridgeError("A seleção contém parcela não disponível nesta competência.")
    total=sum((dec(x["amount"]) for x in rows if x["id"] in selected),Decimal("0"))
    if total>original:
        raise BridgeError("Os vales excedem o líquido do holerite. Selecione menos parcelas para esta competência.")
    return {"competencia":competence,"original":money(original),
        "desconto":money(total),"valor_pagar":money(original-total),
        "parcelas":rows,"atrasadas":arrears,"selecionadas":sorted(selected),
        "vale_employee_id":vale_employee_id,"funcionario_id":employee_id,
        "account_id":existing_id}


def prepare_submission(payload):
    """Valida contrato extra sem alterar o formato normal do CONTAS 4."""
    raw=payload.get("nh_vales")
    if not raw:return None
    if not isinstance(raw,str) or len(raw)>8192:
        raise BridgeError("Dados de conciliação dos Vales inválidos.")
    try:data=json.loads(raw)
    except (TypeError,ValueError):raise BridgeError("Seleção dos Vales inválida.") from None
    if not isinstance(data,dict):
        raise BridgeError("Seleção dos Vales inválida.")
    if str(payload.get("holerite"))!="sim":
        raise BridgeError("Desconto de vale só pode ser aplicado em holerite.")
    emp=payload.get("funcionario_id")
    emp_id=positive_id(emp) if emp not in ("",None) else None
    if emp_id is not None:
        if emp_id not in {int(x["id"]) for x in read_staff()}:
            raise BridgeError("Funcionário do holerite não encontrado.")
    else:
        name=payload.get("funcionario_nome","")
        if len(name_key(name))<6:
            raise BridgeError("Nome do novo funcionário do holerite não foi confirmado.")
    chosen=data.get("selecionadas")
    if not isinstance(chosen,list) or not chosen:
        return None
    q=quote(emp_id, payload.get("competencia"), data.get("original"),
            selected=chosen,vale_employee_id=data.get("vale_employee_id"))
    if dec(payload.get("valor"))!=dec(q["valor_pagar"]):
        raise BridgeError("Valor do holerite mudou depois dos descontos. Recalcule antes de salvar.")
    result={"quote":q,"employee_id":emp_id,"employee_name":name_key(payload.get("funcionario_nome") or payload.get("fornecedor")),
            "selected":chosen}
    return result


def after_submission(plan,account_id):
    if not plan:return
    account_id=positive_id(account_id)
    acc=read_account(account_id)
    q=plan["quote"]
    if not acc.get("funcionario_id"):
        raise BridgeError("Conta foi criada, mas o vínculo do holerite não foi confirmado.")
    if acc.get("competencia")!=q["competencia"] or dec(acc["valor"])!=dec(q["valor_pagar"]):
        raise BridgeError("Conta salva sem conciliação correta; revisão necessária.")
    employee_id=int(acc["funcionario_id"])
    if plan["employee_id"] and employee_id!=plan["employee_id"]:
        raise BridgeError("Funcionário alterado durante o salvamento.")
    people, _ = read_controls()
    with LOCK,closing(journal()) as con:
        con.execute("BEGIN IMMEDIATE")
        if q["vale_employee_id"]:
            row=con.execute("SELECT contas_employee_id FROM staff_links WHERE vale_employee_id=?",
                            (q["vale_employee_id"],)).fetchone()
            if row and row[0]!=employee_id:
                raise BridgeError("Vale já vinculado a outro funcionário.")
            if not row:
                # Novo funcionário já foi efetivamente criado no CONTAS.
                vale=next((x for x in people if int(x["id"])==q["vale_employee_id"]),None)
                if not vale or name_key(vale["name"])!=name_key(acc["fornecedor"]):
                    raise BridgeError("Nome do funcionário não coincide com o cadastro do Vale.")
                con.execute("INSERT INTO staff_links(vale_employee_id,contas_employee_id) VALUES(?,?)",
                            (q["vale_employee_id"],employee_id))
        plan_rows={int(x["id"]):x for x in q["parcelas"]}
        for installment_id in q["selecionadas"]:
            p=plan_rows[installment_id]
            conflicting=con.execute("""SELECT account_id FROM discounts WHERE vale_installment_id=?
                 AND account_id<>? AND status IN ('reserved','error') LIMIT 1""",
                 (installment_id,account_id)).fetchone()
            if conflicting:raise BridgeError("Parcela já reservada por outro holerite.")
            con.execute("""INSERT INTO discounts(
                account_id,vale_installment_id,control_id,employee_id,
                competence,original_amount,amount,status)
                VALUES(?,?,?,?,?,?,?,'reserved')
                ON CONFLICT(account_id,vale_installment_id) DO NOTHING""",
                (account_id,installment_id,p["control_id"],employee_id,
                 q["competencia"],q["original"],p["amount"]))
            event(con,"vale_reservado",account_id,installment_id,p["amount"])
        con.commit()


def _control_request(method,path,payload=None):
    from .operations_gateway import _upstream, _requested_origin
    host,port=_upstream("controles")
    origin=_requested_origin("controles")
    u=urlsplit(origin)
    headers={"Host":u.netloc,"Origin":origin,"Accept":"application/json"}
    body=None
    if payload is not None:
        body=json.dumps(payload,separators=(",",":"),ensure_ascii=False).encode()
        headers["Content-Type"]="application/json"
    conn=http.client.HTTPConnection(host,port,timeout=12)
    try:
        conn.request(method,path,body=body,headers=headers)
        response=conn.getresponse()
        data=response.read(2_000_000)
        try:parsed=json.loads(data)
        except ValueError:parsed={}
        if response.status>=400:
            raise BridgeError(parsed.get("error") or "Motor de Vales recusou a operação.")
        return parsed
    finally:
        conn.close()


def settle_account(account_id):
    """Só efetiva desconto quando o pagamento existir no CONTAS.

    Marcador externo de pagamento protege contra reinício/falha entre a API
    original aceitar o POST e a Central registrar a resposta no journal.
    """
    account_id=positive_id(account_id)
    account=read_account(account_id)
    if not account["paga"]:
        return {"ok":True,"status":"aguardando_pagamento","account_id":account_id}
    settled=0;errors=[]
    with LOCK,closing(journal()) as con:
        plans=[dict(r) for r in con.execute(
            "SELECT * FROM discounts WHERE account_id=? AND status IN ('reserved','error') ORDER BY id",
            (account_id,))]
        for p in plans:
            marker=f"{PAID_NOTE}{account_id}:{p['vale_installment_id']}"
            try:
                history=_control_request("GET",f"/api/controls/{int(p['control_id'])}/vales/payments")
                records=history if isinstance(history,list) else history.get("payments",[])
                previous=[r for r in records if marker in str(r.get("notes","")) and
                          int(r.get("installment_id",0))==p["vale_installment_id"]]
                if len(previous)>1:
                    raise BridgeError("Mais de um desconto com o mesmo marcador; revisão manual necessária.")
                if previous:
                    payment_id=int(previous[0]["id"])
                else:
                    result=_control_request("POST",
                        f"/api/vales-installments/{p['vale_installment_id']}/payments",
                        {"amount":p["amount"],"month":p["competence"],"notes":marker})
                    payment_id=positive_id(result.get("id"))
                con.execute("BEGIN IMMEDIATE")
                con.execute("""UPDATE discounts SET status='settled',vale_payment_id=?,
                    settled_at=CURRENT_TIMESTAMP,last_error='' WHERE id=?""",
                    (payment_id,p["id"]))
                event(con,"vale_baixado",account_id,p["vale_installment_id"],str(payment_id))
                con.commit()
                settled+=1
            except Exception as exc:
                con.rollback()
                message=str(exc)[:350]
                con.execute("BEGIN IMMEDIATE")
                con.execute("UPDATE discounts SET status='error',last_error=? WHERE id=?",
                            (message,p["id"]))
                event(con,"falha_conciliacao",account_id,p["vale_installment_id"],message)
                con.commit()
                errors.append({"parcela_id":p["vale_installment_id"],"erro":message})
    return {"ok":not errors,"account_id":account_id,"baixados":settled,
            "pendentes":len(errors),"erros":errors}


def discounts_for_account(account_id):
    account_id=positive_id(account_id)
    with closing(journal()) as con:
        return [dict(r) for r in con.execute(
            """SELECT vale_installment_id,control_id,competence,amount,original_amount,status,
                      vale_payment_id,last_error FROM discounts WHERE account_id=? ORDER BY id""",
            (account_id,))]


def read_body(handler):
    if handler.headers.get("Content-Type","").split(";")[0].strip()!="application/json":
        raise BridgeError("Envie JSON.")
    try:size=int(handler.headers.get("Content-Length","0"))
    except ValueError:raise BridgeError("Tamanho inválido.") from None
    if not 2<=size<=16000:
        raise BridgeError("Dados inválidos ou grandes demais.")
    try:result=json.loads(handler.rfile.read(size))
    except (ValueError,UnicodeError):raise BridgeError("JSON inválido.") from None
    if not isinstance(result,dict):raise BridgeError("Envie um objeto.")
    return result


def handle(handler):
    url=urlsplit(handler.path)
    path=url.path
    if not path.startswith("/api/vales-holerites/"):
        return False
    if not handler.authorized():
        handler.respond(401,{"ok":False,"erro":"Sessão não autorizada."})
        return True
    if handler.command!="GET" and not access.trusted_origin(handler.headers.get("Origin","")):
        handler.respond(403,{"ok":False,"erro":"Origem não autorizada."})
        return True
    try:
        qs=parse_qs(url.query)
        def param(key):return qs.get(key,[""])[0]
        method=handler.command
        if method=="GET" and path=="/api/vales-holerites/funcionarios":
            result=staff_view()
        elif method=="GET" and path=="/api/vales-holerites/cotacao":
            result=quote(param("funcionario_id"),param("competencia"),param("original"),
                  account_id=param("account_id") or None,
                  vale_employee_id=param("vale_employee_id") or None)
        elif method=="GET" and path=="/api/vales-holerites/conta":
            result={"ok":True,"descontos":discounts_for_account(param("account_id"))}
        elif method=="POST" and path=="/api/vales-holerites/vincular":
            result=assign_link(read_body(handler))
        elif method=="POST" and path=="/api/vales-holerites/reconciliar":
            data=read_body(handler)
            result=settle_account(data.get("account_id"))
        else:
            handler.respond(404,{"ok":False,"erro":"Rota de integração inexistente."})
            return True
        handler.respond(200,result)
    except BridgeError as exc:
        handler.respond(409,{"ok":False,"erro":str(exc)})
    except Exception:
        handler.respond(503,{"ok":False,"erro":"Integração entre Contas e Vales indisponível. Nenhum lançamento de vale foi modificado."})
    return True
