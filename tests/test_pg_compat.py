"""Regressões do adaptador PostgreSQL sem dependência de servidor externo."""
import unittest

import pg_compat


class FakeQuery:
    def __init__(self, row=None, rowcount=1):
        self.row = row
        self.rowcount = rowcount
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass
    def fetchone(self):
        return self.row


class FakeNative:
    def __init__(self, row=None):
        self.row = row
        self.calls = []
    def cursor(self):
        return FakeQuery(row=self.row)
    def execute(self, statement, params=None):
        self.calls.append((statement, params))
        return FakeQuery(row=self.row)


class PgCompatibilityTests(unittest.TestCase):
    def test_sequence_id_with_psycopg_dict_row(self):
        owner = type("FakeOwner", (), {"native": FakeNative({"currval": 42})})()
        inserted = pg_compat.Cursor(owner, FakeQuery(), "INSERT INTO boards(name) VALUES (%s)")
        self.assertEqual(inserted.lastrowid, 42)

    def test_sequence_id_with_tuple_row(self):
        owner = type("FakeOwner", (), {"native": FakeNative((7,))})()
        inserted = pg_compat.Cursor(owner, FakeQuery(), "INSERT INTO controls(name) VALUES (%s)")
        self.assertEqual(inserted.lastrowid, 7)

    def test_hybrid_row_is_dict_and_supports_index(self):
        row = pg_compat.HybridRow({"name": "JONAS", "value": "114000.00"})
        self.assertEqual(row["name"], "JONAS")
        self.assertEqual(row[0], "JONAS")
        self.assertEqual(row[1], "114000.00")
        self.assertEqual(dict(row), {"name": "JONAS", "value": "114000.00"})

    def test_no_id_for_noninsert(self):
        owner = type("FakeOwner", (), {"native": FakeNative({"currval": 42})})()
        updated = pg_compat.Cursor(owner, FakeQuery(), "UPDATE boards SET name='X'")
        self.assertIsNone(updated.lastrowid)

    def test_parameter_and_schema_translation(self):
        connection = pg_compat.Connection.__new__(pg_compat.Connection)
        connection.native = FakeNative({"name": "id"})
        connection._explicit = False
        statement = "UPDATE controls SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
        connection.execute(statement, ("JONAS", 1))
        query, parameters = connection.native.calls[-1]
        self.assertIn("name=%s", query)
        self.assertIn("(CURRENT_TIMESTAMP::text)", query)
        self.assertEqual(parameters, ("JONAS", 1))
        connection.executescript("CREATE TABLE IF NOT EXISTS boards(id INTEGER PRIMARY KEY, name TEXT);")
        self.assertIn("id BIGSERIAL PRIMARY KEY", connection.native.calls[-1][0])


if __name__ == "__main__":
    unittest.main()
