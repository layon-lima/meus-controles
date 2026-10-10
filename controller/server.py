#!/usr/bin/env python3
"""Painel web local da Central de Controles (sem Tkinter e sem terminal)."""
from __future__ import annotations

from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
import json
import os
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import traceback
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
PANEL_ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
BACKUPS = ROOT / "backups"
DB = DATA / "controles.db"
SERVER_LOG = DATA / "servidor.log"
PANEL_LOG = DATA / "painel-web.log"
JOB_PATH = DATA / "atualizacao.json"
TOKEN_PATH = DATA / ".painel-token"
APP_URL = "http://127.0.0.1:18765"
PANEL_URL = "http://127.0.0.1:18764"
PANEL_ID = "br.com.layon.meus-controles.panel"
APP_ID = "br.com.layon.meus-controles"
REPO_NAME = "layon-lima/meus-controles"
BRANCH = "main"
APP_PROCESS = None
LOG_HANDLE = None
WEB_SERVER = None
RUN_LOCK = threading.Lock()
JOB_LOCK = threading.RLock()
JOB = {"status": "idle", "stage": "Pronto", "percent": 0, "logs": [],
       "updated_at": "", "message": "Aguardando atualização."}

def ensure_dirs():
    DATA.mkdir(parents=True, exist_ok=True)
    BACKUPS.mkdir(parents=True, exist_ok=True)
    if not TOKEN_PATH.exists():
        TOKEN_PATH.write_text(secrets.token_urlsafe(48), encoding="utf-8")

def token():
    ensure_dirs()
    return TOKEN_PATH.read_text(encoding="utf-8").strip()

def save_job():
    with JOB_LOCK:
        JOB["updated_at"] = datetime.now().isoformat(timespec="seconds")
        temp = JOB_PATH.with_suffix(".tmp")
        temp.write_text(json.dumps(JOB, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, JOB_PATH)

def set_job(stage, percent=None, status=None, message=None):
    with JOB_LOCK:
        if percent is not None: JOB["percent"] = percent
        if status: JOB["status"] = status
        if message is not None: JOB["message"] = message
        JOB["stage"] = stage
        line = datetime.now().strftime("%H:%M:%S") + "  " + stage
        JOB["logs"].append(line)
        JOB["logs"] = JOB["logs"][-150:]
        save_job()

def command(args, timeout=120):
    proc = subprocess.run(args, cwd=ROOT, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          encoding="utf-8", errors="replace", timeout=timeout,
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    output = (proc.stdout or "").strip()
    error = (proc.stderr or "").strip()
    if proc.returncode:
        raise RuntimeError((error or output or "Comando falhou.")[:1600])
    return output

def git(*args, timeout=120):
    return command(["git", *args], timeout=timeout)

def identify():
    try:
        req = Request(APP_URL + "/api/health", headers={"Accept": "application/json"})
        with urlopen(req, timeout=.9) as r:
            body = json.loads(r.read(4096))
            return r.status == 200 and body.get("app_id") == APP_ID and body.get("ok") is True
    except Exception:
        return False

def is_port_busy(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=.4):
            return True
    except OSError:
        return False

def start_app():
    global APP_PROCESS, LOG_HANDLE
    if identify():
        return "Central de Controles já está funcionando."
    if is_port_busy(18765):
        raise RuntimeError("Porta 18765 ocupada por OUTRO serviço. Nada será aberto ou encerrado.")
    if APP_PROCESS is not None and APP_PROCESS.poll() is None:
        raise RuntimeError("Servidor da Central ainda está iniciando. Aguarde a inicialização.")
    if not (ROOT / "app.py").is_file():
        raise RuntimeError("Arquivo app.py não encontrado.")
    ensure_dirs()
    if LOG_HANDLE:
        LOG_HANDLE.close()
    LOG_HANDLE = SERVER_LOG.open("a", encoding="utf-8")
    APP_PROCESS = subprocess.Popen(
        [sys.executable, str(ROOT / "app.py")],
        cwd=ROOT, stdin=subprocess.DEVNULL,
        stdout=LOG_HANDLE, stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    for _ in range(40):
        if identify():
            return "Central de Controles iniciada na porta 18765."
        if APP_PROCESS.poll() is not None:
            raise RuntimeError("O aplicativo encerrou durante a inicialização. Consulte o log.")
        time.sleep(.15)
    raise RuntimeError("O aplicativo não respondeu dentro do prazo. Consulte o log.")

def stop_app():
    global APP_PROCESS
    if not identify():
        if is_port_busy(18765):
            raise RuntimeError("Outro serviço ocupa a porta 18765. Nenhum processo foi encerrado.")
        return "Aplicativo já está desligado."
    secret = token()
    request = Request(APP_URL + "/api/internal/shutdown", data=b"{}",
        method="POST", headers={"X-Central-Panel-Token": secret, "Content-Type":"application/json"})
    try:
        with urlopen(request, timeout=4) as resp:
            answer = json.loads(resp.read(4096))
            if not answer.get("ok"):
                raise RuntimeError("Servidor não confirmou encerramento.")
    except Exception as exc:
        raise RuntimeError("Não foi possível encerrar com segurança. Atualize o servidor antes de usar o botão: " + str(exc)) from exc
    for _ in range(40):
        if not is_port_busy(18765):
            APP_PROCESS = None
            return "Aplicativo encerrado."
        time.sleep(.15)
    raise RuntimeError("A porta 18765 ainda está ocupada; não foi possível continuar.")

def backup_db():
    ensure_dirs()
    if not DB.exists():
        return "Banco ainda não criado; nenhum dado para copiar."
    filename = "controles_" + datetime.now().strftime("%Y%m%d_%H%M%S_%f") + ".db"
    target = BACKUPS / filename
    try:
        with sqlite3.connect(str(DB), timeout=15) as src:
            with sqlite3.connect(str(target), timeout=15) as dst:
                src.backup(dst)
        with sqlite3.connect(str(target)) as verify:
            result = verify.execute("PRAGMA quick_check").fetchone()
            if not result or result[0] != "ok":
                raise RuntimeError("O backup não passou na verificação de integridade.")
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return "Backup verificado: " + filename

def tail(path, limit=75):
    if not path.is_file(): return []
    with path.open("r", encoding="utf-8", errors="replace") as f:
        return f.readlines()[-limit:]

def repo_status():
    result = {"git_ready": (ROOT / ".git").is_dir(), "branch": "", "revision": "",
              "dirty": False, "remote": "", "remote_valid": False, "error": ""}
    if not result["git_ready"]:
        result["error"] = "Esta pasta não é um clone Git. Use git clone para ativar as atualizações."
        return result
    try:
        result["branch"] = git("branch", "--show-current", timeout=8)
        result["revision"] = git("rev-parse", "--short", "HEAD", timeout=8)
        result["dirty"] = bool(git("status", "--porcelain", "--untracked-files=no", timeout=8))
        result["remote"] = git("remote", "get-url", "origin", timeout=8)
        normalized = result["remote"].replace("\\", "/")
        result["remote_valid"] = bool(re.search(
            r"(?:github\.com[:/])layon-lima/meus-controles(?:\.git)?/?$", normalized, flags=re.I))
    except Exception as exc:
        result["error"] = str(exc)
    return result

def app_status():
    return {"online": identify(), "port_busy": is_port_busy(18765), "url": APP_URL,
            "panel_url": PANEL_URL, "database_exists": DB.exists(),
            "database_bytes": DB.stat().st_size if DB.exists() else 0,
            "repo": repo_status()}

def update_all():
    if not RUN_LOCK.acquire(blocking=False):
        raise RuntimeError("Já existe uma atualização em andamento.")
    with JOB_LOCK:
        JOB.update({"status":"running","stage":"Iniciando","percent":2,
                    "message":"Sincronizando o GitHub.","logs":[]})
        save_job()
    threading.Thread(target=do_update, daemon=False).start()

def do_update():
    stopped = False
    updated = False
    try:
        set_job("Validando este repositório Git", 8)
        repo = repo_status()
        if not repo["git_ready"] or repo["error"]:
            raise RuntimeError(repo["error"] or "Repositório Git não encontrado.")
        if repo["branch"] != BRANCH:
            raise RuntimeError("A branch atual é " + repo["branch"] + "; este painel atualiza somente main.")
        if not repo["remote_valid"]:
            raise RuntimeError("O origin não é layon-lima/meus-controles. Atualização bloqueada para não atingir outro projeto.")
        if repo["dirty"]:
            raise RuntimeError("Existem alterações locais em arquivos versionados. Nenhum arquivo será sobrescrito.")
        set_job("Verificando atualizações no GitHub", 18)
        git("fetch", "--prune", "origin", BRANCH, timeout=90)
        head = git("rev-parse", "HEAD", timeout=8)
        remote = git("rev-parse", "FETCH_HEAD", timeout=8)
        set_job("Criando backup do banco antes de atualizar", 34)
        set_job(backup_db(), 44)
        if head == remote:
            set_job("Código já está atualizado; verificando o aplicativo", 70)
            if not identify():
                set_job(start_app(), 83)
        else:
            set_job("Parando somente a Central de Controles", 52)
            stop_app()
            stopped = True
            set_job("Atualizando todos os arquivos do GitHub", 65)
            git("pull", "--ff-only", "origin", BRANCH, timeout=100)
            updated = True
            set_job("Reiniciando a versão web atualizada", 83)
            set_job(start_app(), 91)
            stopped = False
        set_job("Atualização concluída com sucesso", 100, "success",
                "Todos os arquivos sincronizados. Dados e backups preservados.")
    except Exception as exc:
        set_job("Falha: " + str(exc), status="error", message=str(exc))
        if stopped:
            try:
                set_job("Tentando reabrir o aplicativo", 88)
                set_job(start_app(), 92)
            except Exception as restart_error:
                set_job("Não foi possível reiniciar: " + str(restart_error), status="error")
        with JOB_LOCK:
            JOB["status"] = "error"
            save_job()
    finally:
        RUN_LOCK.release()
        # Após atualização, o painel também precisa carregar o código novo.
        if updated:
            try:
                reload_panel()
            except Exception as exc:
                set_job("O painel ainda usa código anterior: " + str(exc), status="error")

def reload_panel():
    """Fecha o listener, depois inicia o código recém-atualizado, sem CMD."""
    global WEB_SERVER
    if WEB_SERVER is None: return
    WEB_SERVER.shutdown()
    WEB_SERVER.server_close()
    # O painel antigo já liberou a porta; o novo assume o mesmo endereço.
    log = PANEL_LOG.open("a", encoding="utf-8")
    try:
        subprocess.Popen([sys.executable, str(PANEL_ROOT / "server.py"), "--no-browser"],
                         cwd=ROOT, stdin=subprocess.DEVNULL,
                         stdout=log, stderr=subprocess.STDOUT,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    finally:
        log.close()

class Handler(BaseHTTPRequestHandler):
    server_version = "CentralControlesPainel/1.0"
    def log_message(self, fmt, *args):
        try:
            with PANEL_LOG.open("a", encoding="utf-8") as f:
                f.write("%s  %s\n" % (self.log_date_time_string(), fmt % args))
        except OSError: pass

    def reply(self, payload, code=200, mime="application/json; charset=utf-8"):
        raw = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        try: self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError): pass

    def allowed(self):
        host = self.headers.get("Host", "").lower()
        return host in ("127.0.0.1:18764", "localhost:18764")

    def do_GET(self):
        if not self.allowed():
            return self.reply({"error":"Host não permitido."},403)
        route = self.path.split("?", 1)[0]
        if route == "/":
            return self.reply((PANEL_ROOT/"static"/"index.html").read_bytes(),
                              mime="text/html; charset=utf-8")
        if route == "/api/health":
            return self.reply({"ok":True,"app_id":PANEL_ID,"version":"1.0"})
        if route == "/api/status":
            return self.reply(app_status())
        if route == "/api/job":
            with JOB_LOCK: return self.reply(dict(JOB))
        if route == "/api/logs":
            return self.reply({"server_log":"".join(tail(SERVER_LOG))[-24000:],
                               "panel_log":"".join(tail(PANEL_LOG,35))[-12000:]})
        return self.reply({"error":"Rota não encontrada."},404)

    def do_POST(self):
        if not self.allowed():
            return self.reply({"error":"Host não permitido."},403)
        origin=self.headers.get("Origin", "")
        if origin and origin not in (PANEL_URL,"http://localhost:18764"):
            return self.reply({"error":"Origem bloqueada."},403)
        if self.headers.get("X-Central-Panel")!="1":
            return self.reply({"error":"Solicitação não autorizada."},403)
        route = self.path.split("?", 1)[0]
        try:
            if route == "/api/update":
                update_all()
                return self.reply({"ok":True,"message":"Atualização iniciada."},202)
            if RUN_LOCK.locked():
                return self.reply({"error":"Aguarde o fim da atualização."},409)
            if route == "/api/start": msg=start_app()
            elif route == "/api/stop": msg=stop_app()
            elif route == "/api/restart":
                stop_app()
                msg=start_app()
            elif route == "/api/backup": msg=backup_db()
            else: return self.reply({"error":"Rota não encontrada."},404)
            return self.reply({"ok":True,"message":msg})
        except Exception as exc:
            return self.reply({"ok":False,"error":str(exc)},409)

def main():
    global WEB_SERVER
    ensure_dirs()
    if JOB_PATH.exists():
        try:
            previous=json.loads(JOB_PATH.read_text(encoding="utf-8"))
            if isinstance(previous,dict):
                JOB.update(previous)
                if JOB["status"]=="running":
                    JOB.update({"status":"error","message":"Atualização interrompida."})
        except (OSError,ValueError): pass
    try:
        WEB_SERVER=ThreadingHTTPServer(("127.0.0.1",18764),Handler)
        WEB_SERVER.daemon_threads=True
    except OSError as exc:
        print("Não foi possível abrir o painel web: "+str(exc),flush=True)
        return 1
    try:
        try: start_app()
        except Exception as exc: print("Central não iniciada: "+str(exc),flush=True)
        if "--no-browser" not in sys.argv:
            threading.Timer(.5,lambda:webbrowser.open(PANEL_URL)).start()
        WEB_SERVER.serve_forever(poll_interval=.2)
    finally:
        WEB_SERVER.server_close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
