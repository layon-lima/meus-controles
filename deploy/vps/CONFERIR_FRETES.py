#!/usr/bin/env python3
"""Conferência SOMENTE LEITURA dos 3 fretes de calcário informados.

Execução no contêiner: python -m deploy.vps.CONFERIR_FRETES
Não altera banco de dados, configurações, conferências nem lançamentos.
"""
import json
import re
from pathlib import Path
from decimal import Decimal

import app

TARGETS=(("2026-10-15","47000"),("2026-10-10","47610"),("2026-10-06","48380"))


def main():
    print("=== DIAGNOSTICO: FRETES CALCARIO JONAS / PRECO POR TONELADA ===")
    source=Path(app.__file__).read_text(encoding="utf-8")
    release=re.search(r'"release":"([^"]+)"',source)
    print("Versao REAL da API no container:",release.group(1) if release else "nao informada")
    with app.db() as con:
        controls=con.execute("""SELECT c.id,c.mode,c.name,b.name AS board,t.price_basis,
                               t.commission_pct
            FROM controls c JOIN boards b ON b.id=c.board_id
            LEFT JOIN truck_settings t ON t.control_id=c.id
            WHERE LOWER(TRIM(c.name))='controle de fretes'
              AND UPPER(TRIM(b.name))='TRANSPORTADORA'""").fetchall()
        if not controls:
            print("FALHA: Controle de Fretes da TRANSPORTADORA não localizado.")
            return
        for ctrl in controls:
            cid=ctrl["id"]
            print("\nCONTROLE:",cid,"| Modo:",ctrl["mode"],
                  "| Unidade:",ctrl["price_basis"],"| Comissão padrão:",ctrl["commission_pct"])
            for version in ("v1","v2"):
                key="freight_tonne_215_fix_"+version+"_"+str(cid)
                saved=con.execute("SELECT value FROM settings WHERE key=?",(key,)).fetchone()
                if saved:
                    try:
                        count=len(json.loads(saved["value"]))
                    except (ValueError,TypeError):
                        count="?"
                    print("Migração",version,": registrada | Lançamentos na auditoria:",count)
                else:
                    print("Migração",version,": sem registro")
            for date,weight in TARGETS:
                rows=con.execute("""SELECT id,event_date,kind,category,description,weight_kg,
                        price_tonne,commission_pct,amount,commission_amount
                    FROM truck_entries WHERE control_id=? AND event_date=?""",
                    (cid,date)).fetchall()
                matches=[r for r in rows if r["kind"]=="freight" and
                         str(r["category"]).strip().casefold()=="frete jonas" and
                         str(r["description"]).strip().casefold()=="calcario jonas" and
                         Decimal(r["weight_kg"])==Decimal(weight)]
                print("\nDATA",date,"| Peso",weight,"kg | encontrados:",len(matches))
                if not matches:
                    print("  Nada encontrado com o conjunto completo de data, peso, descrição e categoria.")
                    if rows:
                        print("  Existem",len(rows),"outros lançamentos nesta data.")
                for row in matches:
                    chk=con.execute("""SELECT COUNT(*) AS n FROM truck_reviews
                        WHERE control_id=? AND start_date<=? AND end_date>=?""",
                        (cid,date,date)).fetchone()["n"]
                    cls=con.execute("""SELECT COUNT(*) AS n FROM truck_closures
                        WHERE control_id=? AND start_date<=? AND end_date>=?""",
                        (cid,date,date)).fetchone()["n"]
                    print("  ID",row["id"],"| R$/t gravado",row["price_tonne"],
                          "| Entrada",row["amount"],"| Comissão",row["commission_amount"],
                          "| Taxa",row["commission_pct"],"| Conferido:",bool(chk),
                          "| Fechado:",bool(cls))
                    expected=Decimal(weight)*Decimal("215")/Decimal("1000")
                    if Decimal(row["amount"])==expected and Decimal(row["price_tonne"])==215:
                        print("  STATUS: JA CORRETO")
                    elif Decimal(row["price_tonne"])==215000 and Decimal(row["amount"])==expected*1000:
                        print("  STATUS: VALOR MIL VEZES MAIOR (necessita retificação)")
                    else:
                        print("  STATUS: DIVERGENTE (exige análise antes de corrigir)")


if __name__=="__main__":
    main()
