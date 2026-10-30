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

    def test_spreadsheet_has_visible_row_and_column_borders(self):
        # Não basta border-bottom: a grade precisa de linhas verticais também.
        self.assertIn("border-collapse:collapse;border:1px solid #c7d2db",CSS)
        self.assertIn(".vf-ledger-table :is(td,th),.vf-summary-table :is(td,th){padding:8px 9px;border:1px solid #c7d2db",CSS)
        self.assertIn(".vf-month-grid :is(th,td){border:1px solid #c7d2db",CSS)
        self.assertNotIn("tbody tr:last-child td{border-bottom:0}",CSS)
        self.assertIn(".vf-ledger-table :is(td,th),.vf-summary-table :is(td,th){display:block;border:1px solid #c7d2db",CSS)

    def test_new_advance_form_only_asks_title_total_month_and_count(self):
        form=JS[JS.index("  valesDebtForm(employeeId,debtId=null){"):
                JS.index("  valesDebtTitleForm(id){")]
        self.assertIn('Título da dívida *',form)
        self.assertIn('Valor total (R$)',form)
        self.assertIn('Primeiro desconto (mês/ano)',form)
        self.assertIn('Quantidade de parcelas',form)
        self.assertNotIn('Descrição (opcional)',form)
        self.assertNotIn('Observações (opcional)',form)
        self.assertNotIn('Valor desejado por parcela',form)
        self.assertIn("const vfRedistribute=",JS)
        self.assertIn('if(!adjusted)',form)

    def test_one_installment_is_automatically_the_whole_advance(self):
        form=JS[JS.index("  valesShowPlan(plan){"):
                JS.index("  valesEditPlan(index,key,raw){")]
        self.assertIn("const single=plan.length===1;",form)
        self.assertIn("vf-single-amount",form)
        self.assertIn("single?",form)
        self.assertIn("vfMoney(p.amount)",form)

    def test_edits_lock_manual_amounts_and_allocate_remaining_cents(self):
        self.assertIn('const vfRedistribute=(total,plan,editedIndex,editedCents)=>',JS)
        self.assertIn('locked:true',JS)
        self.assertIn('const free=next.filter(p=>!p.locked)',JS)
        self.assertIn('const amounts=vfSplitCents(total-held,free.length)',JS)
        self.assertIn("total-held<free.length",JS)
        self.assertIn('const edited=vfToCents(raw)',JS)
        self.assertIn('this.valesShowPlan(adjusted)',JS)
        self.assertIn('amount:vfFromCents(total)',JS)
        self.assertIn('ctx.plan.some((p,i)=>i>0&&p.month<=ctx.plan[i-1].month)',JS)

    def test_title_only_edit_keeps_legacy_descriptions(self):
        form=JS[JS.index('  valesDebtTitleForm(id){'):
                JS.index('  valesPaymentForm(id){')]
        self.assertIn('Título *',form)
        self.assertNotIn('vfField("Descrição (opcional)"',form)
        self.assertIn('{title:fd.get("title")}',form)

    def test_totals_only_show_employees_with_unpaid_advances(self):
        self.assertIn("const withOpenBalance=all.filter(emp=>Number(emp.remaining)>0);",JS)
        self.assertIn('const visibleTotals=withOpenBalance.filter(emp=>selected==="all"||String(emp.id)===selected);',JS)
        self.assertIn("const totalsRows=visibleTotals.map(emp=>",JS)
        self.assertIn("Nenhum funcionário com vales em aberto.",JS)
        self.assertIn("funcionário(s) com saldo em aberto",JS)
        # Os lançamentos pagos continuam acessíveis no histórico.
        self.assertIn("const entries=all.flatMap(",JS)
        self.assertIn("valesDebtTitleForm('+i.debtId+')",JS)

    def test_pwa_cache_bust_matches_frontend_release(self):
        for asset in ("vales.js","vales.css"):
            version="/static/"+asset+"?v="+("20261026-vales-v5" if asset=="vales.js" else "20261026-vales-v6")
            self.assertIn(version,HTML)
            self.assertIn(version,SW)
        self.assertIn("central-de-controles-shell-v20261030-vale-comissao-v19",SW)


if __name__=="__main__":
    unittest.main()
