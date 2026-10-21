#!/usr/bin/env python3
"""Adiciona (ou ajusta) SOMENTE o site da Central no Caddy existente.

Não pede usuário nem senha. ATENÇÃO: o aplicativo fica acessível sem login.
Faz backup; confere bind mount/rede; valida e recarrega Caddy com rollback.
"""
from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime

DOMAIN = "controles.fazendanovohorizonte.com"
CADDY = "pluv-https-caddy-1"
CADDYFILE = Path("/opt/apps/pluviometros/source/deploy/Caddyfile")
BACKUPS = Path("/root/caddy-config-backups")
NETWORK = "meus-controles_interface_web"
BACKEND = "central-controles-api:18765"
LOCK = "/run/lock/central-configurar-caddy.lock"
MARKER = "# CENTRAL DE CONTROLES — site isolado"


def run(*args):
    result = subprocess.run(args, capture_output=True, timeout=75, check=False)
    if result.returncode:
        reason = (result.stderr or result.stdout).decode(errors="replace").strip()
        raise RuntimeError(f"Comando {args[0]} falhou: {reason}")
    return result


def assert_mount_and_network():
    info = json.loads(run("docker", "inspect", CADDY).stdout)[0]
    if not any(
        m.get("Destination") == "/etc/caddy/Caddyfile"
        and m.get("Source") == str(CADDYFILE)
        for m in info.get("Mounts", [])
    ):
        raise RuntimeError("Caddyfile montado em caminho inesperado. Nenhuma alteração.")
    if NETWORK not in info.get("NetworkSettings", {}).get("Networks", {}):
        raise RuntimeError("Rede privada da Central não está conectada ao Caddy.")
    if not CADDYFILE.is_file():
        raise RuntimeError("Caddyfile não encontrado.")


def caddy_validate():
    run("docker", "exec", CADDY, "caddy", "validate",
        "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")


def caddy_reload():
    run("docker", "exec", CADDY, "caddy", "reload",
        "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")


def render_site():
    return f"{MARKER}\n{DOMAIN} {{\n    reverse_proxy {BACKEND}\n}}\n"


def replace_site(text):
    """Modifica apenas o bloco de site criado para a Central."""
    pos = text.find(MARKER)
    if pos < 0:
        if DOMAIN in text:
            raise RuntimeError(
                "O domínio já existe fora do bloco gerenciado. "
                "Configuração preservada; confira o Caddyfile manualmente."
            )
        return text.rstrip("\n") + "\n\n" + render_site(), True

    if text.find(MARKER, pos + len(MARKER)) >= 0:
        raise RuntimeError("Há mais de um bloco gerenciado. Nenhuma alteração.")

    domain_line = re.compile(r"(?m)^[ \t]*" + re.escape(DOMAIN) + r"[ \t]*\{[ \t]*$")
    header = domain_line.search(text, pos + len(MARKER))
    if header is None or text[pos + len(MARKER):header.start()].strip():
        raise RuntimeError("Bloco gerenciado inesperado: nenhuma alteração.")

    start = header.end() - 1
    depth = 0
    stop = None
    for i in range(start, len(text)):
        char = text[i]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                stop = i + 1
                break
    if stop is None:
        raise RuntimeError("Bloco da Central sem fechamento: nenhuma alteração.")

    current = text[header.start():stop]
    # Somente autorizar a remoção da autenticação antiga no site conhecido:
    # um proxy exato e, opcionalmente, um bloco Basic Auth criado pelo instalador anterior.
    body = current[current.find("{") + 1:current.rfind("}")]
    body = re.sub(
        r"(?ms)^[ \t]*(?:basic_auth|basicauth)[ \t]*\{[ \t]*\n"
        r"[ \t]*[a-zA-Z0-9_.-]+[ \t]+\$2[abxy]\$[^\n{}]+[ \t]*\n"
        r"[ \t]*\}[ \t]*\n?",
        "", body
    )
    if body.strip() != f"reverse_proxy {BACKEND}":
        raise RuntimeError(
            "O site da Central tem diretivas diferentes do modelo esperado. "
            "Nenhuma autenticação será removida automaticamente."
        )
    if DOMAIN in text[:pos] or DOMAIN in text[stop:]:
        raise RuntimeError("Domínio duplicado fora do bloco gerenciado.")

    end = stop + (1 if text[stop:stop + 1] == "\n" else 0)
    replacement = render_site()
    beginning = text[:pos]
    updated = beginning + replacement + text[end:]
    return updated, updated != text


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Execute como root.")
    with open(LOCK, "a+", encoding="utf-8") as file_lock:
        fcntl.flock(file_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert_mount_and_network()
        caddy_validate()
        original = CADDYFILE.read_text(encoding="utf-8")
        modified, changed = replace_site(original)
        if not changed:
            print("Caddy já está configurado para a Central, sem usuário e senha.")
            return

        BACKUPS.mkdir(parents=True, exist_ok=True)
        os.chmod(BACKUPS, 0o700)
        backup = BACKUPS / (
            "Caddyfile_" + datetime.now().strftime("%Y%m%d_%H%M%S_%f") + ".bak"
        )
        shutil.copy2(CADDYFILE, backup)
        os.chmod(backup, 0o600)
        print("ATENÇÃO: sem autenticação, qualquer pessoa com o link terá acesso aos controles.")
        try:
            # O Caddyfile é um bind mount: manter o mesmo inode.
            with CADDYFILE.open("w", encoding="utf-8") as handle:
                handle.write(modified)
                handle.flush()
                os.fsync(handle.fileno())
            caddy_validate()
            caddy_reload()
        except Exception:
            with backup.open("rb") as source, CADDYFILE.open("wb") as target:
                shutil.copyfileobj(source, target)
                target.flush()
                os.fsync(target.fileno())
            try:
                caddy_validate()
                caddy_reload()
                print("Configuração anterior restaurada.")
            except Exception as error:
                print(f"Falha ao recarregar configuração anterior: {error}", file=sys.stderr)
            raise
        print(f"Rota publicada: https://{DOMAIN}")
        print("Sem prompt de usuário ou senha.")
        print(f"Backup do Caddyfile anterior: {backup}")
        print("Demais sites preservados.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERRO: {error}", file=sys.stderr)
        sys.exit(1)
