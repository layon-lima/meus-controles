#!/usr/bin/env python3
"""Remove apenas copias identicas sem entregas. Nunca apaga historico de NF-e.

Executar dentro do container apos backup do banco:
  python scripts/limpar_pedidos_duplicados.py
"""
import sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
import receiving

def main():
    con=app.db()
    try:
        con.execute("BEGIN IMMEDIATE")
        rows=list(con.execute("""SELECT i.id,i.control_id,i.order_number,i.supplier,
            i.product,i.unit,i.ordered_qty,i.closed,
            COUNT(r.id) AS receipts_count
          FROM purchase_items i
          LEFT JOIN purchase_receipts r ON r.item_id=i.id
          GROUP BY i.id,i.control_id,i.order_number,i.supplier,
                   i.product,i.unit,i.ordered_qty,i.closed
          ORDER BY i.id"""))
        groups=defaultdict(list)
        for row in rows:
            key=(row["control_id"],receiving.item_identity(row),
                 receiving.display(receiving.qty(row["ordered_qty"])))
            groups[key].append(row)
        deleted=0
        protected=0
        for values in groups.values():
            if len(values)<2:
                continue
            # Registros com entregas reais sempre permanecem.
            active=[r for r in values if r["receipts_count"]]
            if active:
                keep={r["id"] for r in active}
            else:
                # Preservar registros concluidos, se houver.
                chosen=sorted(values,key=lambda r:(-int(r["closed"]),r["id"]))[0]
                keep={chosen["id"]}
            for row in values:
                if row["id"] in keep:
                    continue
                if row["receipts_count"]:
                    protected+=1
                    continue
                # Checagem dentro da mesma transacao antes do DELETE.
                linked=con.execute(
                    "SELECT COUNT(*) AS n FROM purchase_receipts WHERE item_id=?",
                    (row["id"],)).fetchone()["n"]
                if linked:
                    protected+=1
                    continue
                con.execute("DELETE FROM purchase_items WHERE id=?",(row["id"],))
                deleted+=1
        con.commit()
        print("Pedidos duplicados sem recebimentos removidos:",deleted)
        print("Registros com historico preservados:",protected)
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()

if __name__=="__main__":
    main()
