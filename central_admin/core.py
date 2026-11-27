"""Leitura unificada, sem alterar bancos, comprovantes ou recebimentos."""
from __future__ import annotations

from collections import defaultdict
from contextlib import closing
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
import sqlite3
import unicodedata


class SourceUnavailable(RuntimeError):
    pass


def supplier_key(value):
    raw = unicodedata.normalize("NFKD", str(value or "").casefold())
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", raw).split())


def invoice_number(value):
    raw = str(value or "").strip()
    return str(int(raw)) if raw.isdecimal() and len(raw) <= 9 else None


def account_invoice_number(value):
    raw = str(value or "").strip()
    match = re.fullmatch(r"(?:NF-?E?|NOTA(?:\s+FISCAL)?)?\s*[\s.:\-#]*0*(\d{1,9})\s*", raw, flags=re.I)
    return str(int(match.group(1))) if match else None


def access_key(value):
    match = re.search(r"(?<!\d)\d{44}(?!\d)", str(value or ""))
    return match.group(0) if match else None


def amount(value):
    try:
        number = Decimal(str(value if value is not None else 0))
        return number if number.is_finite() else Decimal("0")
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def read_accounts(path):
    """Consulta o SQLite financeiro original em modo somente leitura."""
    if not path or not Path(path).is_file():
        raise SourceUnavailable("Banco de Contas não configurado ou indisponível.")
    try:
        uri = Path(path).resolve().as_uri() + "?mode=ro"
        with closing(sqlite3.connect(uri, uri=True, timeout=5)) as con:
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA query_only=ON")
            rows = con.execute("""
                SELECT c.id, c.fornecedor, c.documento, c.referencia, c.valor, c.vencimento,
                       CASE WHEN EXISTS (
                         SELECT 1 FROM pagamentos p WHERE p.conta_id=c.id
                         AND p.data_pagamento IS NOT NULL
                         AND TRIM(p.data_pagamento)<>''
                       ) THEN 1 ELSE 0 END AS paga
                FROM contas c ORDER BY c.vencimento, c.id DESC
            """).fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        raise SourceUnavailable("Falha ao consultar Contas em modo leitura.") from exc


def read_receipts(dsn):
    """Consulta as notas recebidas no PostgreSQL sem escrever nada."""
    if not dsn:
        raise SourceUnavailable("Conexão do Meus Controles não configurada.")
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise SourceUnavailable("Driver psycopg não instalado.") from exc
    try:
        with psycopg.connect(dsn, connect_timeout=5,
                             options="-c default_transaction_read_only=on",
                             row_factory=dict_row) as con:
            with con.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS total FROM purchase_items")
                total = int(cur.fetchone()["total"])
                cur.execute("""
                    SELECT r.id, r.access_key, r.invoice_number,
                           COALESCE(NULLIF(r.invoice_issuer,''), i.supplier) AS supplier,
                           i.order_number
                    FROM purchase_receipts r
                    JOIN purchase_items i ON i.id=r.item_id
                    ORDER BY r.id DESC
                """)
                rows = cur.fetchall()
        return {"itens": total, "linhas": rows}
    except Exception as exc:
        raise SourceUnavailable("Falha ao consultar recebimentos em modo leitura.") from exc


def unique_invoices(rows):
    """Agrupa vários itens da mesma NF-e para não inflar os totais."""
    seen, result = set(), []
    for row in rows:
        key = access_key(row.get("access_key"))
        number = invoice_number(row.get("invoice_number"))
        supplier = supplier_key(row.get("supplier"))
        identity = ("chave", key) if key else ("numero", number, supplier)
        if identity in seen:
            continue
        seen.add(identity)
        result.append({
            "receipt_id": row["id"], "access_key": key or "",
            "invoice_number": str(row.get("invoice_number") or ""),
            "supplier": str(row.get("supplier") or ""),
            "order_number": str(row.get("order_number") or ""),
        })
    return result


def matches(accounts, invoices):
    """Sugere só correspondências únicas; não cria vínculos nem pagamentos."""
    by_key, by_pair = defaultdict(list), defaultdict(list)
    for inv in invoices:
        if inv["access_key"]:
            by_key[inv["access_key"]].append(inv)
        number = invoice_number(inv["invoice_number"])
        supplier = supplier_key(inv["supplier"])
        if number and supplier:
            by_pair[(number, supplier)].append(inv)
    suggestions = []
    for acc in accounts:
        if acc["paga"]:
            continue
        key = access_key(acc.get("documento")) or access_key(acc.get("referencia"))
        found = by_key.get(key, []) if key else []
        reason = "Chave NF-e exata" if found else ""
        if not found:
            number = account_invoice_number(acc.get("documento"))
            supplier = supplier_key(acc.get("fornecedor"))
            if number and supplier:
                found = by_pair.get((number, supplier), [])
                reason = "Número da nota e fornecedor exatos"
        if len(found) == 1:
            inv = found[0]
            suggestions.append({
                "account_id": acc["id"], "supplier": str(acc.get("fornecedor") or ""),
                "account_document": str(acc.get("documento") or ""),
                "invoice_number": inv["invoice_number"],
                "receipt_id": inv["receipt_id"], "reason": reason,
                "review_required": True,
            })
    return suggestions


def summarize_accounts(accounts):
    today = date.today().isoformat()
    unpaid = [a for a in accounts if not a["paga"]]
    overdue = {a["id"] for a in unpaid if
               re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(a.get("vencimento") or "")[:10])
               and str(a["vencimento"])[:10] < today}
    total = sum((amount(a["valor"]) for a in unpaid), Decimal("0"))
    return {
        "total": len(accounts), "em_aberto": len(unpaid),
        "vencidas": len(overdue),
        "valor_em_aberto": str(total.quantize(Decimal("0.01"))),
        "proximas": [{
            "id": a["id"], "fornecedor": str(a.get("fornecedor") or ""),
            "documento": str(a.get("documento") or ""),
            "vencimento": str(a.get("vencimento") or ""),
            "valor": str(amount(a.get("valor"))),
            "status": "Vencida" if a["id"] in overdue else "Em aberto",
        } for a in unpaid[:50]],
    }


def snapshot(contas_path, controles_dsn):
    result = {
        "ok": False, "modo": "somente_leitura",
        "fontes": {"contas": {"disponivel": False}, "controles": {"disponivel": False}},
        "contas": None, "controles": None, "sugestoes": [],
    }
    accounts, invoices = None, None
    try:
        accounts = read_accounts(contas_path)
        result["fontes"]["contas"] = {"disponivel": True}
        result["contas"] = summarize_accounts(accounts)
    except SourceUnavailable as exc:
        result["fontes"]["contas"]["erro"] = str(exc)
    try:
        data = read_receipts(controles_dsn)
        invoices = unique_invoices(data["linhas"])
        result["fontes"]["controles"] = {"disponivel": True}
        result["controles"] = {
            "itens_pedido": data["itens"], "linhas_recebidas": len(data["linhas"]),
            "notas": len(invoices), "recentes": invoices[:50],
        }
    except SourceUnavailable as exc:
        result["fontes"]["controles"]["erro"] = str(exc)
    if accounts is not None and invoices is not None:
        result["sugestoes"] = matches(accounts, invoices)[:100]
    result["ok"] = accounts is not None or invoices is not None
    return result
