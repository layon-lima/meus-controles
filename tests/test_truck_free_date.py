"""O formulario de fretes aceita data digitada livremente, sem segmentos bloqueados."""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
JS=(ROOT/"static"/"truck.js").read_text(encoding="utf-8")
HTML=(ROOT/"static"/"index.html").read_text(encoding="utf-8")
SW=(ROOT/"static"/"sw.js").read_text(encoding="utf-8")
CSS=(ROOT/"static"/"truck.css").read_text(encoding="utf-8")
SERVER=(ROOT/"app.py").read_text(encoding="utf-8")


class TruckFreeDateTests(unittest.TestCase):
    def test_date_entry_is_fully_editable_text_not_segmented_native_input(self):
        self.assertIn('const truckParseDate=value=>',JS)
        self.assertIn('const truckFreeDateInput=value=>',JS)
        self.assertIn('type="text" id="truckDateText" name="date"',JS)
        self.assertIn('oninput="this.setCustomValidity(&quot;&quot;)"',JS)
        self.assertIn('onblur="App.truckDateBlur(this)"',JS)
        self.assertIn('truckField("Data",truckFreeDateInput(',JS)
        self.assertNotIn('truckInput("date",r.event_date||truckDate(),',JS)

    def test_digit_lengths_and_iso_conversion_are_both_supported(self):
        self.assertIn(r'const compact=/^\d{6}(?:\d{2})?$/;',JS)
        self.assertIn(r'const separated=/^\d{1,2}',JS)
        self.assertIn('year+=2000',JS)
        self.assertIn('return {iso:yyyy+"-"+pad(month)+"-"+pad(day)',JS)
        self.assertIn('day>length',JS)
        self.assertIn('const parsedDate=truckParseDate(dateInput?.value)',JS)
        self.assertIn('date:parsedDate.iso',JS)
        self.assertLess(JS.index('const parsedDate=truckParseDate(dateInput?.value)'),
                        JS.index('if(!form.reportValidity())return;',JS.index('async truckSave()')))

    def test_partial_edits_remain_untouched_until_valid(self):
        start=JS.index('truckDateBlur(input){')
        end=JS.index('truckOpenDatePicker(){',start)
        on_blur=JS[start:end]
        self.assertIn('if(date){',on_blur)
        self.assertIn('input.value=date.display;',on_blur)
        self.assertNotIn('input.value=date.display;',on_blur.split('if(date){')[0])
        self.assertIn('ctx.entry={...ctx.entry,event_date:values.get("date")',JS)
        self.assertIn('r.event_date??truckDate()',JS)

    def test_optional_calendar_does_not_replace_text_field(self):
        self.assertIn('id="truckDatePicker"',JS)
        self.assertIn('truckDatePicked(picker){',JS)
        self.assertIn('truckOpenDatePicker(){',JS)
        self.assertIn('.truck-entry-form .truck-free-date',CSS)

    def test_pwa_loads_new_asset_versions(self):
        for asset,version_id in (('truck.js','20261022-comissao-v7'),('truck.css','20261022-data-livre-v4')):
            version='/static/'+asset+'?v='+version_id
            self.assertIn(version,HTML)
            self.assertIn(version,SW)
        self.assertIn('central-de-controles-shell-v20261026-vales-v5',SW)
        # A versão do servidor evolui independentemente do campo de data.
        # Não prender o deploy a uma release antiga.
        self.assertRegex(SERVER,r'"release":"20[0-9]{6}-[a-z0-9-]+"')


if __name__=="__main__":
    unittest.main()
