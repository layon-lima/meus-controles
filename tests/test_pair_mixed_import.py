"""A × B: um JSON para dívidas, pagamentos e salários sem impacto no saldo."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import app
import pair
import pair_mixed_import as importer
import pair_records


class MixedImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.old = app.DATA, app.DB
        self.addCleanup(self.restore)
        app.DATA = Path(self.temp.name)
        app.DB = app.DATA / "test_mixed.db"
        app.initialize()
        with app.db() as con:
            self.cid = con.execute(
                """INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                   VALUES(1,'JONAS X MARCOS','acerto_ab','[]','[]','[]')"""
            ).lastrowid
            pair.save_settings(con, self.cid,
                               {"party_a": "JONAS", "party_b": "MARCOS"})

    def restore(self):
        app.DATA, app.DB = self.old

    @staticmethod
    def sample():
        return {
            "format": "central-pair-mixed-v1",
            "target": {"party_a": "JONAS", "party_b": "MARCOS"},
            "source_name": "ACERTO MARCOS ATUALIZADA(2).xlsx",
            "movements": [
                {"source_row": 6, "date": None, "date_raw": "",
                 "kind": "debt", "person": "A", "amount": "114000.00",
                 "description": "FRIGENIO MOEIRA - CRÉDITO REFERENTE A BONIFICAÇÃO %",
                 "original_type": "ENTRADA", "original_receiver": "FRIGENIO MOEIRA"},
                {"source_row": 8, "date": "2025-02-25", "date_raw": "25/02/2025",
                 "kind": "payment", "person": "A", "amount": "4000.00",
                 "description": "DESTINATÁRIO NÃO INFORMADO - SEM MOTIVO DESCRITO",
                 "original_type": "SAÍDA", "original_receiver": ""},
                {"source_row": 78, "date": None, "date_raw": "13/05/1900",
                 "kind": "payment", "person": "A", "amount": "134.90",
                 "description": "FRIGENIO MOEIRA - COMPRA DE CIGARRO",
                 "original_type": "SAÍDA", "original_receiver": "FRIGENIO MOEIRA"},
            ],
            "records": [
                {"source_row": 7, "date": "2025-02-05", "date_raw": "2025-02-05",
                 "amount": "3000.00", "from_name": "JONAS",
                 "to_name": "FRIGENIO MOEIRA", "description": "SALÁRIO",
                 "original_type": "SALÁRIO", "notes": "Registro neutro"},
            ],
        }

    @staticmethod
    def correction(preview, payload):
        return {"payload": payload, "batch_id": preview["batch_id"],
                "corrected_dates": {"6": "2025-02-01", "78": "2025-05-13"}}

    def test_preview_and_atomic_import_preserves_salary(self):
        payload = self.sample()
        with app.db() as con:
            preview = importer.preview(con, self.cid, payload)
            self.assertEqual(preview["count"], 4)
            self.assertEqual(preview["new_count"], 4)
            self.assertEqual(preview["debt_count"], 1)
            self.assertEqual(preview["payment_count"], 2)
            self.assertEqual(preview["record_count"], 1)
            self.assertEqual(preview["neutral_total"], "3000.00")
            self.assertEqual(len(preview["missing_dates"]), 2)
            self.assertEqual(pair.summary(con, self.cid)["totals"]["balance"], "0.00")
            with self.assertRaisesRegex(ValueError, "Informe a data"):
                importer.confirm(con, self.cid,
                                 {"payload": payload, "batch_id": preview["batch_id"]})
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pair_entries").fetchone()[0], 0)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pair_records").fetchone()[0], 0)
            result = importer.confirm(con, self.cid, self.correction(preview, payload))
            self.assertEqual(result["inserted"], 4)
            self.assertEqual(result["inserted_financial"], 3)
            self.assertEqual(result["inserted_neutral"], 1)
            summary = pair.summary(con, self.cid)
            self.assertEqual(summary["totals"]["a_to_b"], "114000.00")
            self.assertEqual(summary["totals"]["payments_a_to_b"], "4134.90")
            self.assertEqual(summary["totals"]["balance"], "-109865.10")
            self.assertEqual(summary["totals"]["closures"], 0)
            self.assertEqual(pair_records.get(con, self.cid)[0]["amount"], "3000.00")
        with app.db() as con:
            p2 = importer.preview(con, self.cid, payload)
            self.assertEqual(p2["new_count"], 0)
            again = importer.confirm(con, self.cid, self.correction(p2, payload))
            self.assertEqual(again["inserted"], 0)

    def test_both_parts_roll_back_when_record_insert_fails(self):
        payload = self.sample()
        with app.db() as con:
            preview = importer.preview(con, self.cid, payload)
            con.executescript("""
                CREATE TRIGGER stop_neutral BEFORE INSERT ON pair_records
                BEGIN SELECT RAISE(ABORT,'failure inserting neutral'); END;
            """)
            with self.assertRaisesRegex(Exception, "failure inserting neutral"):
                importer.confirm(con, self.cid, self.correction(preview, payload))
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pair_entries").fetchone()[0], 0)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pair_financial_import_rows").fetchone()[0], 0)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pair_records").fetchone()[0], 0)

    def test_duplicate_source_row_blocks_both_groups(self):
        payload = self.sample()
        payload["records"][0]["source_row"] = 6
        with app.db() as con:
            with self.assertRaisesRegex(ValueError, "duplicadas"):
                importer.preview(con, self.cid, payload)


if __name__ == "__main__":
    unittest.main()
