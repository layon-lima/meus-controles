"""Teste local do instalador: valida sintaxe e manipulação segura de credenciais."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"deploy"/"vps"/"ATIVAR_INTEGRACAO_GFARM.sh"


class TestarAtivadorIntegracaoGfarm(unittest.TestCase):
    def test_sintaxe_bash(self):
        subprocess.run(["bash","-n",str(SCRIPT)],check=True,capture_output=True)

    def test_envs_preservados_e_token_compartilhado(self):
        text=SCRIPT.read_text(encoding="utf-8")
        marker='python3 - "$GENV" "$CENV" <<\'PY\'\n'
        self.assertIn(marker,text)
        script=text.split(marker,1)[1].split("\nPY\n",1)[0]
        with tempfile.TemporaryDirectory() as tmp:
            a=Path(tmp)/"gfarm.env"
            b=Path(tmp)/"controles.env"
            secret="z"*64
            a.write_text("DB_NAME=gfarm\nGFARM_RECEBIMENTOS_TOKEN="+secret+"\nDB_USER=admin\n")
            b.write_text("CONTROLES_DOMAIN=controles.example.test\nGFARM_RECEBIMENTOS_TOKEN=other\nCONTROLES_PORT=18765\n")
            for _ in range(2):
                subprocess.run([sys.executable,"-c",script,str(a),str(b)],check=True,capture_output=True)
                for p in (a,b):
                    data=p.read_text()
                    self.assertEqual(data.count("GFARM_RECEBIMENTOS_TOKEN="),1)
                    self.assertIn("GFARM_RECEBIMENTOS_TOKEN="+secret+"\n",data)
                    self.assertNotIn("\\n",data)
                    self.assertEqual(p.stat().st_mode & 0o777,0o600)
                self.assertIn("DB_NAME=gfarm\n",a.read_text())
                self.assertIn("CONTROLES_PORT=18765\n",b.read_text())


if __name__=="__main__":
    unittest.main()
