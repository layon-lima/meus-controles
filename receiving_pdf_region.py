"""Visualizador seguro de páginas PDF e OCR da região escolhida manualmente.
O PDF permanece somente na memória, nunca salvo no servidor.
"""
import base64
import hashlib
import re
import subprocess

import receiving
import receiving_pdf
import receiving_pdf_layout


def _document(con,cid,payload):
    receiving.ensure_control(con,cid)
    if not isinstance(payload,dict):
        raise ValueError("Pedido PDF inválido.")
    fingerprint=payload.get("fingerprint")
    data=payload.get("base64")
    if not isinstance(fingerprint,str) or not re.fullmatch(r"[a-f0-9]{64}",fingerprint):
        raise ValueError("Identificação do PDF inválida.")
    if not isinstance(data,str) or len(data)>receiving_pdf.MAX_PDF_BYTES*4//3+100:
        raise ValueError("Arquivo PDF inválido ou acima de 7 MB.")
    try:
        raw=base64.b64decode(data,validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("Conteúdo do PDF inválido.") from exc
    if (not raw.startswith(b"%PDF-") or
        len(raw)>receiving_pdf.MAX_PDF_BYTES or
        hashlib.sha256(raw).hexdigest()!=fingerprint):
        raise ValueError("O PDF mudou desde a prévia. Importe novamente.")
    previous=receiving_pdf._existing(con,cid,fingerprint)
    if not previous or previous["status"]=="imported":
        raise ValueError("Prévia não encontrada. Reabra o pedido PDF.")
    try:
        import fitz
        doc=fitz.open(stream=raw,filetype="pdf")
    except Exception as exc:
        raise ValueError("Não foi possível ler o PDF.") from exc
    if doc.is_encrypted or not 1<=doc.page_count<=receiving_pdf.MAX_PAGES:
        doc.close()
        raise ValueError("PDF protegido ou com páginas demais.")
    try:
        page_index=payload.get("page",0)
        if type(page_index) is not int or not 0<=page_index<doc.page_count:
            raise ValueError("Página do pedido inválida.")
        return doc,doc[page_index],fitz
    except Exception:
        doc.close()
        raise


def page_preview(con,cid,payload):
    doc,page,fitz=_document(con,cid,payload)
    try:
        # Render em dimensões proporcionais ao PDF. O navegador calcula
        # coordenadas normalizadas sem depender do zoom ou da largura da tela.
        zoom=min(1.6,1400/max(page.rect.width,1))
        pix=page.get_pixmap(matrix=fitz.Matrix(zoom,zoom),alpha=False,
                            colorspace=fitz.csRGB)
        image=base64.b64encode(pix.tobytes("png")).decode("ascii")
        return {"image":"data:image/png;base64,"+image,
                "page":payload["page"],"pages":doc.page_count,
                "width":pix.width,"height":pix.height}
    finally:
        doc.close()


def _rect(page,payload,fitz):
    v=payload.get("rect")
    if not isinstance(v,dict):raise ValueError("Marque uma área do PDF.")
    try:
        x0,y0,x1,y1=[float(v[k]) for k in ("x0","y0","x1","y1")]
    except (TypeError,ValueError,KeyError) as exc:
        raise ValueError("Área marcada inválida.") from exc
    if not (0<=x0<x1<=1 and 0<=y0<y1<=1 and x1-x0>=.012 and y1-y0>=.012):
        raise ValueError("Arraste o mouse para selecionar uma área maior.")
    p=page.rect
    clip=fitz.Rect(p.x0+x0*p.width,p.y0+y0*p.height,
                   p.x0+x1*p.width,p.y0+y1*p.height)
    return clip


def _ocr_crop(page,clip,fitz):
    pix=page.get_pixmap(matrix=fitz.Matrix(3,3),clip=clip,
                        colorspace=fitz.csGRAY,alpha=False)
    png=pix.tobytes("png")
    results=[]
    for psm in ("6","11"):
        try:
            proc=subprocess.run(["tesseract","stdin","stdout","-l","por+eng",
                 "--psm",psm,"--dpi","300"],input=png,
                 stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=28,check=False)
        except subprocess.TimeoutExpired:
            continue
        if proc.returncode==0:
            results.append(proc.stdout.decode("utf-8",errors="replace"))
    return results


def read_region(con,cid,payload):
    doc,page,fitz=_document(con,cid,payload)
    try:
        clip=_rect(page,payload,fitz)
        text=page.get_text("text",clip=clip,sort=True) or ""
        words=page.get_text("words",clip=clip,sort=True)
        # Só as linhas selecionadas entram nesta análise.
        sources=[
            ("texto",receiving_pdf.parse_rows(text),text),
            ("colunas",receiving_pdf_layout.parse_words(words,receiving_pdf),text)
        ]
        tables=receiving_pdf_layout.parse_table(page,receiving_pdf,clip=clip)
        if tables:sources.append(("tabela",tables,text))
        if not any(rows for _,rows,_ in sources):
            for attempt in _ocr_crop(page,clip,fitz):
                sources.append(("ocr",receiving_pdf.parse_rows(attempt),attempt))
        _,items,raw=max(sources,key=lambda x:(len(x[1]),len(x[2])))
        warnings=[]
        if not items:
            warnings.append("Não consegui separar os produtos desta região. "
                            "Marque uma linha individual ou preencha manualmente.")
        return {"items":items[:receiving_pdf.MAX_ITEMS],
                "raw_text":raw[:8000],"warnings":warnings}
    finally:
        doc.close()


def handle(handler,con,method,path):
    match=re.fullmatch(r"/api/controls/(\d+)/receiving/pdf/(page|region)",path)
    if not match or method!="POST":
        raise LookupError("Rota de PDF inválida.")
    payload=handler.input(max_bytes=10*1024*1024)
    cid=int(match[1])
    return handler.send(page_preview(con,cid,payload) if match[2]=="page"
                        else read_region(con,cid,payload))
