"""Consolida os controles PEDIDOS em RECEBIMENTO DE PRODUTOS na pasta RECEBIMENTOS.

Executar uma única vez na API da VPS, APÓS backup verificado:
  python /srv/app/receiving_consolidation.py --apply

Sem --apply, apenas exibe diagnóstico. Todos os IDs de produtos e notas são mantidos.
Snapshots completos dos controles removidos ficam no próprio PostgreSQL.
"""
import argparse
import json
import os
import re

import app

SOURCE_IDS = set(range(11, 43))  # IDs confirmados no diagnóstico anterior da VPS.
ALLOWED = {"purchase_items", "receiving_imports", "receiving_pdf_batches",
           "receiving_xml_pending", "control_type_changes"}
TRACKING = ("receiving_imports", "receiving_pdf_batches")
ID_RE = re.compile(r"^[a-z_][a-z0-9_]*$", re.I)


def _name(value):
    return " ".join(value.casefold().split())


def _rows(con, table, cid):
    assert ID_RE.fullmatch(table)
    return [dict(r) for r in con.execute(
        f"SELECT * FROM {table} WHERE control_id=? ORDER BY id", (cid,))]


def _links(con):
    """Encontra TODAS as tabelas com chave estrangeira direta para controls."""
    if hasattr(con, "native"):
        rows = con.execute("""
          SELECT DISTINCT tc.table_name AS table_name,
                          kcu.column_name AS column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name=kcu.constraint_name
           AND tc.constraint_schema=kcu.constraint_schema
          JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name=ccu.constraint_name
           AND tc.constraint_schema=ccu.constraint_schema
          WHERE tc.constraint_type='FOREIGN KEY'
            AND tc.table_schema=current_schema()
            AND ccu.table_name='controls' AND ccu.column_name='id'
        """).fetchall()
        result={(r["table_name"],r["column_name"]) for r in rows}
    else:
        result=set()
        names=[r["name"] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")]
        for table in names:
            if not ID_RE.fullmatch(table):
                continue
            for fk in con.execute(f"PRAGMA foreign_key_list({table})"):
                if fk["table"]=="controls" and fk["to"]=="id":
                    result.add((table,fk["from"]))
    if any(not ID_RE.fullmatch(t) or not ID_RE.fullmatch(c) for t,c in result):
        raise ValueError("Nome de referência inesperado: consolidação cancelada.")
    return sorted(result)


def _plan(con):
    boards=[dict(r) for r in con.execute("SELECT id,name FROM boards")]
    matches=[b for b in boards if _name(b["name"])=="recebimentos"]
    if len(matches)!=1:
        raise ValueError("É necessária exatamente uma pasta RECEBIMENTOS.")
    board=matches[0]
    controls=[dict(r) for r in con.execute(
        "SELECT * FROM controls WHERE board_id=? ORDER BY id", (board["id"],))]
    main=[c for c in controls if c["mode"]=="recebimento"
          and _name(c["name"])=="recebimento de produtos"]
    if len(main)!=1:
        raise ValueError("É necessário exatamente um controle principal RECEBIMENTO DE PRODUTOS.")
    main=main[0]
    sources=[c for c in controls if _name(c["name"])=="pedidos" and c["mode"]=="recebimento"]
    others=[c for c in controls if c["mode"]=="recebimento"
            and c["id"]!=main["id"] and c not in sources]
    if others or any(_name(c["name"])=="pedidos" and c["mode"]!="recebimento" for c in controls):
        raise ValueError("Existem outros controles de recebimento não previstos: operação cancelada.")
    if sources and {c["id"] for c in sources}!=SOURCE_IDS:
        raise ValueError("Os IDs dos 32 controles PEDIDOS não coincidem com o diagnóstico anterior. Nada foi alterado.")
    if sources and len(sources)!=32:
        raise ValueError("Quantidade inesperada de controles PEDIDOS. Nada foi alterado.")

    links=_links(con)
    ids=[c["id"] for c in sources]
    unexpected={}
    for table,column in links:
        if table in ALLOWED or not ids:
            continue
        question=",".join("?" for _ in ids)
        count=con.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE {column} IN ({question})",ids).fetchone()["n"]
        if count:
            unexpected[table]=int(count)
    if unexpected:
        raise ValueError("Controles PEDIDOS têm dados inesperados que não podem ser descartados: "
                         +repr(unexpected)+". Nada foi alterado.")

    data=[]
    for c in sources:
        items=_rows(con,"purchase_items",c["id"])
        receipts=[]
        for item in items:
            receipts.extend([dict(r) for r in con.execute(
                "SELECT * FROM purchase_receipts WHERE item_id=? ORDER BY id", (item["id"],))])
        data.append({"control":c, "purchase_items":items, "purchase_receipts":receipts,
                     **{table:_rows(con,table,c["id"]) for table in
                        (*TRACKING,"receiving_xml_pending","control_type_changes")}})
    primary_items=_rows(con,"purchase_items",main["id"])
    return main, sources, data, primary_items


def _snapshot(con, main_id, source):
    c=source["control"]
    con.execute("""INSERT INTO receiving_consolidation_archive
        (source_control_id,target_control_id,snapshot_json)
        VALUES(?,?,?)""",
        (c["id"],main_id,json.dumps(source,ensure_ascii=False,default=str)))


def _merge_unique(con, table, sources, target_id, keys, strict=False):
    existing={}
    for r in _rows(con,table,target_id):
        existing[tuple(r[k] for k in keys)]=r
    moved=discarded=0
    for source in sources:
        for r in source[table]:
            key=tuple(r[k] for k in keys)
            old=existing.get(key)
            if old:
                if strict:
                    ignore={"id","control_id","created_at"}
                    if any(old[k]!=v for k,v in r.items() if k not in ignore):
                        raise ValueError("Conflito em "+table+" para a referência "+repr(key)
                                         +": migração revertida sem perda.")
                # A linha duplicada está preservada integralmente no snapshot.
                con.execute(f"DELETE FROM {table} WHERE id=?",(r["id"],))
                discarded+=1
            else:
                con.execute(f"UPDATE {table} SET control_id=? WHERE id=?",(target_id,r["id"]))
                existing[key]=r
                moved+=1
    return moved,discarded


def consolidate(con, apply=False):
    # BEGIN IMMEDIATE oferece isolamento serializado no SQLite e lock advisory
    # na camada PostgreSQL da aplicação.
    if apply:
        con.execute("BEGIN IMMEDIATE")
        if hasattr(con,"native"):
            con.execute("""LOCK TABLE controls, purchase_items, purchase_receipts,
                receiving_imports, receiving_pdf_batches, receiving_xml_pending,
                control_type_changes IN SHARE ROW EXCLUSIVE MODE""")
    main, sources, data, current_items=_plan(con)
    item_count=sum(len(d["purchase_items"]) for d in data)
    receipt_count=sum(len(d["purchase_receipts"]) for d in data)
    report={"principal":main["id"], "controles_extras":len(sources),
            "produtos_principais_antes":len(current_items),
            "produtos_para_mover":item_count,
            "notas_para_preservar":receipt_count,
            "sem_pedido_para_mover":sum(len(d["receiving_xml_pending"]) for d in data)}
    if not apply or not sources:
        return report

    con.execute("""CREATE TABLE IF NOT EXISTS receiving_consolidation_archive (
        source_control_id INTEGER PRIMARY KEY,
        target_control_id INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    for source in data:
        _snapshot(con,main["id"],source)

    source_ids=[s["id"] for s in sources]
    for s in sources:
        con.execute("UPDATE purchase_items SET control_id=? WHERE control_id=?",
                    (main["id"],s["id"]))
    report["historicos_importacao"]={}
    for table in TRACKING:
        moved,archived=_merge_unique(con,table,data,main["id"],("fingerprint",))
        report["historicos_importacao"][table]={"movidos":moved,"repetidos_arquivados":archived}
    moved,archived=_merge_unique(con,"receiving_xml_pending",data,main["id"],
                                 ("access_key","line_index"),strict=True)
    report["xml_pendentes"]={"movidos":moved,"repetidos_arquivados":archived}

    # Históricos de mudança de tipo dos controles secundários ficam arquivados,
    # sem atribuir incorretamente essas alterações ao controle principal.
    for source in data:
        for row in source["control_type_changes"]:
            con.execute("DELETE FROM control_type_changes WHERE id=?",(row["id"],))

    # Verificação em TODAS as tabelas que referenciam controls: não usar
    # ON DELETE CASCADE para eliminar dados acidentalmente.
    for table,column in _links(con):
        question=",".join("?" for _ in source_ids)
        remaining=con.execute(
            f"SELECT COUNT(*) AS n FROM {table} WHERE {column} IN ({question})",
            source_ids).fetchone()["n"]
        if remaining:
            raise ValueError(f"Dados restantes em {table} ({remaining}); reversão automática.")
    final=con.execute("SELECT COUNT(*) AS n FROM purchase_items WHERE control_id=?",
                      (main["id"],)).fetchone()["n"]
    if final!=len(current_items)+item_count:
        raise ValueError("A quantidade de produtos após a unificação não confere.")
    for source_id in source_ids:
        con.execute("DELETE FROM controls WHERE id=?",(source_id,))
    if con.execute("SELECT COUNT(*) AS n FROM controls WHERE board_id=? AND mode='recebimento'",
                   (main["board_id"],)).fetchone()["n"]!=1:
        raise ValueError("Não restou exatamente um controle de recebimento.")

    report["produtos_principais_depois"]=final
    report["controles_removidos"]=len(source_ids)
    report["arquivo_auditoria"]="receiving_consolidation_archive"
    con.commit()
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply",action="store_true",
                        help="Aplicar unificação com transação atômica (exige backup anterior).")
    args=parser.parse_args()
    if args.apply and not os.getenv("CONTROLES_PGHOST"):
        raise SystemExit("Aplicação permitida somente no PostgreSQL da VPS.")
    with app.db() as con:
        result=consolidate(con,args.apply)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if not args.apply:
        print("MODO DIAGNÓSTICO: nada foi alterado.")
    elif result["controles_extras"]:
        print("UNIFICAÇÃO CONCLUÍDA: único controle de recebimentos, com pedidos e históricos preservados.")
    else:
        print("UNIFICAÇÃO JÁ REALIZADA; nenhuma alteração necessária.")


if __name__=="__main__":
    main()
