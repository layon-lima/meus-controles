"""Compatibilidade restrita de consultas da Central com PostgreSQL (psycopg 3).

A versão Windows continua usando sqlite3 sem nenhuma alteração na base.
A versão VPS tem seu próprio banco PostgreSQL, com transações e IDs preservados.
"""
import re

# Importação sob demanda: versão Windows não precisa ter psycopg instalado.

_SIMPLE_PK = re.compile(r"\bid\s+INTEGER\s+PRIMARY\s+KEY\b", re.I)
_TABLE_INFO = re.compile(r"^\s*PRAGMA\s+table_info\(\s*([a-z_][a-z0-9_]*)\s*\)\s*$", re.I)
_INSERT_TABLE = re.compile(r"^\s*INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+([a-z_][a-z0-9_]*)\b", re.I)
_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$", re.I)


class HybridRow(dict):
    """Compatível com sqlite3.Row: suporta row['col'], row[0] e dict(row)."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


class Cursor:
    def __init__(self, owner, native, statement):
        self.owner = owner
        self.native = native
        self.statement = statement

    @property
    def rowcount(self):
        return self.native.rowcount

    @property
    def lastrowid(self):
        match = _INSERT_TABLE.match(self.statement)
        if not match or self.native.rowcount < 1:
            return None
        table = match.group(1)
        if not _IDENTIFIER.fullmatch(table):
            return None
        sql = "SELECT currval(pg_get_serial_sequence(%s, 'id'))"
        # Executar diretamente na conexão respeita o row_factory da sessão
        # e funciona também com cursores substitutos em testes.
        row = self.owner.native.execute(sql, (table,)).fetchone()
        if row is None:
            return None
        return next(iter(row.values())) if isinstance(row, dict) else row[0]

    @staticmethod
    def _row(value):
        return HybridRow(value) if isinstance(value, dict) else value

    def fetchone(self):
        return self._row(self.native.fetchone())

    def fetchall(self):
        return [self._row(row) for row in self.native.fetchall()]

    def __iter__(self):
        for row in self.native:
            yield self._row(row)


class Connection:
    def __init__(self):
        import os
        import psycopg
        from psycopg.rows import dict_row
        self.native = psycopg.connect(
            host=os.environ["CONTROLES_PGHOST"],
            port=int(os.getenv("CONTROLES_PGPORT", "5432")),
            user=os.environ["CONTROLES_PGUSER"],
            password=os.environ["CONTROLES_PGPASSWORD"],
            dbname=os.environ["CONTROLES_PGDATABASE"],
            connect_timeout=10,
            row_factory=dict_row,
        )
        self._explicit = False

    @property
    def in_transaction(self):
        return self._explicit

    def execute(self, sql, params=None):
        sql = sql.strip()
        if sql.upper() in ("PRAGMA FOREIGN_KEYS=ON", "PRAGMA BUSY_TIMEOUT=20000"):
            return None
        if sql.upper() == "BEGIN IMMEDIATE":
            # A transação pode ter começado na leitura anterior. Serializa
            # operações sensíveis à concorrência como o BEGIN IMMEDIATE do SQLite.
            self.native.execute("SELECT pg_advisory_xact_lock(63501765)")
            self._explicit = True
            return None
        match = _TABLE_INFO.match(sql)
        if match:
            sql = ("SELECT column_name AS name FROM information_schema.columns "
                   "WHERE table_schema=current_schema() AND table_name=%s "
                   "ORDER BY ordinal_position")
            params = (match.group(1),)
        else:
            if re.match(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO\b", sql, re.I):
                sql = re.sub(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO\b", "INSERT INTO", sql, count=1, flags=re.I)
                sql += " ON CONFLICT DO NOTHING"
            sql = sql.replace("?", "%s")
            sql = re.sub(r"\bCURRENT_TIMESTAMP\b", "(CURRENT_TIMESTAMP::text)", sql, flags=re.I)
        native = self.native.execute(sql, params)
        return Cursor(self, native, sql)

    def executescript(self, script):
        sql = _SIMPLE_PK.sub("id BIGSERIAL PRIMARY KEY", script)
        # As instruções do esquema não possuem literais com ponto e vírgula.
        for statement in sql.split(";"):
            if statement.strip():
                self.execute(statement)

    def commit(self):
        self.native.commit()
        self._explicit = False

    def rollback(self):
        self.native.rollback()
        self._explicit = False

    def close(self):
        self.native.close()

    def __enter__(self):
        return self

    def __exit__(self, typ, value, tb):
        try:
            if typ is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()


def connect():
    return Connection()
