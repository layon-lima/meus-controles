"""Validações de origin e isolamento Docker do deploy remoto."""
import unittest
from pathlib import Path
from unittest.mock import patch
import app

ROOT = Path(__file__).resolve().parents[1]
VPS = ROOT / "deploy" / "vps"


class VpsDeploymentTests(unittest.TestCase):
    def test_origin_remoto_so_aceita_https_exato(self):
        with patch.object(app, "PUBLIC_ORIGIN", "https://controles.exemplo.com"):
            self.assertTrue(app.allowed_mutation_origin("https://controles.exemplo.com"))
            for origin in ("", "null", "http://controles.exemplo.com",
                           "https://outro.exemplo.com",
                           "https://controles.exemplo.com.evil",
                           "http://127.0.0.1:18765"):
                self.assertFalse(app.allowed_mutation_origin(origin), origin)

    def test_modo_local_conserva_painel_windows(self):
        with patch.object(app, "PUBLIC_ORIGIN", ""):
            self.assertTrue(app.allowed_mutation_origin(""))
            self.assertTrue(app.allowed_mutation_origin("http://127.0.0.1:18765"))
            self.assertFalse(app.allowed_mutation_origin("https://site-invalido.com"))

    def test_api_banco_e_docker_isolados(self):
        self.assertEqual(app.HOST, "127.0.0.1")
        compose = (VPS / "compose.yml").read_text(encoding="utf-8")
        self.assertIn("postgres:16-alpine", compose)
        self.assertIn("restart: unless-stopped", compose)
        self.assertIn("CONTROLES_DISABLE_LOCAL_SHUTDOWN:", compose)
        self.assertIn("CONTROLES_PUBLIC_ORIGIN:", compose)
        self.assertIn("internal: true", compose)
        self.assertIn("banco_pg:/var/lib/postgresql/data", compose)
        self.assertNotIn("ports:", compose)
        self.assertIn("central-controles-api", compose)

    def test_backups_pg_e_migracao_sao_verificados(self):
        script = (VPS / "BACKUP_PG.sh").read_text(encoding="utf-8")
        self.assertIn("pg_dump", script)
        self.assertIn("pg_restore -l", script)
        self.assertIn("/opt/apps/backups/meus-controles", script)
        timer = (VPS / "meus-controles-pg-backup.timer").read_text(encoding="utf-8")
        self.assertIn("Persistent=true", timer)
        migration = (VPS / "MIGRAR_SQLITE_PG.py").read_text(encoding="utf-8")
        self.assertIn("PRAGMA quick_check", migration)
        self.assertIn("pg_advisory_xact_lock", migration)

    def test_caddy_protegido_e_nao_sobrescrito(self):
        proxy = (VPS / "Caddyfile.example").read_text(encoding="utf-8")
        self.assertIn("basic_auth", proxy)
        self.assertIn("reverse_proxy central-controles-api:18765", proxy)
        setup = (VPS / "INSTALAR.sh").read_text(encoding="utf-8")
        self.assertIn("docker compose", setup)
        self.assertNotIn("nginx -t", setup)
        self.assertNotIn("certbot", setup)


if __name__ == "__main__":
    unittest.main()
