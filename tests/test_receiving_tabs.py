"""Recebimento: pedidos e notas em subabas separadas, sem resumos duplicados."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
JS=(ROOT/"static"/"receiving.js").read_text(encoding="utf-8")
CSS=(ROOT/"static"/"receiving.css").read_text(encoding="utf-8")
HTML=(ROOT/"static"/"index.html").read_text(encoding="utf-8")
SW=(ROOT/"static"/"sw.js").read_text(encoding="utf-8")


class ReceivingSubtabsTests(unittest.TestCase):
    def test_orders_and_receipts_have_dedicated_tabs(self):
        self.assertIn('role="tablist"',JS)
        self.assertIn('App.receivingSwitchTab(&quot;pedidos&quot;)',JS)
        self.assertIn('App.receivingSwitchTab(&quot;notas&quot;)',JS)
        self.assertIn('activeTab==="pedidos"?',JS)
        self.assertIn("receiving-orders",JS)
        self.assertIn("receiving-invoices",JS)
        self.assertIn("Histórico de notas fiscais",JS)
        self.assertIn("Chave da NF-e",JS)
        self.assertNotIn("<th>Ações</th>",JS)
        self.assertIn('aria-selected=',JS)
        self.assertIn('receivingSwitchTab(tab){',JS)

    def test_history_can_still_edit_and_delete_a_receipt(self):
        self.assertIn('ondblclick="App.receivingManageReceipt(',JS)
        self.assertIn('ondblclick="App.receivingManageItem(',JS)
        self.assertIn('receivingManageReceiptAction(action)',JS)
        self.assertIn('receivingManageAction(action)',JS)
        self.assertIn('this.receivingReceiptForm(receipt.item_id,id)',JS)
        self.assertIn('this.receivingDeleteReceipt(id)',JS)
        self.assertIn('Nº nota fiscal',JS)
        self.assertIn("t.receipts?",JS)
        self.assertIn('Ainda não existem recebimentos lançados.',JS)

    def test_top_summary_cards_are_removed_from_rendered_module(self):
        self.assertNotIn('receiving-kpis',JS)
        self.assertNotIn('Produtos cadastrados',JS)
        self.assertNotIn('Totalmente recebidos',JS)
        self.assertNotIn('Entregas registradas',JS)

    def test_filters_are_independent_and_selection_only_on_orders(self):
        self.assertIn('queries:{pedidos:"",notas:""}',JS)
        self.assertIn("this.s.receivingSearch.queries?.[activeTab]",JS)
        self.assertIn('this.s.receivingSearch={controlId,queries};',JS)
        self.assertIn('activeTab==="pedidos"?',JS)
        self.assertIn("receivingBulkDeleteBtn",JS)
        self.assertIn("receivingApplyFilter(savedSearch)",JS)
        self.assertIn("receivingFloatingAdd(){",JS)
        self.assertIn("receivingChooseReceiptProduct(){",JS)
        self.assertIn("receivingPickReceiptProduct(){",JS)
        self.assertIn("receivingFocusItem(id)",JS)
        self.assertIn('class="receiving-search-band"',JS)
        self.assertIn('class="receiving-fab"',JS)

    def test_tabs_are_compact_and_non_scrolling(self):
        self.assertIn(".receiving-tabs",CSS)
        self.assertIn(".receiving-tabs button.active",CSS)
        self.assertIn('max-width:100%;min-width:0',CSS)

    def test_pwa_precaches_fresh_versions(self):
        for asset in ("receiving.js","receiving.css"):
            version="/static/"+asset+"?v=20261026-recebimento-flutuante-v8"
            self.assertIn(version,HTML)
            self.assertIn(version,SW)
        self.assertIn('central-de-controles-shell-v20261026-recebimento-flutuante-v8',SW)


if __name__=="__main__":
    unittest.main()
