"""Valida o pacote do icone e a criacao automatica de atalho no Windows."""
from pathlib import Path
import struct
import unittest
import app

ROOT=Path(__file__).resolve().parents[1]

class DesktopShortcutTests(unittest.TestCase):
    def test_windows_icon_is_a_valid_multisize_ico(self):
        data=(ROOT/"assets"/"CENTRAL_DE_CONTROLES.ico").read_bytes()
        self.assertGreater(len(data),1800)
        self.assertEqual(struct.unpack_from("<HHH",data,0),(0,1,4))
        sizes=[]
        for i in range(4):
            pos=6+i*16
            width,height,*rest=struct.unpack_from("<BBBBHHII",data,pos)
            sizes.append((width,height))
            image_size,offset=rest[-2],rest[-1]
            self.assertLessEqual(offset+image_size,len(data))
            self.assertTrue(data[offset:offset+8].startswith(b"\x89PNG"))
        self.assertEqual(sizes,[(16,16),(32,32),(48,48),(64,64)])

    def test_installer_points_to_current_clone_without_admin(self):
        installer=(ROOT/"INSTALAR_ATALHO.vbs").read_text(encoding="utf-8")
        self.assertIn('GetParentFolderName(WScript.ScriptFullName)',installer)
        self.assertIn('SpecialFolders("Desktop")',installer)
        self.assertIn('Central de Controles.lnk',installer)
        self.assertIn('CreateShortcut',installer)
        self.assertIn('INICIAR_APP.vbs',installer)
        self.assertIn('CENTRAL_DE_CONTROLES.ico',installer)
        self.assertIn('wscript.exe',installer)
        self.assertNotIn('RunAs',installer)

    def test_app_launch_is_direct_without_console_or_wrong_service(self):
        direct=(ROOT/"INICIAR_APP.vbs").read_text(encoding="utf-8")
        self.assertIn('127.0.0.1:18765',direct)
        self.assertIn('127.0.0.1:18764',direct)
        self.assertIn('Serv ic o'.replace(' ',''),direct)
        self.assertIn('br.com.layon.meus-controles.panel',direct)
        self.assertIn('br.com.layon.meus-controles',direct)
        self.assertIn('shell.Run appURL & "/", 1, False',direct)
        self.assertIn('" --no-browser"',direct)
        self.assertNotIn('cmd.exe',direct)
        self.assertNotIn('INICIAR.bat',direct)

    def test_initialization_auto_creates_shortcut_only_on_windows(self):
        source=(ROOT/"app.py").read_text(encoding="utf-8")
        self.assertIn('def ensure_windows_desktop_shortcut()',source)
        self.assertIn('if os.name!="nt":',source)
        self.assertIn('ensure_windows_desktop_shortcut()\n    server=',source)
        self.assertIn('"wscript.exe",str(script)',source)
        self.assertIn('timeout=15',source)
        # On Linux/macOS this is safely a no-op.
        if __import__("os").name!="nt":
            self.assertIsNone(app.ensure_windows_desktop_shortcut())

    def test_favicon_on_app_and_update_panel(self):
        page=(ROOT/"static"/"index.html").read_text(encoding="utf-8")
        panel=(ROOT/"controller"/"static"/"index.html").read_text(encoding="utf-8")
        server=(ROOT/"controller"/"server.py").read_text(encoding="utf-8")
        for html in (page,panel):
            self.assertIn('href="/favicon.ico"',html)
        self.assertIn('if route == "/favicon.ico":',server)

if __name__=="__main__":
    unittest.main()
