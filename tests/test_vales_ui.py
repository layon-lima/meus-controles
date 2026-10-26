"""UI de vales: cada parcela deve aparecer individualmente na grade Excel."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
JS=(ROOT/"static"/"vales.js").read_text(encoding="utf-8")
CSS=(ROOT/"static"/"vales.css").read_text(encoding="utf-8")
HTML=(ROOT/"static"/"index.html").read_text(encoding="utf-8")
SW=(ROOT/"static"/"sw.js").read_text(encoding="utf-8")


class ValesSpreadsheetUITests(unittest.TestCase):
    def test_main_view_has_separate_tabs_and_no_stat_cards(self):
        self.assertIn("Lançamentos</button>",JS)
        self.assertIn("Totais por funcionário</button>",JS)
        self.assertIn("valesSwitchTab(tab)",JS)
        self.assertNotIn("vf-stats",JS)
        self.assertIn("vf-ledger-table",JS)
        self.assertIn("vf-summary-table",JS)

    def test_each_installment_becomes_an_independent_ledger_row(self):
        self.assertIn("emp.debts.flatMap(d=>d.installments.map(i=>({",JS)
        self.assertIn("launchDate:d.created_at",JS)
        self.assertIn("Data do lançamento",JS)
        self.assertIn("Descrição</th>",JS)
        self.assertIn("Valor</th>",JS)
        self.assertIn("Para quem foi</th>",JS)
        self.assertIn("Quando descontar</th>",JS)
        self.assertIn("vfEntryDate(i.launchDate)",JS)
        self.assertIn("vfMonth(i.due_month)",JS)
        self.assertIn("Parcela \"+i.installment_number+\"/\"+i.numberOfInstallments",JS)
        self.assertIn("i.status",JS)
        self.assertIn("App.valesPaymentForm(",JS)

    def test_employee_filter_works_on_ledger_totals_and_history(self):
        self.assertIn("valesSelectEmployee(value)",JS)
        self.assertIn('String(i.employeeId)===selected',JS)
        self.assertIn('String(emp.id)===selected',JS)
        self.assertIn("selectedEmployee?this.s.valesPaymentHistory.filter",JS)

    def test_per_employee_totals_keep_management_actions(self):
        for label in ("Total emprestado","Total descontado","Em aberto","Detalhes"):
            self.assertIn(label,JS)
        for action in ("valesSetActive(","valesDebtForm(","valesSettleForm(",
                       "valesDebtTitleForm(","valesDeleteDebt("):
            self.assertIn(action,JS)
        self.assertIn("valesNewDebt(){",JS)
        self.assertIn("valesEmployeeForm(){",JS)

    def test_full_width_excel_layout_and_small_screen_without_horizontal_scroll(self):
        self.assertIn(".vf-ledger-table",CSS)
        self.assertIn(".vf-summary-table",CSS)
        self.assertIn("table-layout:fixed",CSS)
        self.assertIn("@media(max-width:720px)",CSS)
        self.assertIn("content:attr(data-label)",CSS)
        self.assertNotIn("min-width:530px",CSS)

    def test_pwa_cache_bust_matches_frontend_release(self):
        for asset in ("vales.js","vales.css"):
            version="/static/"+asset+"?v=20261026-vales-v3"
            self.assertIn(version,HTML)
            self.assertIn(version,SW)
        self.assertIn("central-de-controles-shell-v20261026-vales-v3",SW)


if __name__=="__main__":
    unittest.main()
