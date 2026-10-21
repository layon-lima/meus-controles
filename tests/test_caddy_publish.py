"""Garante que o instalador da Central não edite outros sites no Caddyfile."""
import importlib.util
from pathlib import Path
import unittest

MODULE_FILE = Path(__file__).resolve().parents[1] / "deploy" / "vps" / "CONFIGURAR_CADDY.py"
spec = importlib.util.spec_from_file_location("central_caddy_deploy", MODULE_FILE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

OTHER_SITE = """pluv.fazendanovohorizonte.com {
    reverse_proxy pluviometros-app:8000
}

gfarm.fazendanovohorizonte.com {
    reverse_proxy gfarm-app:8000
}
"""
AUTH = """
# CENTRAL DE CONTROLES — site isolado
controles.fazendanovohorizonte.com {
    basic_auth {
        admin $2b$12$ABCDEFGHIJKLM12345678901234567890123456789012345
    }
    reverse_proxy central-controles-api:18765
}
"""
NO_AUTH = """
# CENTRAL DE CONTROLES — site isolado
controles.fazendanovohorizonte.com {
    reverse_proxy central-controles-api:18765
}
"""


class CaddyPublicationTests(unittest.TestCase):
    def test_new_site_has_no_login(self):
        result, changed = module.replace_site(OTHER_SITE)
        self.assertTrue(changed)
        self.assertTrue(result.startswith(OTHER_SITE.rstrip("\n")))
        self.assertEqual(result.count("controles.fazendanovohorizonte.com {"), 1)
        self.assertIn("reverse_proxy central-controles-api:18765", result)
        self.assertNotIn("basic_auth", result)
        self.assertNotIn("basicauth", result)

    def test_upgrade_old_basic_auth_without_touching_other_sites(self):
        result, changed = module.replace_site(OTHER_SITE + AUTH)
        self.assertTrue(changed)
        self.assertTrue(result.startswith(OTHER_SITE))
        self.assertEqual(result.count(module.DOMAIN), 1)
        self.assertNotIn("basic_auth", result)
        self.assertIn("reverse_proxy central-controles-api:18765", result)
        self.assertIn("reverse_proxy gfarm-app:8000", result)

    def test_idempotent_if_already_without_login(self):
        first, changed = module.replace_site(OTHER_SITE)
        self.assertTrue(changed)
        again, changed = module.replace_site(first)
        self.assertFalse(changed)
        self.assertEqual(again, first)

    def test_unmanaged_site_is_untouched(self):
        source = OTHER_SITE + """
controles.fazendanovohorizonte.com {
    reverse_proxy different-backend:3000
}
"""
        with self.assertRaises(RuntimeError):
            module.replace_site(source)

    def test_does_not_remove_unexpected_directives(self):
        source = OTHER_SITE + NO_AUTH.replace(
            "    reverse_proxy", "    respond /secret 403\n    reverse_proxy"
        )
        with self.assertRaises(RuntimeError):
            module.replace_site(source)


if __name__ == "__main__":
    unittest.main()
