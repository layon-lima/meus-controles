"""Conferências e fechamentos seguros no CONTROLE CHAVE ERRADA."""
import unittest
import tempfile
from pathlib import Path
import app
import truck
import truck_workflow as workflow

class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.original=(app.DATA,app.DB)
        app.DATA=Path(self.temp.name)
        app.DB=app.DATA/"workflow.db"
        app.initialize()
        with app.db() as con:
            self.cid=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'CONTROLE CHAVE ERRADA','caminhao','[]','[]','[]')""").lastrowid
            self.other=con.execute("""INSERT INTO controls(board_id,name,mode,fields_json,rules_json,types_json)
                VALUES(1,'OUTRO CAMINHÃO','caminhao','[]','[]','[]')""").lastrowid
            workflow.initialize(con)
            truck.save_settings(con,self.cid,{
                "commission_pct":"13","opening_commission":"1000",
                "opening_cash":"0","driver_name":"Motorista"})
    def tearDown(self):
        app.DATA,app.DB=self.original
        self.temp.cleanup()

    def add(self, when,kind="freight",amount="1000",cid=None):
        cid=cid or self.cid
        payload={"date":when,"kind":kind,"description":"Comprovante físico",
                 "category":"Frete Normal" if kind=="freight" else "Vale motorista",
                 "weight_kg":"1000","price_tonne":amount,"amount":amount,"notes":""}
        with app.db() as con:
            values=truck.compute_entry(con,cid,payload)
            cursor=con.execute("""INSERT INTO truck_entries
               (control_id,event_date,kind,category,description,weight_kg,price_tonne,
                commission_pct,amount,commission_amount,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",values)
            return cursor.lastrowid

    def check(self,start,end):
        with app.db() as con:
            pre=workflow.review_preview(con,self.cid,start,end)
            payload={"start":start,"end":end,"fingerprint":pre["fingerprint"],
                     "checked_ids":[r["id"] for r in pre["entries"]]}
            return workflow.confirm_review(con,self.cid,payload)

    def close(self,start,end):
        with app.db() as con:
            p=workflow.close_preview(con,self.cid,start,end)
            self.assertTrue(p["ready"],p.get("message"))
            return workflow.confirm_close(con,self.cid,{"start":start,"end":end,"fingerprint":p["fingerprint"]})

    def test_only_named_control_activated(self):
        with app.db() as con:
            self.assertTrue(workflow.is_enabled(con,self.cid))
            self.assertFalse(workflow.is_enabled(con,self.other))
            with self.assertRaises(ValueError):
                workflow.review_preview(con,self.other,"2026-10-01","2026-10-07")

    def test_review_requires_all_documents_and_prevents_overlap(self):
        a=self.add("2026-10-02")
        b=self.add("2026-10-05",kind="advance",amount="20")
        with app.db() as con:
            preview=workflow.review_preview(con,self.cid,"2026-10-01","2026-10-07")
            with self.assertRaises(ValueError):
                workflow.confirm_review(con,self.cid,{"start":"2026-10-01","end":"2026-10-07",
                    "fingerprint":preview["fingerprint"],"checked_ids":[a]})
        self.check("2026-10-01","2026-10-07")
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"sobrepõe"):
                workflow.review_preview(con,self.cid,"2026-10-06","2026-10-09")
            with self.assertRaisesRegex(ValueError,"Reabra"):
                workflow.assert_entry_editable(con,self.cid,"2026-10-05")
            result=workflow.info(con,self.cid)
            self.assertEqual(result["pending_check_from"],"2026-10-08")
            self.assertEqual(result["checks"][0]["entry_count"],2)

    def test_review_can_be_reopened_if_not_closed(self):
        self.add("2026-10-02")
        record=self.check("2026-10-01","2026-10-03")
        with app.db() as con:
            workflow.reopen_review(con,record["id"])
        with app.db() as con:
            workflow.assert_entry_editable(con,self.cid,"2026-10-02")
            self.assertEqual(workflow.info(con,self.cid)["checks"],[])

    def test_closure_requires_full_day_coverage(self):
        self.add("2026-10-02")
        self.add("2026-10-11")
        self.check("2026-10-01","2026-10-07")
        with app.db() as con:
            incomplete=workflow.close_preview(con,self.cid,"2026-10-01","2026-10-12")
            self.assertFalse(incomplete["ready"])
            self.assertEqual(incomplete["missing_from"],"2026-10-08")
            with self.assertRaisesRegex(ValueError,"limites"):
                workflow.close_preview(con,self.cid,"2026-10-01","2026-10-03")
        self.check("2026-10-08","2026-10-12")
        closed=self.close("2026-10-01","2026-10-12")
        self.assertEqual(closed["entry_count"],2)

    def test_closure_archives_and_driver_commission_carries_forward(self):
        self.add("2026-10-02",amount="1000")
        self.add("2026-10-05",kind="advance",amount="50")
        self.add("2026-10-15",amount="500")
        review=self.check("2026-10-01","2026-10-12")
        with app.db() as con:
            before=truck.summary(con,self.cid,scope="all")
            self.assertEqual(before["totals"]["driver_due"],"1145.00")
        closed=self.close("2026-10-01","2026-10-12")
        with app.db() as con:
            active=truck.summary(con,self.cid)
            archive=workflow.closure_detail(con,closed["id"])
            self.assertEqual(active["totals"]["freight"],"500.00")
            self.assertEqual(active["totals"]["count"],1)
            self.assertEqual(active["totals"]["driver_due"],"1145.00")
            self.assertEqual(active["workflow"]["current_from"],"2026-10-13")
            self.assertEqual(archive["totals"]["freight"],"1000.00")
            self.assertEqual(archive["totals"]["driver_due_at_close"],"1080.00")
            self.assertEqual(len(archive["entries"]),2)
            self.assertTrue(workflow.export_csv(con,closed["id"]).startswith(b"\xef\xbb\xbf"))
            with self.assertRaisesRegex(ValueError,"fechado"):
                workflow.reopen_review(con,review["id"])
            with self.assertRaises(ValueError):
                workflow.assert_entry_editable(con,self.cid,"2026-10-02")

    def test_second_closure_must_start_next_day(self):
        self.add("2026-09-02")
        self.check("2026-09-01","2026-09-07")
        self.close("2026-09-01","2026-09-07")
        self.add("2026-09-12")
        self.check("2026-09-08","2026-09-14")
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"começar"):
                workflow.close_preview(con,self.cid,"2026-09-09","2026-09-14")
        self.close("2026-09-08","2026-09-14")
        with app.db() as con:
            self.assertEqual(truck.summary(con,self.cid)["totals"]["count"],0)
            self.assertEqual(len(workflow.info(con,self.cid)["closures"]),2)

    def test_review_fingerprint_detects_external_tampering(self):
        eid=self.add("2026-10-02")
        self.check("2026-10-01","2026-10-07")
        with app.db() as con:
            con.execute("UPDATE truck_entries SET description='Alterado' WHERE id=?",(eid,))
        with app.db() as con:
            preview=workflow.close_preview(con,self.cid,"2026-10-01","2026-10-07")
            self.assertFalse(preview["ready"])
            self.assertIn("alterados",preview["message"])

    def test_future_review_and_closure_are_rejected(self):
        from datetime import date, timedelta
        tomorrow=(date.today()+timedelta(days=1)).isoformat()
        with app.db() as con:
            with self.assertRaisesRegex(ValueError,"não terminou"):
                workflow.review_preview(con,self.cid,tomorrow,tomorrow)
            with self.assertRaisesRegex(ValueError,"não terminou"):
                workflow.close_preview(con,self.cid,tomorrow,tomorrow)

    def test_protects_data_and_opening_balance(self):
        self.add("2026-10-02")
        self.check("2026-10-01","2026-10-12")
        self.close("2026-10-01","2026-10-12")
        with app.db() as con:
            with self.assertRaises(ValueError):
                workflow.assert_entry_editable(con,self.cid,"2026-10-05")
            with self.assertRaises(ValueError):
                workflow.assert_settings_editable(con,self.cid,[],True)

if __name__=="__main__":
    unittest.main()
