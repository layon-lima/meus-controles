"""Proteções do seletor de vários controles e do endpoint Excel."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

class ReportsExcelUITests(unittest.TestCase):
    def test_excel_entrypoint_is_available_in_folders_and_home(self):
        js=(ROOT/"static"/"app.js").read_text(encoding="utf-8")
        self.assertGreaterEqual(js.count('onclick="App.reportExcelOpen()"'),2)
        self.assertIn("reportExcelOpen(){",js)
        self.assertIn("reportExcelSelectVisible(){",js)
        self.assertIn("reportExcelClear(){",js)
        self.assertIn("reportExcelFilter(value){",js)
        self.assertIn('this.s.reportExcelIds=new Set()',js)
        self.assertIn("reportExcelDownload(){",js)
        self.assertIn('"/api/reports/controls.xlsx"',js)
        self.assertIn('JSON.stringify({control_ids:ids})',js)
        self.assertIn('response.blob()',js)
        self.assertIn('link.download="relatorio_controles.xlsx"',js)
        self.assertIn('if(!ids.length||ids.length>80||this.s.reportExcelBusy)return;',js)
    def test_excel_route_is_binary_and_has_attachment_header(self):
        app=(ROOT/"app.py").read_text(encoding="utf-8")
        self.assertIn('url=="/api/reports/controls.xlsx"',app)
        self.assertIn("reports_excel.generate(con,ids)",app)
        self.assertIn("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",app)
        self.assertIn("attachment; filename=",app)
        css=(ROOT/"static"/"app.css").read_text(encoding="utf-8")
        self.assertIn(".report-excel-choice[hidden]",css)


if __name__=="__main__":
    unittest.main()
