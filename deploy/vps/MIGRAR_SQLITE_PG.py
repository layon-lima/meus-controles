#!/usr/bin/env python3
"""Migra o banco SQLite do Windows para a base PostgreSQL PRIVADA da Central.

Requer serviço web parado e PostgreSQL novo/vazio (aceita apenas seed inicial).
Tudo é inserido em uma transação: falha = rollback completo.
"""
from collections import defaultdict
from pathlib import Path
import sqlite3
import sys

import psycopg
from psycopg import sql


def main(filename):
    file = Path(filename)
    if not file.is_file():
        raise SystemExit("Banco SQLite de origem não encontrado.")
    source = sqlite3.connect(f"file:{file}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    if source.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise SystemExit("O arquivo SQLite não passou na verificação de integridade.")
    tables = [
        r[0] for r in source.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]
    if not {"settings", "boards", "controls", "entries", "pair_entries"}.issubset(tables):
        raise SystemExit("Esse arquivo não corresponde a uma base válida da Central.")
    dependencies = {}
    for name in tables:
        dependencies[name] = {
            row["table"] for row in source.execute(f'PRAGMA foreign_key_list("{name}")')
            if row["table"] in tables and row["table"] != name
        }
    remaining = set(tables)
    ordered = []
    while remaining:
        ready = sorted(t for t in remaining if not dependencies[t].intersection(remaining))
        if not ready:
            raise SystemExit("Dependência circular no esquema SQLite; migração não iniciada.")
        ordered.extend(ready)
        remaining.difference_update(ready)

    import os
    with psycopg.connect(
        host=os.environ["CONTROLES_PGHOST"],
        port=int(os.getenv("CONTROLES_PGPORT", "5432")),
        user=os.environ["CONTROLES_PGUSER"],
        password=os.environ["CONTROLES_PGPASSWORD"],
        dbname=os.environ["CONTROLES_PGDATABASE"],
    ) as dest:
        with dest.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(63501765)")
            # Somente migra na primeira instalação: não apaga um banco VPS já em uso.
            cur.execute("SELECT COUNT(*) FROM controls")
            existing_controls = cur.fetchone()[0]
            if existing_controls == 1:
                cur.execute("SELECT name, mode FROM controls LIMIT 1")
                seed = cur.fetchone()
                if seed != ("Controle de Fretes", "calculo"):
                    raise SystemExit("A VPS possui um controle próprio; migração cancelada.")
            cur.execute("SELECT COUNT(*) FROM entries")
            existing_entries = cur.fetchone()[0]
            if existing_controls > 1 or existing_entries:
                raise SystemExit("A VPS já possui controles reais. Migração cancelada para não sobrescrever dados.")
            for name in ("pair_entries", "debt_payments", "truck_entries", "purchase_items", "pair_records"):
                cur.execute("SELECT to_regclass(%s)", ("public." + name,))
                if cur.fetchone()[0] is not None:
                    cur.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(name)))
                    if cur.fetchone()[0]:
                        raise SystemExit("A VPS contém registros em " + name + "; migração cancelada.")
            cur.execute("SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema='public' AND table_type='BASE TABLE'")
            postgres_tables = {row[0] for row in cur.fetchall()}
            extra = set(tables) - postgres_tables
            if extra:
                raise SystemExit("O PostgreSQL não contém as tabelas: " + ", ".join(sorted(extra)))
            # Esse banco é exclusivo da Central, mas só limpamos tabelas que conhecemos.
            if postgres_tables:
                truncate = sql.SQL("TRUNCATE TABLE {} RESTART IDENTITY CASCADE").format(
                    sql.SQL(", ").join(sql.Identifier(t) for t in sorted(postgres_tables))
                )
                cur.execute(truncate)
            for name in ordered:
                columns = [r["name"] for r in source.execute(f'PRAGMA table_info("{name}")')]
                if not columns:
                    continue
                rows = source.execute(f'SELECT * FROM "{name}"').fetchall()
                if not rows:
                    continue
                insert = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                    sql.Identifier(name),
                    sql.SQL(", ").join(sql.Identifier(c) for c in columns),
                    sql.SQL(", ").join(sql.Placeholder() for _ in columns)
                )
                cur.executemany(insert, [tuple(row[c] for c in columns) for row in rows])
                print(f"Transferido {name}: {len(rows)} linha(s).")
            for name in ordered:
                cur.execute("SELECT pg_get_serial_sequence(%s, 'id')", ("public." + name,))
                sequence = cur.fetchone()[0]
                if not sequence:
                    continue
                cur.execute(sql.SQL("SELECT COALESCE(MAX(id),0) FROM {}").format(sql.Identifier(name)))
                last = cur.fetchone()[0]
                cur.execute("SELECT setval(%s::regclass, %s, %s)",
                            (sequence, max(last, 1), last > 0))
            cur.execute("SELECT COUNT(*) FROM controls")
            copied = cur.fetchone()[0]
            expected = source.execute("SELECT COUNT(*) FROM controls").fetchone()[0]
            if copied != expected:
                raise RuntimeError("Contagem de controles divergente; transação revertida.")
            print(f"MIGRAÇÃO VALIDADA: {copied} controle(s). Banco VPS PostgreSQL atualizado.")
    source.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python MIGRAR_SQLITE_PG.py /import/controles.db")
    main(sys.argv[1])
