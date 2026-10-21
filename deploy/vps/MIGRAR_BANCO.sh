#!/usr/bin/env bash
# Instala um backup SQLite real vindo do PC, sem substituir dados silenciosamente.
set -euo pipefail
if [[ "$EUID" -ne 0 ]]; then echo "Execute com sudo/root." >&2; exit 1; fi
SOURCE="${1:-}"
if [[ -z "$SOURCE" || ! -f "$SOURCE" || -L "$SOURCE" ]]; then
  echo "Uso: sudo bash deploy/vps/MIGRAR_BANCO.sh /root/controles-do-pc.db" >&2; exit 1
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
# Em qualquer falha durante a cópia, o serviço anterior volta a iniciar.
trap 'systemctl start meus-controles.service >/dev/null 2>&1 || true' EXIT
# O backup acontece após o banco atual parar, evitando conflito.
BACKUP_RESULT="$(runuser -u meuscontroles -- env CONTROLES_DATA_DIR=/var/lib/meus-controles \
  CONTROLES_BACKUP_DIR=/var/backups/meus-controles \
  /usr/bin/python3 /opt/apps/meus-controles/deploy/vps/BACKUP.py)"
echo "$BACKUP_RESULT"
BACKUP_FILE=""
if [[ "$BACKUP_RESULT" == "Backup verificado: "* ]]; then
  BACKUP_FILE="${BACKUP_RESULT#Backup verificado: }"
fi
TMP=/var/lib/meus-controles/.controles-importando.db
install -o meuscontroles -g meuscontroles -m 0600 "$SOURCE" "$TMP"
mv -f "$TMP" "$TARGET"
chown meuscontroles:meuscontroles "$TARGET"
chmod 0600 "$TARGET"
systemctl start meus-controles.service
OK=0
for i in {1..10}; do
  if curl --fail --silent --max-time 4 http://127.0.0.1:18765/api/health >/dev/null; then
    OK=1; break
  fi
  sleep 1
done
if [[ "$OK" -ne 1 ]]; then
  echo "O banco migrado não iniciou. Tentando restaurar o banco anterior..." >&2
  systemctl stop meus-controles.service
  if [[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]]; then
    install -o meuscontroles -g meuscontroles -m 0600 "$BACKUP_FILE" "$TARGET"
    systemctl start meus-controles.service
    echo "Banco anterior restaurado. Consulte: journalctl -u meus-controles -n 80" >&2
  else
    echo "Não há backup anterior; arquivo importado preservado para diagnóstico." >&2
  fi
  exit 1
fi
trap - EXIT
echo "Banco migrado. Central online. Backup anterior preservado em /var/backups/meus-controles."
