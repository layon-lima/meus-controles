"""Leitura conservadora de DANFE PDF para completar lançamento fiscal manual.

Nunca confirma uma nota nem preenche dados incertos como se fossem definitivos.
O documento permanece em memória. Usuário revisa tudo antes de salvar.
"""
from __future__ import annotations

import base64
from datetime import datetime
import re
import unicodedata
from decimal import Decimal, InvalidOperation

import receiving
import receiving_pdf


def _plain(raw):
    return ''.join(c for c in unicodedata.normalize("NFKD", str(raw).upper()) if not unicodedata.combining(c))


def _iso_date(value):
    try:
        return datetime.strptime(value, "%d/%m/%Y").date().isoformat()
    except (ValueError, TypeError):
        return ""


def _field(body, regexes):
    for pattern in regexes:
        match = re.search(pattern,body,re.I|re.M)
        if match:
            return match.group(1).strip()
    return ""


def _digits(value):
    return re.sub(r"\D","",str(value or ""))


def _decimal(value):
    raw=str(value or "").strip().replace(" ","")
    if not raw:return None
    # DANFE brasileira: separadores de milhares e decimais impressos em PT-BR.
    raw=raw.replace(".","").replace(",",".") if "," in raw else raw
    try:
        result=Decimal(raw)
    except InvalidOperation:
        return None
    return str(result) if result.is_finite() and result>=0 else None


def _find_tables(page):
    """Extrai apenas colunas explicitamente rotuladas para evitar valores trocados."""
    found=[]
    try:
        tablefinder=page.find_tables()
    except (AttributeError, ValueError, RuntimeError):
        return found
    for table in getattr(tablefinder,"tables",[]):
        try:
            rows=table.extract()
        except Exception:
            continue
        if not rows or len(rows)<2:continue
        names=[_plain(x or "").replace("\n"," ").strip() for x in rows[0]]
        def col(*fragments):
            for idx,name in enumerate(names):
                if any(fragment in name for fragment in fragments):return idx
            return None
        name_index=col("DESCRICAO","DESCR","PRODUTO")
        qty_index=col("QTD","QUANT")
        unit_price_index=col("VALOR UNIT","VL UNIT","VLR UNIT","PRECO UNIT")
        if name_index is None or qty_index is None or unit_price_index is None:continue
        code_index=col("CODIGO","COD PROD")
        unit_index=col("UNID","UN ")
        cfop_index=col("CFOP")
        ncm_index=col("NCM")
        for row in rows[1:]:
            if not row or max(name_index,qty_index,unit_price_index)>=len(row):continue
            name=str(row[name_index] or "").strip().replace("\n"," ")
            qty=_decimal(row[qty_index])
            price=_decimal(row[unit_price_index])
            if not name or qty is None or price is None:continue
            def value(idx):
                return str(row[idx] or "").strip() if idx is not None and idx<len(row) else ""
            found.append({
                "produto":name[:255],"quantidade":qty,
                "valor_unitario":price,"codigo_produto":value(code_index)[:100],
                "unidade":value(unit_index)[:30],"cfop":value(cfop_index)[:10],
                "ncm":value(ncm_index)[:12],
            })
    return found[:150]


def preview(con,cid,payload):
    receiving.ensure_control(con,cid)
    encoded=payload.get("pdf")
    if not isinstance(encoded,str) or len(encoded)>receiving_pdf.MAX_PDF_BYTES*4//3+100:
        raise ValueError("DANFE PDF ausente ou maior que 7 MB.")
    try:
        raw=base64.b64decode(encoded,validate=True)
    except (TypeError,ValueError):
        raise ValueError("Conteúdo PDF inválido.") from None
    if not raw.startswith(b"%PDF-") or len(raw)>receiving_pdf.MAX_PDF_BYTES:
        raise ValueError("Envie um PDF válido de até 7 MB.")
    try:
        import fitz
        doc=fitz.open(stream=raw,filetype="pdf")
    except Exception as err:
        raise ValueError("Não consegui abrir o DANFE PDF.") from err
    if doc.is_encrypted or not 1<=doc.page_count<=12:
        doc.close()
        raise ValueError("PDF protegido ou maior que 12 páginas.")
    texts=[]
    entries=[]
    scanned=0
    try:
        for page in doc:
            value=page.get_text("text",sort=True)
            if len(value.strip())<130:
                try:
                    value=receiving_pdf._tesseract_page(page,fitz,mode=3)
                    scanned+=1
                except (OSError, ValueError):
                    pass
            texts.append(value[:100000])
            entries.extend(_find_tables(page))
    finally:
        doc.close()
    body="\n".join(texts)
    normalized=_plain(body)
    lines=[x.strip() for x in body.splitlines() if x.strip()]
    # A chave de acesso é a identificação mais confiável de uma DANFE.
    key=""
    near=_field(normalized,(
        r"CHAVE\s+DE\s+ACESSO\s*[:\-]?\s*((?:[0-9][ .\-]*){44,80})",
    ))
    if len(_digits(near))==44:key=_digits(near)
    if not key:
        for candidate in re.findall(r"(?:\d[ .\-]*){44,65}", normalized):
            if len(_digits(candidate))==44:
                key=_digits(candidate);break

    number=_field(normalized,(
        r"(?:NF[- ]?E|NOTA\s+FISCAL)\s*(?:N\.?[Oº°]?)?\s*[:#-]?\s*([0-9]{1,9})\b",
        r"\bN[.°ºO]?\s*([0-9]{1,9})\s*\bSERIE\b",
    ))
    series=_field(normalized,(r"\bSERIE\s*[:\-]?\s*([0-9]{1,3})\b",))
    dates=_field(normalized,(
        r"(?:DATA\s+(?:DA\s+)?EMISSAO|EMISSAO)\s*[:\-]?\s*(\d{2}/\d{2}/\d{4})",
    ))
    issued=_iso_date(dates)
    issuer=""
    issuer_doc=""
    # Apenas captura o CPF/CNPJ do bloco do emitente, quando claramente rotulado.
    match=re.search(r"(?s)(?:IDENTIFICACAO\s+DO\s+EMITENTE|EMITENTE)(.{0,400})",normalized)
    if match:
        near=match.group(1)
        found=re.search(r"(?:CNPJ|CPF)\s*[:\-]?\s*([\d./\-]{11,25})",near)
        if found and len(_digits(found.group(1))) in (11,14):
            issuer_doc=_digits(found.group(1))
        # Nome só quando o próprio campo tem rótulo explícito.
        name=re.search(r"(?:RAZAO\s+SOCIAL|NOME\s+EMPRESARIAL)\s*[:\-]?\s*([^\n]{4,120})",match.group(0))
        if name:issuer=name.group(1).strip()

    warnings=["Confira todos os campos e valores extraídos antes de confirmar."]
    if not key:warnings.append("A chave de 44 dígitos não foi identificada. Informe manualmente.")
    if not entries:warnings.append("Não foi possível separar com segurança os preços por produto. Informe manualmente.")
    return {"invoice_number":number,"serie":series,"data_emissao":issued,
            "access_key":key,"fornecedor":issuer,"documento_fornecedor":issuer_doc,
            "products":entries,"ocr_pages":scanned,"warnings":warnings}


def handle(handler,con,method,path):
    match=re.fullmatch(r"/api/controls/(\d+)/receiving/fiscal/pdf/preview",path)
    if not match or method!="POST":
        raise LookupError("Rota de leitura de DANFE não encontrada.")
    return handler.send(preview(con,int(match[1]),handler.input(max_bytes=10*1024*1024)))
