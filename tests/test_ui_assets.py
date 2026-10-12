"""Garantias de interface compacta e iconografia vetorial local."""
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"

class LayoutAssetsTests(unittest.TestCase):
    def test_home_has_no_bloated_intro(self):
        source = (STATIC / "app.js").read_text(encoding="utf-8")
        home = source.split('if(this.s.route==="home"){', 1)[1].split('} else if(this.s.route==="board"){', 1)[0]
        self.assertNotIn("PAINEL DE GESTÃO", home)
        self.assertNotIn("stat-grid", home)
        self.assertIn("Seus quadros", home)
        self.assertNotIn('class="control-grid"', home)
        self.assertNotIn('controlCard)', home)
        self.assertNotIn('<h2>Controles</h2>', home)

    def test_no_sidebar_create_control_button(self):
        markup = (STATIC / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("sidebar-new", markup)
        self.assertIn('class="sidebar-version"', markup)
        self.assertIn('onclick="App.newControl()"', markup)

    def test_new_board_is_visible_and_uses_own_form(self):
        app=(STATIC / "app.js").read_text(encoding="utf-8")
        markup=(STATIC / "index.html").read_text(encoding="utf-8")
        css=(STATIC / "app.css").read_text(encoding="utf-8")
        self.assertIn('class="sidebar-create-board"', markup)
        self.assertIn('Novo quadro</button>', markup)
        self.assertIn('boards-home-heading', app)
        self.assertIn('onclick="App.newBoard()"', app)
        self.assertIn('this.s.modal="new-board"', app)
        self.assertIn('id="newBoardForm"', app)
        self.assertIn('name="name"', app)
        self.assertIn('aria-modal="false"', app)
        self.assertIn('async saveNewBoard()', app)
        self.assertIn('"/api/boards","POST",{name}', app)
        self.assertIn('Já existe um quadro com esse nome.', app)
        self.assertNotIn('prompt("Nome do novo quadro:")', app)
        self.assertIn('.sidebar-create-board', css)

    def test_universal_search_interface(self):
        app=(STATIC / "app.js").read_text(encoding="utf-8")
        markup=(STATIC / "index.html").read_text(encoding="utf-8")
        self.assertIn("function parseSearchQuery(raw)", app)
        self.assertIn('isBoard?"board":"control"', app)
        self.assertIn('data.boards.filter(', app)
        self.assertIn('data.controls.filter(', app)
        self.assertIn('id="searchResults"', markup)
        self.assertIn('oninput="App.search(this.value)"', markup)
        self.assertIn("Q quadro", markup)
        self.assertNotIn('oninput="App.search(this.value)"', (STATIC / "icons.svg").read_text(encoding="utf-8"))
        self.assertIn("search-results", (STATIC / "app.css").read_text(encoding="utf-8"))

    def test_board_compact_and_card_action_menu(self):
        app=(STATIC / "app.js").read_text(encoding="utf-8")
        board=app.split('} else if(this.s.route==="board"){',1)[1].split('} else if(this.s.route==="control"',1)[0]
        self.assertNotIn("QUADRO DE CONTROLES",board)
        self.assertNotIn('class="stat-grid"',board)
        self.assertIn("board-controls-heading",board)
        self.assertIn("control-card-edit",app)
        self.assertIn("card-action-menu",app)
        for action in ("configure","duplicate","delete"):
            self.assertIn('action==="'+action+'"',app)
        self.assertIn('const source=this.s.state?.controls?.find',app)

    def test_forms_do_not_close_on_outside_click_or_block_app(self):
        app=(STATIC / "app.js").read_text(encoding="utf-8")
        css=(STATIC / "app.css").read_text(encoding="utf-8")
        self.assertIn('aria-modal="false"',app)
        self.assertNotIn('getElementById("backdrop").addEventListener',app)
        self.assertIn('pointer-events:none',css)
        self.assertIn('pointer-events:auto',css)
        self.assertIn("modalContext",app)
        self.assertIn("this.s.modalContext?.control",app)

    def test_truck_primary_tab_is_compact_and_detailed_tab_is_separate(self):
        source = (STATIC / "truck.js").read_text(encoding="utf-8")
        css = (STATIC / "truck.css").read_text(encoding="utf-8")
        assert 'truckSetTab(tab)' in source
        assert 'this.s.truckTab="entries"' in source
        self.assertIn("Entradas do período", source)
        self.assertIn("Saídas do período", source)
        self.assertIn("truck-fast-summary", source)
        self.assertIn("truck-entries-view", source)
        self.assertIn("truck-details-view", source)
        self.assertIn("Todos os lançamentos", source)
        self.assertIn("<h3>FRETES</h3>", source)
        self.assertIn("<h3>COMISSÃO MOTORISTA</h3>", source)
        self.assertIn("truck-fast-total", css)
        self.assertIn("<h3>GASTOS</h3>", source)
        self.assertIn("truck-detail-freights", source)
        self.assertIn("truck-detail-expenses", source)
        self.assertIn("truck-detail-commission", source)
        self.assertNotIn("truck-kpis", source)
        self.assertIn(".truck-detail-cards .truck-detail-header", css)
        self.assertIn('aria-selected=', source)

    def test_truck_expense_categories_are_fixed_and_configurable(self):
        truck = (STATIC / "truck.js").read_text(encoding="utf-8")
        css = (STATIC / "truck.css").read_text(encoding="utf-8")
        self.assertNotIn('<datalist', truck)
        self.assertIn('role="combobox"', truck)
        self.assertIn('role="listbox"', truck)
        self.assertIn('Mostrar todas as categorias', truck)
        self.assertIn('truckCategoryRender(showAll=false)', truck)
        self.assertIn('truckCategoryInput(input)', truck)
        self.assertIn('truckCategoryToggle()', truck)
        self.assertIn('truckCategoryPick(index)', truck)
        self.assertIn('truckCategoryKeydown(event)', truck)
        self.assertIn('onpointerdown="event.preventDefault()"', truck)
        self.assertIn('this.truckValidateExpenseCategory(category,true)', truck)
        self.assertIn('ctx.settings.categories||TRUCK_EXPENSES', truck)
        self.assertIn('truckAddCategory()', truck)
        self.assertIn('truckEditCategory(index,value)', truck)
        self.assertIn('truckRemoveCategory(index)', truck)
        self.assertIn('category_renames:renames', truck)
        self.assertIn('Categorias de despesa', truck)
        self.assertIn('truck-category-settings', css)
        self.assertIn('.truck-expense-options', css)
        self.assertIn('.truck-expense-option:hover', css)

    def test_chave_errada_has_conference_and_closing_tabs(self):
        truck=(STATIC / "truck.js").read_text(encoding="utf-8")
        workflow=(STATIC / "truck_workflow.js").read_text(encoding="utf-8")
        css=(STATIC / "truck_workflow.css").read_text(encoding="utf-8")
        html=(STATIC / "index.html").read_text(encoding="utf-8")
        self.assertIn('tab("checks","Conferência")', truck)
        self.assertIn('tab("closures","Fechamentos")', truck)
        self.assertIn('this.truckReviewMarkup()',truck)
        self.assertIn('this.truckCloseMarkup()',truck)
        self.assertIn('Capítulo atual',truck)
        self.assertIn('truckEntryStatus(x.event_date)',truck)
        self.assertIn('truckConfirmReview()', workflow)
        self.assertIn('truckConfirmClose()',workflow)
        self.assertIn('truckReopenReview(',workflow)
        self.assertIn('data-review-id=',workflow)
        self.assertIn('.truck-workflow-metrics',css)
        self.assertIn('/static/truck_workflow.js',html)

    def test_debt_is_a_ready_made_simple_control(self):
        app=(STATIC / "app.js").read_text(encoding="utf-8")
        debt=(STATIC / "debt.js").read_text(encoding="utf-8")
        css=(STATIC / "debt.css").read_text(encoding="utf-8")
        page=(STATIC / "index.html").read_text(encoding="utf-8")
        self.assertIn('Controle de Dívidas', app)
        self.assertIn('debt_settings:mode==="divida"', app)
        self.assertIn('return this.renderDebt()', app)
        self.assertIn('return this.debtSettings(id)', app)
        for fragment in ("Dívida inicial", "Total pago", "Saldo restante",
                         "Histórico de pagamentos", "Descrição do pagamento",
                         "Pagamento registrado", "debtSavePayment",
                         "debtDeletePayment", "debtSaveSettings"):
            self.assertIn(fragment, debt)
        self.assertIn('maxlength="200"', debt)
        self.assertIn('name="description"', debt)
        self.assertIn('role="dialog" aria-modal="false"', debt)
        self.assertIn('.debt-summary', css)
        self.assertIn('/static/debt.js', page)
        self.assertIn('/static/debt.css', page)

    def test_icons_are_real_svg_symbols(self):
        tree = ET.parse(STATIC / "icons.svg")
        elements = tree.findall("{http://www.w3.org/2000/svg}symbol")
        names = {el.get("id") for el in elements}
        for name in ("dashboard", "folder", "truck", "plus",
                     "search", "arrow-right", "settings", "download", "logo"):
            self.assertIn(name, names)
        for symbol in elements:
            self.assertGreater(len(list(symbol)), 0)
        app = (STATIC / "app.js").read_text(encoding="utf-8")
        self.assertIn("/static/icons.svg#", app)

if __name__ == "__main__":
    unittest.main()
