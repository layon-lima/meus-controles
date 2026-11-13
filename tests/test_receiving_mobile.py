"""Tela mobile exclusiva de acompanhamento: separação do desktop e consulta somente leitura."""
from pathlib import Path
import re
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
    def test_mobile_uses_same_url_and_hides_desktop(self):
        self.assertIn('id="mobileReceiving"',HTML)
        self.assertIn("@media (max-width:820px)",CSS)
        self.assertIn('.app-shell,#modalRoot,#toastRoot{display:none!important}',CSS)
        self.assertIn('#mobileReceiving{display:none}',CSS)
        self.assertIn('if(!window.matchMedia("(max-width: 820px)").matches)',APP)
        self.assertIn('App.initNavigation();',APP)
        self.assertIn('App.load();',APP)

    def test_readonly_uses_existing_server_receiving_data(self):
        self.assertIn('json("/api/state")',JS)
        self.assertIn('"/api/controls/"+encodeURIComponent(control.id)+"/receiving"',JS)
        self.assertIn('method:"GET",cache:"no-store"',JS)
        self.assertNotIn('method:"POST"',JS)
        self.assertNotIn('method:"PATCH"',JS)
        self.assertNotIn('method:"DELETE"',JS)
        self.assertNotIn('App.receivingReceiptForm(',JS)
        mobile_html=HTML.split('<div id="mobileReceiving"',1)[1].split('<div id="modalRoot"',1)[0]
        self.assertNotIn("App.",mobile_html)
        self.assertNotIn('type="submit"',mobile_html)
        self.assertIn('id="mobileReceivingRefresh"',mobile_html)

    def test_groups_filters_progress_and_invoices(self):
        for part in ("groupsOf(items)","state.collapsed","state.openOrders",
                     "state.openNotes","[data-supplier]","[data-order]",
                     "notesFor(item)","aria-valuenow=",
                     "state.filter","data-filter","state.query"):
            self.assertIn(part,JS)
        self.assertIn("window.setInterval",JS)
        self.assertIn('document.hidden',JS)
        self.assertIn("received_qty",JS)
        self.assertIn("remaining_qty",JS)
        self.assertIn("invoice_number",JS)

    def test_pwa_precaches_mobile_assets(self):
        version="20261113-mobile-recebimentos-v1"
        for asset in ("receiving_mobile.js","receiving_mobile.css"):
            name="/static/"+asset+"?v="+version
            self.assertIn(name,HTML)
            self.assertIn(name,SW)
            self.assertIn('url=="/static/'+asset+'"',SERVER)
        self.assertIn('central-de-controles-shell-v20261113-recebimentos-mobile-v1',SW)
        self.assertIn('url.pathname.startsWith("/api/")',SW)
        self.assertIn("MobileReceiving.refresh()",PWA)

if __name__=="__main__":
    unittest.main()
