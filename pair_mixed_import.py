"""Importação única de dívidas, pagamentos e registros neutros do Acerto A × B.

Os dois tipos existentes são validados antes de gravar e confirmados na MESMA
transação: se uma linha falhar, nenhuma parte do arquivo fica importada.
"""
import hashlib
import json

import pair_financial_import
import pair_records

FORMAT = "central-pair-mixed-v1"


def analyze(con, cid, payload):
    if not isinstance(payload, dict) or payload.get("format") != FORMAT:
        raise ValueError("Arquivo inválido. Use um JSON de lançamentos A × B.")
    if not isinstance(payload.get("movements"), list) or not payload["movements"]:
        raise ValueError("Informe as dívidas e pagamentos no arquivo.")
    if not isinstance(payload.get("records"), list) or not payload["records"]:
        raise ValueError("Informe os registros neutros no arquivo.")

    root = {key: payload[key] for key in ("target", "source_name") if key in payload}
    financial = {**root, "format": pair_financial_import.FORMAT,
                 "movements": payload["movements"]}
    neutral = {**root, "format": pair_records.FORMAT,
               "records": payload["records"]}
    f = pair_financial_import.analyze(con, cid, financial)
    n = pair_records.batch(con, cid, neutral)

    financial_rows = {r["source_row"] for r in f["movements"]}
    neutral_rows = {r["source_row"] for r in n["records"]}
    overlap = financial_rows & neutral_rows
    if overlap:
        raise ValueError("As linhas de origem estão duplicadas entre movimentos e registros: " +
                         ", ".join(map(str, sorted(overlap)[:20])) + ".")

    batch = hashlib.sha256(
        json.dumps({"financial": f["batch_id"], "neutral": n["batch_id"]},
                   sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "batch_id": batch,
        "source_name": f["source_name"],
        "count": f["count"] + n["count"],
        "new_count": f["new_count"] + n["new_count"],
        "already_imported": f["already_imported"] + n["already_imported"],
        "debt_count": f["debt_count"],
        "payment_count": f["payment_count"],
        "record_count": n["count"],
        "new_financial": f["new_count"],
        "new_neutral": n["new_count"],
        "debt_total": f["debt_total"],
        "payment_total": f["payment_total"],
        "neutral_total": n["total_recorded"],
        "net_of_file": f["net_of_file"],
        "current_balance": f["current_balance"],
        "missing_dates": f["missing_dates"],
        "unusual_dates": f["unusual_dates"],
        "neutral_warnings": n["warnings"],
        "financial_payload": financial,
        "neutral_payload": neutral,
        "financial_batch": f["batch_id"],
        "neutral_batch": n["batch_id"],
        "neutral_rows": n["records"],
    }


def preview(con, cid, payload):
    found = analyze(con, cid, payload)
    private_keys = {
        "financial_payload", "neutral_payload", "financial_batch",
        "neutral_batch", "neutral_rows",
    }
    return {key: value for key, value in found.items() if key not in private_keys}


def confirm(con, cid, request):
    if not isinstance(request, dict) or not isinstance(request.get("payload"), dict):
        raise ValueError("Selecione um arquivo JSON validado na prévia.")
    if con.in_transaction:
        raise ValueError("Há uma operação pendente. Tente novamente.")
    con.execute("BEGIN IMMEDIATE")
    try:
        checked = analyze(con, cid, request["payload"])
        if checked["batch_id"] != request.get("batch_id"):
            raise ValueError("O arquivo foi modificado após a prévia.")

        finance = pair_financial_import.confirm(con, cid, {
            "payload": checked["financial_payload"],
            "batch_id": checked["financial_batch"],
            "corrected_dates": request.get("corrected_dates", {}),
            "accept_unusual_dates": request.get("accept_unusual_dates", False),
            "accept_matching_existing": request.get("accept_matching_existing", False),
        }, commit=False)

        inserted_neutral = 0
        for r in checked["neutral_rows"]:
            fields = {key: value for key, value in r.items() if key != "source_row"}
            cur = con.execute("""INSERT OR IGNORE INTO pair_records
                (control_id,record_date,original_date,amount,from_name,to_name,
                 description,notes,original_type,original_balance,batch_id,source_row)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (cid, *fields.values(), checked["neutral_batch"], r["source_row"]))
            inserted_neutral += cur.rowcount

        con.commit()
    except Exception:
        con.rollback()
        raise

    return {
        "inserted": finance["inserted"] + inserted_neutral,
        "inserted_financial": finance["inserted"],
        "inserted_neutral": inserted_neutral,
        "skipped": checked["count"] - finance["inserted"] - inserted_neutral,
        "count": checked["count"],
        "batch_id": checked["batch_id"],
        "balance": finance["balance"],
        "settlement": finance["settlement"],
    }
