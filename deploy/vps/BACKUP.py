#!/usr/bin/env python3
"""Backup SQLite consistente, verificado e com retenção (nunca envia dados ao GitHub)."""
from datetime import datetime, timedelta
import os
from pathlib import Path
import sqlite3

DATA = Path(os.getenv("CONTROLES_DATA_DIR", "/var/lib/meus-controles"))
OUT = Path(os.getenv("CONTROLES_BACKUP_DIR", "/var/backups/meus-controles"))
DAYS = 30


def backup():
    source = DATA / "controles.db"
    if not source.is_file():
        print("Backup ignorado: não existe banco de dados.")
        return None
    OUT.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    final = OUT / ("controles_" + timestamp + ".db")
    temp = OUT / ("." + final.name + ".partial")
    try:
        with sqlite3.connect(f"file:{source}?mode=ro", uri=True, timeout=30) as source_db:
            with sqlite3.connect(str(temp), timeout=30) as target_db:
                source_db.backup(target_db)
        with sqlite3.connect(f"file:{temp}?mode=ro", uri=True, timeout=10) as verify:
            result = verify.execute("PRAGMA quick_check").fetchone()
            if not result or result[0] != "ok":
                raise RuntimeError("Backup reprovado no PRAGMA quick_check.")
            if not verify.execute("SELECT 1 FROM sqlite_master WHERE name='controls'").fetchone():
                raise RuntimeError("Banco de backup não contém a tabela de controles.")
        os.chmod(temp, 0o600)
        os.replace(temp, final)
    finally:
        temp.unlink(missing_ok=True)
    old_cutoff = datetime.now() - timedelta(days=DAYS)
    candidates = sorted(OUT.glob("controles_*.db"), reverse=True)
    # Reter pelo menos os últimos sete backups válidos, independentemente da idade.
    for obsolete in candidates[7:]:
        try:
            if datetime.fromtimestamp(obsolete.stat().st_mtime) < old_cutoff:
                obsolete.unlink()
        except FileNotFoundError:
            pass
    print("Backup verificado:", final)
    return final


if __name__ == "__main__":
    backup()
