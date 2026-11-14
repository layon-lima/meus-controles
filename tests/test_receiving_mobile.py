"""Mobile iOS: somente fornecedores com produtos, recebido e saldo por item."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/"static/index.html").read_text(encoding="utf-8")
JS=(ROOT/"static/receiving_mobile.js").read_text(encoding="utf-8")
CSS=(ROOT/"static/receiving_mobile.css").read_text(encoding="utf-8")
APP=(ROOT/"static/app.js").read_text(encoding="utf-8")
SW=(ROOT/"static/sw.js").read_text(encoding="utf-8")
SERVER=(ROOT/"app.py").read_text(encoding="utf-8")
PWA=(ROOT/"static/pwa.js").read_text(encoding="utf-8")

class ReceivingMobileTests(unittest.TestCase):
    def test_mobile_exclusive_and_desktop_unchanged(self):
        self.assertIn('id="mobileReceiving"',HTML)
        self.assertIn('@media (max-width:820px), (hover:none) and (pointer:coarse)',CSS)
        self.assertIn('.app-shell,#modalRoot,#toastRoot{display:none!important}',CSS)
        self.assertIn('#mobileReceiving{display:none}',CSS)
        self.assertIn('if(!window.matchMedia("(max-width: 820px), (hover: none) and (pointer: coarse)").matches)',APP)
        self.assertIn('App.initNavigation();',APP)
        self.assertIn('App.load();',APP)

    def test_readonly_same_api_and_auto_refresh(self):
        self.assertIn('json("/api/state")',JS)
        self.assertIn('"/api/controls/"+encodeURIComponent(control.id)+"/receiving"',JS)
        self.assertIn('method:"GET",cache:"no-store"',JS)
        self.assertNotIn('method:"POST"',JS)
        self.assertNotIn('method:"PATCH"',JS)
        self.assertNotIn('method:"DELETE"',JS)
        self.assertNotIn('App.receivingReceiptForm(',JS)
        self.assertIn('window.setInterval',JS)
        self.assertIn('document.hidden',JS)
        self.assertIn('window.MobileReceiving={refresh,isMobile:true,groupsOf}',JS)
        self.assertIn('MobileReceiving.refresh()',PWA)

    def test_approved_simple_mobile_without_header_controls(self):
        mobile_html=HTML.split('<div id="mobileReceiving"',1)[1].split('<div id="modalRoot"',1)[0]
        self.assertIn('MEUS CONTROLES',mobile_html)
        self.assertIn('id="mobileReceivingList"',mobile_html)
        self.assertNotIn('id="mobileReceivingRefresh"',mobile_html)
        self.assertNotIn('id="mobileReceivingSearch"',mobile_html)
        self.assertNotIn('mr-stats',mobile_html)
        self.assertNotIn('mr-filters',mobile_html)
        self.assertNotIn('mr-title',mobile_html)
        self.assertNotIn('mr-section-title',mobile_html)
        self.assertNotIn('App.',mobile_html)

    def test_supplier_collapsible_but_no_orders_icons_or_counters(self):
        self.assertIn('function groupsOf(items)',JS)
        self.assertIn('state.closed',JS)
        self.assertIn('data-supplier=',JS)
        self.assertIn('aria-expanded=',JS)
        self.assertIn('group.items.map(renderProduct)',JS)
        self.assertNotIn('function renderOrders(',JS)
        self.assertNotIn('data-order=',JS)
        self.assertNotIn('mr-supplier-icon',JS)
        self.assertNotIn('mr-chevron',JS)
        self.assertNotIn('mr-supplier-right',JS)
        self.assertNotIn('mr-progress',JS)
        self.assertNotIn('notesFor(',JS)
        self.assertNotIn('data-filter=',JS)

    def test_product_cards_only_show_received_and_remaining(self):
        self.assertIn('item.received_qty',JS)
        self.assertIn('item.remaining_qty',JS)
        self.assertIn('mr-value-received',JS)
        self.assertIn('mr-value-remaining',JS)
        self.assertIn('Falta receber',JS)
        self.assertNotIn('>Pedido</span>',JS)
        self.assertIn('.mr-product-title',CSS)
        self.assertIn('.mr-product-values',CSS)
        self.assertIn('.mr-supplier-products',CSS)
        self.assertNotIn('.mr-numbers',CSS)

    def test_pwa_precaches_mobile_assets(self):
        version="20261113-mobile-ios-cards-v2"
        for asset in ("receiving_mobile.js","receiving_mobile.css"):
            name="/static/"+asset+"?v="+version
            self.assertIn(name,HTML)
            self.assertIn(name,SW)
            self.assertIn('url=="/static/'+asset+'"',SERVER)
        self.assertIn('central-de-controles-shell-v20261114-acerto-export-xlsx-v1',SW)
        self.assertIn('url.pathname.startsWith("/api/")',SW)

if __name__=="__main__":
    unittest.main()
