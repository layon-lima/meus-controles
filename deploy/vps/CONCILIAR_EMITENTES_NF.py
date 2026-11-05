"""Reconcilia emitentes de NF-e de uma lista conferida, sem tocar nas entregas.

Modo padrão: diagnóstico SOMENTE LEITURA.
Aplicar: python deploy/vps/CONCILIAR_EMITENTES_NF.py --apply
Exige backup completo PostgreSQL antes da aplicação.

Uma nota é alterada APENAS se:
 - número da NF-e coincide com a fonte;
 - chave de acesso original do sistema tem 44 dígitos;
 - CNPJ da chave confirma exatamente o CNPJ da fonte;
 - número da nota embutido na chave confirma o número cadastrado;
 - ano/mês da chave confirma a emissão da fonte;
 - o campo emitente estava vazio (nunca sobrescreve emitente já salvo).
Todas as alterações são auditadas e atômicas.
"""
import argparse
import hashlib
import csv
import json
import re
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import app

SOURCE=Path(__file__).with_name("emitentes_nf_20261105.csv")
LIMIT=20000


def digits(value):
    return re.sub(r"\D","",str(value or ""))


def normalized_note(value):
    value=str(value or "").strip().replace(".","").replace(",","")
    if not re.fullmatch(r"\d{1,9}",value):
        return None
    return str(int(value))


def match_digest(kind,value):
    return hashlib.sha256((kind+"|"+value).encode("ascii")).hexdigest()


def load_source(path=SOURCE):
    """Lê tokens SHA-256. O arquivo público não contém números ou chaves fiscais."""
    items={}
    with path.open(encoding="utf-8-sig",newline="") as file:
        reader=csv.DictReader(file,delimiter=";")
        if not {"tipo","hash_sha256","emitente"}.issubset(reader.fieldnames or []):
            raise ValueError("Arquivo de emitentes inválido: cabeçalhos ausentes.")
        for row_index,row in enumerate(reader,2):
            kind=str(row["tipo"] or "").strip()
            digest=str(row["hash_sha256"] or "").strip().lower()
            issuer=str(row["emitente"] or "").strip()
            if kind not in ("K","T") or not re.fullmatch(r"[0-9a-f]{64}",digest) or not issuer:
                raise ValueError("Identificador de emitente inválido na linha "+str(row_index))
            old=items.get(digest)
            if old and old["issuer"]!=issuer:
                raise ValueError("Emitentes conflitantes para o mesmo identificador na linha "+
                                 str(row_index))
            items[digest]={"issuer":issuer,"kind":kind}
    return items

def build_plan(con,source):
    receipts=[dict(r) for r in con.execute("""
        SELECT r.id,r.invoice_number,r.access_key,r.received_date,
               r.invoice_issuer,r.invoice_issuer_document,
               i.control_id,i.product
          FROM purchase_receipts r
          JOIN purchase_items i ON i.id=r.item_id
         ORDER BY r.id
    """)]
    if len(receipts)>LIMIT:
        raise ValueError("Há mais de 20 mil registros; usar análise paginada antes de aplicar.")
    changes=[]
    report={"fonte_nf":len(source),"recibos_verificados":len(receipts),
            "candidatos":0,"ja_preenchidos":0,"sem_correspondencia":0,
            "chave_invalida":0,"chave_divergente":0,"conflitos":0,
            "chave_exata_divergente":0,
            "alteracoes":[],"avisos":[]}
    for r in receipts:
        number=normalized_note(r["invoice_number"])
        if not number:
            continue
        key=str(r["access_key"] or "").strip()
        if not re.fullmatch(r"\d{44}",key):
            report["chave_invalida"]+=1
            report["avisos"].append({"id":r["id"],"nf":r["invoice_number"],
                                     "motivo":"Chave original ausente ou inválida"})
            continue
        embedded=str(int(key[25:34]))
        key_cnpj=key[6:20]
        month=key[2:6]
        if embedded!=number:
            report["chave_divergente"]+=1
            report["avisos"].append({"id":r["id"],"nf":r["invoice_number"],
                                     "motivo":"Número da NF não coincide com a chave"})
            continue
        # Sempre priorizar correspondência pela chave completa exata.
        # Para 30 notas da primeira tabela sem chave legível, comparar
        # número + CNPJ/CPF + ano/mês EXTRAÍDOS DA CHAVE ORIGINAL DO BANCO.
        key_hash=match_digest("K",key)
        tuple_hash=match_digest("T",number+"|"+key_cnpj+"|"+month)
        match=source.get(key_hash) or source.get(tuple_hash)
        if not match:
            report["sem_correspondencia"]+=1
            if len(report["avisos"])<30:
                report["avisos"].append({"id":r["id"],"nf":r["invoice_number"],
                                         "motivo":"Chave ou combinação número/CNPJ/mês não está na fonte"})
            continue
        # O dado do XML original tem precedência sobre a tabela fornecida.
        old_name=str(r["invoice_issuer"] or "").strip()
        old_doc=digits(r["invoice_issuer_document"])
        if old_name:
            report["ja_preenchidos"]+=1
            if old_doc and old_doc!=match["cnpj"]:
                report["conflitos"]+=1
                report["avisos"].append({"id":r["id"],"nf":number,
                                         "motivo":"CNPJ já cadastrado diverge da chave"})
            continue
        if old_doc and old_doc!=match["cnpj"]:
            report["conflitos"]+=1
            report["avisos"].append({"id":r["id"],"nf":number,
                                     "motivo":"CNPJ existente difere do CNPJ da fonte"})
            continue
        entry={"id":r["id"],"numero":number,"control_id":r["control_id"],
               "emitente":match["issuer"],"cnpj":match["cnpj"],
               "chave":key,"anterior_nome":r["invoice_issuer"],
               "anterior_cnpj":r["invoice_issuer_document"]}
        changes.append(entry)
        report["alteracoes"].append({"id":r["id"],"numero":number,
                                     "emitente":match["issuer"]})
    report["candidatos"]=len(changes)
    return changes,report


def reconcile(con,source,apply=False):
    if not apply:
        return build_plan(con,source)[1]
    if not con.in_transaction:
        con.execute("BEGIN IMMEDIATE")
    changes,report=build_plan(con,source)
    con.execute("""CREATE TABLE IF NOT EXISTS nf_issuer_reconciliation_audit (
        id INTEGER PRIMARY KEY,
        receipt_id INTEGER NOT NULL,
        invoice_number TEXT NOT NULL,
        access_key TEXT NOT NULL,
        old_issuer TEXT NOT NULL,
        old_document TEXT NOT NULL,
        new_issuer TEXT NOT NULL,
        new_document TEXT NOT NULL,
        source_name TEXT NOT NULL,
        changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    for change in changes:
        con.execute("""UPDATE purchase_receipts
            SET invoice_issuer=?,invoice_issuer_document=?,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND invoice_issuer='' AND access_key=?""",(
                change["emitente"],change["cnpj"],change["id"],change["chave"]))
        row=con.execute("""SELECT invoice_issuer,invoice_issuer_document
            FROM purchase_receipts WHERE id=?""",(change["id"],)).fetchone()
        if not row or row["invoice_issuer"]!=change["emitente"] or digits(
                row["invoice_issuer_document"])!=change["cnpj"]:
            raise ValueError("Falha na validação final da nota "+change["numero"]+
                             ". Todas as alterações foram revertidas.")
        # No PostgreSQL, INTEGER PRIMARY KEY não gera IDs automaticamente
        # (ao contrário de SQLite). O ID do recibo é único e estável, então
        # também identifica o registro de auditoria sem depender de SERIAL.
        con.execute("""INSERT INTO nf_issuer_reconciliation_audit (
            id,receipt_id,invoice_number,access_key,
            old_issuer,old_document,new_issuer,new_document,source_name)
            VALUES(?,?,?,?,?,?,?,?,?)""",(
                change["id"],change["id"],change["numero"],change["chave"],
                str(change["anterior_nome"] or ""),str(change["anterior_cnpj"] or ""),
                change["emitente"],change["cnpj"],SOURCE.name))
    con.commit()
    report["aplicadas"]=len(changes)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    source=load_source()
    with app.db() as con:
        result=reconcile(con,source,apply=args.apply)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if args.apply:
        if result.get("aplicadas",0)>0:
            print("CONCLUÍDO: "+str(result["aplicadas"])+
                  " registro(s) alterado(s), com auditoria.")
        else:
            print("ATENÇÃO: ZERO registros alterados. Veja candidatos, avisos e chaves acima.")
    else:
        print("DIAGNÓSTICO SOMENTE LEITURA: "+
              str(result["candidatos"])+" registro(s) apto(s) à correção.")


if __name__=="__main__":
    main()
