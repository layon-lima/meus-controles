"""Envio confiável e não bloqueante de recebimentos ao GFARM.

O Controles guarda o documento e entrega uma cópia fiscal; apenas o GFARM
aprova e movimenta estoque. Integração desligada sem URL/token no ambiente.
"""
from __future__ import annotations

from datetime import datetime
import json
import os
import threading
import time
import urllib.error
import urllib.request

def initialize(con):
    con.executescript("""
        CREATE TABLE IF NOT EXISTS receiving_gfarm_queue(
            receipt_id INTEGER PRIMARY KEY REFERENCES purchase_receipts(id) ON DELETE CASCADE,
            sent_at TEXT,
            remote_status TEXT NOT NULL DEFAULT 'AGUARDANDO_ENVIO',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    """)
    columns={x["name"] for x in con.execute("PRAGMA table_info(purchase_receipts)")}
    if "fiscal_json" not in columns:
        con.execute("ALTER TABLE purchase_receipts ADD COLUMN fiscal_json TEXT NOT NULL DEFAULT '{}'")
    pending={x["name"] for x in con.execute("PRAGMA table_info(receiving_xml_pending)")}
    if pending and "fiscal_json" not in pending:
        con.execute("ALTER TABLE receiving_xml_pending ADD COLUMN fiscal_json TEXT NOT NULL DEFAULT '{}'")


def fiscal_required():
    """Obrigatório em instalações que ativaram a comunicação com GFARM."""
    return _connection() is not None


def fiscal_manual(payload, *, exigir=True):
    """Campos solicitados ao operador quando não houve leitura de documento."""
    if not isinstance(payload, dict):
        raise ValueError("Dados fiscais inválidos.")
    fields={
        "serie": str(payload.get("serie") or "").strip()[:20],
        "data_emissao": str(payload.get("data_emissao") or "").strip()[:10],
        "fornecedor": str(payload.get("fornecedor") or "").strip()[:240],
        "documento_fornecedor": "".join(c for c in str(payload.get("documento_fornecedor") or "") if c.isdigit())[:20],
        "codigo_produto": str(payload.get("codigo_produto") or "").strip()[:100],
        "valor_unitario": str(payload.get("valor_unitario") or "").strip().replace(",", "."),
        "valor_total": str(payload.get("valor_total") or "").strip().replace(",", "."),
        "cfop": str(payload.get("cfop") or "").strip()[:10],
        "ncm": str(payload.get("ncm") or "").strip()[:12],
        "lote": str(payload.get("lote") or "").strip()[:100],
        "validade": str(payload.get("validade") or "").strip()[:10],
        "origem_arquivo": str(payload.get("origem_arquivo") or "manual")[:30],
    }
    if exigir:
        if not fields["serie"] or not fields["data_emissao"] or not fields["fornecedor"] or not fields["documento_fornecedor"]:
            raise ValueError("Informe série, emissão, fornecedor e CPF/CNPJ do emitente para o GFARM.")
        if not fields["valor_unitario"]:
            raise ValueError("Informe o valor unitário de cada produto para o GFARM.")
    from datetime import date
    from decimal import Decimal, InvalidOperation
    if fields["data_emissao"]:
        try: date.fromisoformat(fields["data_emissao"])
        except ValueError: raise ValueError("Data de emissão inválida.") from None
    if fields["validade"]:
        try: date.fromisoformat(fields["validade"])
        except ValueError: raise ValueError("Validade inválida.") from None
    for name in ("valor_unitario","valor_total"):
        if fields[name]:
            try: n=Decimal(fields[name])
            except InvalidOperation: raise ValueError("Valor fiscal inválido: "+name) from None
            if not n.is_finite() or n < 0: raise ValueError("Valor fiscal inválido: "+name)
            fields[name]=str(n)
        else:
            fields[name]=None
    return fields


def queue(con, receipt_id, fiscal=None):
    if fiscal is not None:
        con.execute("UPDATE purchase_receipts SET fiscal_json=? WHERE id=?",
                    (json.dumps(fiscal,ensure_ascii=False), receipt_id))
    con.execute("""
        INSERT INTO receiving_gfarm_queue(receipt_id) VALUES(?)
        ON CONFLICT(receipt_id) DO UPDATE SET
            sent_at=NULL, remote_status='AGUARDANDO_ENVIO',
            last_error='', updated_at=CURRENT_TIMESTAMP
    """, (receipt_id,))


def _connection():
    url=os.environ.get("GFARM_RECEBIMENTOS_URL","").strip()
    token=os.environ.get("GFARM_RECEBIMENTOS_TOKEN","").strip()
    # URL somente interna, nunca enviar token por HTTP público nem a hosts arbitrários.
    if not url or not token or not url.startswith("http://gfarm-app-1:8000/"):
        return None
    return url.rstrip("/"), token


def _request(endpoint,token,method="GET",payload=None):
    data=json.dumps(payload,ensure_ascii=False).encode("utf-8") if payload is not None else None
    req=urllib.request.Request(endpoint,data=data,method=method,headers={
        "X-Integracao-Token":token,"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=8) as response:
        return json.loads(response.read(64*1024))


def assert_editable(con,receipt_id):
    row=con.execute("SELECT * FROM receiving_gfarm_queue WHERE receipt_id=?",(receipt_id,)).fetchone()
    if not row or not row["sent_at"]:
        return
    link=_connection()
    if not link:
        raise ValueError("Recebimento já integrado. Configure a conexão com o GFARM para alterá-lo.")
    try:
        response=_request(link[0]+"/status/controles:receipt:"+str(receipt_id),link[1])
    except Exception as error:
        raise ValueError("Não foi possível confirmar no GFARM se o recebimento pode ser alterado.") from error
    if response["status"] != "PENDENTE":
        raise ValueError("Recebimento já revisado no GFARM. Não é possível alterar/excluir este documento.")


def cancel(con,receipt_id):
    assert_editable(con,receipt_id)
    row=con.execute("SELECT sent_at FROM receiving_gfarm_queue WHERE receipt_id=?",(receipt_id,)).fetchone()
    if row and row["sent_at"]:
        link=_connection()
        if not link:
            raise ValueError("Integração indisponível; exclusão cancelada.")
        try:
            _request(link[0]+"/controles:receipt:"+str(receipt_id),link[1],"DELETE")
        except Exception as error:
            raise ValueError("GFARM não autorizou cancelar a pendência. Nada foi excluído.") from error


def _payload(con,receipt_id):
    row=con.execute("""
        SELECT r.*,i.product,i.unit,i.order_number,i.supplier
        FROM purchase_receipts r JOIN purchase_items i ON i.id=r.item_id
        WHERE r.id=?
    """,(receipt_id,)).fetchone()
    if not row:return None
    f=json.loads(row["fiscal_json"] or "{}")
    total=f.get("valor_total")
    unit_price=f.get("valor_unitario")
    if total is None and unit_price is not None:
        from decimal import Decimal
        total=str(Decimal(str(unit_price))*Decimal(str(row["received_qty"])))
    return {
        "origem_id":"controles:receipt:"+str(receipt_id),
        "numero_nota":row["invoice_number"],"chave_acesso":row["access_key"],
        "serie":f.get("serie") or "",
        "data_emissao":f.get("data_emissao") or row["received_date"],
        "data_recebimento":row["received_date"],
        "fornecedor":f.get("fornecedor") or row["invoice_issuer"] or row["supplier"],
        "documento_fornecedor":f.get("documento_fornecedor") or row["invoice_issuer_document"],
        "numero_pedido":row["order_number"],"produto":row["product"],
        "codigo_produto":f.get("codigo_produto") or "",
        "quantidade":row["received_qty"],"unidade":row["unit"],
        "valor_unitario":unit_price,"valor_total":total,
        "cfop":f.get("cfop") or "","ncm":f.get("ncm") or "",
        "lote":f.get("lote") or "","validade":f.get("validade") or "",
        "origem_arquivo":f.get("origem_arquivo") or "manual"
    }


def dispatch_one(con,receipt_id):
    connection=_connection()
    if not connection: return
    url,token=connection
    row=con.execute("SELECT * FROM receiving_gfarm_queue WHERE receipt_id=?",(receipt_id,)).fetchone()
    if not row:return
    try:
        payload=_payload(con,receipt_id)
        if not payload:return
        if row["sent_at"]:
            # Consulta remota para refletir aprovação/recusa sem alterar dados locais.
            reply=_request(url+"/status/"+payload["origem_id"],token)
        else:
            reply=_request(url,token,"POST",payload)
        con.execute("""
            UPDATE receiving_gfarm_queue SET sent_at=COALESCE(sent_at,CURRENT_TIMESTAMP),
                remote_status=?, last_error='', updated_at=CURRENT_TIMESTAMP
            WHERE receipt_id=?
        """,(reply["status"],receipt_id))
        con.commit()
    except (urllib.error.URLError,TimeoutError,ValueError,KeyError) as error:
        con.execute("""
            UPDATE receiving_gfarm_queue
               SET attempts=attempts+1,last_error=?,updated_at=CURRENT_TIMESTAMP
             WHERE receipt_id=?
        """,(str(error)[:500],receipt_id))
        con.commit()


def worker_loop(db_factory):
    while True:
        try:
            if _connection():
                with db_factory() as con:
                    ids=[r["receipt_id"] for r in con.execute("""
                        SELECT receipt_id FROM receiving_gfarm_queue
                        WHERE remote_status NOT IN ('APROVADO','REJEITADO','CANCELADO')
                        ORDER BY (sent_at IS NULL) DESC, updated_at ASC LIMIT 50
                    """)]
                    for rid in ids:
                        dispatch_one(con,rid)
        except Exception as error:
            print("GFARM integração: "+str(error)[:300],flush=True)
        time.sleep(30)


def start_worker(db_factory):
    if _connection():
        threading.Thread(target=worker_loop,args=(db_factory,),
                         name="controles-gfarm-outbox",daemon=True).start()
