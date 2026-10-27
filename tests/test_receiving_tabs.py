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

    def test_only_one_visible_search_markup_and_no_actions_column(self):
        # O formulário antigo não pode continuar escondido atrás da busca nova.
        self.assertEqual(JS.count('id="receivingSearch"'),1)
        self.assertEqual(JS.count('id="receivingSelectedCount"'),1)
        self.assertEqual(JS.count('id="receivingBulkDeleteBtn"'),1)
        self.assertIn('class="receiving-search-band"',JS)
        self.assertNotIn('Buscar nota, pedido, fornecedor ou produto...',JS)
        self.assertNotIn('<th>Ações</th>',JS)

    def test_receipt_picker_accepts_typing_and_click_selection(self):
        self.assertIn('id="receivingPickSearch"',JS)
        self.assertIn('type="search"',JS)
        self.assertIn('role="combobox"',JS)
        self.assertIn('aria-autocomplete="list"',JS)
        self.assertIn('id="receivingPickResults"',JS)
        self.assertIn('role="listbox"',JS)
        self.assertIn('onclick="App.receivingPickSelect(',JS)
        self.assertIn('oninput="App.receivingFilterPick(this.value)"',JS)
        self.assertIn('onkeydown="App.receivingPickKeydown(event)"',JS)
        self.assertIn('receivingPickShowAll(){',JS)
        self.assertIn('receivingPickReceiptProduct(){',JS)
        self.assertIn('picker.selectedId=id;',JS)
        self.assertIn('const terms=rxPickNormalize(query).split(" ").filter(Boolean)',JS)
        self.assertIn('normalize("NFD")',JS)
        self.assertIn('terms.every(term=>search.includes(term))',JS)
        self.assertIn('if(continueBtn)continueBtn.disabled=!valid;',JS)
        self.assertNotIn('id="receivingPickItem"',JS)

    def test_new_delivery_must_not_reuse_last_selected_product(self):
        floating=JS[JS.index("  receivingFloatingAdd(){"):
                    JS.index("  receivingChooseReceiptProduct(){")]
        self.assertIn("this.receivingChooseReceiptProduct();",floating)
        self.assertNotIn("this.receivingReceiptForm(focused.id)",floating)
        self.assertIn("this.s.receivingFocused={controlId:this.s.detail?.control?.id,itemId:null};",JS)
        self.assertIn('Trocar produto / pedido',JS)
        self.assertIn('receivingChangeReceiptProduct(){',JS)
        self.assertIn('this.s.receivingPick=null;',JS)

    def test_search_results_are_clickable_and_mobile_friendly(self):
        self.assertIn('.receiving-pick-input',CSS)
        self.assertIn('.receiving-pick-results',CSS)
        self.assertIn('.receiving-pick-option:hover',CSS)
        self.assertIn('overscroll-behavior:contain',CSS)
        self.assertIn('.receiving-pick-results[hidden]{display:none!important}',CSS)

    def test_tabs_are_compact_and_non_scrolling(self):
        self.assertIn(".receiving-tabs",CSS)
        self.assertIn(".receiving-tabs button.active",CSS)
        self.assertIn('max-width:100%;min-width:0',CSS)

    def test_completed_receiving_action_has_correct_api_signature(self):
        self.assertIn('Concluir recebimento',JS)
        self.assertIn('this.api("/api/receiving-items/"+id+"/complete","POST",{})',JS)
        self.assertIn('if(p.closed||!(Number(p.remaining_qty)>0))return false;',JS)
        self.assertIn('receiving-closed',JS)
        self.assertIn('receiving-status.closed',CSS)

    def test_pwa_precaches_fresh_versions(self):
        for asset in ("receiving.js","receiving.css"):
            version="/static/"+asset+"?v=20261027-xml-v15"
            self.assertIn(version,HTML)
            self.assertIn(version,SW)
        self.assertIn('central-de-controles-shell-v20261027-xml-v15',SW)
        self.assertIn('/static/receiving_xml.js?v=20261027-xml-v15',HTML)
        self.assertIn('/static/receiving_xml.js?v=20261027-xml-v15',SW)


if __name__=="__main__":
    unittest.main()
