#!/usr/bin/env python3
"""Publica a Central pelo Caddy existente sem alterar sites/contêineres vizinhos.

Executar na VPS como root, em terminal interativo.
- Confirma bind mount do Caddyfile já em uso.
- Obtém a senha sem eco e calcula bcrypt pelo próprio Caddy, sem senha em argv.
- Faz backup fora dos repositórios Git.
- Acrescenta apenas um bloco de site e valida antes do hot reload.
- Reverte o conteúdo original se a validação ou o reload falhar.
"""
from __future__ import annotations

import fcntl
import getpass
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


def run(*args, data=None, check=True):
    result = subprocess.run(
        args, input=data, capture_output=True, timeout=75, check=False
    )
    if check and result.returncode:
        err = result.stderr.decode(errors="replace").strip()
        out = result.stdout.decode(errors="replace").strip()
        raise RuntimeError(f"Falha em {args[0]} {args[1] if len(args)>1 else ''}: {err or out}")
    return result


def assert_mount_and_network():
    result = run("docker", "inspect", CADDY)
    info = json.loads(result.stdout)[0]
    mounts = info.get("Mounts", [])
    if not any(
        m.get("Destination") == "/etc/caddy/Caddyfile"
        and m.get("Source") == str(CADDYFILE)
        for m in mounts
    ):
        raise RuntimeError("O Caddyfile em uso não corresponde ao caminho esperado. Nenhum arquivo alterado.")
    networks = info.get("NetworkSettings", {}).get("Networks", {})
    if NETWORK not in networks:
        raise RuntimeError("Caddy ainda não está ligado à rede privada da Central. Nada foi alterado.")
    if not CADDYFILE.is_file():
        raise RuntimeError("Caddyfile não encontrado. Nada foi alterado.")


def caddy_validate():
    run("docker", "exec", CADDY, "caddy", "validate",
        "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")


def caddy_reload():
    run("docker", "exec", CADDY, "caddy", "reload",
        "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")


def check_duplicate():
    content = CADDYFILE.read_text(encoding="utf-8")
    if DOMAIN in content:
        print("O domínio já aparece no Caddyfile. Nada foi modificado.")
        print("Confira manualmente a configuração existente antes de continuar.")
        return True
    return False


def get_directive():
    version = run("docker", "exec", CADDY, "caddy", "version").stdout.decode().strip()
    match = re.search(r"v?2\.(\d+)", version)
    if match and int(match.group(1)) < 8:
        return "basicauth"
    return "basic_auth"


def get_hash():
    user = input("Usuário de acesso ao PWA [admin]: ").strip() or "admin"
    if not re.fullmatch(r"[a-zA-Z0-9_.-]{1,40}", user):
        raise RuntimeError("Usuário inválido. Use letras, números, _ . ou -.")
    pwd = getpass.getpass("Crie uma senha forte (mínimo 12 caracteres): ")
    pwd2 = getpass.getpass("Repita a senha: ")
    if len(pwd) < 12 or pwd != pwd2:
        raise RuntimeError("A senha deve ter pelo menos 12 caracteres e as duas entradas devem coincidir.")
    # Sem --plaintext, a senha vai somente ao stdin do Caddy, nunca ao shell/ps.
    result = run("docker", "exec", "-i", CADDY, "caddy",
                 "hash-password", "--algorithm", "bcrypt",
                 data=(pwd + "\n").encode())
    pwd = None
    pwd2 = None
    lines = result.stdout.decode(errors="replace").strip().splitlines()
    hashes = [x.strip() for x in lines if x.strip().startswith(("$2a$", "$2b$", "$2y$"))]
    if not hashes:
        raise RuntimeError("Caddy não retornou hash bcrypt. Nenhum arquivo alterado.")
    return user, hashes[-1]


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Execute como root com: python3 deploy/vps/CONFIGURAR_CADDY.py")
    with open(LOCK, "a+", encoding="utf-8") as file_lock:
        fcntl.flock(file_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert_mount_and_network()
        if check_duplicate():
            return
        # Nunca modifica uma configuração já inválida.
        caddy_validate()
        user, pw_hash = get_hash()
        directive = get_directive()
        backup_name = f"Caddyfile_{datetime.now().strftime('%Y%m%d_%H%M%S')}.bak"
        BACKUPS.mkdir(parents=True, exist_ok=True)
        os.chmod(BACKUPS, 0o700)
        backup = BACKUPS / backup_name
        shutil.copy2(CADDYFILE, backup)
        os.chmod(backup, 0o600)
        snippet = (
            f"\n\n# CENTRAL DE CONTROLES — site isolado\n"
            f"{DOMAIN} {{\n"
            f"    {directive} {{\n"
            f"        {user} {pw_hash}\n"
            f"    }}\n"
            f"    reverse_proxy {BACKEND}\n"
            f"}}\n"
        )
        # Modificar o mesmo inode preserva a montagem bind do Docker.
        try:
            with CADDYFILE.open("a", encoding="utf-8") as output:
                output.write(snippet)
                output.flush()
                os.fsync(output.fileno())
            caddy_validate()
            caddy_reload()
        except Exception:
            # Não usar os.replace: arquivo de host está montado como bind.
            with backup.open("rb") as original, CADDYFILE.open("wb") as target:
                shutil.copyfileobj(original, target)
                target.flush()
                os.fsync(target.fileno())
            try:
                caddy_validate()
                caddy_reload()
                print("O arquivo anterior foi restaurado e recarregado.")
            except Exception as rollback_error:
                print(f"ATENÇÃO: falha ao recarregar backup: {rollback_error}", file=sys.stderr)
            raise
        print(f"CADDY PUBLICADO: https://{DOMAIN}")
        print(f"Usuário: {user}")
        print("Senha: a mesma que você digitou, NÃO foi salva em texto puro.")
        print(f"Backup da configuração anterior: {backup}")
        print("Se o DNS acabou de ser criado, o certificado HTTPS pode levar alguns minutos.")
        print("O Caddy foi recarregado sem reiniciar os demais serviços.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERRO: {error}", file=sys.stderr)
        sys.exit(1)
