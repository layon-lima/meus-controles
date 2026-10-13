"""Livro de fretes e despesas de caminhões.
Não altera a contabilidade dos controles genéricos nem seus lançamentos existentes.
Comissão é competência do frete, vale é liquidação da dívida com o motorista.
"""
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import csv
import io
import json
import re
from urllib.parse import parse_qs, urlsplit

CENT = Decimal("0.01")
MAX = Decimal("1000000000000")
CATEGORIES = ["Manutenção", "Abastecimento", "Seguro do caminhão",
              "Pedágio", "Salário motorista", "Outros gastos"]
FREIGHT_CATEGORIES = ("Frete Normal", "Frete Morto")
ADVANCE_CATEGORIES = ("Vale motorista", "Acerto motorista")

def num(value, label, positive=False, maximum=MAX):
    if value is None or isinstance(value, bool):
        raise ValueError("Informe "+label+".")
    raw = str(value).strip().replace(" ", "")
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    try:
        result = Decimal(raw)
    except (InvalidOperation, ValueError):
        raise ValueError(label+" inválido.") from None
    if not result.is_finite() or result > maximum or result < 0:
        raise ValueError(label+" fora do limite permitido.")
    if positive and result <= 0:
        raise ValueError(label+" deve ser maior que zero.")
    return result

def money(value):
    return str(Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP))

def safe_text(value, label, size=150, required=False):
    if not isinstance(value, str):
        raise ValueError(label+" inválido.")
    result = value.strip()
    if len(result)>size or (required and not result):
        raise ValueError("Verifique "+label+".")
    return result

def init(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS truck_settings(
        control_id INTEGER PRIMARY KEY REFERENCES controls(id) ON DELETE CASCADE,
        commission_pct TEXT NOT NULL DEFAULT '13',
        opening_commission TEXT NOT NULL DEFAULT '0',
        opening_cash TEXT NOT NULL DEFAULT '0',
        driver_name TEXT NOT NULL DEFAULT '',
        categories_json TEXT NOT NULL DEFAULT '',
        freight_types_json TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS truck_entries(
        id INTEGER PRIMARY KEY,
        control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
        event_date TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('freight','expense','advance')),
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        weight_kg TEXT NOT NULL DEFAULT '0',
        price_tonne TEXT NOT NULL DEFAULT '0',
        commission_pct TEXT NOT NULL DEFAULT '0',
        amount TEXT NOT NULL,
        commission_amount TEXT NOT NULL DEFAULT '0',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_truck_entry_control_date
      ON truck_entries(control_id,event_date,id);
    """)
    existing = {row["name"] for row in con.execute("PRAGMA table_info(truck_settings)")}
    if "categories_json" not in existing:
        con.execute("ALTER TABLE truck_settings ADD COLUMN categories_json TEXT NOT NULL DEFAULT ''")
    if "freight_types_json" not in existing:
        con.execute("ALTER TABLE truck_settings ADD COLUMN freight_types_json TEXT NOT NULL DEFAULT ''")
    # Migração sem perda de dados: cada caminhão conserva as categorias
    # já utilizadas em seus lançamentos, inclusive as importadas da planilha.
    rows=con.execute("SELECT control_id FROM truck_settings WHERE categories_json=''").fetchall()
    for row in rows:
        cid=row["control_id"]
        cats=list(CATEGORIES)
        for used in con.execute("SELECT DISTINCT category FROM truck_entries WHERE control_id=? AND kind='expense' ORDER BY category",(cid,)):
            name=used["category"]
            if name.casefold() not in {c.casefold() for c in cats}:
                cats.append(name)
        con.execute("UPDATE truck_settings SET categories_json=? WHERE control_id=?",
                    (json.dumps(cats,ensure_ascii=False),cid))

    for row in con.execute("SELECT control_id FROM truck_settings WHERE freight_types_json=''").fetchall():
        cid=row["control_id"]
        choices=list(FREIGHT_CATEGORIES)
        for used in con.execute("SELECT DISTINCT category FROM truck_entries WHERE control_id=? AND kind='freight' ORDER BY category",(cid,)):
            if used["category"].casefold() not in {n.casefold() for n in choices}:
                choices.append(used["category"])
        con.execute("UPDATE truck_settings SET freight_types_json=? WHERE control_id=?",
                    (json.dumps(choices,ensure_ascii=False),cid))

def check_control(con, cid):
    row=con.execute("SELECT id,name,board_id,mode FROM controls WHERE id=?", (cid,)).fetchone()
    if row is None:
        raise LookupError("Controle não encontrado.")
    if row["mode"]!="caminhao":
        raise ValueError("Este controle não é um Controle de Caminhão.")
    return dict(row)

def validate_categories(value):
    if not isinstance(value,list) or not 1 <= len(value) <= 80:
        raise ValueError("Cadastre de 1 a 80 categorias de despesa.")
    result=[]
    forbidden={n.casefold() for n in (*FREIGHT_CATEGORIES,*ADVANCE_CATEGORIES)}
    for item in value:
        name=safe_text(item,"a categoria de despesa",90,True)
        if name.casefold() in forbidden:
            raise ValueError(f"A categoria {name} pertence a outro tipo de lançamento.")
        if name.casefold() in {n.casefold() for n in result}:
            raise ValueError(f"Categoria duplicada: {name}.")
        result.append(name)
    return result

def validate_freights(value):
    if not isinstance(value,list) or not 1<=len(value)<=80:
        raise ValueError("Cadastre de 1 a 80 tipos de frete.")
    names=[]
    for item in value:
        label=safe_text(item,"o tipo de frete",90,True)
        if label.casefold() in {n.casefold() for n in names}:
            raise ValueError("Tipo de frete duplicado: "+label+".")
        if label.casefold() in {x.casefold() for x in ADVANCE_CATEGORIES}:
            raise ValueError("Este nome é reservado para vales do motorista.")
        names.append(label)
    return names

def settings(con, cid):
    check_control(con,cid)
    row=con.execute("SELECT commission_pct,opening_commission,opening_cash,driver_name,categories_json,freight_types_json FROM truck_settings WHERE control_id=?",(cid,)).fetchone()
    if not row:
        return {"commission_pct":"13","opening_commission":"0","opening_cash":"0","driver_name":"","categories":list(CATEGORIES),"freight_types":list(FREIGHT_CATEGORIES)}
    obj=dict(row)
    freights_text=obj.pop("freight_types_json")
    obj["freight_types"]=json.loads(freights_text) if freights_text else list(FREIGHT_CATEGORIES)
    categories_text=obj.pop("categories_json")
    if categories_text:
        obj["categories"]=json.loads(categories_text)
    else:
        # Compatibilidade com bancos antigos, ainda não migrados.
        obj["categories"]=list(CATEGORIES)
        used=con.execute("SELECT DISTINCT category FROM truck_entries WHERE control_id=? AND kind='expense'",(cid,)).fetchall()
        for item in used:
            if item["category"].casefold() not in {c.casefold() for c in obj["categories"]}:
                obj["categories"].append(item["category"])
    return obj

def save_settings(con, cid, payload):
    check_control(con,cid)
    previous=settings(con,cid)
    pct=num(payload.get("commission_pct","13"),"a porcentagem",maximum=Decimal("100"))
    opening_commission=num(payload.get("opening_commission","0"),"o saldo inicial do motorista")
    opening_cash=num(payload.get("opening_cash","0"),"o saldo inicial do caminhão")
    driver=safe_text(payload.get("driver_name",""),"o nome do motorista",100)

    categories=validate_categories(payload.get("categories",previous["categories"]))
    freight_types=validate_freights(payload.get("freight_types",previous["freight_types"]))
    if {x.casefold() for x in categories}&{x.casefold() for x in freight_types}:
        raise ValueError("Nomes de frete e de despesa não podem se repetir.")
    old_categories={c.casefold():c for c in previous["categories"]}
    old_freights={c.casefold():c for c in previous["freight_types"]}
    renames=payload.get("category_renames",[])
    if not isinstance(renames,list) or len(renames)>80:
        raise ValueError("Alterações de categorias inválidas.")
    mapped={}
    for item in renames:
        if not isinstance(item,dict):
            raise ValueError("Renomeação de categoria inválida.")
        old=safe_text(item.get("old"),"a categoria original",90,True)
        new=safe_text(item.get("new"),"a nova categoria",90,True)
        canonical=old_categories.get(old.casefold())
        if canonical is None or canonical.casefold() in mapped:
            raise ValueError(f"A categoria {old} não pode ser renomeada.")
        match=next((c for c in categories if c.casefold()==new.casefold()),None)
        if match is None:
            raise ValueError(f"A categoria {new} não está na lista atual.")
        if match.casefold() in old_categories and match.casefold()!=canonical.casefold():
            raise ValueError("Não é possível renomear para uma categoria que já existe.")
        mapped[canonical.casefold()]=match

    freight_renames=payload.get("freight_type_renames",[])
    if not isinstance(freight_renames,list) or len(freight_renames)>80:
        raise ValueError("Renomeações de tipos de frete inválidas.")
    mapped_freights={}
    for item in freight_renames:
        if not isinstance(item,dict):
            raise ValueError("Renomeação de tipo de frete inválida.")
        old=safe_text(item.get("old"),"o tipo original",90,True)
        new=safe_text(item.get("new"),"o novo tipo",90,True)
        original=old_freights.get(old.casefold())
        if original is None or original.casefold() in mapped_freights:
            raise ValueError("O tipo de frete "+old+" não pode ser renomeado.")
        match=next((n for n in freight_types if n.casefold()==new.casefold()),None)
        if match is None or (match.casefold() in old_freights and match.casefold()!=original.casefold()):
            raise ValueError("O novo nome está ausente ou já pertence a outro frete.")
        mapped_freights[original.casefold()]=match
    active={n.casefold() for n in freight_types}
    for used in con.execute("SELECT DISTINCT category FROM truck_entries WHERE control_id=? AND kind='freight'",(cid,)):
        name=used["category"]
        if name.casefold() not in active and name.casefold() not in mapped_freights:
            raise ValueError("O tipo de frete "+name+" possui lançamentos. Renomeie-o ou mantenha-o.")

    used=[r["category"] for r in con.execute(
        "SELECT DISTINCT category FROM truck_entries WHERE control_id=? AND kind='expense'",(cid,))]
    active={name.casefold() for name in categories}
    for old in used:
        if old.casefold() not in active and old.casefold() not in mapped:
            raise ValueError(f"A categoria {old} possui lançamentos. Renomeie-a ou mantenha na lista.")

    # Preservar a imutabilidade dos comprovantes conferidos e dos fechamentos.
    import truck_workflow
    truck_workflow.assert_settings_editable(
        con,cid,[old_categories[k] for k in mapped],
        money(opening_commission)!=previous["opening_commission"] or
        money(opening_cash)!=previous["opening_cash"],
        [old_freights[k] for k in mapped_freights])
    # A renomeação reorganiza o histórico da mesma categoria, mas nunca
    # altera valores, datas, comissão ou saldos dos lançamentos.
    for old_key,new in mapped.items():
        original=old_categories[old_key]
        con.execute("UPDATE truck_entries SET category=?,updated_at=CURRENT_TIMESTAMP "
                    "WHERE control_id=? AND kind='expense' AND category=?",
                    (new,cid,original))

    for old_key,new in mapped_freights.items():
        con.execute("UPDATE truck_entries SET category=?,updated_at=CURRENT_TIMESTAMP "
                    "WHERE control_id=? AND kind='freight' AND category=?",
                    (new,cid,old_freights[old_key]))

    if "name" in payload:
        name=safe_text(payload["name"],"o nome do controle",150,True)
        con.execute("UPDATE controls SET name=? WHERE id=?",(name,cid))
    con.execute("""INSERT INTO truck_settings(control_id,commission_pct,opening_commission,opening_cash,driver_name,categories_json,freight_types_json)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(control_id) DO UPDATE SET
        commission_pct=excluded.commission_pct,
        opening_commission=excluded.opening_commission,
        opening_cash=excluded.opening_cash,driver_name=excluded.driver_name,
        categories_json=excluded.categories_json,
        freight_types_json=excluded.freight_types_json""",
        (cid,str(pct),money(opening_commission),money(opening_cash),driver,
         json.dumps(categories,ensure_ascii=False),
         json.dumps(freight_types,ensure_ascii=False)))
    return settings(con,cid)

def compute_entry(con, cid, payload):
    config=settings(con,cid)
    when=safe_text(payload.get("date",""),"a data",10,True)
    try:
        date.fromisoformat(when)
    except ValueError:
        raise ValueError("Data inválida, use o calendário.") from None
    kind=payload.get("kind")
    if kind not in ("freight","expense","advance"):
        raise ValueError("Selecione frete, despesa ou vale/acerto.")
    desc=safe_text(payload.get("description",""),"a descrição",200,True)
    notes=safe_text(payload.get("notes",""),"as observações",1500)
    weight=price=pct=commission=Decimal("0")
    if kind=="freight":
        category=payload.get("category")
        name=next((n for n in config["freight_types"]
                   if n.casefold()==str(category).casefold()),None)
        if name is None:
            raise ValueError("Escolha um tipo de frete cadastrado nos Ajustes.")
        category=name
        weight=num(payload.get("weight_kg"),"o peso em kg",True)
        price=num(payload.get("price_tonne"),"o preço por tonelada",True)
        amount=(weight/Decimal("1000")*price).quantize(CENT,rounding=ROUND_HALF_UP)
        if amount>MAX:
            raise ValueError("Valor total do frete acima do limite.")
        # A comissão aplicada no lançamento é gravada para preservar o histórico.
        pct=num(config["commission_pct"],"a comissão",maximum=Decimal("100"))
        commission=(amount*pct/Decimal("100")).quantize(CENT, rounding=ROUND_HALF_UP)
    else:
        category=safe_text(payload.get("category",""),"a categoria",90,True)
        if kind=="advance" and category not in ADVANCE_CATEGORIES:
            raise ValueError("Escolha Vale motorista ou Acerto motorista.")
        if kind=="expense":
            selected=next((x for x in config["categories"] if x.casefold()==category.casefold()),None)
            if selected is None:
                raise ValueError("Escolha uma categoria cadastrada nos Ajustes do caminhão.")
            category=selected
        amount=num(payload.get("amount"),"o valor",True).quantize(CENT,rounding=ROUND_HALF_UP)
        if not amount:
            raise ValueError("O valor não pode arredondar para zero.")
    return (cid,when,kind,category,desc,str(weight),str(price),
            str(pct),money(amount),money(commission),notes)

def summary(con,cid,month="",scope=None):
    check_control(con,cid)
    import truck_workflow
    workflow=truck_workflow.info(con,cid)
    if month and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])",month):
        raise ValueError("Mês inválido.")
    conf=settings(con,cid)
    rows=con.execute("SELECT * FROM truck_entries WHERE control_id=? ORDER BY event_date DESC,id DESC",(cid,)).fetchall()
    current=workflow["enabled"] and not month and scope!="all"
    cutoff=workflow.get("last_closed_until") if current else None
    period=[dict(r) for r in rows if (not month or r["event_date"].startswith(month))
            and (not cutoff or r["event_date"]>cutoff)]
    all_rows=[dict(r) for r in rows]
    gross=expenses=advances=commission=Decimal("0")
    by_expense={}
    by_freight={}
    expense_counts={}
    freight_counts={}
    for r in period:
        value=Decimal(r["amount"])
        if r["kind"]=="freight":
            gross+=value
            commission+=Decimal(r["commission_amount"])
            by_freight[r["category"]]=by_freight.get(r["category"],Decimal("0"))+value
            freight_counts[r["category"]]=freight_counts.get(r["category"],0)+1
        elif r["kind"]=="expense":
            expenses+=value
            by_expense[r["category"]]=by_expense.get(r["category"],Decimal("0"))+value
            expense_counts[r["category"]]=expense_counts.get(r["category"],0)+1
        else:
            advances+=value
            by_expense[r["category"]]=by_expense.get(r["category"],Decimal("0"))+value
            expense_counts[r["category"]]=expense_counts.get(r["category"],0)+1
    lifetime_earned=sum((Decimal(r["commission_amount"]) for r in all_rows if r["kind"]=="freight"),Decimal("0"))
    lifetime_paid=sum((Decimal(r["amount"]) for r in all_rows if r["kind"]=="advance"),Decimal("0"))
    # O vale reduz o caixa, porém não entra nas despesas do resultado novamente.
    cash=(gross-expenses-advances+(Decimal(conf["opening_cash"]) if not month and not cutoff else Decimal("0")))
    profit=gross-expenses-commission
    driver_due=Decimal(conf["opening_commission"])+lifetime_earned-lifetime_paid
    return {
      "period":month,
      "scope":"current" if current else ("month" if month else "all"),
      "workflow":workflow,
      "entries":period,
      "settings":conf,
      "totals":{
        "freight":money(gross),
        "operating_expenses":money(expenses),
        "driver_advances":money(advances),
        "cash_out":money(expenses+advances),
        "cash_balance":money(cash),
        "commission_earned":money(commission),
        "operating_result":money(profit),
        "driver_due":money(driver_due),
        "driver_earned_all":money(lifetime_earned),
        "driver_paid_all":money(lifetime_paid),
        "outstanding_opening":money(conf["opening_commission"]),
        "count":len(period)
      },
      "by_freight":[{"name":k,"total":money(v),"count":freight_counts[k]} for k,v in sorted(by_freight.items())],
      "by_expense":[{"name":k,"total":money(v),"count":expense_counts[k]} for k,v in sorted(by_expense.items())],
      "available_months":sorted({r["event_date"][:7] for r in rows},reverse=True),
      "categories":conf["categories"]
    }

def handle(handler,con,method,path):
    base=re.fullmatch(r"/api/controls/(\d+)/truck(?:/(entries|settings|export.csv))?",path)
    entry=re.fullmatch(r"/api/truck-entries/(\d+)",path)
    if not base and not entry: return False
    if base:
        cid=int(base[1]);action=base[2]
        check_control(con,cid)
        if method=="GET" and action is None:
            query=parse_qs(urlsplit(handler.path).query)
            return handler.send(summary(con,cid,query.get("month",[""])[0],query.get("scope",[None])[0]))
        if method=="GET" and action=="export.csv":
            query=parse_qs(urlsplit(handler.path).query)
            data=summary(con,cid,query.get("month",[""])[0],query.get("scope",[None])[0])
            output=io.StringIO()
            writer=csv.writer(output,delimiter=";")
            writer.writerow(["ID","Data","Tipo","Categoria","Descrição","Peso kg",
                             "Preço por tonelada","Total R$","Comissão %","Comissão R$","Observações"])
            for r in data["entries"]:
                writer.writerow([r["id"],r["event_date"],r["kind"],r["category"],r["description"],
                                 r["weight_kg"],r["price_tonne"],r["amount"],r["commission_pct"],
                                 r["commission_amount"],r["notes"]])
            return handler.send(("\ufeff"+output.getvalue()).encode("utf-8"),
                                mime="text/csv; charset=utf-8")
        if method=="PUT" and action=="settings":
            p=handler.input()
            conf=save_settings(con,cid,p)
            con.commit()
            return handler.send(conf)
        if method=="POST" and action=="entries":
            p=handler.input()
            con.execute("BEGIN IMMEDIATE")
            values=compute_entry(con,cid,p)
            import truck_workflow
            truck_workflow.assert_entry_editable(con,cid,values[1])
            cur=con.execute("""INSERT INTO truck_entries(control_id,event_date,kind,category,
                description,weight_kg,price_tonne,commission_pct,amount,commission_amount,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",values)
            con.commit()
            return handler.send({"id":cur.lastrowid},201)
        raise LookupError("Ação não encontrada.")
    eid=int(entry[1])
    row=con.execute("SELECT control_id FROM truck_entries WHERE id=?",(eid,)).fetchone()
    if row is None:raise LookupError("Lançamento não encontrado.")
    cid=row["control_id"]
    check_control(con,cid)
    import truck_workflow
    con.execute("BEGIN IMMEDIATE")
    old_date=con.execute("SELECT event_date FROM truck_entries WHERE id=?",(eid,)).fetchone()["event_date"]
    if method=="DELETE":
        truck_workflow.assert_entry_editable(con,cid,old_date)
        con.execute("DELETE FROM truck_entries WHERE id=?",(eid,))
    elif method=="PUT":
        p=handler.input()
        values=compute_entry(con,cid,p)
        truck_workflow.assert_entry_editable(con,cid,old_date,values[1])
        con.execute("""UPDATE truck_entries SET event_date=?,kind=?,category=?,description=?,
                     weight_kg=?,price_tonne=?,commission_pct=?,amount=?,commission_amount=?,
                     notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?""",(*values[1:],eid))
    else:
        raise LookupError("Ação não encontrada.")
    con.commit()
    return handler.send({"ok":True})
