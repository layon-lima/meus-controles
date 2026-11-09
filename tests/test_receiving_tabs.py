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

    def test_invoice_list_displays_xml_issuer_and_offers_legacy_restore(self):
        xml=(ROOT/"static"/"receiving_xml.js").read_text(encoding="utf-8")
        app=(ROOT/"app.py").read_text(encoding="utf-8")
        self.assertIn('E(p.invoice_issuer||"Emitente não registrado")',JS)
        self.assertIn('p.invoice_issuer_document||"Emitente não salvo na nota"',JS)
        self.assertIn("App.receivingXMLRestoreIssuers()",JS)
        self.assertIn('id="receivingXMLIssuerFiles"',JS)
        self.assertIn('onchange="App.receivingXMLRestoreFiles(this.files)"',JS)
        self.assertIn("receivingXMLRestoreFiles(files)",xml)
        self.assertIn('"/api/controls/"+cid+"/receiving/xml/issuer"',xml)
        self.assertIn("receiving/xml/(?:preview|confirm|issuer|pending",app)

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

    def test_xml_importer_is_served_by_backend(self):
        app_source=(ROOT/"app.py").read_text(encoding="utf-8")
        self.assertIn('url=="/static/receiving_xml.js"',app_source)
        self.assertIn('(ROOT/"static"/"receiving_xml.js").read_bytes()',app_source)
        self.assertIn('receivingXMLLoad', (ROOT/"static"/"receiving_xml.js").read_text(encoding="utf-8"))

    def test_xml_picker_supports_live_search_and_explicit_fuzzy_selection(self):
        script=(ROOT/"static"/"receiving_xml.js").read_text(encoding="utf-8")
        self.assertIn('id="receivingXMLSearch-',script)
        self.assertIn('type="search"',script)
        self.assertIn('role="combobox"',script)
        self.assertIn('role="listbox"',script)
        self.assertIn('oninput="App.receivingXMLSearch(',script)
        self.assertIn('receivingXMLKeydown(event,index)',script)
        self.assertIn('receivingXMLPick(index,value)',script)
        self.assertIn('ctx.selections[index]=Number(item.id)',script)
        self.assertIn('item.order_number??item.order??"Pedido sem número"',script)
        self.assertIn('if(item.selectable===false&&!needsManualConversion(index,item))',script)
        self.assertNotIn('class="receiving-xml-choice"',script)
        self.assertNotIn("x.order+' · '+x.supplier",script)
        self.assertIn('.receiving-xml-results',CSS)
        self.assertIn('.receiving-xml-search',CSS)

    def test_manual_conversion_form_for_xml_and_sem_pedido(self):
        script=(ROOT/"static"/"receiving_xml.js").read_text(encoding="utf-8")
        self.assertIn('id="receivingXMLManual-',script)
        self.assertIn('id="receivingXMLManualQty-',script)
        self.assertIn('renderManualConversion(index,item)',script)
        self.assertIn('ctx.manualQuantities[index]',script)
        self.assertIn('manual_quantities:[...ctx.manualQuantities]',script)
        self.assertIn('receivingXMLPendingUnitChanged()',script)
        self.assertIn('id="receivingXMLPendingManualQty"',script)
        self.assertIn('manual_quantity:manual',script)
        self.assertIn('if(item.selectable===false&&!needsManualConversion(index,item))',script)
        self.assertIn(".receiving-xml-manual[hidden]",CSS)

    def test_each_supplier_is_a_separate_collapsible_card(self):
        theme=(ROOT/"static"/"livro_caixa_theme.css").read_text(encoding="utf-8")
        self.assertIn('const cards=supplierGroups.map((group,index)=>',JS)
        self.assertIn('class="receiving-supplier-card',JS)
        self.assertIn('class="receiving-supplier-body"',JS)
        self.assertIn('receivingToggleSupplier(index){',JS)
        self.assertIn('body.hidden=isCollapsed;',JS)
        self.assertIn('receivingApplyFilter(query){',JS)
        self.assertIn('receiving-supplier-cards',JS)
        self.assertNotIn('const rows=supplierGroups.map(',JS)
        self.assertEqual(JS.count('id="receivingSelectAll"'),1)
        self.assertIn('.receiving-supplier-cards{',theme)
        self.assertIn('.receiving-supplier-card{',theme)
        self.assertIn('.receiving-supplier-body[hidden]{display:none!important}',theme)

    def test_manual_invoice_http_dispatch_and_draft_recovery(self):
        app_source=(ROOT/"app.py").read_text(encoding="utf-8")
        self.assertIn("items|bulk-delete|invoice",app_source)
        self.assertIn("receiving.handle(self,con,method,url)",app_source)
        self.assertIn("receivingManualInvoiceSaveDraft(){",JS)
        self.assertIn('sessionStorage.setItem("controles:nfe-manual:rascunho:"',JS)
        self.assertIn('sessionStorage.getItem(storageKey)',JS)
        self.assertIn('sessionStorage.removeItem("controles:nfe-manual:rascunho:"',JS)

    def test_pwa_precaches_fresh_versions(self):
        for asset,release in (("receiving.js","20261109-nfe-manual-rascunho-v3"),("receiving.css","20261109-nfe-manual-rascunho-v3")):
            version="/static/"+asset+"?v="+release
            self.assertIn(version,HTML)
            self.assertIn(version,SW)
        self.assertIn('central-de-controles-shell-v20261109-nfe-manual-rascunho-v3',SW)
        self.assertIn('/static/receiving_xml.js?v=20261104-xml-emitente-v21',HTML)
        self.assertIn('/static/receiving_xml.js?v=20261104-xml-emitente-v21',SW)
        self.assertIn('/static/livro_caixa_theme.css?v=20261109-nfe-manual-rascunho-v3',SW)
        self.assertIn('surface.ondrop=event=>',JS)
        self.assertIn('event.preventDefault();',JS)


if __name__=="__main__":
    unittest.main()
