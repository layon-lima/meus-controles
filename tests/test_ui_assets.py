"""Garantias de interface compacta e iconografia vetorial local."""
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"

class LayoutAssetsTests(unittest.TestCase):
    def test_standard_web_font_is_global_in_app_and_update_panel(self):
        app_css=(STATIC / "app.css").read_text(encoding="utf-8")
        panel=(ROOT / "controller" / "static" / "index.html").read_text(encoding="utf-8")
        self.assertIn("--app-font:Arial,Helvetica,sans-serif",app_css)
        self.assertIn("html,body,body *:not(svg):not(svg *)",app_css)
        self.assertIn("font-family:var(--app-font)!important",app_css)
        self.assertNotIn("font-family:Inter,Segoe UI,Arial,sans-serif",app_css)
        self.assertIn("font:14px/1.5 Arial,Helvetica,sans-serif",panel)
        self.assertIn("button,input,select,textarea{font-family:Arial,Helvetica,sans-serif}",panel)
        # Manter a logotipia vetorial e os logs tecnicos sem alterar os icones.
        self.assertIn(":not(svg):not(svg *)",app_css)
        self.assertIn("Consolas",panel)

    def test_browser_history_and_internal_navigation_buttons(self):
        source=(STATIC / "app.js").read_text(encoding="utf-8")
        page=(STATIC / "index.html").read_text(encoding="utf-8")
        styles=(STATIC / "app.css").read_text(encoding="utf-8")
        for token in ("initNavigation()", "navRouteFromUrl()", "navUrl(route,id)",
                      "history.pushState", "history.replaceState", '"popstate"',
                      "goBack()", "goForward()", "updateNavigationButtons()"):
            self.assertIn(token,source)
        self.assertIn('id="navBack"',page)
        self.assertIn('id="navForward"',page)
        self.assertIn('onclick="App.goBack()"',page)
        self.assertIn('onclick="App.goForward()"',page)
        self.assertIn('.page-nav-arrows',styles)
        self.assertIn('.page-nav-back .ui-icon',styles)
        self.assertIn('transform:rotate(180deg)',styles)
        self.assertIn("App.initNavigation();",source)

    def test_home_has_no_bloated_intro(self):
        source = (STATIC / "app.js").read_text(encoding="utf-8")
        home = source.split('if(this.s.route==="home"){', 1)[1].split('} else if(this.s.route==="board"){', 1)[0]
        self.assertNotIn("PAINEL DE GESTÃO", home)
        self.assertNotIn("stat-grid", home)
        self.assertIn("Suas pastas", home)
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
        self.assertIn('Nova pasta</button>', markup)
        self.assertIn('boards-home-heading', app)
        self.assertIn('onclick="App.newBoard()"', app)
        self.assertIn('this.s.modal="new-board"', app)
        self.assertIn('id="newBoardForm"', app)
        self.assertIn('name="name"', app)
        self.assertIn('aria-modal="false"', app)
        self.assertIn('async saveNewBoard()', app)
        self.assertIn('"/api/boards","POST",{name}', app)
        self.assertIn('Já existe uma pasta com esse nome.', app)
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
        self.assertIn("P pasta", markup)
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
        for action in ("configure","move","duplicate","delete"):
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

    def test_truck_category_counts_are_visible_only_in_chave_errada(self):
        ui=(STATIC / "truck.js").read_text(encoding="utf-8")
        style=(STATIC / "truck.css").read_text(encoding="utf-8")
        self.assertIn("truck-category-count",ui)
        self.assertIn("x.count",ui)
        self.assertIn("lançamento",ui)
        self.assertIn("lançamentos",ui)
        self.assertIn("enabled?'<small",ui)
        self.assertIn(".truck-detail-cards .truck-category-count",style)

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
        self.assertIn('debtInput("description"', debt)
        self.assertIn('role="dialog" aria-modal="false"', debt)
        self.assertIn('.debt-summary', css)
        self.assertIn('/static/debt.js', page)
        self.assertIn('/static/debt.css', page)

    def test_debt_import_from_local_json_preserves_month_precision(self):
        debt=(STATIC / "debt.js").read_text(encoding="utf-8")
        css=(STATIC / "debt.css").read_text(encoding="utf-8")
        self.assertIn('Importar pagamentos',debt)
        self.assertIn('debtReadImportFile(file)',debt)
        self.assertIn('debtRenderImportPreview()',debt)
        self.assertIn('debtConfirmImport()',debt)
        self.assertIn('debt/import/preview',debt)
        self.assertIn('debt/import/confirm',debt)
        self.assertIn('type="month" required',debt)
        self.assertIn('String(s).length===7',debt)
        self.assertIn('MM/AAAA',debt)
        self.assertIn('already_imported',debt)
        self.assertIn('.debt-import-facts',css)

    def test_receiving_products_ready_model_and_invoice_forms(self):
        appjs=(STATIC / "app.js").read_text(encoding="utf-8")
        rxjs=(STATIC / "receiving.js").read_text(encoding="utf-8")
        css=(STATIC / "receiving.css").read_text(encoding="utf-8")
        html=(STATIC / "index.html").read_text(encoding="utf-8")
        self.assertIn('Recebimento de Produtos',appjs)
        self.assertIn('mode==="recebimento"',appjs)
        self.assertIn('this.renderReceiving()',appjs)
        self.assertIn('this.receivingSettings(id)',appjs)
        self.assertIn('d.mode==="recebimento"',appjs)
        for piece in ("Número do pedido","Fornecedor","Produto","Quantidade contratada",
                      "Quantidade recebida","Número da nota fiscal","Falta receber",
                      "Histórico de notas fiscais","receivingSaveItem",
                      "receivingSaveReceipt","receivingDeleteReceipt"):
            self.assertIn(piece,rxjs)
        self.assertIn('role="dialog" aria-modal="false"',rxjs)
        self.assertIn('.receiving-kpis',css)
        self.assertIn('/static/receiving.js',html)
        self.assertIn('/static/receiving.css',html)

    def test_receiving_numeric_and_action_columns_align_to_headers(self):
        css=(STATIC / "receiving.css").read_text(encoding="utf-8")
        js=(STATIC / "receiving.js").read_text(encoding="utf-8")
        self.assertIn(".receiving-table table th.numeric,",css)
        self.assertIn(".receiving-table table td.numeric{",css)
        self.assertIn("text-align:right;",css)
        self.assertIn(".receiving-table table th:last-child,",css)
        self.assertIn(".receiving-table table td:last-child{",css)
        self.assertIn(".receiving-table table td:last-child .table-actions{",css)
        self.assertIn("justify-content:center;",css)
        # Pedido e NF usam o mesmo estilo, sem forçar larguras que gerem scroll.
        self.assertGreaterEqual(js.count('<th class="numeric">'),4)
        self.assertGreaterEqual(js.count('class="numeric"'),8)

    def test_receiving_search_survives_receipt_updates(self):
        js=(STATIC / "receiving.js").read_text(encoding="utf-8")
        self.assertIn('this.s.receivingSearch={controlId:id,query:""}',js)
        self.assertIn('this.s.receivingSearch={controlId,query:raw}',js)
        self.assertIn('id="receivingSearch"',js)
        self.assertIn("E(savedSearch)",js)
        self.assertIn("this.receivingApplyFilter(savedSearch)",js)
        self.assertIn("receivingApplyFilter(query)",js)
        self.assertIn('await this.load();this.toast("Recebimento salvo.',js)
        # Controle trocado: não reutilizar filtro de outro controle.
        self.assertIn('this.s.receivingSearch?.controlId!==id',js)

    def test_receiving_import_remains_in_settings_after_first_use(self):
        page=(STATIC / "index.html").read_text(encoding="utf-8")
        receiving=(STATIC / "receiving.js").read_text(encoding="utf-8")
        importer=(STATIC / "receiving_import.js").read_text(encoding="utf-8")
        stylesheet=(STATIC / "receiving_import.css").read_text(encoding="utf-8")
        self.assertIn('/static/receiving_import.js',page)
        self.assertIn('/static/receiving_import.css',page)
        self.assertIn('t.items===0',receiving)
        self.assertIn('receivingOpenImportFromSettings()',receiving)
        self.assertIn('id="receivingImportInput"',receiving)
        self.assertIn('receivingChooseImport()',importer)
        self.assertIn('receivingLoadImportFile(file)',importer)
        self.assertIn('receivingConfirmImport()',importer)
        self.assertIn('receiving/import/preview',importer)
        self.assertIn('receiving/import/confirm',importer)
        self.assertIn('0 (0%)',importer)
        self.assertIn('unknown_suppliers',importer)
        self.assertIn('.receiving-import-preview-list',stylesheet)

    def test_receiving_allows_future_identical_orders_with_explicit_new_batch(self):
        ui=(STATIC / "receiving_import.js").read_text(encoding="utf-8")
        items=(STATIC / "receiving.js").read_text(encoding="utf-8")
        css=(STATIC / "receiving_import.css").read_text(encoding="utf-8")
        self.assertIn('receivingApproveDuplicateBatch(checked)',ui)
        self.assertIn('allow_duplicates:!!ctx.allowDuplicates',ui)
        self.assertIn('repeat_batch:!!p.already_imported',ui)
        self.assertIn('confirmation_token:p.confirmation_token',ui)
        self.assertIn('novos pedidos/lote',ui)
        self.assertIn('Cadastrar novo lote com ',ui)
        self.assertIn('requires_duplicate_consent',ui)
        self.assertIn('Fornecedor (opcional)',items)
        self.assertIn('.receiving-import-consent',css)

    def test_pair_ab_ready_model_and_closures_in_interface(self):
        app=(STATIC / "app.js").read_text(encoding="utf-8")
        pair=(STATIC / "pair.js").read_text(encoding="utf-8")
        css=(STATIC / "pair.css").read_text(encoding="utf-8")
        html=(STATIC / "index.html").read_text(encoding="utf-8")
        self.assertIn('Acerto A × B',app)
        self.assertIn('pair_settings:mode==="acerto_ab"',app)
        self.assertIn('this.renderPair()',app)
        self.assertIn('this.pairSettings(id)',app)
        self.assertIn('d.mode==="acerto_ab"',app)
        for name in ("SALDO LÍQUIDO ATUAL","Quem deve para quem?","Descrição obrigatória",
                     "Novo lançamento","Fechamento por período","Verificar acerto",
                     "Confirmar fechamento","pairPreviewClose()","pairConfirmClose()",
                     "/pair/entries","/pair/preview","/pair/closures","pairExportClose"):
            self.assertIn(name,pair)
        self.assertIn('role="dialog" aria-modal="false"',pair)
        self.assertIn('.ab-balance',css)
        self.assertIn('.ab-stats',css)
        self.assertIn('/static/pair.js',html)
        self.assertIn('/static/pair.css',html)

    def test_pair_debts_and_real_payments_share_one_settlement(self):
        js=(STATIC / "pair.js").read_text(encoding="utf-8")
        css=(STATIC / "pair.css").read_text(encoding="utf-8")
        backend=(ROOT / "pair.py").read_text(encoding="utf-8")
        for token in ("Nova dívida","Registrar pagamento","Quem pagou para quem?",
                      "Quem deve para quem?","Dívida / compensação","Pagamento real",
                      "abPartyLabel","pairKindChanged()","payments_a_to_b",
                      "payments_b_to_a",'p[kind==="payment"?"payer":"debtor"]',
                      'value="payment"', 'name="kind"'):
            self.assertIn(token,js)
        self.assertIn("ab-kind-payment",css)
        self.assertIn("ab-kind-debt",css)
        self.assertIn("ALTER TABLE pair_entries ADD COLUMN",backend)
        self.assertIn("kind_of(entry)",backend)
        self.assertIn('entry_kind=?',backend)
        self.assertIn('movement_totals',backend)
        self.assertIn("Pagamento real",backend)

    def test_folders_and_move_control_user_interface(self):
        app=(STATIC / "app.js").read_text(encoding="utf-8")
        html=(STATIC / "index.html").read_text(encoding="utf-8")
        css=(STATIC / "app.css").read_text(encoding="utf-8")
        server=(ROOT / "app.py").read_text(encoding="utf-8")
        for text in ("MINHAS PASTAS","Nova pasta","P pasta"):
            self.assertIn(text,html)
        self.assertNotIn("MEUS QUADROS",html)
        for text in ("Suas pastas","Renomear pasta","Excluir pasta",
                     "Mover para pasta","moveControlForm(id)","saveControlMove()",
                     '"/api/controls/"+ctx.controlId+"/move"', 'action==="move"'):
            self.assertIn(text,app)
        self.assertIn('id="moveCurrentControl"',html)
        self.assertIn('class="modal move-control-modal"',app)
        self.assertIn('"PATCH",{board_id:destination}',app)
        self.assertIn('action=="move"',server)
        self.assertIn("UPDATE controls SET board_id=?",server)
        self.assertIn("Mova-os para outra pasta antes de excluir.",server)
        self.assertIn(".move-control-modal",css)

    def test_typography_prevents_overlapping_text_in_all_modules(self):
        css=(STATIC / "app.css").read_text(encoding="utf-8")
        for text in ("letter-spacing:normal!important",
                     "line-height:1.45!important",
                     "overflow-wrap:anywhere",
                     ".app-shell .topbar{flex-wrap:wrap}",
                     ".app-shell .control-bottom>span:first-child",
                     ".app-shell .table-wrap :is(th,td)",
                     ".app-shell .table-actions{flex-wrap:wrap"):
            self.assertIn(text,css)
        self.assertIn("--app-font:Arial,Helvetica,sans-serif",css)

    def test_open_debt_unlimited_payments_ui(self):
        app_js=(STATIC / "app.js").read_text(encoding="utf-8")
        js=(STATIC / "open_debt.js").read_text(encoding="utf-8")
        css=(STATIC / "open_debt.css").read_text(encoding="utf-8")
        html=(STATIC / "index.html").read_text(encoding="utf-8")
        app_py=(ROOT / "app.py").read_text(encoding="utf-8")
        self.assertIn('Dívidas sem valor fixo',app_js)
        self.assertIn('App.mode(&quot;divida_sem_valor&quot;)',app_js)
        self.assertIn('this.renderOpenDebt()',app_js)
        self.assertIn('this.openDebtSettings(id)',app_js)
        self.assertIn('c.mode==="divida_sem_valor"?"Total acumulado"',app_js)
        self.assertIn('divida_sem_valor',app_py)
        self.assertIn('open_debt.handle(self,con,method,url)',app_py)
        for value in ("TOTAL ACUMULADO DE PAGAMENTOS","Registre os pagamentos.",
                      "Registrar pagamento","Histórico de pagamentos",
                      "openDebtSave()","openDebtDelete(id)","openDebtExport(id)"):
            self.assertIn(value,js)
        self.assertNotIn("Dívida quitada",js)
        self.assertNotIn("Saldo restante",js)
        self.assertNotIn("debt-progress",js)
        self.assertIn('/static/open_debt.js',html)
        self.assertIn('/static/open_debt.css',html)
        self.assertIn('.open-debt-total',css)

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
