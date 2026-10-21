#!/usr/bin/env bash
# Instala um backup SQLite real vindo do PC, sem substituir dados silenciosamente.
set -euo pipefail
if [[ "$EUID" -ne 0 ]]; then echo "Execute com sudo/root." >&2; exit 1; fi
SOURCE="${1:-}"
if [[ -z "$SOURCE" || ! -f "$SOURCE" || -L "$SOURCE" ]]; then
  echo "Uso: sudo bash deploy/vps/MIGRAR_BANCO.sh /tmp/controles-do-pc.db" >&2; exit 1
fi
SOURCE="$(realpath "$SOURCE")"
TARGET=/var/lib/meus-controles/controles.db
if [[ "$SOURCE" == "$TARGET" ]]; then echo "Fonte e destino são o mesmo arquivo."; exit 1; fi
python3 - "$SOURCE" <<'PY'
import sqlite3, sys
path=sys.argv[1]
with sqlite3.connect("file:"+path+"?mode=ro",uri=True) as con:
    if con.execute("PRAGMA quick_check").fetchone()[0]!="ok":
        raise SystemExit("Banco de origem corrompido; migração cancelada.")
    tables={x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"boards","controls","pair_entries"}.issubset(tables):
        raise SystemExit("O arquivo não é um banco válido da Central de Controles.")
    print("Banco de origem válido. Controles:",con.execute("SELECT COUNT(*) FROM controls").fetchone()[0])
PY
echo "ATENÇÃO: o banco atual da VPS será substituído pelo arquivo do PC."
read -r -p "Digite MIGRAR para confirmar: " CONFIRM
[[ "$CONFIRM" == "MIGRAR" ]] || { echo "Cancelado. Nenhum dado alterado."; exit 1; }

systemctl stop meus-controles.service
# O backup só acontece após o banco atual parar, evitando conflito.
runuser -u meuscontroles -- env CONTROLES_DATA_DIR=/var/lib/meus-controles \
  CONTROLES_BACKUP_DIR=/var/backups/meus-controles \
  /usr/bin/python3 /opt/apps/meus-controles/deploy/vps/BACKUP.py
TMP=/var/lib/meus-controles/.controles-importando.db
install -o meuscontroles -g meuscontroles -m 0600 "$SOURCE" "$TMP"
mv -f "$TMP" "$TARGET"
chown meuscontroles:meuscontroles "$TARGET"
chmod 0600 "$TARGET"
systemctl start meus-controles.service
if curl --fail --silent --max-time 10 http://127.0.0.1:18765/api/health >/dev/null; then
  echo "Banco migrado. Central online. O backup anterior está em /var/backups/meus-controles."
else
  echo "O app não respondeu. NÃO execute novamente a migração; confira os logs:" >&2
  echo "journalctl -u meus-controles -n 80 --no-pager" >&2
  exit 1
fi
