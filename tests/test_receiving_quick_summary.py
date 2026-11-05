"""Resumo rápido de pedidos: seleção inclui recebidos, sem totais combinados."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
JS=(ROOT/"static"/"receiving.js").read_text(encoding="utf-8")
CSS=(ROOT/"static"/"receiving.css").read_text(encoding="utf-8")


class QuickSummaryTests(unittest.TestCase):
    def test_summary_control_attached_to_existing_selection(self):
        self.assertIn('id="receivingQuickSummaryBtn"',JS)
        self.assertIn('App.receivingQuickSummary()',JS)
        self.assertIn('summary.hidden=!selected.size;',JS)
        self.assertIn('const available=new Set(r.items.map(p=>p.id));',JS)
        self.assertIn('if(!item)return;',JS)
        self.assertIn('aria-label="Selecionar todos os produtos exibidos"',JS)
        self.assertNotIn('disabled title="Exclua as entregas antes de excluir este produto"',JS)

    def test_bulk_delete_remains_protected_even_if_summary_selection_contains_receipts(self):
        self.assertIn("const canDelete=selected.size>0",JS)
        self.assertIn("return !!item&&!item.receipts_count;",JS)
        self.assertIn("return !item||item.receipts_count;",JS)
        self.assertIn("button.hidden=!canDelete;",JS)

    def test_full_unit_names_and_both_common_aliases(self):
        self.assertIn('function rxFullUnit(unit){',JS)
        for name in ['"t":"Toneladas"', '"ton":"Toneladas"',
                     '"l":"Litros"', '"lt":"Litros"',
                     '"kg":"Quilogramas"', '"un":"Unidades"']:
            self.assertIn(name,JS)

    def test_each_order_owns_product_metric_cards_without_aggregate(self):
        self.assertIn('function rxQuickSummaryOrders(items,selectedIds){',JS)
        self.assertIn('const ids=new Set(selectedIds||[])',JS)
        self.assertIn('groups.get(key).items.push(item)',JS)
        self.assertIn('groups.map(card).join',JS)
        self.assertIn('group.items.map(p=>{',JS)
        self.assertIn("metric('Total pedido',p.ordered_qty,'total')",JS)
        self.assertIn("metric('Recebido',p.received_qty,'received')",JS)
        self.assertIn("metric('Falta receber',p.remaining_qty,'remaining')",JS)
        self.assertNotIn('reduce((sum,p)=>sum+Number(p.ordered_qty)',JS)
        self.assertNotIn('reduce((sum,p)=>sum+Number(p.received_qty)',JS)
        self.assertIn('const unit=rxFullUnit(p.unit)',JS)

    def test_safe_screenshot_layout(self):
        for term in ['.receiving-quick-sheet',
                     '.receiving-quick-order',
                     '.receiving-quick-product',
                     '.receiving-quick-metric',
                     '.receiving-quick-orders',
                     '.receiving-quick-modal']:
            self.assertIn(term,CSS)
        self.assertIn('grid-template-columns:minmax(0,1fr);gap:11px',CSS)
        self.assertIn('grid-template-columns:minmax(150px,.5fr) minmax(0,1.8fr)',CSS)
        self.assertIn('border-left:4px solid #15866f',CSS)
        self.assertIn('font-family:inherit',CSS)
        self.assertIn('MEUS CONTROLES / RECEBIMENTOS',JS)
        self.assertIn('Resumo de pedidos',JS)
        self.assertNotIn('Fazenda Novo Horizonte · Resumo individual por pedido',JS)
        self.assertIn('this.s.modal="receiving-quick-summary"',JS)
        self.assertIn('App.closeModal()',JS)


if __name__=="__main__":
    unittest.main()
