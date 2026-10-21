#!/usr/bin/env bash
set -euo pipefail
if ! /usr/bin/curl --fail --silent --show-error --max-time 8 http://127.0.0.1:18765/api/health | /usr/bin/grep -q '"ok": true'; then
  # Não interfere em nenhum outro serviço ou porta da VPS.
  /usr/bin/systemctl restart meus-controles.service
fi
