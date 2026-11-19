"""Testes isolados: não exigem VPS, R2 ou dados financeiros reais."""
import sqlite3
import tempfile
import unittest
from pathlib import Path

from central_admin.core import (
    SourceUnavailable, access_key, account_invoice_number, matches,
    read_accounts, summarize_accounts, supplier_key, unique_invoices
)


class CentralAdminTests(unittest.TestCase):
    def test_identificacao_conservadora(self):
        self.assertEqual(supplier_key(" AGRÈX S/A "), "agrex s a")
        self.assertEqual(account_invoice_number("NF-e 002402"), "2402")
        self.assertIsNone(account_invoice_number("BOLETO 2402"))
        self.assertEqual(access_key("Chave " + "1"*44), "1"*44)

    def test_uma_nota_multiplos_itens(self):
        rows = [
            {"id": 5, "access_key": "1"*44, "invoice_number": "2402",
             "supplier": "Agrex", "order_number": "A"},
            {"id": 4, "access_key": "1"*44, "invoice_number": "2402",
             "supplier": "Agrex", "order_number": "A"},
        ]
        self.assertEqual(len(unique_invoices(rows)), 1)

    def test_vinculo_so_exato_e_nao_automatico(self):
        invoices = [{"receipt_id": 5, "access_key": "1"*44,
                     "invoice_number": "2402", "supplier": "Agrex",
                     "order_number": "A"}]
        account = {"id": 9, "fornecedor": "Agrèx", "documento": "NF-e 002402",
                   "referencia": "", "paga": 0}
        result = matches([account], invoices)
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]["review_required"])
        self.assertEqual(matches([{**account, "paga": 1}], invoices), [])
        self.assertEqual(matches([{**account, "fornecedor": "Outro"}], invoices), [])

    def test_ambiguidade_nao_vincula(self):
        one = {"receipt_id": 1, "access_key": "", "invoice_number": "2402",
               "supplier": "Agrex", "order_number": "A"}
        account = {"id": 1, "fornecedor": "Agrex", "documento": "NF 2402",
                   "referencia": "", "paga": 0}
        self.assertEqual(matches([account], [one, {**one, "receipt_id": 2}]), [])

    def test_contas_sqlite_estritamente_leitura(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "contas.db"
            with sqlite3.connect(path) as conn:
                conn.executescript("""
                    CREATE TABLE contas (id INTEGER, fornecedor TEXT,
                      documento TEXT, referencia TEXT, valor TEXT, vencimento TEXT);
                    CREATE TABLE pagamentos (id INTEGER, conta_id INTEGER, data_pagamento TEXT);
                    INSERT INTO contas VALUES
                      (1,'Agrex','NF 2402','','150.00','2020-01-01'),
                      (2,'Outro','NF 3','','50.00','2040-01-01');
                    INSERT INTO pagamentos VALUES (1,2,'2026-11-19');
                """)
            accounts = read_accounts(path)
            self.assertEqual([row["paga"] for row in accounts], [0, 1])
            report = summarize_accounts(accounts)
            self.assertEqual(report["em_aberto"], 1)
            self.assertEqual(report["valor_em_aberto"], "150.00")
            with sqlite3.connect(path) as conn:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM contas").fetchone()[0], 2)

    def test_sem_base_nao_significa_zero(self):
        with self.assertRaises(SourceUnavailable):
            read_accounts("/diretorio/inexistente/contas.db")


if __name__ == "__main__":
    unittest.main()
