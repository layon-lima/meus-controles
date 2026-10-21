"""Validações estáticas e do origin para implantação privada via HTTPS."""
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
            for origin in (
                "", "null", "http://controles.exemplo.com",
                "https://outro.exemplo.com", "https://controles.exemplo.com.evil",
                "http://127.0.0.1:18765"
            ):
                self.assertFalse(app.allowed_mutation_origin(origin), origin)

    def test_modo_local_conserva_painel(self):
        with patch.object(app, "PUBLIC_ORIGIN", ""):
            self.assertTrue(app.allowed_mutation_origin(""))
            self.assertTrue(app.allowed_mutation_origin("http://127.0.0.1:18765"))
            self.assertFalse(app.allowed_mutation_origin("https://site-invalido.com"))

    def test_producao_nao_publica_backend_diretamente(self):
        self.assertEqual(app.HOST, "127.0.0.1")
        service = (VPS / "meus-controles.service").read_text(encoding="utf-8")
        self.assertIn("Restart=always", service)
        self.assertIn("WantedBy=multi-user.target", service)
        self.assertIn("CONTROLES_DISABLE_LOCAL_SHUTDOWN=1", service)
        self.assertIn("CONTROLES_DATA_DIR=/var/lib/meus-controles", service)
        self.assertIn("ProtectSystem=strict", service)

    def test_backup_tem_validacao_e_timer(self):
        code = (VPS / "BACKUP.py").read_text(encoding="utf-8")
        self.assertIn("source_db.backup(target_db)", code)
        self.assertIn("PRAGMA quick_check", code)
        timer = (VPS / "meus-controles-backup.timer").read_text(encoding="utf-8")
        self.assertIn("Persistent=true", timer)
        self.assertIn("OnCalendar=", timer)

    def test_nginx_exige_senha_e_https(self):
        installer = (VPS / "INSTALAR.sh").read_text(encoding="utf-8")
        self.assertIn("auth_basic_user_file", installer)
        self.assertIn("certbot certonly --webroot", installer)
        self.assertIn("proxy_pass http://127.0.0.1:18765", installer)
        self.assertIn("CONTROLES_PUBLIC_ORIGIN=https://", installer)


if __name__ == "__main__":
    unittest.main()
