"""Painel de Funcionários da Central Novo Horizonte.

Visão consolidada somente leitura de CONTAS (contas, holerites, Pix e
pagamentos), Vales (parcelas, baixas), e do journal independente da Central.
Uma conta NÃO vira dívida de funcionário apenas por coincidência de nome:
sugestões são separadas até confirmação explícita em tabela da Central.
"""
from __future__ import annotations

from collections import defaultdict
from contextlib import closing
from datetime import date
from decimal import Decimal
from urllib.parse import parse_qs, urlsplit
import re
import sqlite3

from . import access
from . import vales_holerites as bridge


ZERO=Decimal("0")
CENT=Decimal("0.01")


def amount(value):
    """Para indicadores, número malformado não se transforma em dívida."""
    try:
        value=Decimal(str(value if value is not None else 0))
    except Exception:
        return ZERO
    return value if value.is_finite() and value>=0 else ZERO


def serial(value):
    return str(value.quantize(CENT))


def competence(value=None):
    if value in (None,""):
        return date.today().strftime("%Y-%m")
    return bridge.valid_month(value)


def account_links(con):
    con.execute("""CREATE TABLE IF NOT EXISTS staff_account_links(
        account_id INTEGER PRIMARY KEY,
        contas_employee_id INTEGER NOT NULL,
        confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    return {int(r["account_id"]):int(r["contas_employee_id"])
            for r in con.execute("SELECT account_id,contas_employee_id FROM staff_account_links")}


def read_contas():
    with closing(bridge.sqlite_accounts()) as con:
        tables={r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"contas","pagamentos","holerite_funcionarios","holerite_lancamentos"}.issubset(tables):
            raise bridge.BridgeError("CONTAS não possui as tabelas necessárias de funcionários.")
        employees=[dict(r) for r in con.execute(
            "SELECT id,nome,chave_pix FROM holerite_funcionarios ORDER BY nome COLLATE NOCASE")]
        accounts=[dict(r) for r in con.execute("""
          SELECT c.id,c.fornecedor,c.documento,c.referencia,c.observacoes,
                 c.valor,c.vencimento,h.funcionario_id,h.competencia,
                 CASE WHEN EXISTS(
                    SELECT 1 FROM pagamentos p
                    WHERE p.conta_id=c.id AND p.data_pagamento IS NOT NULL
                    AND TRIM(p.data_pagamento)!='') THEN 1 ELSE 0 END AS paga
          FROM contas c
          LEFT JOIN holerite_lancamentos h ON h.conta_id=c.id
          ORDER BY c.vencimento,c.id DESC
        """)]
    return employees,accounts


def dashboard(month=None):
    month=competence(month)
    employees,accounts=read_contas()
    staff,installments=bridge.read_controls()
    with bridge.LOCK, closing(bridge.journal()) as con:
        links=bridge.linked(con)
        manual_links=account_links(con)
        discounts=[dict(r) for r in con.execute(
            """SELECT account_id,vale_installment_id,competence,original_amount,
                      amount,status,vale_payment_id,last_error
               FROM discounts ORDER BY id""")]
    employees_by_id={int(x["id"]):x for x in employees}
    accounts_by_id={int(x["id"]):x for x in accounts}
    # Numa competência específica, uma conta comum pode ter vencimento em
    # outro mês, mas só as contas ainda abertas entram no total de dívida.
    for id_account,id_employee in manual_links.items():
        a=accounts_by_id.get(id_account)
        if not a or id_employee not in employees_by_id or a["funcionario_id"]:
            manual_links.pop(id_account,None)
    # Não inferir relacionamentos por nomes repetidos/ambíguos.
    exact=defaultdict(list)
    for person in employees:
        exact[bridge.name_key(person["nome"])].append(int(person["id"]))
    rows={}
    for person in employees:
        eid=int(person["id"])
        rows[eid]={
          "id":eid,"nome":person["nome"],
          "pix_cadastrado":bool(str(person.get("chave_pix") or "").strip()),
          "vales_ids":[],"holerites":[],"outras_contas":[],"sugestoes":[],
          "parcelas":[],"descontos":[],"totais":{},
        }
    for vale in staff:
        employee_id=links.get(int(vale["id"]))
        if employee_id in rows:
            rows[employee_id]["vales_ids"].append(int(vale["id"]))
    pending_by_employee=defaultdict(list)
    for item in installments:
        pending_by_employee[int(item["employee_id"])].append(item)
    used_accounts=set()
    suggestions=defaultdict(list)
    for a in accounts:
        account_id=int(a["id"])
        employee_id=a["funcionario_id"]
        payload={
          "id":account_id,
          "fornecedor":str(a.get("fornecedor") or ""),
          "documento":str(a.get("documento") or ""),
          "referencia":str(a.get("referencia") or ""),
          "observacoes":str(a.get("observacoes") or "")[:200],
          "vencimento":str(a.get("vencimento") or ""),
          "competencia":str(a.get("competencia") or ""),
          "valor":serial(amount(a["valor"])),
          "paga":bool(a["paga"]),
          "origem_vinculo":"holerite" if employee_id else "confirmado",
        }
        if employee_id in rows:
            rows[employee_id]["holerites"].append(payload)
            used_accounts.add(account_id)
        elif manual_links.get(account_id) in rows:
            rows[manual_links[account_id]]["outras_contas"].append(payload)
            used_accounts.add(account_id)
        elif not employee_id:
            matches=exact.get(bridge.name_key(a["fornecedor"]),[])
            if len(matches)==1:
                suggestions[matches[0]].append({
                    **payload,"origem_vinculo":"sugestao_por_nome"
                })
    for eid,possible in suggestions.items():
        # Sugestões são sinalizadas e nunca contam como obrigação confirmada.
        rows[eid]["sugestoes"]=possible
    journal_by_account=defaultdict(list)
    for d in discounts:
        journal_by_account[int(d["account_id"])].append(d)

    total_pending=ZERO
    payroll_pending=ZERO
    other_pending=ZERO
    pending_people=0
    total_payroll_month=0
    total_paid_month=0
    total_vales_to_deduct=ZERO
    linked_reserved_total=ZERO
    unlinked=[]

    for person in rows.values():
        eid=person["id"]
        holerites=[a for a in person["holerites"] if a["competencia"]==month]
        all_other=person["outras_contas"]
        # Outras contas sem competência de holerite não somem do painel:
        # valor aberto é a dívida REAL, mesmo com vencimento noutro mês.
        pending_salary=sum((amount(a["valor"]) for a in holerites if not a["paga"]),ZERO)
        pending_other=sum((amount(a["valor"]) for a in all_other if not a["paga"]),ZERO)
        paid_month=sum(1 for a in holerites if a["paga"])
        total_payroll_month+=len(holerites)
        total_paid_month+=paid_month
        account_ids={a["id"] for a in person["holerites"]}
        for account_id in account_ids:
            for d in journal_by_account.get(account_id,[]):
                person["descontos"].append({
                   "conta_id":account_id,
                   "parcela_id":d["vale_installment_id"],
                   "competencia":d["competence"],
                   "valor":serial(amount(d["amount"])),
                   "original_holerite":serial(amount(d["original_amount"])),
                   "status":d["status"],"erro":str(d["last_error"] or ""),
                })
        reserved_by_installment=defaultdict(Decimal)
        for d in person["descontos"]:
            if d["status"] in ("reserved","error"):
                reserved_by_installment[int(d["parcela_id"])]+=amount(d["valor"])
        linked_res=sum((amount(d["valor"]) for d in person["descontos"]
                         if d["competencia"]==month and d["status"] in ("reserved","error")),ZERO)
        scheduled=ZERO
        overdue=ZERO
        for vale_id in person["vales_ids"]:
            for item in pending_by_employee.get(vale_id,[]):
                remaining=max(ZERO,amount(item["amount"])-amount(item["paid"]))
                if remaining==ZERO and item["due_month"]!=month:
                    continue
                committed=reserved_by_installment.get(int(item["id"]),ZERO)
                open_balance=max(ZERO,remaining-committed)
                p={
                  "id":int(item["id"]),"vale_id":vale_id,
                  "control_id":int(item["control_id"]),
                  "titulo":str(item["title"] or "Vale"),
                  "parcela":int(item["installment_number"]),
                  "competencia":str(item["due_month"]),
                  "valor":serial(amount(item["amount"])),
                  "ja_descontado":serial(amount(item["paid"])),
                  "reservado":serial(committed),
                  "saldo_a_descontar":serial(open_balance),
                }
                person["parcelas"].append(p)
                if item["due_month"]==month:
                    scheduled+=open_balance
                elif item["due_month"]<month:
                    overdue+=open_balance
        is_due=bool(pending_salary or pending_other)
        if is_due:pending_people+=1
        total_pending+=pending_salary+pending_other
        payroll_pending+=pending_salary
        other_pending+=pending_other
        total_vales_to_deduct+=scheduled
        linked_reserved_total+=linked_res
        person["totais"]={
            "holerites_abertos":serial(pending_salary),
            "outras_contas_abertas":serial(pending_other),
            "total_a_pagar":serial(pending_salary+pending_other),
            "vales_previstos":serial(scheduled),
            "vales_reservados":serial(linked_res),
            "vales_atrasados":serial(overdue),
            "holerites_mes":len(holerites),
            "holerites_pagos_mes":paid_month,
            "holerites_pendentes_mes":len(holerites)-paid_month,
            "sugestoes_contas":len(person["sugestoes"]),
        }
        # Todos os holerites permanecem disponíveis para histórico,
        # mesmo quando não pertencem à competência selecionada.
        person["holerites"].sort(key=lambda a:(a["competencia"],a["id"]),reverse=True)
        person["outras_contas"].sort(key=lambda a:(a["paga"],a["vencimento"],a["id"]))
        person["parcelas"].sort(key=lambda a:(a["competencia"],a["id"]),reverse=True)
    for vale in staff:
        if links.get(int(vale["id"])) in rows:
            continue
        related=pending_by_employee.get(int(vale["id"]),[])
        remaining=sum((max(ZERO,amount(p["amount"])-amount(p["paid"]))
                       for p in related if p["due_month"]==month),ZERO)
        unlinked.append({
          "vale_employee_id":int(vale["id"]),
          "control_id":int(vale["control_id"]),
          "nome":str(vale["name"]),
          "vales_previstos":serial(remaining),
          "sugestao_funcionario_id":(
             exact[bridge.name_key(vale["name"])][0]
             if len(exact.get(bridge.name_key(vale["name"]),[]))==1 else None
          ),
        })
    return {
       "ok":True,"competencia":month,
       "indicadores":{
          "funcionarios":len(rows),
          "funcionarios_com_pagamentos":pending_people,
          "holerites_mes":total_payroll_month,
          "holerites_pagos_mes":total_paid_month,
          "holerites_pendentes_mes":total_payroll_month-total_paid_month,
          "total_holerites_pendentes":serial(payroll_pending),
          "total_outras_contas_pendentes":serial(other_pending),
          "total_a_pagar":serial(total_pending),
          "vales_a_descontar":serial(total_vales_to_deduct),
          "vales_ja_reservados":serial(linked_reserved_total),
          "vales_sem_vinculo":len(unlinked),
          "total_sugestoes":sum(len(x["sugestoes"]) for x in rows.values()),
       },
       "funcionarios":list(rows.values()),
       "vales_sem_vinculo":unlinked,
       "nota":"Contas sugeridas por nome não entram no total até confirmação. "
              "Vales reservados já foram abatidos do valor do holerite e não são descontados novamente."
    }


def assign_account(payload):
    account_id=bridge.positive_id(payload.get("conta_id"))
    employee_id=bridge.positive_id(payload.get("funcionario_id"))
    employees,accounts=read_contas()
    employee=next((p for p in employees if int(p["id"])==employee_id),None)
    if not employee:
        raise bridge.BridgeError("Funcionário não cadastrado no CONTAS.")
    account=next((a for a in accounts if int(a["id"])==account_id),None)
    if not account:
        raise bridge.BridgeError("Conta não encontrada.")
    if account["funcionario_id"]:
        raise bridge.BridgeError("Holerite já vinculado a um funcionário; vínculo não pode ser alterado aqui.")
    # Não validar apenas o nome: associação explícita exige confirmação
    # no navegador e integra somente contas existentes (nunca gera cobrança).
    with bridge.LOCK, closing(bridge.journal()) as con:
        con.execute("BEGIN IMMEDIATE")
        existing=account_links(con).get(account_id)
        if existing not in (None,employee_id):
            raise bridge.BridgeError("Conta já está vinculada a outro funcionário. Revise antes de alterar.")
        con.execute("""INSERT INTO staff_account_links(account_id,contas_employee_id)
          VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET
          contas_employee_id=excluded.contas_employee_id,
          confirmed_at=CURRENT_TIMESTAMP""",(account_id,employee_id))
        bridge.event(con,"conta_funcionario_confirmada",account_id,None,
                     f"funcionario={employee_id}")
        con.commit()
    return {"ok":True,"conta_id":account_id,"funcionario_id":employee_id}


def handle(handler):
    uri=urlsplit(handler.path)
    path=uri.path
    if not path.startswith("/api/funcionarios/"):
        return False
    if not handler.authorized():
        handler.respond(401,{"ok":False,"erro":"Sessão não autorizada."})
        return True
    if handler.command!="GET" and not access.trusted_origin(handler.headers.get("Origin","")):
        handler.respond(403,{"ok":False,"erro":"Origem não autorizada."})
        return True
    try:
        if handler.command=="GET" and path=="/api/funcionarios/painel":
            month=parse_qs(uri.query).get("competencia",[""])[0]
            result=dashboard(month)
        elif handler.command=="POST" and path=="/api/funcionarios/vincular-conta":
            result=assign_account(bridge.read_body(handler))
        else:
            handler.respond(404,{"ok":False,"erro":"Rota de funcionários não encontrada."})
            return True
        handler.respond(200,result)
    except bridge.BridgeError as exc:
        handler.respond(409,{"ok":False,"erro":str(exc)})
    except (sqlite3.Error,ValueError):
        handler.respond(503,{"ok":False,"erro":"Não foi possível consolidar os funcionários, sem alterar os dados."})
    except Exception:
        handler.respond(503,{"ok":False,"erro":"Fontes de funcionários indisponíveis. Nenhuma conta foi alterada."})
    return True
