"""Vales de funcionários: dívidas, parcelas mensais previstas e descontos reais.

Valores guardados como DECIMAL em texto, sempre com 2 casas, sem floats.
Exclusão de funcionário significa arquivar: nunca apagar dívidas/pagamentos.
"""
from datetime import date
from calendar import monthrange
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re

CENT=Decimal("0.01")
MAX=Decimal("1000000000.00")


def money(n):
    return str(Decimal(n).quantize(CENT,rounding=ROUND_HALF_UP))


def value(raw, *, positive=True):
    if isinstance(raw,bool) or raw is None:
        raise ValueError("Informe um valor válido.")
    text=str(raw).strip().replace(" ","")
    if "," in text:
        text=text.replace(".","").replace(",",".")
    try:
        amount=Decimal(text)
    except (InvalidOperation,ValueError):
        raise ValueError("Valor inválido.") from None
    if not amount.is_finite() or amount>MAX or (positive and amount<=0) or (not positive and amount<0):
        raise ValueError("Valor fora do intervalo permitido.")
    if amount!=amount.quantize(CENT):
        raise ValueError("Use até duas casas decimais.")
    return amount


def label(raw,name,limit=160):
    if not isinstance(raw,str) or not raw.strip() or len(raw.strip())>limit:
        raise ValueError("Informe "+name+" válido.")
    return raw.strip()


def month(raw):
    if not isinstance(raw,str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])",raw):
        raise ValueError("Informe o mês no formato AAAA-MM.")
    if not 1900<=int(raw[:4])<=9999:
        raise ValueError("Ano inválido.")
    return raw


def month_plus(start,index):
    d=month(start)
    total=int(d[:4])*12+int(d[5:])-1+index
    year,zero=divmod(total,12)
    if year>9999:raise ValueError("Mês fora do intervalo permitido.")
    return f"{year:04d}-{zero+1:02d}"


def schedule(amount,first,count,each=None):
    total=value(amount)
    first=month(first)
    if isinstance(count,bool) or not isinstance(count,int) or not 1<=count<=120:
        raise ValueError("Informe de 1 a 120 parcelas.")
    cents=int(total*100)
    if cents<count:
        raise ValueError("O valor não comporta tantas parcelas de pelo menos R$ 0,01.")
    if each not in (None,""):
        fixed=int(value(each)*100)
        if count>1 and fixed*(count-1)>=cents:
            raise ValueError("O valor sugerido por parcela deixa a última parcela zerada ou negativa.")
        parts=[fixed]*(count-1)+[cents-fixed*(count-1)]
    else:
        base,rest=divmod(cents,count)
        parts=[base+1 if i<rest else base for i in range(count)]
    return [{"month":month_plus(first,i),"amount":money(Decimal(parts[i])/100)}
            for i in range(count)]


def verify_plan(raw,principal):
    if not isinstance(raw,list) or not 1<=len(raw)<=120:
        raise ValueError("Informe as parcelas do vale.")
    out=[]
    last=""
    for row in raw:
        if not isinstance(row,dict):raise ValueError("Parcela inválida.")
        m=month(row.get("month"))
        amt=money(value(row.get("amount")))
        if m<=last:raise ValueError("Os meses devem estar em ordem crescente, sem repetição.")
        out.append({"month":m,"amount":amt})
        last=m
    if sum((Decimal(x["amount"]) for x in out),Decimal("0")) != value(principal):
        raise ValueError("A soma das parcelas deve ser exatamente igual ao valor do vale.")
    return out


def initialize(con):
    con.executescript("""
    CREATE TABLE IF NOT EXISTS vale_employees(
      id INTEGER PRIMARY KEY,
      control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_vale_employee ON vale_employees(control_id,name);
    CREATE TABLE IF NOT EXISTS vale_debts(
      id INTEGER PRIMARY KEY,
      control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES vale_employees(id) ON DELETE RESTRICT,
      amount TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      first_month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_vale_debts ON vale_debts(control_id,employee_id);
    CREATE TABLE IF NOT EXISTS vale_installments(
      id INTEGER PRIMARY KEY,
      debt_id INTEGER NOT NULL REFERENCES vale_debts(id) ON DELETE CASCADE,
      installment_number INTEGER NOT NULL,
      due_month TEXT NOT NULL,
      amount TEXT NOT NULL,
      UNIQUE(debt_id,installment_number)
    );
    CREATE INDEX IF NOT EXISTS idx_vale_due ON vale_installments(due_month);
    CREATE TABLE IF NOT EXISTS vale_payments(
      id INTEGER PRIMARY KEY,
      installment_id INTEGER NOT NULL REFERENCES vale_installments(id) ON DELETE RESTRICT,
      payment_month TEXT NOT NULL,
      amount TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_vale_payment ON vale_payments(installment_id);
    """)
    # Migração não destrutiva para instalações com vales existentes.
    # A descrição antiga vira o título inicial; valores e parcelas permanecem intactos.
    cols={row["name"] for row in con.execute("PRAGMA table_info(vale_debts)")}
    if "title" not in cols:
        con.execute("ALTER TABLE vale_debts ADD COLUMN title TEXT NOT NULL DEFAULT ''")
    con.execute("UPDATE vale_debts SET title=description WHERE TRIM(title)='' AND TRIM(description)!=''")


def ensure_control(con,cid):
    c=con.execute("SELECT id,name,mode FROM controls WHERE id=?",(cid,)).fetchone()
    if not c:raise LookupError("Controle não encontrado.")
    if c["mode"]!="vale_funcionarios":raise ValueError("Este controle não é de vales de funcionários.")
    return dict(c)


def employee(con,eid):
    row=con.execute("SELECT * FROM vale_employees WHERE id=?",(eid,)).fetchone()
    if not row:raise LookupError("Funcionário não encontrado.")
    ensure_control(con,row["control_id"])
    return dict(row)


def debt(con,did):
    row=con.execute("SELECT * FROM vale_debts WHERE id=?",(did,)).fetchone()
    if not row:raise LookupError("Vale não encontrado.")
    ensure_control(con,row["control_id"])
    return dict(row)


def all_installments(con,did):
    """Somente Decimal; SUM SQL pode usar float e criar saldo de 1 centavo."""
    result=[]
    for row in con.execute("""SELECT id,debt_id,installment_number,due_month,amount
            FROM vale_installments WHERE debt_id=? ORDER BY installment_number""",(did,)):
        data=dict(row)
        paid=sum((Decimal(p["amount"]) for p in con.execute(
            "SELECT amount FROM vale_payments WHERE installment_id=?",(data["id"],))),
            Decimal("0"))
        data["paid"]=money(paid)
        result.append(data)
    return result


def get_summary(con,cid):
    ensure_control(con,cid)
    people=[dict(r) for r in con.execute(
        "SELECT * FROM vale_employees WHERE control_id=? ORDER BY active DESC,name,id",(cid,))]
    debts=[dict(r) for r in con.execute(
        "SELECT * FROM vale_debts WHERE control_id=? ORDER BY id DESC",(cid,))]
    by_person={p["id"]:{"employee":p,"debts":[],"lent":Decimal("0"),"paid":Decimal("0")} for p in people}
    scheduled=[]
    total=paid=Decimal("0")
    for d in debts:
        plan=all_installments(con,d["id"])
        spent=sum((Decimal(str(p["paid"])) for p in plan),Decimal("0"))
        due=Decimal(d["amount"])
        if spent>due:raise ValueError("Inconsistência financeira: pagamentos acima da dívida.")
        item={**d,"installments":[{**i,"paid":money(i["paid"]),
                "remaining":money(Decimal(i["amount"])-Decimal(str(i["paid"]))),
                "status":"pago" if Decimal(str(i["paid"]))==Decimal(i["amount"]) else
                  ("parcial" if Decimal(str(i["paid"]))>0 else "pendente")} for i in plan],
                "paid":money(spent),"remaining":money(due-spent)}
        by_person[d["employee_id"]]["debts"].append(item)
        by_person[d["employee_id"]]["lent"]+=due
        by_person[d["employee_id"]]["paid"]+=spent
        scheduled.extend([{**i,"employee":by_person[d["employee_id"]]["employee"]["name"],
                           "debt_title":d["title"],"debt_description":d["description"],
                           "debt_id":d["id"]} for i in item["installments"]])
        total+=due;paid+=spent
    employees=[]
    for record in by_person.values():
        employees.append({"id":record["employee"]["id"],"name":record["employee"]["name"],
                          "active":bool(record["employee"]["active"]),
                          "lent":money(record["lent"]),"paid":money(record["paid"]),
                          "remaining":money(record["lent"]-record["paid"]),
                          "debts":record["debts"]})
    return {"control_id":cid,"employees":employees,"schedule":sorted(scheduled,key=lambda x:(x["due_month"],x["employee"],x["installment_number"])),
            "totals":{"employees":len(people),"active":sum(bool(p["active"]) for p in people),
                      "debts":len(debts),"lent":money(total),"paid":money(paid),
                      "remaining":money(total-paid)}}


def create_employee(con,cid,name):
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    ensure_control(con,cid)
    name=label(name,"o nome do funcionário")
    matches=con.execute("SELECT * FROM vale_employees WHERE control_id=?",(cid,)).fetchall()
    if any(str(e["name"]).casefold()==name.casefold() for e in matches):
        raise ValueError("Funcionário já cadastrado; reative-o caso esteja arquivado.")
    cur=con.execute("INSERT INTO vale_employees(control_id,name) VALUES(?,?)",(cid,name))
    con.commit()
    return {"id":cur.lastrowid}


def archive_employee(con,eid,active):
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    e=employee(con,eid)
    con.execute("UPDATE vale_employees SET active=? WHERE id=?",(1 if active else 0,eid))
    con.commit()
    return {"ok":True,"active":bool(active)}


def create_debt(con,eid,p):
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    e=employee(con,eid)
    if not e["active"]:raise ValueError("Reative o funcionário antes de lançar um novo vale.")
    if not isinstance(p,dict):raise ValueError("Dados inválidos.")
    amount=money(value(p.get("amount")))
    # Compatibilidade com os vales criados antes da chegada do campo título.
    title=label(p.get("title") or p.get("description"),"o título da dívida",160)
    description=p.get("description","")
    if not isinstance(description,str) or len(description)>500:
        raise ValueError("Descrição da dívida inválida.")
    description=description.strip()
    first=month(p.get("first_month"))
    if "installments" in p:
        plan=verify_plan(p["installments"],amount)
    else:
        count=p.get("count",1)
        if type(count) is not int:raise ValueError("Quantidade de parcelas inválida.")
        plan=schedule(amount,first,count,p.get("each"))
    if plan[0]["month"]!=first:raise ValueError("A primeira parcela deve começar no mês selecionado.")
    cur=con.execute("""INSERT INTO vale_debts(control_id,employee_id,amount,title,description,first_month)
      VALUES(?,?,?,?,?,?)""",(e["control_id"],eid,amount,title,description,first))
    did=cur.lastrowid
    for n,row in enumerate(plan,1):
        con.execute("""INSERT INTO vale_installments(debt_id,installment_number,due_month,amount)
          VALUES(?,?,?,?)""",(did,n,row["month"],row["amount"]))
    con.commit()
    return {"id":did}


def update_debt_details(con,did,p):
    """Altera somente título e descrição, mesmo após descontos registrados."""
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    d=debt(con,did)
    if not isinstance(p,dict):raise ValueError("Dados inválidos.")
    title=label(p.get("title"),"o título da dívida",160)
    description=p.get("description",d["description"])
    if not isinstance(description,str) or len(description)>500:
        raise ValueError("Descrição da dívida inválida.")
    con.execute("UPDATE vale_debts SET title=?,description=? WHERE id=? AND control_id=?",
                (title,description.strip(),did,d["control_id"]))
    con.commit()
    return {"ok":True}


def replan_debt(con,did,p):
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    d=debt(con,did)
    if not isinstance(p,dict):raise ValueError("Dados inválidos.")
    current=all_installments(con,did)
    if any(Decimal(str(i["paid"]))>0 for i in current):
        raise ValueError("O vale já tem descontos registrados. Não é permitido refazer parcelas pagas; lance os demais descontos normalmente.")
    plan=verify_plan(p.get("installments"),d["amount"])
    con.execute("DELETE FROM vale_installments WHERE debt_id=?",(did,))
    for n,row in enumerate(plan,1):
        con.execute("INSERT INTO vale_installments(debt_id,installment_number,due_month,amount) VALUES(?,?,?,?)",
                    (did,n,row["month"],row["amount"]))
    con.execute("UPDATE vale_debts SET first_month=? WHERE id=?",(plan[0]["month"],did))
    con.commit()
    return {"ok":True}


def payment(con,iid,p):
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    if not isinstance(p,dict):raise ValueError("Pagamento inválido.")
    i=con.execute("""SELECT i.*,d.control_id FROM vale_installments i
      JOIN vale_debts d ON d.id=i.debt_id WHERE i.id=?""",(iid,)).fetchone()
    if not i:raise LookupError("Parcela não encontrada.")
    ensure_control(con,i["control_id"])
    paid=sum((Decimal(r["amount"]) for r in con.execute(
        "SELECT amount FROM vale_payments WHERE installment_id=?",(iid,))),Decimal("0"))
    amount=value(p.get("amount"))
    if paid+amount>Decimal(i["amount"]):
        raise ValueError("Desconto supera o saldo desta parcela.")
    paid_month=month(p.get("month"))
    notes=p.get("notes","")
    if not isinstance(notes,str) or len(notes)>500:raise ValueError("Observações inválidas.")
    result=con.execute("""INSERT INTO vale_payments(installment_id,payment_month,amount,notes)
      VALUES(?,?,?,?)""",(iid,paid_month,money(amount),notes.strip()))
    con.commit()
    return {"id":result.lastrowid}


def settle_debt(con,did,p):
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    """Quita todas as parcelas restantes em um único registro lógico (transação)."""
    d=debt(con,did)
    if not isinstance(p,dict):raise ValueError("Dados inválidos.")
    paid_month=month(p.get("month"))
    plan=all_installments(con,did)
    remains=[(i,Decimal(i["amount"])-Decimal(str(i["paid"]))) for i in plan]
    remains=[(i,amount) for i,amount in remains if amount>0]
    if not remains:raise ValueError("Este vale já está quitado.")
    for i,amount in remains:
        con.execute("""INSERT INTO vale_payments(installment_id,payment_month,amount,notes)
            VALUES(?,?,?,?)""",(i["id"],paid_month,money(amount),"Quitação do vale"))
    con.commit()
    return {"ok":True,"paid":money(sum((a for _,a in remains),Decimal("0"))),
            "installments":len(remains)}


def payments(con,cid):
    ensure_control(con,cid)
    return [dict(x) for x in con.execute("""SELECT p.id,p.installment_id,p.payment_month,p.amount,p.notes,
       e.name AS employee,d.title,d.description,i.due_month
       FROM vale_payments p
       JOIN vale_installments i ON i.id=p.installment_id
       JOIN vale_debts d ON d.id=i.debt_id
       JOIN vale_employees e ON e.id=d.employee_id
       WHERE d.control_id=? ORDER BY p.id DESC""",(cid,))]


def delete_payment(con,pid):
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    row=con.execute("""SELECT p.id,d.control_id FROM vale_payments p
       JOIN vale_installments i ON i.id=p.installment_id
       JOIN vale_debts d ON d.id=i.debt_id WHERE p.id=?""",(pid,)).fetchone()
    if not row:raise LookupError("Desconto não encontrado.")
    ensure_control(con,row["control_id"])
    con.execute("DELETE FROM vale_payments WHERE id=?",(pid,))
    con.commit()
    return {"ok":True}


def delete_debt(con,did):
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    d=debt(con,did)
    if con.execute("""SELECT 1 FROM vale_payments p JOIN vale_installments i ON i.id=p.installment_id
                      WHERE i.debt_id=? LIMIT 1""",(did,)).fetchone():
        raise ValueError("Vale com descontos registrados não pode ser excluído.")
    con.execute("DELETE FROM vale_debts WHERE id=?",(did,))
    con.commit()
    return {"ok":True}


def handle(handler,con,method,url):
    root=re.fullmatch(r"/api/controls/(\d+)/vales(?:/(employees|payments))?",url)
    person=re.fullmatch(r"/api/vales-employees/(\d+)(?:/(debts))?",url)
    debt_route=re.fullmatch(r"/api/vales-debts/(\d+)(?:/(plan|pay))?",url)
    installment=re.fullmatch(r"/api/vales-installments/(\d+)/payments",url)
    payroute=re.fullmatch(r"/api/vales-payments/(\d+)",url)
    if root:
        cid=int(root[1]);part=root[2]
        ensure_control(con,cid)
        if method=="GET" and part is None:return handler.send(get_summary(con,cid))
        if method=="GET" and part=="payments":return handler.send(payments(con,cid))
        if method=="POST" and part=="employees":
            data=handler.input()
            return handler.send(create_employee(con,cid,data.get("name")),201)
    if person:
        eid=int(person[1]);employee(con,eid)
        if method=="PATCH" and person[2] is None:
            body=handler.input()
            if type(body.get("active")) is not bool:raise ValueError("Informe se o funcionário está ativo.")
            return handler.send(archive_employee(con,eid,body["active"]))
        if method=="POST" and person[2]=="debts":
            return handler.send(create_debt(con,eid,handler.input()),201)
    if debt_route:
        did=int(debt_route[1]);debt(con,did)
        if method=="PATCH" and debt_route[2] is None:
            return handler.send(update_debt_details(con,did,handler.input()))
        if method=="PUT" and debt_route[2]=="plan":
            return handler.send(replan_debt(con,did,handler.input()))
        if method=="POST" and debt_route[2]=="pay":
            return handler.send(settle_debt(con,did,handler.input()))
        if method=="DELETE" and debt_route[2] is None:
            return handler.send(delete_debt(con,did))
    if installment and method=="POST":
        return handler.send(payment(con,int(installment[1]),handler.input()),201)
    if payroute and method=="DELETE":
        return handler.send(delete_payment(con,int(payroute[1])))
    raise LookupError("Operação não encontrada.")
