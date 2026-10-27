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
import open_debt
import receiving
import pair
import pair_records
import pair_financial_import
import pair_mixed_import
import control_types
import vales
import receiving_import
import receiving_pdf
import receiving_xml
import debt_import
import truck_workflow
import threading
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("CONTROLES_DATA_DIR", str(ROOT / "data"))).resolve()
DB = DATA / "controles.db"
PORT = int(os.environ.get("CONTROLES_PORT", "18765"))
HOST = os.environ.get("CONTROLES_BIND_HOST", "127.0.0.1")
# O acesso remoto deve passar por um proxy HTTPS com autenticação.
PUBLIC_ORIGIN = os.environ.get("CONTROLES_PUBLIC_ORIGIN", "").strip().rstrip("/")
DISABLE_LOCAL_SHUTDOWN = os.environ.get("CONTROLES_DISABLE_LOCAL_SHUTDOWN", "") == "1"


def allowed_mutation_origin(origin):
    """Em modo público exige Origin HTTPS exato; em modo local preserva o painel Windows."""
    if PUBLIC_ORIGIN:
        return PUBLIC_ORIGIN.startswith("https://") and origin == PUBLIC_ORIGIN
    return not origin or origin in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}")

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
    if os.environ.get("CONTROLES_PGHOST"):
        # Cada requisição usa o PostgreSQL PRIVADO da VPS; SQLite local permanece intacto.
        from pg_compat import connect
        return connect()
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
        vales.initialize(con)
        receiving.initialize(con)
        pair.initialize(con)
        pair_records.initialize(con)
        pair_financial_import.initialize(con)
        control_types.initialize(con)
        receiving_import.initialize(con)
        receiving_pdf.initialize(con)
        receiving_xml.initialize(con)
        debt_import.initialize(con)
        if not con.execute("SELECT 1 FROM settings WHERE key=\'seeded\'").fetchone():
            already_has_boards = bool(con.execute("SELECT 1 FROM boards LIMIT 1").fetchone())
            con.execute("INSERT INTO settings(key,value) VALUES(\'seeded\',\'1\')")
            if not already_has_boards:
                seed_initial(con)
        truck_workflow.initialize(con)
        if os.environ.get('CONTROLES_PGHOST'):
            upgrade_default_freight_control(con)
            fix_seeded_freight_commission(con)
            correct_freight_tonne_unit(con)

def upgrade_default_freight_control(con):
    """Converte apenas a planilha padrão vazia na VPS; nunca dados já lançados."""
    rows=con.execute("""SELECT c.id,c.fields_json,c.rules_json,c.types_json
        FROM controls c JOIN boards b ON c.board_id=b.id
        WHERE c.mode='calculo' AND c.name='Controle de Fretes'
          AND b.name='TRANSPORTADORA'""").fetchall()
    for row in rows:
        try:
            original=(json.loads(row["fields_json"])==FREIGHT_FIELDS and
                      json.loads(row["rules_json"])==FREIGHT_RULES and
                      json.loads(row["types_json"])==FREIGHT_TYPES)
        except (TypeError,ValueError):
            original=False
        cid=row["id"]
        if not original or con.execute("SELECT 1 FROM entries WHERE control_id=? LIMIT 1",(cid,)).fetchone():
            continue
        if con.execute("SELECT 1 FROM truck_entries WHERE control_id=? LIMIT 1",(cid,)).fetchone():
            continue
        con.execute("UPDATE controls SET mode='caminhao' WHERE id=?",(cid,))
        truck.save_settings(con,cid,{"commission_pct":"13",
            "opening_cash":"0","opening_commission":"0","driver_name":"",
            "price_basis":"tonne","freight_types":["Frete Normal","Frete Jonas"],
            "categories":["Abastecimento","Manutenção","Pedágio",
                          "Seguro do Caminhão","Outros Gastos"]})


def fix_seeded_freight_commission(con):
    """Corrige uma única vez 10% -> 13% no Controle de Fretes padrão da VPS.

    Só altera a taxa dos próximos lançamentos. Não modifica valores, datas,
    comissões históricas, saldos iniciais nem outros controles personalizados.
    O marcador impede que futuras configurações manuais sejam sobrescritas.
    """
    rows=con.execute("""SELECT c.id,c.fields_json,c.rules_json,c.types_json,
                               t.commission_pct,t.price_basis,t.freight_types_json
        FROM controls c
        JOIN boards b ON b.id=c.board_id
        JOIN truck_settings t ON t.control_id=c.id
        WHERE c.mode='caminhao' AND c.name='Controle de Fretes'
          AND b.name='TRANSPORTADORA'""").fetchall()
    for row in rows:
        try:
            seeded=(json.loads(row["fields_json"])==FREIGHT_FIELDS and
                    json.loads(row["rules_json"])==FREIGHT_RULES and
                    json.loads(row["types_json"])==FREIGHT_TYPES)
            freights=json.loads(row["freight_types_json"])
        except (TypeError,ValueError):
            continue
        if (not seeded or row["price_basis"]!="kg" or
            not {"Frete Normal","Frete Jonas"}.issubset(set(freights))):
            continue
        key="freight_seed_pct13_v1_"+str(row["id"])
        if con.execute("SELECT 1 FROM settings WHERE key=?",(key,)).fetchone():
            continue
        if row["commission_pct"]=="10":
            con.execute("UPDATE truck_settings SET commission_pct='13' WHERE control_id=?",
                        (row["id"],))
        con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)",
                    (key,"1"))


def correct_freight_tonne_unit(con):
    """Reconcilia exclusivamente os três fretes de calcário confirmados.

    Independe da configuração anterior (kg/tonne) e da migração v1:
    o próprio registro precisa coincidir com os valores inflados, 215/kg,
    comissão de 13%, nome, categoria, data e peso. Sem mudar datas
    conferidas/fechadas, sem mexer em outros fretes ou apagar histórico.
    """
    import truck_workflow
    targets=(
        ("2026-10-15",Decimal("47000")),
        ("2026-10-10",Decimal("47610")),
        ("2026-10-06",Decimal("48380")),
    )
    controls=con.execute("""SELECT c.id,t.price_basis
        FROM controls c JOIN boards b ON b.id=c.board_id
        JOIN truck_settings t ON t.control_id=c.id
        WHERE c.mode='caminhao' AND LOWER(TRIM(c.name))='controle de fretes'
          AND UPPER(TRIM(b.name))='TRANSPORTADORA'""").fetchall()
    if not controls:
        print("FRETES/R$/T: controle TRANSPORTADORA / Controle de Fretes não encontrado.")
    for control in controls:
        cid=control["id"]
        pending=[]
        already=[]
        absent=[]
        issues=[]
        for when,weight in targets:
            candidates=con.execute("""SELECT * FROM truck_entries
                WHERE control_id=? AND event_date=? AND kind='freight'""",
                (cid,when)).fetchall()
            matches=[r for r in candidates
                     if str(r["category"]).strip().casefold()=="frete jonas"
                     and str(r["description"]).strip().casefold()=="calcario jonas"
                     and Decimal(r["weight_kg"])==weight]
            if not matches:
                absent.append(when)
                continue
            if len(matches)!=1:
                issues.append(when+": encontrados "+str(len(matches))+" registros idênticos")
                continue
            item=matches[0]
            old_amount=money(weight*Decimal("215"))
            new_amount=money(weight/Decimal("1000")*Decimal("215"))
            old_commission=money(Decimal(old_amount)*Decimal("0.13"))
            new_commission=money(Decimal(new_amount)*Decimal("0.13"))
            old_data=(Decimal(item["price_tonne"])==Decimal("215000")
                      and Decimal(item["amount"])==Decimal(old_amount)
                      and Decimal(item["commission_amount"])==Decimal(old_commission)
                      and Decimal(item["commission_pct"])==Decimal("13"))
            corrected=(Decimal(item["price_tonne"])==Decimal("215")
                       and Decimal(item["amount"])==Decimal(new_amount)
                       and Decimal(item["commission_amount"])==Decimal(new_commission)
                       and Decimal(item["commission_pct"])==Decimal("13"))
            if corrected:
                already.append(item["id"])
                continue
            if not old_data:
                issues.append(when+": valores diferentes da captura; entrada "+str(item["amount"])
                              +", frete/t "+str(item["price_tonne"])
                              +", comissão "+str(item["commission_amount"]))
                continue
            try:
                truck_workflow.assert_entry_editable(con,cid,when)
            except ValueError as exc:
                issues.append(when+": "+str(exc))
                continue
            pending.append((item,new_amount,new_commission))
        if issues:
            print("FRETES/R$/T: controle",cid,"SEM ALTERAÇÕES:","; ".join(issues),
                  "| já corretos:",len(already),"| não encontrados:",",".join(absent))
            continue
        audit=[]
        for entry,amount,commission in pending:
            con.execute("""UPDATE truck_entries
                SET price_tonne=?,amount=?,commission_amount=?,updated_at=CURRENT_TIMESTAMP
                WHERE id=? AND control_id=?""",
                ("215",amount,commission,entry["id"],cid))
            audit.append({
                "entry_id":entry["id"],"date":entry["event_date"],
                "old_price_tonne":str(entry["price_tonne"]),
                "old_amount":str(entry["amount"]),
                "old_commission":str(entry["commission_amount"]),
                "new_price_tonne":"215","new_amount":amount,
                "new_commission":commission
            })
        # R$/tonelada para novos lançamentos, mesmo se a migração v1
        # já havia mudado a configuração mas deixado linhas antigas erradas.
        if control["price_basis"]!="tonne":
            con.execute("UPDATE truck_settings SET price_basis='tonne' WHERE control_id=?",
                        (cid,))
        key="freight_tonne_215_fix_v2_"+str(cid)
        previous=con.execute("SELECT value FROM settings WHERE key=?",(key,)).fetchone()
        if previous:
            earlier=json.loads(previous["value"])
            if audit:
                con.execute("UPDATE settings SET value=? WHERE key=?",
                            (json.dumps(earlier+audit,ensure_ascii=False),key))
        else:
            con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)",
                        (key,json.dumps(audit,ensure_ascii=False)))
        print("FRETES/R$/T: controle",cid,"| corrigidos:",len(audit),
              "| já corretos:",len(already),"| não encontrados:",",".join(absent) or "nenhum",
              "| unidade atual: R$/tonelada")


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
    if mode not in ("calculo", "saldo", "financeiro", "caminhao", "divida", "divida_sem_valor", "recebimento", "acerto_ab", "vale_funcionarios"):
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
        if c["mode"]=="acerto_ab":
            totals=pair.summary(con,c["id"])["totals"]
            c["summary"]={"count":totals["count"],"balance":totals["balance"],
                "settlement":totals["settlement"],
                "plus":money(Decimal(totals["b_to_a"])+Decimal(totals["payments_a_to_b"])),
                "minus":money(Decimal(totals["a_to_b"])+Decimal(totals["payments_b_to_a"])),
                "by_category":[],"by_type":[]}
        elif c["mode"]=="vale_funcionarios":
            totals=vales.get_summary(con,c["id"])["totals"]
            c["summary"]={"count":totals["debts"],"balance":totals["remaining"],
                "plus":totals["lent"],"minus":totals["paid"],
                "employees":totals["active"],"by_category":[],"by_type":[]}
        elif c["mode"]=="recebimento":
            totals=receiving.summary(con,c["id"])["totals"]
            c["summary"]={"count":totals["receipts"],"balance":"0.00",
                "item_total":totals["items"],"complete":totals["complete"],
                "partial":totals["partial"],"pending":totals["pending"],
                "plus":"0.00","minus":"0.00","by_category":[],"by_type":[]}
        elif c["mode"]=="divida_sem_valor":
            totals=open_debt.summary(con,c["id"])["totals"]
            c["summary"]={"count":totals["count"],"balance":totals["paid"],
                "plus":totals["paid"],"minus":"0.00",
                "by_category":[],"by_type":[]}
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
        self.send_header("X-Frame-Options","DENY")
        self.send_header("Referrer-Policy","no-referrer")
        self.end_headers()
        self.wfile.write(body)
    def input(self,max_bytes=1024*512):
        size = int(self.headers.get("Content-Length","0"))
        if not 0 <= size <= max_bytes:
            raise ValueError("Requisicao muito grande.")
        try:
            value = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeDecodeError):
            raise ValueError("JSON invalido.") from None
        if not isinstance(value,dict):
            raise ValueError("Envie um objeto.")
        return value
    def route(self):
        public_host = urlsplit(PUBLIC_ORIGIN).hostname if PUBLIC_ORIGIN else None
        allowed_hosts = ("127.0.0.1", "localhost", public_host)
        if self.headers.get("Host","").split(":")[0].lower() not in allowed_hosts:
            return self.send({"error":"Host nao permitido."},403)
        if self.command in ("POST","PATCH","PUT","DELETE"):
            origin = self.headers.get("Origin","")
            if not allowed_mutation_origin(origin):
                return self.send({"error":"Origem nao permitida."},403)
        url = urlsplit(self.path).path
        method = self.command
        try:
            if method=="POST" and url=="/api/internal/shutdown":
                if DISABLE_LOCAL_SHUTDOWN:
                    return self.send({"error":"Desligamento remoto desabilitado."},403)
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
            if method=="GET" and url=="/api/ready":
                try:
                    with db() as probe:
                        found = probe.execute("SELECT COUNT(*) AS count FROM controls").fetchone()
                        if found is None:
                            raise RuntimeError("Banco sem resposta")
                    return self.send({"ok":True,"database":"ready"})
                except Exception:
                    return self.send({"ok":False,"database":"unavailable"},503)
            if method=="GET" and url=="/manifest.webmanifest":
                return self.send((ROOT/"static"/"manifest.webmanifest").read_bytes(),mime="application/manifest+json; charset=utf-8")
            if method=="GET" and url=="/sw.js":
                return self.send((ROOT/"static"/"sw.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/pwa.js":
                return self.send((ROOT/"static"/"pwa.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url in ("/pwa-icon-192.png","/pwa-icon-512.png"):
                from pwa_assets import icon_png
                return self.send(icon_png(192 if "192" in url else 512),mime="image/png")
            if method=="GET" and url in ("/","/index.html"):
                return self.send((ROOT/"static"/"index.html").read_bytes(),mime="text/html; charset=utf-8")
            if method=="GET" and url=="/favicon.ico":
                return self.send((ROOT/"assets"/"CENTRAL_DE_CONTROLES.ico").read_bytes(),mime="image/x-icon")
            if method=="GET" and url=="/static/icons.svg":
                return self.send((ROOT/"static"/"icons.svg").read_bytes(),mime="image/svg+xml; charset=utf-8")
            if method=="GET" and url=="/static/app.css":
                return self.send((ROOT/"static"/"app.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/desktop_compact.css":
                return self.send((ROOT/"static"/"desktop_compact.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/app.js":
                return self.send((ROOT/"static"/"app.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/truck.js":
                return self.send((ROOT/"static"/"truck.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/receiving_pdf.js":
                return self.send((ROOT/"static"/"receiving_pdf.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/receiving_pdf.css":
                return self.send((ROOT/"static"/"receiving_pdf.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/receiving_import.js":
                return self.send((ROOT/"static"/"receiving_import.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/receiving_import.css":
                return self.send((ROOT/"static"/"receiving_import.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/vales.js":
                return self.send((ROOT/"static"/"vales.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/vales.css":
                return self.send((ROOT/"static"/"vales.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/control_types.js":
                return self.send((ROOT/"static"/"control_types.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/control_types.css":
                return self.send((ROOT/"static"/"control_types.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/pair_financial_import.js":
                return self.send((ROOT/"static"/"pair_financial_import.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/pair_records.js":
                return self.send((ROOT/"static"/"pair_records.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/pair.js":
                return self.send((ROOT/"static"/"pair.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/pair.css":
                return self.send((ROOT/"static"/"pair.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/receiving.js":
                return self.send((ROOT/"static"/"receiving.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/receiving_xml.js":
                return self.send((ROOT/"static"/"receiving_xml.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/receiving.css":
                return self.send((ROOT/"static"/"receiving.css").read_bytes(),mime="text/css; charset=utf-8")
            if method=="GET" and url=="/static/open_debt.js":
                return self.send((ROOT/"static"/"open_debt.js").read_bytes(),mime="application/javascript; charset=utf-8")
            if method=="GET" and url=="/static/open_debt.css":
                return self.send((ROOT/"static"/"open_debt.css").read_bytes(),mime="text/css; charset=utf-8")
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
                return self.send({"ok":True,"app":"Central de Controles","app_id":"br.com.layon.meus-controles","version":"1.0","release":"20261027-pedidos-pdf-ocr-dbfix-v12","import_formats":["central-pair-financial-v1","central-pair-records-v1","central-pair-mixed-v1"]})
            with db() as con:
                if re.fullmatch(r"/api/controls/\d+/vales(?:/(?:employees|payments))?",url) or re.fullmatch(r"/api/vales-(?:employees|debts|installments|payments)/\d+(?:/(?:debts|plan|pay|payments))?",url):
                    vales.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/pair/mixed-import/(?:preview|confirm)",url):
                    match=re.fullmatch(r"/api/controls/(\d+)/pair/mixed-import/(preview|confirm)",url)
                    if method!="POST":
                        raise LookupError("Operação não encontrada.")
                    request=self.input()
                    cid=int(match[1])
                    if match[2]=="preview":
                        return self.send(pair_mixed_import.preview(con,cid,request))
                    return self.send(pair_mixed_import.confirm(con,cid,request),201)
                if re.fullmatch(r"/api/controls/\d+/pair/financial-import/(?:preview|confirm)",url):
                    match=re.fullmatch(r"/api/controls/(\d+)/pair/financial-import/(preview|confirm)",url)
                    cid=int(match[1])
                    request=self.input()
                    if method!="POST":
                        raise LookupError("Operação não encontrada.")
                    if match[2]=="preview":
                        return self.send(pair_financial_import.preview(con,cid,request))
                    return self.send(pair_financial_import.confirm(con,cid,request),201)
                if re.fullmatch(r"/api/controls/\d+/pair/(?:records|import/(?:preview|confirm))",url) or re.fullmatch(r"/api/pair-records/\d+",url):
                    pair_records.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/pair(?:/(?:entries|settings|preview|closures))?",url) or re.fullmatch(r"/api/pair-entries/\d+",url) or re.fullmatch(r"/api/pair-closures/\d+(?:/export\.csv)?",url):
                    pair.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/receiving/xml/(?:preview|confirm|pending(?:/\d+/assign)?)",url):
                    receiving_xml.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/receiving/pdf/(?:preview|confirm)",url):
                    receiving_pdf.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/receiving/import/(?:preview|confirm)",url):
                    receiving_import.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/receiving(?:/(?:items|bulk-delete))?",url) or re.fullmatch(r"/api/receiving-items/\d+(?:/(?:receipts|complete))?",url) or re.fullmatch(r"/api/receiving-receipts/\d+",url):
                    receiving.handle(self,con,method,url)
                    return
                if re.fullmatch(r"/api/controls/\d+/open-debt(?:/(?:payments|settings|export\.csv))?",url) or re.fullmatch(r"/api/open-debt-payments/\d+",url):
                    open_debt.handle(self,con,method,url)
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
                if re.fullmatch(r"/api/controls/\d+/truck(?:/(?:entries|settings|categories|export\.csv))?",url) or re.fullmatch(r"/api/truck-entries/\d+",url):
                    truck.handle(self,con,method,url)
                    return
                if method=="GET" and url=="/api/state":
                    return self.send(state(con))
                if method=="POST" and url=="/api/boards":
                    p=self.input()
                    cur=con.execute("INSERT INTO boards(name) VALUES(?)",(require(p.get("name"),"a pasta"),))
                    con.commit()
                    return self.send({"id":cur.lastrowid},201)
                m=re.fullmatch(r"/api/boards/(\d+)",url)
                if m and method in ("PATCH","DELETE"):
                    bid=int(m[1])
                    if method=="PATCH":
                        p=self.input()
                        cur=con.execute("UPDATE boards SET name=? WHERE id=?",
                                        (require(p.get("name"),"a pasta"),bid))
                    else:
                        if not con.execute("SELECT 1 FROM boards WHERE id=?",(bid,)).fetchone():
                            raise LookupError("Pasta não encontrada.")
                        if con.execute("SELECT 1 FROM controls WHERE board_id=? LIMIT 1",(bid,)).fetchone():
                            raise ValueError("Esta pasta contém controles. Mova-os para outra pasta antes de excluir.")
                        cur=con.execute("DELETE FROM boards WHERE id=?",(bid,))
                    if not cur.rowcount: raise LookupError("Pasta não encontrada.")
                    con.commit()
                    return self.send({"ok":True})
                if method=="POST" and url=="/api/controls":
                    p=self.input()
                    name,bid,mode,fields,rules,types=validate_config(p)
                    if not con.execute("SELECT 1 FROM boards WHERE id=?",(bid,)).fetchone():
                        raise ValueError("Escolha uma pasta existente.")
                    cur=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                       VALUES(?,?,?,?,?,?)""",(bid,name,mode,json.dumps(fields),json.dumps(rules),json.dumps(types)))
                    if mode=="caminhao":
                        truck.save_settings(con,cur.lastrowid,p.get("truck_settings",{}))
                    if mode=="divida":
                        debt.save_settings(con,cur.lastrowid,p.get("debt_settings",{}))
                    if mode=="acerto_ab":
                        pair.save_settings(con,cur.lastrowid,p.get("pair_settings",{}))
                    con.commit()
                    return self.send({"id":cur.lastrowid},201)
                m=re.fullmatch(r"/api/controls/(\d+)(?:/(entries|duplicate|move|type|export.csv))?",url)
                if m:
                    cid=int(m[1]); action=m[2]
                    if method=="GET" and action is None:
                        return self.send(detail(con,cid))
                    if action=="type":
                        if method=="GET":
                            return self.send(control_types.preview(con,cid))
                        if method=="PATCH":
                            return self.send(control_types.change(con,cid,self.input()))
                    if method=="PATCH" and action=="move":
                        current=get_control(con,cid)
                        payload=self.input()
                        destination=payload.get("board_id")
                        if isinstance(destination,bool) or not isinstance(destination,int) or destination<=0:
                            raise ValueError("Selecione uma pasta de destino válida.")
                        if not con.execute("SELECT 1 FROM boards WHERE id=?",(destination,)).fetchone():
                            raise ValueError("A pasta de destino não existe.")
                        # Modificar apenas board_id: mantém o mesmo ID, modelo, configurações
                        # e todas as tabelas de lançamentos vinculadas ao controle.
                        con.execute("UPDATE controls SET board_id=? WHERE id=?",(destination,cid))
                        con.commit()
                        return self.send({"ok":True,"id":cid,"from_board_id":current["board_id"],
                                          "board_id":destination,"moved":current["board_id"]!=destination})
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
                        old=get_control(con,cid)
                        p=self.input()
                        name,bid,mode,fields,rules,types=validate_config(p)
                        if mode!=old["mode"]:
                            raise ValueError("Use a opção Alterar tipo para trocar o modelo sem perder dados.")
                        if not con.execute("SELECT 1 FROM boards WHERE id=?",(bid,)).fetchone():
                            raise ValueError("Pasta inexistente.")
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
                        if c["mode"]=="acerto_ab":
                            pair.save_settings(con,cur.lastrowid,pair.settings(con,cid))
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
    if os.environ.get("CONTROLES_PGHOST") and (not PUBLIC_ORIGIN.startswith("https://") or not DISABLE_LOCAL_SHUTDOWN):
        raise RuntimeError("A VPS exige CONTROLES_PUBLIC_ORIGIN=https://... e desligamento remoto desabilitado.")
    initialize()
    ensure_windows_desktop_shortcut()
    server=ThreadingHTTPServer((HOST,PORT),Handler)
    print(f"Central de Controles: http://{HOST}:{PORT}",flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
