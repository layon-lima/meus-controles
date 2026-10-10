#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Painel local para iniciar, atualizar e proteger os dados da Central."""
import os
import json
import socket
from pathlib import Path
import queue
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import messagebox, scrolledtext, ttk
from urllib.request import urlopen
import webbrowser
from datetime import datetime

ROOT = Path(__file__).resolve().parent
DB = ROOT / "data" / "controles.db"
BACKUPS = ROOT / "backups"
LOG = ROOT / "data" / "servidor.log"
URL = "http://127.0.0.1:18765"

class Painel:
    def __init__(self,root):
        self.root=root
        self.process=None
        self.log_handle=None
        self.tasks=queue.Queue()
        self.busy=False
        root.title("Central de Controles - Painel")
        root.geometry("810x555")
        root.minsize(670,470)
        root.configure(bg="#edf2f6")
        try:root.iconbitmap(str(ROOT/"icone.ico"))
        except Exception:pass
        style=ttk.Style()
        style.theme_use("clam")
        style.configure("TButton",padding=(12,10),font=("Segoe UI",10))
        style.configure("TLabel",background="#edf2f6",font=("Segoe UI",10))
        top=tk.Frame(root,bg="#14283c",padx=26,pady=23)
        top.pack(fill="x")
        tk.Label(top,text="CENTRAL DE CONTROLES",font=("Segoe UI",19,"bold"),fg="white",bg="#14283c").pack(anchor="w")
        tk.Label(top,text="Iniciador · Atualizações pelo GitHub · Backups · Diagnóstico",
                 font=("Segoe UI",10),fg="#b7c9d8",bg="#14283c").pack(anchor="w",pady=(6,0))
        content=tk.Frame(root,bg="#edf2f6",padx=23,pady=19)
        content.pack(fill="both",expand=True)
        self.status=tk.StringVar(value="Verificando servidor...")
        row=tk.Frame(content,bg="#edf2f6")
        row.pack(fill="x",pady=(0,15))
        ttk.Label(row,textvariable=self.status,font=("Segoe UI",11,"bold")).pack(side="left")
        ttk.Button(row,text="Abrir aplicativo",command=self.open_browser).pack(side="right")
        actions=tk.Frame(content,bg="#edf2f6")
        actions.pack(fill="x",pady=(0,12))
        self.buttons={}
        for text,callback in [
            ("▶ Iniciar",self.start),("■ Parar",self.stop),
            ("↓ Atualizar pelo Git",self.update),("◆ Fazer backup",self.backup),
            ("≡ Ver log do servidor",self.show_server_log)
        ]:
            b=ttk.Button(actions,text=text,command=callback)
            b.pack(side="left",padx=(0,7),pady=4)
            self.buttons[text]=b
        ttk.Label(content,text="ATIVIDADES DO PAINEL").pack(anchor="w",pady=(12,6))
        self.logs=scrolledtext.ScrolledText(content,height=13,bg="#fff",fg="#243d51",
            font=("Consolas",10),bd=0,padx=13,pady=11,state="disabled",wrap="word")
        self.logs.pack(fill="both",expand=True)
        ttk.Label(content,text="Os dados ficam em data/controles.db. Atualizar o código não apaga o banco.",
                  foreground="#637989").pack(anchor="w",pady=(10,0))
        root.after(250,self.poll)
        root.after(650,self.autostart)
        root.protocol("WM_DELETE_WINDOW",self.close)

    def post(self,msg):
        self.tasks.put(("log",str(msg)))

    def print_log(self,msg):
        self.logs.configure(state="normal")
        self.logs.insert("end",datetime.now().strftime("%H:%M:%S")+"  "+msg+"\n")
        self.logs.see("end")
        self.logs.configure(state="disabled")

    def healthy(self):
        """Confirma a identidade exata da Central, nao apenas um servidor online."""
        try:
            with urlopen(URL+"/api/health",timeout=.7) as r:
                if r.status != 200:
                    return False
                state = json.loads(r.read(1500).decode("utf-8"))
                return (state.get("ok") is True and
                        state.get("app_id") == "br.com.layon.meus-controles")
        except Exception:
            return False

    def port_in_use(self):
        try:
            with socket.create_connection(("127.0.0.1",18765),timeout=.5):
                return True
        except OSError:
            return False

    def poll(self):
        while True:
            try:kind,data=self.tasks.get_nowait()
            except queue.Empty:break
            if kind=="log":self.print_log(data)
            elif kind=="finished":self.busy=False
            elif kind=="restart":self.start()
        online=self.healthy()
        if online:self.status.set("● SERVIDOR ONLINE  ·  "+URL)
        else:self.status.set("○ SERVIDOR DESLIGADO")
        self.root.after(1300,self.poll)

    def autostart(self):
        self.start()
        self.root.after(950,self.open_browser)

    def start(self):
        if self.healthy():
            self.post("A Central de Controles já está funcionando.")
            return
        if self.port_in_use():
            self.post("BLOQUEADO: outra aplicação ocupa a porta 18765. Não será aberto outro aplicativo.")
            messagebox.showerror("Porta ocupada",
                "A porta 18765 está ocupada por outro serviço. A Central não será confundida com ele.\n"
                "Consulte o log do painel.")
            return
        if self.process and self.process.poll() is None:
            self.post("Servidor iniciando...")
            return
        try:
            LOG.parent.mkdir(parents=True,exist_ok=True)
            self.log_handle=open(LOG,"a",encoding="utf-8")
            args=[sys.executable,str(ROOT/"app.py")]
            flags=getattr(subprocess,"CREATE_NO_WINDOW",0)
            self.process=subprocess.Popen(args,cwd=str(ROOT),stdin=subprocess.DEVNULL,
                stdout=self.log_handle,stderr=subprocess.STDOUT,creationflags=flags)
            self.post("Servidor iniciado. PID "+str(self.process.pid))
        except Exception as e:
            self.post("Falha ao iniciar: "+str(e))
            messagebox.showerror("Erro ao iniciar",str(e))

    def stop(self):
        if self.process and self.process.poll() is None:
            try:
                self.process.terminate()
                self.process.wait(timeout=4)
                self.post("Servidor interrompido.")
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.post("Servidor encerrado à força.")
            except Exception as e:
                self.post("Erro ao parar: "+str(e))
        elif self.healthy():
            self.post("Há um serviço externo na porta 18765. Este painel não o encerrará.")
        else:self.post("Servidor já está parado.")
        self.process=None
        if self.log_handle:
            try:self.log_handle.close()
            except Exception:pass
            self.log_handle=None

    def open_browser(self):
        if self.healthy():
            webbrowser.open(URL)
        else:self.post("Servidor ainda não responde. Verifique o log e clique em Abrir aplicativo.")

    def backup_database(self):
        if not DB.exists():
            self.post("Nenhum banco encontrado para salvar.")
            return None
        BACKUPS.mkdir(parents=True,exist_ok=True)
        dest=BACKUPS/("controles_"+datetime.now().strftime("%Y%m%d_%H%M%S_%f")+".db")
        with sqlite3.connect(str(DB),timeout=20) as original:
            with sqlite3.connect(str(dest)) as target:
                original.backup(target)
        self.post("Backup realizado: "+dest.name)
        return dest

    def backup(self):
        if self.busy:return
        self.busy=True
        def task():
            try:self.backup_database()
            except Exception as e:self.post("Erro no backup: "+str(e))
            finally:self.tasks.put(("finished",None))
        threading.Thread(target=task,daemon=True).start()

    def update(self):
        if self.busy:return
        if not (ROOT/".git").exists():
            messagebox.showwarning("Git não encontrado",
                "Esta pasta não possui um repositório Git. Clone o projeto do GitHub para habilitar as atualizações.")
            return
        if not messagebox.askyesno("Atualizar aplicativo",
            "Criar um backup do banco e baixar a versão mais recente da branch main?\nO servidor será reiniciado."):
            return
        self.busy=True
        self.post("Preparando atualização segura pelo Git...")
        def task():
            previously_online=self.healthy()
            try:
                def git(*args):
                    flags=getattr(subprocess,"CREATE_NO_WINDOW",0)
                    return subprocess.run(["git",*args],cwd=ROOT,capture_output=True,text=True,
                        encoding="utf-8",errors="replace",timeout=90,creationflags=flags)
                status=git("status","--porcelain","--untracked-files=no")
                if status.returncode or status.stdout.strip():
                    self.post("Atualização cancelada: há alterações locais no código ou o Git falhou.")
                    return
                self.backup_database()
                self.stop()
                result=git("pull","--ff-only","origin","main")
                if result.returncode:
                    self.post("Falha ao atualizar: "+(result.stderr.strip() or result.stdout.strip()))
                    self.post("Nenhum reset forçado foi realizado.")
                else:
                    self.post("Git atualizado: "+(result.stdout.strip() or "já estava atualizado"))
            except FileNotFoundError:
                self.post("Git não instalado ou não está no PATH.")
            except Exception as e:
                self.post("Erro na atualização: "+str(e))
            finally:
                self.tasks.put(("finished",None))
                if previously_online:self.tasks.put(("restart",None))
        threading.Thread(target=task,daemon=True).start()

    def show_server_log(self):
        if not LOG.exists():return self.post("Ainda não há log do servidor.")
        try:
            lines=LOG.read_text(encoding="utf-8",errors="replace").splitlines()[-60:]
            self.post("--- ÚLTIMAS LINHAS DO SERVIDOR ---")
            for line in lines:self.post(line[:300])
        except Exception as e:self.post("Erro lendo log: "+str(e))

    def close(self):
        if self.busy and not messagebox.askyesno("Operação em andamento",
            "Há uma atualização ou backup em andamento. Deseja mesmo fechar o painel?"):return
        self.stop()
        self.root.destroy()

if __name__=="__main__":
    window=tk.Tk()
    Painel(window)
    window.mainloop()
