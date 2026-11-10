#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Importação DANFE DIDI 2026: dois pedidos, 45 NF-es; milho 2389 EXCLUÍDO.
Simulação: python scripts/importar_didi_notas_2026.py
Aplicação:  python scripts/importar_didi_notas_2026.py --apply
Execute BACKUP_PG.sh antes do --apply. Reexecução é idempotente.
"""
import argparse
from collections import defaultdict
from datetime import date
from decimal import Decimal
from pathlib import Path
import re
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
SUPPLIER="E M DE SOUSA TRANSPORTES LTDA"
CNPJ="25262883000139"
SPECS={
  "C":{"order":"DIDI-CALCARIO-2026","product":"CALCARIO","unit":"t",
       "total":Decimal("1226.46"),"count":39},
  "G":{"order":"DIDI-GESSO-2026","product":"GESSO AGRICOLA","unit":"t",
       "total":Decimal("241.69"),"count":6},
}
# categoria|número NF|emissão|quantidade t|chave de acesso|descrição original|unidade original
RAW="""C|2284|2026-08-10|48.76|22260825262883000139550010000022841060095100|CALCARIO|TON
C|2286|2026-08-10|48.32|22260825262883000139550010000022861053210599|CALCARIO|TON
C|2290|2026-08-12|14.33|22260825262883000139550010000022901695061668|CALCARIO|TON
C|2291|2026-08-12|17.4|22260825262883000139550010000022911950651850|CALCARIO|TON
C|2303|2026-08-16|48.22|22260825262883000139550010000023031656047714|CALCARIO|TON
C|2305|2026-08-16|48.4|22260825262883000139550010000023051035290036|CALCARIO|TON
C|2307|2026-08-17|48.3|22260825262883000139550010000023071970464046|CALCARIO|TON
C|2308|2026-08-17|48.54|22260825262883000139550010000023081452258683|CALCARIO|TON
C|2309|2026-08-17|14.77|22260825262883000139550010000023091480883705|CALCARIO|TON
C|2310|2026-08-17|47.02|22260825262883000139550010000023101001178462|CALCARIO|TON
C|2316|2026-08-18|47.84|22260825262883000139550010000023161740983954|CALCARIO|TON
C|2317|2026-08-18|15.53|22260825262883000139550010000023171262380053|CALCARIO|TON
C|2318|2026-08-19|13.47|22260825262883000139550010000023181786064808|CALCARIO|TON
C|2319|2026-08-19|12.63|22260825262883000139550010000023191325467627|CALCARIO|TON
C|2320|2026-08-19|48.26|22260825262883000139550010000023201877735789|CALCARIO|TON
C|2325|2026-08-21|49.16|22260825262883000139550010000023251584480767|CALCARIO|TON
C|2328|2026-08-22|47.62|22260825262883000139550010000023281593684509|CALCARIO|TON
C|2335|2026-08-24|25.88|22260825262883000139550010000023351406773462|CALCARIO|TON
C|2336|2026-08-24|48.08|22260825262883000139550010000023361661144499|CALCARIO|TON
C|2337|2026-08-25|13.16|22260825262883000139550010000023371570475627|CALCARIO|TON
C|2338|2026-08-25|12.32|22260825262883000139550010000023381027509440|CALCARIO|TON
C|2342|2026-08-25|48.76|22260825262883000139550010000023421299572404|CALCARIO|TON
C|2343|2026-08-25|12.24|22260825262883000139550010000023431645722607|CALCARIO|TON
C|2345|2026-08-26|47.88|22260825262883000139550010000023451899327046|CALCARIO|TON
C|2346|2026-08-26|47.08|22260825262883000139550010000023461072748418|CALCARIO|TON
C|2349|2026-08-28|13.32|22260825262883000139550010000023491731990944|CALCARIO|TON
C|2350|2026-08-28|14.53|22260825262883000139550010000023501165514681|CALCARIO|TON
C|2351|2026-08-28|15.2|22260825262883000139550010000023511035482701|CALCARIO|TON
C|2352|2026-08-28|12.15|22260825262883000139550010000023521326797110|CALCARIO|TON
C|2359|2026-08-30|48.1|22260825262883000139550010000023591387928739|CALCARIO|TON
C|2364|2026-08-31|47.85|22260825262883000139550010000023641925392755|CALCARIO|TON
C|2368|2026-08-31|10.78|22260825262883000139550010000023681503907231|CALCARIO|TON
C|2370|2026-09-01|48.48|22260925262883000139550010000023701223890047|CALCARIO|TON
C|2371|2026-09-05|8.38|22260925262883000139550010000023711295810950|CALCARIO AGRICOLA|TON
C|2377|2026-09-02|12.34|22260925262883000139550010000023771066844290|CALCARIO AGRICOLA|TN
C|2379|2026-09-02|48.52|22260925262883000139550010000023791995613579|CALCARIO|TON
C|2384|2026-09-04|47.82|22260925262883000139550010000023841722942668|CALCARIO|TON
C|2385|2026-09-05|12.82|22260925262883000139550010000023851874842825|CALCARIO|TON
C|2396|2026-09-09|12.2|22260925262883000139550010000023961202722982|CALCARIO|TON
G|2242|2026-07-29|49.42|22260725262883000139550010000022421086519329|GESSO AGRICOLA|TON
G|2250|2026-08-02|49.48|22260825262883000139550010000022501024980567|GESSO AGRICOLA|TON
G|2254|2026-08-02|43.66|22260825262883000139550010000022541624396288|GESSO AGRICOLA|TON
G|2274|2026-08-09|49.1|22260825262883000139550010000022741149944592|GESSO AGRICOLA|TON
G|2288|2026-08-10|22.59|22260825262883000139550010000022881148637918|GESSO AGRICOLA|TON
G|2306|2026-08-17|27.44|22260825262883000139550010000023061348061432|GESSO AGRICOLA|TON"""

def check_digit(key):
    total=0;factor=2
    for digit in reversed(key[:43]):
        total+=int(digit)*factor
        factor=2 if factor==9 else factor+1
    remainder=total%11
    return 0 if remainder in (0,1) else 11-remainder

def manifest():
    entries=[];numbers=set();keys=set()
    total=defaultdict(lambda:Decimal("0"));count=defaultdict(int)
    for line in RAW.strip().splitlines():
        parts=line.split("|")
        if len(parts)!=7:raise RuntimeError("Manifesto de NF-es incompleto.")
        cat,number,issued,qty,key,product,unit=parts
        if (cat not in SPECS or number=="2389" or "MILHO" in product or
            not number.isdecimal() or not re.fullmatch(r"\d{44}",key)):
            raise RuntimeError("NF-e excluída ou inválida no manifesto.")
        date.fromisoformat(issued)
        if (key[6:20]!=CNPJ or key[20:22]!="55" or key[22:25]!="001" or
            int(key[25:34])!=int(number) or key[2:6]!=issued[2:4]+issued[5:7] or
            check_digit(key)!=int(key[-1])):
            raise RuntimeError("Chave de acesso fiscal não confere: "+number)
        if cat=="C" and product not in ("CALCARIO","CALCARIO AGRICOLA"):
            raise RuntimeError("Produto errado: "+product)
        if cat=="G" and product!="GESSO AGRICOLA":
            raise RuntimeError("Produto errado: "+product)
        if unit not in ("TON","TN"):raise RuntimeError("Unidade inesperada: "+unit)
        amount=Decimal(qty)
        if not amount.is_finite() or amount<=0 or amount.as_tuple().exponent < -3:
            raise RuntimeError("Quantidade inválida: "+number)
        if number in numbers or key in keys:raise RuntimeError("Chave/número de NF-e repetido.")
        numbers.add(number);keys.add(key);total[cat]+=amount;count[cat]+=1
        entries.append({"code":cat,"invoice":number,"date":issued,"qty":amount,
                        "key":key,"original":product,"original_unit":unit})
    if len(entries)!=45 or any(
        count[c]!=spec["count"] or total[c]!=spec["total"]
        for c,spec in SPECS.items()):
        raise RuntimeError("Totais divergem dos PDFs auditados.")
    return entries

def norm(value):
    return " ".join(str(value or "").casefold().split())

def control_id(con):
    rows=list(con.execute("""SELECT c.id,c.name,b.name AS board_name
       FROM controls c LEFT JOIN boards b ON b.id=c.board_id
       WHERE c.mode='recebimento'"""))
    preferred=[r for r in rows if norm(r["name"])=="recebimento de produtos"
               and norm(r["board_name"])=="recebimentos"]
    if len(preferred)==1:return preferred[0]["id"]
    if len(preferred)>1:raise RuntimeError("Centrais duplicadas; não é seguro escolher.")
    if len(rows)==1:return rows[0]["id"]
    raise RuntimeError("Central de Recebimento única não encontrada; nada foi alterado.")

def inspect(con,cid,entries):
    orders={}
    for c,spec in SPECS.items():
        rows=list(con.execute("""SELECT * FROM purchase_items
           WHERE control_id=? AND order_number=?""",(cid,spec["order"])))
        if len(rows)>1:raise RuntimeError("Pedido duplicado: "+spec["order"])
        item=dict(rows[0]) if rows else None
        if item and (norm(item["supplier"])!=norm(SUPPLIER) or
                     norm(item["product"])!=norm(spec["product"]) or
                     item["unit"]!="t" or Decimal(item["ordered_qty"])!=spec["total"]):
            raise RuntimeError("Pedido existente com dados diferentes: "+spec["order"])
        orders[c]=item

    keys=[e["key"] for e in entries]
    marks=",".join("?" for _ in keys)
    receipts=list(con.execute("""SELECT r.id,r.item_id,r.invoice_number,
        r.access_key,r.received_qty,r.received_date,i.control_id,
        i.order_number,i.product,i.supplier
        FROM purchase_receipts r JOIN purchase_items i ON i.id=r.item_id
        WHERE r.access_key IN ("""+marks+")",tuple(keys)))
    by_key=defaultdict(list)
    for r in receipts:by_key[r["access_key"]].append(dict(r))

    # Bloquear nota já cadastrada para este fornecedor, inclusive sem chave.
    invoices={e["invoice"] for e in entries}
    suspect=[]
    for r in con.execute("""SELECT r.id,r.access_key,r.invoice_number,
        r.invoice_issuer_document,i.supplier
        FROM purchase_receipts r JOIN purchase_items i ON i.id=r.item_id
        WHERE i.control_id=?""",(cid,)):
        number=str(r["invoice_number"]).strip()
        if (number.isdecimal() and str(int(number)) in invoices and
            (norm(r["supplier"])==norm(SUPPLIER) or
             re.sub(r"\D","",r["invoice_issuer_document"] or "")==CNPJ) and
            r["access_key"] not in by_key):
            suspect.append(number)
    if suspect:
        raise RuntimeError("Notas do fornecedor já cadastradas sem chave correspondente: "+
                           ", ".join(suspect[:8])+"; nada alterado.")

    existing={"C":0,"G":0}
    for e in entries:
        matches=by_key.get(e["key"],[])
        if len(matches)>1:raise RuntimeError("Chave duplicada: NF "+e["invoice"])
        if not matches:continue
        r=matches[0];item=orders[e["code"]]
        if (not item or r["item_id"]!=item["id"] or r["control_id"]!=cid or
            not str(r["invoice_number"]).strip().isdecimal() or
            int(r["invoice_number"])!=int(e["invoice"]) or
            Decimal(r["received_qty"])!=e["qty"] or r["received_date"]!=e["date"]):
            raise RuntimeError("NF "+e["invoice"]+
              " já lançada em outro pedido ou com dados diferentes. Nada alterado.")
        existing[e["code"]]+=1
    for cat,item in orders.items():
        if not item:continue
        known={e["key"] for e in entries if e["code"]==cat}
        for r in con.execute("SELECT access_key FROM purchase_receipts WHERE item_id=?",
                             (item["id"],)):
            if r["access_key"] not in known:
                raise RuntimeError("Pedido tem outras entregas não previstas: "+SPECS[cat]["order"])
    return orders,by_key,existing

def run(app,receiving,apply):
    entries=manifest()
    con=app.db()
    try:
        if apply:con.execute("BEGIN IMMEDIATE")
        cid=control_id(con)
        receiving.ensure_control(con,cid)
        orders,by_key,existing=inspect(con,cid,entries)
        print("CENTRAL",cid,"| FORNECEDOR",SUPPLIER)
        print("NF-e 2389 (MILHO): EXCLUÍDA. Não entra em nenhum cálculo.")
        for code,spec in SPECS.items():
            print(spec["order"],"|",spec["total"],"toneladas |",
                  spec["count"],"NF-es | já existentes:",existing[code],
                  "| novas:",spec["count"]-existing[code])
        if not apply:
            print("SIMULAÇÃO: NENHUM DADO ALTERADO. Use --apply após backup.")
            return
        for cat,spec in SPECS.items():
            if orders[cat]:continue
            row=receiving.validate_item({
                "order_number":spec["order"],"supplier":SUPPLIER,
                "product":spec["product"],"unit":"t","ordered_qty":str(spec["total"])})
            receiving.ensure_item_unique(con,cid,row)
            cursor=con.execute("""INSERT INTO purchase_items
                (control_id,order_number,supplier,product,unit,ordered_qty)
                VALUES(?,?,?,?,?,?)""",(cid,row["order_number"],row["supplier"],
                                      row["product"],row["unit"],row["ordered_qty"]))
            orders[cat]=dict(con.execute("SELECT * FROM purchase_items WHERE id=?",
                                          (cursor.lastrowid,)).fetchone())
        created=0
        for e in entries:
            if by_key.get(e["key"]):continue
            notes=("DANFE DIDI 2026; descrição fiscal: "+e["original"]+
                   "; unidade fiscal: "+e["original_unit"]+
                   ". Data usada: EMISSÃO da NF-e (data da entrega não informada).")
            con.execute("""INSERT INTO purchase_receipts
                (item_id,received_date,invoice_number,received_qty,
                 access_key,invoice_issuer,invoice_issuer_document,notes)
                VALUES(?,?,?,?,?,?,?,?)""",(
                  orders[e["code"]]["id"],e["date"],e["invoice"],
                  receiving.display(e["qty"]),e["key"],SUPPLIER,CNPJ,notes))
            created+=1
        for code,spec in SPECS.items():
            item=orders[code]
            qty=receiving.received_total(con,item["id"])
            count=con.execute("SELECT COUNT(*) AS n FROM purchase_receipts WHERE item_id=?",
                              (item["id"],)).fetchone()["n"]
            if qty!=spec["total"] or count!=spec["count"]:
                raise RuntimeError("Verificação final falhou: "+spec["order"])
        con.commit()
        print("SUCESSO:",created,"NF-es adicionadas; 2 pedidos; ambos com saldo 0 t.")
    except BaseException:
        con.rollback()
        raise
    finally:
        con.close()

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--apply",action="store_true",help="executar após backup")
    args=p.parse_args()
    import app
    import receiving
    try:run(app,receiving,args.apply)
    except Exception as e:
        print("CANCELADO SEM GRAVAÇÃO:",e,file=sys.stderr)
        sys.exit(1)
