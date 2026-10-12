#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Central de Controles - servidor local, sem dependencias externas."""
from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import csv
import io
import json
import os
import subprocess
import re
import sqlite3
import truck
import debt
import receiving
import receiving_import
import debt_import
import truck_workflow
import threading
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("CONTROLES_DATA_DIR", str(ROOT / "data"))).resolve()
DB = DATA / "controles.db"
PORT = int(os.environ.get("CONTROLES_PORT", "18765"))
HOST = "127.0.0.1"
MONEY = Decimal("0.01")
SAFE_KEY = re.compile(r"^[a-z][a-z0-9_]{0,49}$")

def decimal(value):
    if isinstance(value, bool) or value is None:
        raise ValueError("Informe um numero valido.")
    value = str(value).strip()
    if "," in value:
        value = value.replace(".", "").replace(",", ".")
    try:
        n = Decimal(value)
    except (InvalidOperation, ValueError):
        raise ValueError("Numero invalido.") from None
    if not n.is_finite() or abs(n) > Decimal("1000000000000"):
        raise ValueError("Numero fora do limite.")
    return n

def money(n):
    return str(n.quantize(MONEY, rounding=ROUND_HALF_UP))

def db():
    DATA.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=20000")
    return conn

FREIGHT_FIELDS = [
    {"key":"data","label":"Data","type":"date","required":True},
    {"key":"motorista","label":"Motorista","type":"text","required":True},
    {"key":"peso","label":"Peso carregado (kg)","type":"number","required":True},
    {"key":"valor_kg","label":"Valor por kg (R$)","type":"currency","required":True},
    {"key":"comissao","label":"Comissao (%)","type":"percent","required":True,"default":"10"},
]
FREIGHT_RULES = [
    {"key":"valor_frete","label":"Valor do frete","op":"multiply","a":"peso","b":"valor_kg"},
    {"key":"comissao_valor","label":"Comissao do motorista","op":"percent","a":"valor_frete","b":"comissao"},
    {"key":"resultado","label":"Resultado apos comissao","op":"subtract","a":"valor_frete","b":"comissao_valor"},
]
FREIGHT_TYPES = [
    {"key":"frete","label":"Frete realizado","direction":1,"source":"valor_frete"},
    {"key":"abatimento","label":"Abatimento","direction":-1,"source":"manual"},
    {"key":"informacao","label":"Somente informacao","direction":0,"source":"manual"},
]

def initialize():
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS boards(
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS controls(
          id INTEGER PRIMARY KEY, board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          name TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'calculo',
          fields_json TEXT NOT NULL, rules_json TEXT NOT NULL, types_json TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS entries(
          id INTEGER PRIMARY KEY, control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
          type_key TEXT NOT NULL, type_label TEXT NOT NULL, direction INTEGER NOT NULL,
          category TEXT NOT NULL DEFAULT 'Geral', notes TEXT NOT NULL DEFAULT '',
          data_json TEXT NOT NULL, calculated_json TEXT NOT NULL,
          amount TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE INDEX IF NOT EXISTS idx_entries_control ON entries(control_id, id DESC);
        """)
        truck.init(con)
        debt.initialize(con)
        receiving.initialize(con)
        receiving_import.initialize(con)
        debt_import.initialize(con)
        if not con.execute("SELECT 1 FROM settings WHERE key=\'seeded\'").fetchone():
            already_has_boards = bool(con.execute("SELECT 1 FROM boards LIMIT 1").fetchone())
            con.execute("INSERT INTO settings(key,value) VALUES(\'seeded\',\'1\')")
            if not already_has_boards:
                seed_initial(con)
        truck_workflow.initialize(con)

def seed_initial(con):
    cur = con.execute("INSERT INTO boards(name) VALUES(?)", ("TRANSPORTADORA",))
    con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                   VALUES(?,?,?,?,?,?)""",
                (cur.lastrowid, "Controle de Fretes", "calculo",
                 json.dumps(FREIGHT_FIELDS), json.dumps(FREIGHT_RULES),
                 json.dumps(FREIGHT_TYPES)))


def unpack(row):
    result = dict(row)
    for field in ("fields_json", "rules_json", "types_json"):
        if field in result:
            result[field[:-5]] = json.loads(result.pop(field))
    return result

def require(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Informe {name}.")
    if len(value.strip()) > 150:
        raise ValueError(f"{name} muito longo.")
    return value.strip()

def validate_config(p):
    name = require(p.get("name"), "o nome")
    board_id = int(p.get("board_id") or 0)
    mode = p.get("mode", "calculo")
    if mode not in ("calculo", "saldo", "financeiro", "caminhao", "divida", "recebimento"):
        raise ValueError("Modelo de controle invalido.")
    fields = p.get("fields", [])
    rules = p.get("rules", [])
    types = p.get("types", [])
    if not isinstance(fields, list) or not 1 <= len(fields) <= 35:
        raise ValueError("Adicione de 1 a 35 campos ao formulario.")
    if not isinstance(rules, list) or len(rules) > 25:
        raise ValueError("Quantidade de calculos invalida.")
    if not isinstance(types, list) or not 1 <= len(types) <= 20:
        raise ValueError("Adicione ao menos um tipo de lancamento.")
    used, numeric = set(), set()
    for f in fields:
        key = f.get("key")
        if not isinstance(key,str) or not SAFE_KEY.fullmatch(key) or key in used:
            raise ValueError("Identificador de campo invalido ou repetido.")
        f["label"] = require(f.get("label"), "o titulo do campo")
        if f.get("type") not in ("date","text","number","currency","percent"):
            raise ValueError("Tipo de campo nao permitido.")
        f["required"] = bool(f.get("required"))
        if "default" in f and len(str(f["default"])) > 150:
            raise ValueError("Valor padrao longo demais.")
        used.add(key)
        if f["type"] in ("number","currency","percent"):
            numeric.add(key)
    for r in rules:
        key = r.get("key")
        if not isinstance(key,str) or not SAFE_KEY.fullmatch(key) or key in used:
            raise ValueError("Identificador de calculo invalido ou repetido.")
        r["label"] = require(r.get("label"), "o nome do calculo")
        if r.get("op") not in ("add","subtract","multiply","percent"):
            raise ValueError("Operacao nao permitida.")
        if r.get("a") not in numeric or r.get("b") not in numeric:
            raise ValueError("Calculo depende de campo inexistente ou de um calculo posterior.")
        used.add(key)
        numeric.add(key)
    type_keys = set()
    for t in types:
        key = t.get("key")
        if not isinstance(key,str) or not SAFE_KEY.fullmatch(key) or key in type_keys:
            raise ValueError("Tipo de lancamento invalido ou repetido.")
        t["label"] = require(t.get("label"), "o nome do lancamento")
        if type(t.get("direction")) is not int or t["direction"] not in (-1,0,1):
            raise ValueError("Escolha somar, subtrair ou nao alterar.")
        if t.get("source") != "manual" and t.get("source") not in numeric:
            raise ValueError("Origem de valor do lancamento invalida.")
        type_keys.add(key)
    return name, board_id, mode, fields, rules, types

def evaluate(control, payload, type_key, manual=None):
    if not isinstance(payload,dict):
        raise ValueError("Formulario invalido.")
    values = {}
    nums = {}
    for f in control["fields"]:
        key = f["key"]
        val = payload.get(key, f.get("default", ""))
        if val is None:
            val = ""
        val = str(val).strip()
        if f.get("required") and not val:
            raise ValueError("Preencha o campo " + f["label"] + ".")
        if len(val) > 2000:
            raise ValueError("Campo excedeu o limite.")
        if f["type"] == "date" and val:
            try:
                date.fromisoformat(val)
            except ValueError:
                raise ValueError("Data invalida.") from None
        if f["type"] in ("number","currency","percent") and val:
            n = decimal(val)
            nums[key] = n
            if f["type"] == "percent" and not 0 <= n <= 100:
                raise ValueError("Porcentagem deve estar entre 0 e 100.")
            val = str(n)
        elif f["type"] in ("number","currency","percent"):
            nums[key] = Decimal("0")
        values[key] = val
    computed = {}
    for rule in control["rules"]:
        a, b = nums[rule["a"]], nums[rule["b"]]
        op = rule["op"]
        answer = {"add":lambda:a+b, "subtract":lambda:a-b, "multiply":lambda:a*b,
                  "percent":lambda:a*b/Decimal(100)}[op]()
        answer = answer.quantize(MONEY, rounding=ROUND_HALF_UP)
        nums[rule["key"]] = answer
        computed[rule["key"]] = money(answer)
    typ = next((x for x in control["types"] if x["key"] == type_key), None)
    if typ is None:
        raise ValueError("Selecione um tipo de lancamento valido.")
    if typ["source"] == "manual":
        amount = decimal(manual if manual not in (None,"") else "0")
    else:
        amount = nums[typ["source"]]
    if amount < 0:
        raise ValueError("Valor do lancamento nao pode ser negativo.")
    return values, computed, money(amount), typ

def get_control(con, control_id):
    row = con.execute("SELECT * FROM controls WHERE id=?", (control_id,)).fetchone()
    if not row:
        raise LookupError("Controle nao encontrado.")
    return unpack(row)

def summarize(entries):
    balance = Decimal("0")
    by_category, by_type = {}, {}
    plus = minus = Decimal("0")
    for e in entries:
        amt = decimal(e["amount"])
        effect = amt * e["direction"]
        balance += effect
        if e["direction"] == 1: plus += amt
        if e["direction"] == -1: minus += amt
        cat = e["category"]
        by_category[cat] = by_category.get(cat,Decimal(0)) + effect
        typ = e["type_label"]
        by_type[typ] = by_type.get(typ,Decimal(0)) + effect
    return {"count":len(entries),"balance":money(balance),"plus":money(plus),
            "minus":money(minus),
            "by_category":[{"name":k,"total":money(v)} for k,v in sorted(by_category.items())],
            "by_type":[{"name":k,"total":money(v)} for k,v in sorted(by_type.items())]}

def entry_data(row):
    obj = dict(row)
    obj["data"] = json.loads(obj.pop("data_json"))
    obj["calculated"] = json.loads(obj.pop("calculated_json"))
    return obj

def state(con):
    boards = [dict(b) for b in con.execute("SELECT * FROM boards ORDER BY id")]
    controls = [unpack(c) for c in con.execute("SELECT * FROM controls ORDER BY id")]
    for c in controls:
        if c["mode"]=="recebimento":
            totals=receiving.summary(con,c["id"])["totals"]
            c["summary"]={"count":totals["receipts"],"balance":"0.00",
                "item_total":totals["items"],"complete":totals["complete"],
                "partial":totals["partial"],"pending":totals["pending"],
                "plus":"0.00","minus":"0.00","by_category":[],"by_type":[]}
        elif c["mode"]=="divida":
            totals=debt.summary(con,c["id"])["totals"]
            c["summary"]={"count":totals["count"],"balance":totals["balance"],
                          "plus":totals["opening_amount"],"minus":totals["paid"],
                          "by_category":[],"by_type":[]}
        elif c["mode"]=="caminhao":
            totals=truck.summary(con,c["id"])["totals"]
            c["summary"]={"count":totals["count"],"balance":totals["cash_balance"],
                          "plus":totals["freight"],"minus":totals["cash_out"],
                          "by_category":[],"by_type":[]}
        else:
            rows = con.execute("SELECT amount,direction,category,type_label FROM entries WHERE control_id=?",
                               (c["id"],)).fetchall()
            c["summary"] = summarize(rows)
    return {"boards":boards,"controls":controls}

def detail(con, cid):
    control = get_control(con,cid)
    entries = [entry_data(e) for e in con.execute(
        "SELECT * FROM entries WHERE control_id=? ORDER BY id DESC",(cid,))]
    return {"control":control,"entries":entries,"summary":summarize(entries)}

class Handler(BaseHTTPRequestHandler):
    server_version = "CentralControles/1.0"
    def log_message(self, fmt, *args):
        print("%s %s" % (self.log_date_time_string(),fmt % args),flush=True)
    def send(self, data, status=200, mime="application/json; charset=utf-8"):
        body = json.dumps(data,ensure_ascii=False).encode("utf-8") if not isinstance(data,bytes) else data
        self.send_response(status)
        self.send_header("Content-Type",mime)
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        self.wfile.write(body)
    def input(self):
        size = int(self.headers.get("Content-Length","0"))
        if not 0 <= size <= 1024*512:
            raise ValueError("Requisicao muito grande.")
        try:
            value = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeDecodeError):
            raise ValueError("JSON invalido.") from None
        if not isinstance(value,dict):
            raise ValueError("Envie um objeto.")
        return value
    def route(self):
        if self.headers.get("Host","").split(":")[0].lower() not in ("127.0.0.1","localhost"):
            return self.send({"error":"Host nao permitido."},403)
        if self.command in ("POST","PATCH","PUT","DELETE"):
            origin = self.headers.get("Origin","")
            if origin and origin not in (f"http://127.0.0.1:{PORT}",f"http://localhost:{PORT}"):
                return self.send({"error":"Origem nao permitida."},403)
        url = urlsplit(self.path).path
        method = self.command
        try:
            if method=="POST" and url=="/api/internal/shutdown":
                key_path = DATA / ".painel-token"
                try:
                    key = key_path.read_text(encoding="utf-8").strip()
                except OSError:
                    key = ""
                import secrets
                provided = self.headers.get("X-Central-Panel-Token","")
                if not key or not secrets.compare_digest(provided,key):
                    return self.send({"error":"Painel não autorizado."},403)
                self.send({"ok":True,"message":"Desligando somente a Central de Controles."})
                threading.Thread(target=self.server.shutdown,daemon=True).start()
                return
            if method=="GET" and url in ("/","/index.html"):
                return self.send((ROOT/"static"/"index.html").read_bytes(),mime="text/html; charset=utf-8")
            if method=="GET" and url=="/favicon.ico":
                return self.send((ROOT/"assets"/"CENTRAL_DE_CONTROLES.ico").read_bytes(),mime="image/x-icon")
            if method=="GET" and url=="/static/icons.svg":
                return self.send((ROOT/"static"/"icons.svg").read_bytes(),mime="image/svg+xml; charset=utf-8")
            if method=="GET" and url=="/static/app.css":
                return self.send((ROOT/"static"/"app.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/app.js":
                return self.send((ROOT/"static"/"app.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/truck.js":
                return self.send((ROOT/"static"/"truck.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/receiving_import.js":
                return self.send((ROOT/"static"/"receiving_import.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/receiving_import.css":
                return self.send((ROOT/"static"/"receiving_import.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/receiving.js":
                return self.send((ROOT/"static"/"receiving.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/receiving.css":
                return self.send((ROOT/"static"/"receiving.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/debt.js":
                return self.send((ROOT/"static"/"debt.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/debt.css":
                return self.send((ROOT/"static"/"debt.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/truck.css":
                return self.send((ROOT/"static"/"truck.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/truck_workflow.css":
                return self.send((ROOT/"static"/"truck_workflow.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/truck_workflow.js":
                return self.send((ROOT/"static"/"truck_workflow.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/api/health":
                return self.send({"ok":True,"app":"Central de Controles","app_id":"br.com.layon.meus-controles","version":"1.0"})
            with db() as con:
                if re.fullmatch(r"/api/controls/\d+/receiving/import/(?:preview|confirm)",url):
                    receiving_import.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/receiving(?:/items)?",url) or re.fullmatch(r"/api/receiving-items/\d+(?:/receipts)?",url) or re.fullmatch(r"/api/receiving-receipts/\d+",url):
                    receiving.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/debt/import/(?:preview|confirm)",url):
                    debt_import.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/debt(?:/(?:payments|settings|export\.csv))?",url) or re.fullmatch(r"/api/debt-payments/\d+",url):
                    debt.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/truck/(?:workflow|check-preview|checks|close-preview|closures)",url) or re.fullmatch(r"/api/truck-(?:checks|closures)/\d+(?:/export\.csv)?",url):
                    truck_workflow.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/truck(?:/(?:entries|settings|export\.csv))?",url) or re.fullmatch(r"/api/truck-entries/\d+",url):
                    truck.handle(self,con,method,url)
                    return
                if method=="GET" and url=="/api/state":
                    return self.send(state(con))
                if method=="POST" and url=="/api/boards":
                    p=self.input()
                    cur=con.execute("INSERT INTO boards(name) VALUES(?)",(require(p.get("name"),"o quadro"),))
                    con.commit()
                    return self.send({"id":cur.lastrowid},201)
                m=re.fullmatch(r"/api/boards/(\d+)",url)
                if m and method in ("PATCH","DELETE"):
                    bid=int(m[1])
                    if method=="PATCH":
                        p=self.input()
                        cur=con.execute("UPDATE boards SET name=? WHERE id=?",
                                        (require(p.get("name"),"o quadro"),bid))
                    else:
                        cur=con.execute("DELETE FROM boards WHERE id=?",(bid,))
                    if not cur.rowcount: raise LookupError("Quadro nao encontrado.")
                    con.commit()
                    return self.send({"ok":True})
                if method=="POST" and url=="/api/controls":
                    p=self.input()
                    name,bid,mode,fields,rules,types=validate_config(p)
                    if not con.execute("SELECT 1 FROM boards WHERE id=?",(bid,)).fetchone():
                        raise ValueError("Escolha um quadro existente.")
                    cur=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                       VALUES(?,?,?,?,?,?)""",(bid,name,mode,json.dumps(fields),json.dumps(rules),json.dumps(types)))
                    if mode=="caminhao":
                        truck.save_settings(con,cur.lastrowid,p.get("truck_settings",{}))
                    if mode=="divida":
                        debt.save_settings(con,cur.lastrowid,p.get("debt_settings",{}))
                    con.commit()
                    return self.send({"id":cur.lastrowid},201)
                m=re.fullmatch(r"/api/controls/(\d+)(?:/(entries|duplicate|export.csv))?",url)
                if m:
                    cid=int(m[1]); action=m[2]
                    if method=="GET" and action is None:
                        return self.send(detail(con,cid))
                    if method=="GET" and action=="export.csv":
                        view=detail(con,cid)
                        buf=io.StringIO()
                        writer=csv.writer(buf,delimiter=";")
                        columns=[f["key"] for f in view["control"]["fields"]]
                        calcs=[f["key"] for f in view["control"]["rules"]]
                        writer.writerow(["ID","Categoria","Tipo","Operacao","Valor","Observacoes"]+columns+calcs)
                        for e in view["entries"]:
                            writer.writerow([e["id"],e["category"],e["type_label"],e["direction"],e["amount"],e["notes"]]+
                                            [e["data"].get(k,"") for k in columns]+[e["calculated"].get(k,"") for k in calcs])
                        raw="\ufeff"+buf.getvalue()
                        return self.send(raw.encode("utf-8"),mime="text/csv; charset=utf-8")
                    if method=="PATCH" and action is None:
                        get_control(con,cid)
                        p=self.input()
                        name,bid,mode,fields,rules,types=validate_config(p)
                        if not con.execute("SELECT 1 FROM boards WHERE id=?",(bid,)).fetchone():
                            raise ValueError("Quadro inexistente.")
                        con.execute("""UPDATE controls SET board_id=?,name=?,mode=?,fields_json=?,rules_json=?,types_json=? WHERE id=?""",
                                    (bid,name,mode,json.dumps(fields),json.dumps(rules),json.dumps(types),cid))
                        con.commit()
                        return self.send({"ok":True})
                    if method=="DELETE" and action is None:
                        cur=con.execute("DELETE FROM controls WHERE id=?",(cid,))
                        if not cur.rowcount: raise LookupError("Controle nao encontrado.")
                        con.commit()
                        return self.send({"ok":True})
                    if method=="POST" and action=="duplicate":
                        c=get_control(con,cid)
                        cur=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json) VALUES(?,?,?,?,?,?)""",
                                        (c["board_id"],c["name"]+" (copia)",c["mode"],
                                         json.dumps(c["fields"]),json.dumps(c["rules"]),json.dumps(c["types"])))
                        if c["mode"]=="caminhao":
                            truck.save_settings(con,cur.lastrowid,truck.settings(con,cid))
                        if c["mode"]=="divida":
                            debt.save_settings(con,cur.lastrowid,debt.settings(con,cid))
                        con.commit()
                        return self.send({"id":cur.lastrowid},201)
                    if method=="POST" and action=="entries":
                        c=get_control(con,cid); p=self.input()
                        values,computed,amount,typ=evaluate(c,p.get("data",{}),p.get("type_key"),p.get("manual_amount"))
                        category=str(p.get("category") or "Geral").strip()[:100] or "Geral"
                        notes=str(p.get("notes") or "")[:3000]
                        cur=con.execute("""INSERT INTO entries(control_id,type_key,type_label,direction,category,notes,
                            data_json,calculated_json,amount) VALUES(?,?,?,?,?,?,?,?,?)""",
                            (cid,typ["key"],typ["label"],typ["direction"],category,notes,
                             json.dumps(values),json.dumps(computed),amount))
                        con.commit()
                        return self.send({"id":cur.lastrowid},201)
                m=re.fullmatch(r"/api/entries/(\d+)",url)
                if m and method in ("PUT","DELETE"):
                    eid=int(m[1])
                    original=con.execute("SELECT * FROM entries WHERE id=?",(eid,)).fetchone()
                    if not original: raise LookupError("Lancamento nao encontrado.")
                    if method=="DELETE":
                        con.execute("DELETE FROM entries WHERE id=?",(eid,))
                    else:
                        c=get_control(con,original["control_id"]); p=self.input()
                        values,computed,amount,typ=evaluate(c,p.get("data",{}),p.get("type_key"),p.get("manual_amount"))
                        category=str(p.get("category") or "Geral").strip()[:100] or "Geral"
                        notes=str(p.get("notes") or "")[:3000]
                        con.execute("""UPDATE entries SET type_key=?,type_label=?,direction=?,category=?,notes=?,
                            data_json=?,calculated_json=?,amount=?,updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                            (typ["key"],typ["label"],typ["direction"],category,notes,json.dumps(values),
                             json.dumps(computed),amount,eid))
                    con.commit()
                    return self.send({"ok":True})
            return self.send({"error":"Rota nao encontrada."},404)
        except LookupError as exc:
            return self.send({"error":str(exc)},404)
        except (ValueError, TypeError, KeyError, InvalidOperation) as exc:
            return self.send({"error":str(exc)},400)
        except Exception:
            import traceback
            traceback.print_exc()
            return self.send({"error":"Falha interna. Consulte o log do painel."},500)
    def do_GET(self): self.route()
    def do_POST(self): self.route()
    def do_PATCH(self): self.route()
    def do_PUT(self): self.route()
    def do_DELETE(self): self.route()

def ensure_windows_desktop_shortcut():
    """O app recem-atualizado instala automaticamente o atalho no Windows.

    Chamado pelo app, nao pelo painel antigo que pode estar executando
    durante o primeiro git pull. Erros nao impedem que o app inicie.
    """
    if os.name!="nt":
        return
    script=ROOT/"INSTALAR_ATALHO.vbs"
    icon=ROOT/"assets"/"CENTRAL_DE_CONTROLES.ico"
    if not (script.is_file() and icon.is_file()):
        print("Atalho: arquivos nao encontrados.",flush=True)
        return
    try:
        done=subprocess.run(["wscript.exe",str(script)],cwd=str(ROOT),
            stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,timeout=15,
            creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        if done.returncode:
            print("Atalho: nao foi possivel criar ("+str(done.returncode)+").",flush=True)
    except Exception as exc:
        print("Atalho: "+str(exc),flush=True)


if __name__=="__main__":
    initialize()
    ensure_windows_desktop_shortcut()
    server=ThreadingHTTPServer((HOST,PORT),Handler)
    print(f"Central de Controles: http://{HOST}:{PORT}",flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
