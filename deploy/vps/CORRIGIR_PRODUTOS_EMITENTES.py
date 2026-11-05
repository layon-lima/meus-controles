"""Corrige somente o emitente das notas de recebimento já cadastradas.

Regras confirmadas pelo usuário:
  - Produto KCL 00-00-60 -> EUROCHEIM
  - Produtos CALCARIO / GESSO -> CALTINS CALCARIO TOCATINS LTDA

Não cria notas, não altera o fornecedor do pedido, produto, quantidade,
valor, número, chave da NF-e ou documento de identificação.
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import app


KCL_EMITENTE = "EUROCHEIM"
CALCARIO_GESSO_EMITENTE = "CALTINS CALCARIO TOCATINS LTDA"


def normalizar_produto(value):
    text = unicodedata.normalize("NFKD", str(value or "").upper())
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[\u2010-\u2015\u2212]", "-", text)
    return re.sub(r"\s+", " ", text).strip()


def emitente_por_produto(value):
    produto = normalizar_produto(value)
    if re.search(r"\bKCL\s+00\s*-\s*00\s*-\s*60\b", produto):
        return KCL_EMITENTE
    if re.search(r"\b(CALCARIO|GESSO)\b", produto):
        return CALCARIO_GESSO_EMITENTE
    return None


def corrigir(con, aplicar=False):
    """Atualiza exclusivamente invoice_issuer de NF-e existentes de recebimento."""
    if aplicar and not con.in_transaction:
        con.execute("BEGIN IMMEDIATE")
    notas = [dict(r) for r in con.execute("""
        SELECT r.id, r.invoice_number, r.invoice_issuer,
               i.product, i.control_id
          FROM purchase_receipts r
          JOIN purchase_items i ON i.id = r.item_id
          JOIN controls c ON c.id = i.control_id
         WHERE c.mode = 'recebimento'
         ORDER BY r.id
    """)]

    alteracoes = []
    ja_corretos = []
    por_regra = {
        "KCL 00-00-60": {"existentes": 0, "a_corrigir": 0},
        "CALCARIO / GESSO": {"existentes": 0, "a_corrigir": 0},
    }
    for nota in notas:
        emitente = emitente_por_produto(nota["product"])
        if emitente is None:
            continue
        regra = "KCL 00-00-60" if emitente == KCL_EMITENTE else "CALCARIO / GESSO"
        por_regra[regra]["existentes"] += 1
        atual = str(nota["invoice_issuer"] or "")
        registro = {
            "id": nota["id"],
            "numero_nf": nota["invoice_number"],
            "produto": nota["product"],
            "emitente_anterior": atual,
            "emitente_correto": emitente,
        }
        if atual == emitente:
            ja_corretos.append(registro)
        else:
            por_regra[regra]["a_corrigir"] += 1
            alteracoes.append(registro)

    if aplicar:
        if not any(r["existentes"] for r in por_regra.values()):
            raise RuntimeError(
                "Nenhuma NF-e existente dos produtos KCL 00-00-60, CALCARIO ou GESSO "
                "foi localizada no banco de recebimentos. Nada foi alterado."
            )
        for registro in alteracoes:
            con.execute("""
                UPDATE purchase_receipts
                   SET invoice_issuer = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND invoice_issuer = ?
            """, (
                registro["emitente_correto"],
                registro["id"],
                registro["emitente_anterior"],
            ))
            confirmacao = con.execute(
                "SELECT invoice_issuer FROM purchase_receipts WHERE id = ?",
                (registro["id"],),
            ).fetchone()
            if not confirmacao or confirmacao["invoice_issuer"] != registro["emitente_correto"]:
                raise RuntimeError(
                    f"Não foi possível corrigir a NF {registro['numero_nf']} "
                    f"(id {registro['id']}). Transação revertida."
                )
        con.commit()

    return {
        "regras": {
            "KCL 00-00-60": KCL_EMITENTE,
            "CALCARIO / GESSO": CALCARIO_GESSO_EMITENTE,
        },
        "por_produto": por_regra,
        "notas_encontradas": sum(r["existentes"] for r in por_regra.values()),
        "notas_ja_corretas": len(ja_corretos),
        "notas_a_corrigir": len(alteracoes),
        "notas_alteradas": len(alteracoes) if aplicar else 0,
        "detalhes": alteracoes,
        "aplicado": aplicar,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    with app.db() as con:
        resultado = corrigir(con, aplicar=args.apply)
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
    if args.apply:
        print(
            f"CONFIRMADO: {resultado['notas_alteradas']} nota(s) alterada(s), "
            f"{resultado['notas_ja_corretas']} já correta(s)."
        )
    else:
        print(
            f"DIAGNÓSTICO: {resultado['notas_encontradas']} nota(s) existente(s); "
            f"{resultado['notas_a_corrigir']} aguardando correção; nenhum dado alterado."
        )


if __name__ == "__main__":
    main()
