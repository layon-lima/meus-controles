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
import http.client
import json

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
                    AND TRIM(p.data_pagamento)!='') THEN 1 ELSE 0 END AS paga,
                 (SELECT MAX(p.data_pagamento) FROM pagamentos p
                    WHERE p.conta_id=c.id AND p.data_pagamento IS NOT NULL
                    AND TRIM(p.data_pagamento)!='') AS data_pagamento
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
        explicit=bridge.linked(con)
        links=bridge.unique_name_links(staff,employees,explicit)
        manual_links=account_links(con)
        discounts=[dict(r) for r in con.execute(
            """SELECT account_id,vale_installment_id,competence,original_amount,
                      amount,status,vale_payment_id,last_error
               FROM discounts ORDER BY id""")]
    employees_by_id={int(x["id"]):x for x in employees}
    accounts_by_id={int(x["id"]):x for x in accounts}
    # Numa competência específica, uma conta comum pode ter vencimento em
    # outro mês, mas só as contas ainda abertas entram no total de dívida.
    for id_account,id_employee in list(manual_links.items()):
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
          "id":eid,"nome":person["nome"],"origem_cadastro":"contas",
          "pix_cadastrado":bool(str(person.get("chave_pix") or "").strip()),
          "chave_pix":str(person.get("chave_pix") or ""),
          "vales_ids":[],"holerites":[],"outras_contas":[],"sugestoes":[],
          "parcelas":[],"descontos":[],"totais":{},
        }
    # O módulo de Funcionários também inclui cadastros que só existem
    # no Meus Controles. São perfis de CONSULTA com ID virtual negativo:
    # não criam funcionário/PIX no Contas nem geram holerite/pagamento.
    # Assim todos os vales ficam visíveis mesmo antes do primeiro holerite.
    virtual_ids=set()
    for vale in staff:
        vid=int(vale["id"])
        if links.get(vid) in rows:
            continue
        eid=-vid
        virtual_ids.add(eid)
        rows[eid]={
          "id":eid,"nome":str(vale["name"]),"origem_cadastro":"vales",
          "pix_cadastrado":False,"chave_pix":"",
          "vales_ids":[],"holerites":[],"outras_contas":[],"sugestoes":[],
          "parcelas":[],"descontos":[],"totais":{},
        }
    for vale in staff:
        vid=int(vale["id"])
        employee_id=links.get(vid,-vid)
        if employee_id in rows:
            rows[employee_id]["vales_ids"].append(vid)
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
          "data_pagamento":str(a.get("data_pagamento") or ""),
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
        person["quantidade_vales"]=len({item.get("debt_id",item["id"]) for vid in person["vales_ids"]
            for item in pending_by_employee.get(vid,[])})
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
    # Não há mais uma fila de pareamento manual: todos os perfis de Vales
    # estão nos cards da Central, com seus saldos e competências.
    # Vínculos ambíguos permanecem em cadastros virtuais separados.
    unlinked=[]
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
          "vales_sem_vinculo":len(virtual_ids),
          "funcionarios_somente_vales":len(virtual_ids),
          "total_sugestoes":sum(len(x["sugestoes"]) for x in rows.values()),
       },
       "funcionarios":list(rows.values()),
       "vales_sem_vinculo":unlinked,
       "nota":"Cadastros exclusivos de Vales aparecem como perfis de leitura. Contas sugeridas por nome não entram no total até confirmação. "
              "Vales reservados já foram abatidos do valor do holerite e não são descontados novamente."
    }


def find_account_candidates(query):
    """Busca contas não vinculadas, sem criar novas obrigações por nome."""
    query=str(query or "").strip()
    if len(query)<2 or len(query)>90:
        raise bridge.BridgeError("Pesquise pelo menos 2 caracteres do fornecedor ou o número da conta.")
    with bridge.LOCK, closing(bridge.journal()) as con:
        confirmed=set(account_links(con))
    with closing(bridge.sqlite_accounts()) as con:
        found=[dict(r) for r in con.execute("""
            SELECT c.id,c.fornecedor,c.documento,c.valor,c.vencimento,
              CASE WHEN EXISTS (SELECT 1 FROM pagamentos p
                WHERE p.conta_id=c.id AND p.data_pagamento IS NOT NULL
                AND TRIM(p.data_pagamento)!='') THEN 1 ELSE 0 END AS paga
            FROM contas c
            WHERE (LOWER(c.fornecedor) LIKE '%' || LOWER(?) || '%'
                   OR CAST(c.id AS TEXT)=?)
              AND NOT EXISTS (SELECT 1 FROM holerite_lancamentos h
                              WHERE h.conta_id=c.id)
            ORDER BY c.vencimento DESC,c.id DESC LIMIT 45
        """,(query,query))]
    return {"ok":True,"contas":[{
        "id":int(a["id"]),"fornecedor":str(a["fornecedor"] or ""),
        "documento":str(a["documento"] or ""),
        "valor":serial(amount(a["valor"])),"vencimento":str(a["vencimento"] or ""),
        "paga":bool(a["paga"])
    } for a in found if int(a["id"]) not in confirmed][:25]}


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


def update_pix(payload):
    """Altera somente o Pix de um funcionário existente pelo motor original.
    O token interno nunca sai do servidor e a base continua montada só leitura.
    """
    from .operations_gateway import _upstream, _requested_origin
    employee_id=bridge.positive_id(payload.get("funcionario_id"))
    key=payload.get("chave_pix")
    previous=payload.get("chave_anterior")
    if not isinstance(key,str) or not isinstance(previous,str) or len(key)>150 or any(ord(c)<32 for c in key):
        raise bridge.BridgeError("Chave Pix inválida.")
    key=key.strip()
    employees,_=read_contas()
    employee=next((p for p in employees if int(p["id"])==employee_id),None)
    if not employee:
        raise bridge.BridgeError("Funcionário não cadastrado no Contas.")
    if str(employee.get("chave_pix") or "")!=previous:
        raise bridge.BridgeError("A chave foi alterada em outra sessão. Atualize a lista antes de editar.")
    host,port=_upstream("contas")
    origin=_requested_origin("contas")
    headers={"Host":urlsplit(origin).netloc,"Accept-Encoding":"identity"}
    conn=http.client.HTTPConnection(host,port,timeout=15)
    try:
        conn.request("GET","/?desktop=1",headers=headers)
        response=conn.getresponse()
        if response.status!=200:
            raise bridge.BridgeError("Não foi possível abrir a sessão do Contas.")
        html=response.read(4_000_000).decode("utf-8")
        match=re.search(r'window\.__CONTAS_TOKEN__\s*=\s*("(?:[^"\\]|\\.)*")\s*;',html)
        if not match:
            raise bridge.BridgeError("Sessão do Contas indisponível.")
        token=json.loads(match.group(1))
        headers.update({"X-Local-Token":token,"Origin":origin,"Content-Type":"application/json"})
        # Reutiliza o cadastro original, preservando ID e nome; não cria conta.
        body=json.dumps({"id":employee_id,"nome":employee["nome"],"chave_pix":key}).encode("utf-8")
        conn.request("POST","/api/holerites/funcionarios",body=body,headers=headers)
        response=conn.getresponse()
        result=json.loads(response.read(100_000))
        if response.status!=200 or not result.get("ok") or int(result.get("id") or 0)!=employee_id:
            raise bridge.BridgeError("O Contas não confirmou a alteração do Pix. Confira a chave e tente novamente.")
        return {"ok":True,"funcionario_id":employee_id}
    finally:
        conn.close()


def _vale_context(employee_id):
    """Resolve o perfil pelo mesmo vínculo usado no painel e nos holerites."""
    try:
        eid=int(employee_id)
    except (ValueError,TypeError):
        raise bridge.BridgeError("Selecione um funcionário.") from None
    people=bridge.read_staff()
    staff,_=bridge.read_controls()
    with closing(bridge.journal()) as con:
        links=bridge.unique_name_links(staff,people,bridge.linked(con))
    if eid<0:
        owned=[v for v in staff if int(v["id"])==-eid and int(v["id"]) not in links]
        name=owned[0]["name"] if owned else ""
    else:
        person=next((p for p in people if int(p["id"])==eid),None)
        name=person["nome"] if person else ""
        owned=[v for v in staff if links.get(int(v["id"]))==eid]
    if not name:
        raise bridge.BridgeError("Funcionário não encontrado. Atualize o painel.")
    return eid,name,owned,staff,people,links


def _vale_records(owned):
    result=[]
    for cid in sorted({int(v["control_id"]) for v in owned}):
        report=bridge._control_request("GET",f"/api/controls/{cid}/vales")
        ids={int(v["id"]) for v in owned}
        result.extend({**p,"control_id":cid} for p in report["employees"] if int(p["id"]) in ids)
    return result


def vale_details(employee_id):
    with bridge.LOCK:
        eid,name,owned,*_=_vale_context(employee_id)
        records=_vale_records(owned)
        with closing(bridge.journal()) as con:
            reserved=bridge.available_allocations(con)
            locked_payments={int(r[0]) for r in con.execute(
                "SELECT vale_payment_id FROM discounts WHERE vale_payment_id IS NOT NULL")}
        for person in records:
            ids={int(i["id"]) for d in person["debts"] for i in d["installments"]}
            history=bridge._control_request("GET",f"/api/controls/{person['control_id']}/vales/payments")
            person["payments"]=[{**p,"protegido":int(p["id"]) in locked_payments}
                for p in history if int(p["installment_id"]) in ids]
            for debt in person["debts"]:
                for i in debt["installments"]:
                    i["reservado"]=serial(reserved.get(int(i["id"]),ZERO))
        return {"ok":True,"funcionario_id":eid,"nome":name,"cadastros":records}


def _new_vale_control():
    catalog=bridge._control_request("GET","/api/state")
    choices=[c for c in catalog["controls"] if c.get("mode")=="vale_funcionarios" and not c.get("closed_at")]
    if len(choices)!=1:
        raise bridge.BridgeError("É necessário um único controle ativo de Vales para cadastrar funcionários.")
    return int(choices[0]["id"])


def _vale_payload(payload):
    principal=bridge.dec(payload.get("amount"))
    if principal<=ZERO:raise bridge.BridgeError("Informe um valor positivo.")
    title=str(payload.get("title") or "").strip()
    description=str(payload.get("description") or "").strip()
    if not title or len(title)>160 or len(description)>500:
        raise bridge.BridgeError("Informe um título válido (até 160 caracteres) e descrição de até 500.")
    first=bridge.valid_month(payload.get("first_month"))
    count=payload.get("count",1)
    if type(count) is not int or not 1<=count<=120:
        raise bridge.BridgeError("Informe entre 1 e 120 parcelas.")
    result={"amount":bridge.money(principal),"title":title,"description":description,
            "first_month":first,"count":count}
    if payload.get("each") not in (None,""):
        result["each"]=bridge.money(bridge.dec(payload["each"]))
    if "installments" in payload:
        result["installments"]=payload["installments"]
    return result


def vale_action(payload):
    action=payload.get("action")
    with bridge.LOCK:
        if action=="register":
            name=str(payload.get("name") or "").strip()
            if not name or len(name)>160:raise bridge.BridgeError("Informe o nome completo.")
            staff,_=bridge.read_controls()
            people=bridge.read_staff()
            if any(bridge._same_employee_name(v["name"],name) for v in staff) or any(
                bridge._same_employee_name(p["nome"],name) for p in people):
                raise bridge.BridgeError("Funcionário já existente ou nome semelhante. Use o cadastro existente.")
            result=bridge._control_request("POST",f"/api/controls/{_new_vale_control()}/vales/employees",{"name":name})
            return {"ok":True,"funcionario_id":-int(result["id"])}
        eid,name,owned,staff,people,links=_vale_context(payload.get("funcionario_id"))
        if action=="add":
            data=_vale_payload(payload)
            if not owned:
                if any(bridge._same_employee_name(v["name"],name) for v in staff) or sum(
                    bridge.name_key(p["nome"])==bridge.name_key(name) for p in people)!=1:
                    raise bridge.BridgeError("Cadastro ambíguo de funcionário. Confira os nomes antes de lançar.")
                vid=bridge.positive_id(bridge._control_request("POST",
                    f"/api/controls/{_new_vale_control()}/vales/employees",{"name":name})["id"])
                # Fixar o vínculo ao perfil selecionado, sem criar conta ou holerite.
                with closing(bridge.journal()) as con:
                    con.execute("INSERT INTO staff_links(vale_employee_id,contas_employee_id) VALUES(?,?)",(vid,eid))
                    con.commit()
            else:
                active=[v for v in owned if v.get("active",True)]
                if len(active)!=1:
                    raise bridge.BridgeError("Selecione um cadastro ativo de Vales; reative-o se necessário.")
                vid=int(active[0]["id"])
            result=bridge._control_request("POST",f"/api/vales-employees/{vid}/debts",data)
            return {"ok":True,"id":result["id"],"funcionario_id":eid}
        details=vale_details(eid)["cadastros"]
        by_employee={int(p["id"]):p for p in details}
        debts={int(d["id"]):d for p in details for d in p["debts"]}
        installments={int(i["id"]):i for d in debts.values() for i in d["installments"]}
        payments={int(p["id"]):p for v in details for p in v["payments"]}
        rid=bridge.positive_id(payload.get("id"))
        if action=="active" and rid in by_employee:
            if type(payload.get("active")) is not bool:raise bridge.BridgeError("Status inválido.")
            bridge._control_request("PATCH",f"/api/vales-employees/{rid}",{"active":payload["active"]})
        elif action=="edit" and rid in debts:
            bridge._control_request("PATCH",f"/api/vales-debts/{rid}",{
                "title":payload.get("title"),"description":payload.get("description","")})
        elif action in ("plan","settle","delete") and rid in debts:
            if any(amount(i["reservado"])>ZERO for i in debts[rid]["installments"]):
                raise bridge.BridgeError("Vale reservado em holerite. Não altere enquanto houver desconto reservado.")
            base=f"/api/vales-debts/{rid}"
            if action=="plan":bridge._control_request("PUT",base+"/plan",{"installments":payload.get("installments")})
            elif action=="settle":bridge._control_request("POST",base+"/pay",{"month":bridge.valid_month(payload.get("month"))})
            else:bridge._control_request("DELETE",base)
        elif action=="payment" and rid in installments:
            i=installments[rid]
            payment=bridge.dec(payload.get("amount"))
            if payment<=ZERO or payment>amount(i["remaining"])-amount(i["reservado"]):
                raise bridge.BridgeError("Desconto supera o saldo disponível da parcela.")
            bridge._control_request("POST",f"/api/vales-installments/{rid}/payments",{
                "month":bridge.valid_month(payload.get("month")),"amount":bridge.money(payment),
                "notes":payload.get("notes","")})
        elif action=="undo" and rid in payments:
            if payments[rid]["protegido"]:
                raise bridge.BridgeError("Desconto vinculado ao holerite. Não pode ser estornado por aqui.")
            bridge._control_request("DELETE",f"/api/vales-payments/{rid}")
        else:
            raise bridge.BridgeError("Operação ou registro não pertence ao funcionário selecionado.")
        return {"ok":True,"funcionario_id":eid}


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
        elif handler.command=="GET" and path=="/api/funcionarios/buscar-contas":
            query=parse_qs(uri.query).get("q",[""])[0]
            result=find_account_candidates(query)
        elif handler.command=="GET" and path=="/api/funcionarios/vales":
            result=vale_details(parse_qs(uri.query).get("funcionario_id",[""])[0])
        elif handler.command=="POST" and path=="/api/funcionarios/vales":
            result=vale_action(bridge.read_body(handler))
        elif handler.command=="POST" and path=="/api/funcionarios/pix":
            result=update_pix(bridge.read_body(handler))
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
