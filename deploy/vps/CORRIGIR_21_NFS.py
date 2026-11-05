"""Correção pontual, determinada pelo usuário, de 21 números de NF-e existentes.

NÃO importa notas, NÃO consulta o arquivo de 241 NF-e, NÃO muda fornecedor
cadastrado no pedido, produto, quantidade, valor ou chave de acesso.
O nome do emitente da nota prevalece sobre qualquer nome anterior.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import app


GRUPOS=(
    ("Agro Industrial São Luiz LTDA",
     (40704,40544,40708,40706,40602,40617,40541,40550,40558)),
    ("Mosaic Fertilizantes do Brasil LTDA",
     (48463,48458,48462,48413,48363,48420,48415,48417,48477)),
    ("Motta Agropecuária LTDA",
     (3800,3911,3870)),
)
EMITENTES={str(numero):emitente for emitente,numeros in GRUPOS for numero in numeros}
assert len(EMITENTES)==21


def numero_nf(value):
    """Normaliza apenas número da NF-e; nunca interpreta notação científica."""
    raw=str(value or "").strip()
    if not re.fullmatch(r"\d{1,3}(?:\.\d{3})*|\d{1,9}",raw):
        return None
    return str(int(raw.replace(".","")))


def conciliar(con,aplicar=False):
    """Consulta notas existentes; atualiza SOMENTE invoice_issuer em recebimentos.

    Mesmo que o campo tenha um nome anterior, o nome confirmado pelo usuário
    prevalece. Notas ausentes não são criadas. Backup é feito pelo script .sh.
    """
    if aplicar and not con.in_transaction:
        con.execute("BEGIN IMMEDIATE")
    existentes=list(con.execute("""
        SELECT r.id,r.invoice_number,r.invoice_issuer,i.control_id
        FROM purchase_receipts r
        JOIN purchase_items i ON i.id=r.item_id
        JOIN controls c ON c.id=i.control_id
        WHERE c.mode='recebimento'
        ORDER BY r.id
    """))
    presentes=set()
    alteracoes=[]
    inalteradas=[]
    for r in existentes:
        nf=numero_nf(r["invoice_number"])
        if nf not in EMITENTES:
            continue
        presentes.add(nf)
        esperado=EMITENTES[nf]
        anterior=str(r["invoice_issuer"] or "")
        entry={"id":r["id"],"controle":r["control_id"],"nf":nf,
               "anterior":anterior,"correto":esperado}
        if anterior==esperado:
            inalteradas.append(entry)
        else:
            alteracoes.append(entry)
    nao_encontradas=[nf for nf in EMITENTES if nf not in presentes]
    # Nunca considerar um banco incorreto / vazio como execução bem-sucedida.
    if aplicar and not presentes:
        raise RuntimeError(
            "NENHUMA das 21 notas foi localizada neste banco de recebimentos. "
            "Nenhuma alteração foi executada. Confira a VPS e o banco.")
    if aplicar:
        for entry in alteracoes:
            con.execute("""UPDATE purchase_receipts
                SET invoice_issuer=?,updated_at=CURRENT_TIMESTAMP
                WHERE id=? AND invoice_issuer=?""",
                (entry["correto"],entry["id"],entry["anterior"]))
            atual=con.execute(
                "SELECT invoice_issuer FROM purchase_receipts WHERE id=?",
                (entry["id"],)).fetchone()
            if not atual or atual["invoice_issuer"]!=entry["correto"]:
                raise RuntimeError("Falha ao atualizar NF "+entry["nf"]+
                                   " (id "+str(entry["id"])+"); transação revertida.")
        # Todas as alterações passam juntas; nada parcial.
        con.commit()
    return {"notas_confirmadas":len(EMITENTES),
            "numeros_encontrados":len(presentes),
            "registros_encontrados":len(alteracoes)+len(inalteradas),
            "registros_alterados":len(alteracoes) if aplicar else 0,
            "pendentes_de_atualizacao":0 if aplicar else len(alteracoes),
            "ja_corretos":len(inalteradas),
            "numeros_nao_encontrados":nao_encontradas,
            "detalhes":alteracoes,
            "alteracao_aplicada":aplicar}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply",action="store_true",
                        help="Aplicar os 21 nomes exatamente como confirmados.")
    args=parser.parse_args()
    with app.db() as con:
        resultado=conciliar(con,args.apply)
    print(json.dumps(resultado,ensure_ascii=False,indent=2))
    if args.apply:
        print("GRAVADO: "+str(resultado["registros_alterados"])+
              " emitente(s) corrigido(s); "+
              str(resultado["ja_corretos"])+" já correto(s); "+
              str(len(resultado["numeros_nao_encontrados"]))+
              " número(s) não encontrado(s).")
    else:
        print("DIAGNÓSTICO: nenhuma alteração ainda; "+
              str(resultado["pendentes_de_atualizacao"])+
              " registro(s) terão o emitente corrigido.")


if __name__=="__main__":
    main()
