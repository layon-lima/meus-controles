"""Extração e conferência de pedidos em PDF para Recebimento de Produtos.

PDF é processado apenas em memória. Primeiro extrai texto nativo com PyMuPDF;
em páginas digitalizadas usa OCR Tesseract (português/inglês). O operador
sempre revisa/corrige os campos antes de confirmar. Nunca cria NFs.
"""
import base64
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import io
import json
import re
import subprocess
import unicodedata

import receiving

MAX_PDF_BYTES = 7 * 1024 * 1024
MAX_PAGES = 16
MAX_ITEMS = 150
PDF_PREFIX = b"%PDF-"
FORMAT = "receiving-pdf-v1"

# A expressão exige uma unidade próxima à quantidade para não confundir
# preço, código ou CNPJ com volumes comprados.
UNIT_PATTERN = r"(?:QUILOGRAMAS?|KG|KGS|TONELADAS?|TON|TONS|TON\.?|T|LITROS?|LTS?|L|DOSES?|DOS|UNIDADES?|UNID\.?|UN|CX|CAIXAS?|SACAS?|SC|PCT|PACOTES?)"
QTY_PATTERN = r"(?:\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,3})?|\d+(?:[.,]\d{1,3})?)"
ROW_QTY = re.compile(r"(?<![\w])(?P<qty>" + QTY_PATTERN + r")\s*(?P<unit>" + UNIT_PATTERN + r")(?!\w)",re.I)
ROW_UNIT_FIRST = re.compile(r"(?<!\w)(?P<unit>" + UNIT_PATTERN + r")\s+(?P<qty>" + QTY_PATTERN + r")(?!\w)",re.I)
ORDER_PATTERNS = (
  re.compile(r"\b(?:NUMERO|N[°ºO.]*)\s*(?:DO|DE)?\s*PEDIDO\s*(?:DE COMPRA)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{2,45})",re.I),
  re.compile(r"\bPEDIDO\s*(?:DE COMPRA|MESTRE|COMERCIAL)?\s*(?:N[°ºO.]*|#|REF(?:ERENCIA)?)?\s*[:#-]\s*([A-Z0-9][A-Z0-9./_-]{2,45})",re.I),
  re.compile(r"\bPEDIDO\s+(?:N[°ºO.]*\s*)?([A-Z0-9][A-Z0-9./_-]{3,45})",re.I),
)
SUPPLIER_PATTERN = re.compile(
    r"^\s*(?:FORNECEDOR|VENDEDOR|EMPRESA\s+FORNECEDORA|RAZAO\s+SOCIAL\s+DO\s+FORNECEDOR|EMITENTE)\s*[:\-]\s*(.+)$",re.I)
SKIP_LINE = re.compile(
    r"^(?:ITEM|CODIGO|COD\.?|PRODUTOS?|DESCRICAO|QUANTIDADE|QTDE|QTD|UNID|UM|VALOR|PRECO|TOTAL|"
    r"PEDIDO|DATA|CNPJ|CPF|FRETE|IMPOSTO|SUBTOTAL|OBSERVACOES?|CONDICOES|FATURAMENTO|PAGAMENTO|"
    r"ENTREGA|TRANSPORTADORA|DESCONTO|FILIAL|ENDERECO|COMPRADOR|CLIENTE)\b",re.I)
MONEY_TRAIL = re.compile(r"\s+(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})\s*(?:R\$)?\s*$",re.I)

def normalize_text(s):
    raw=unicodedata.normalize("NFKD",str(s))
    return "".join(c for c in raw if not unicodedata.combining(c)).upper().strip()

def clean_line(s):
    return " ".join(str(s).replace("\xa0"," ").split())

def number(raw):
    raw=clean_line(raw).replace(" ","")
    if "," in raw:
        raw=raw.replace(".","").replace(",",".")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+",raw):
        raw=raw.replace(".","")
    return receiving.display(receiving.qty(raw))

def unit_name(raw):
    n=normalize_text(raw).strip(". ")
    if n in ("QUILOGRAMA","QUILOGRAMAS","KG","KGS"):return "kg"
    if n in ("TON","TONS","TONELADA","TONELADAS","T"):return "t"
    if n in ("L","LT","LTS","LITRO","LITROS"):return "L"
    if n in ("DOSE","DOSES","DOS"):return "DOS"
    if n in ("CX","CAIXA","CAIXAS"):return "cx"
    if n in ("SACA","SACAS","SC"):return "sc"
    if n in ("PACOTE","PACOTES","PCT"):return "pct"
    return "un"

def clean_product(text):
    value=clean_line(text)
    value=re.sub(r"^\s*(?:ITEM\s*)?\d{1,3}\s*[-.)]\s*","",value,flags=re.I)
    value=re.sub(r"^\s*\d{1,3}\s+(?=[A-Za-zÀ-ÿ])","",value)
    value=re.sub(r"^\s*\d{5,14}\s+(?=[A-Za-zÀ-ÿ])","",value)
    value=re.sub(r"^(?:PRODUTO|DESCRICAO|DESCRIÇÃO)\s*[:\-]\s*","",value,flags=re.I)
    value=re.sub(r"\s+(?:R\$|BRL)\s*[\d.,]+.*$","",value,flags=re.I)
    return value.strip(" -:;|.")[:160]

def plausible_product(raw):
    product=clean_product(raw)
    alpha=sum(x.isalpha() for x in product)
    return bool(3<=len(product)<=160 and alpha>=3 and not SKIP_LINE.match(normalize_text(product)) and
        not re.search(r"\b(?:CNPJ|CPF|CEP|BANCO|CHAVE|VENCIMENTO|VALOR TOTAL)\b",normalize_text(product)))

def find_order(lines):
    for line in lines[:130]:
        line=normalize_text(line)
        for pattern in ORDER_PATTERNS:
            result=pattern.search(line)
            if result:
                code=result[1].rstrip(".,:;-")
                if code and code not in ("DE","COMPRA","COMERCIAL","N","NUMERO"):
                    return code[:100]
    return ""

def find_supplier(lines):
    for line in lines[:120]:
        cleaned=clean_line(line)
        m=SUPPLIER_PATTERN.match(normalize_text(cleaned))
        if m:
            orig=cleaned[cleaned.find(":")+1:] if ":" in cleaned else m[1]
            orig=re.split(r"\s+(?:CNPJ|CPF|INSCRICAO|ENDERECO|FONE|TEL)\b",orig,flags=re.I)[0]
            orig=clean_line(orig).strip(" :-")
            if 2<len(orig)<=160 and not re.match(r"^\d",orig):return orig
    return ""

def supplier_alias_key(name):
    normalized=receiving.supplier_key(name)
    normalized=re.sub(r"(?:\s+(?:LTDA|EIRELI|ME|EPP|S/A|SA|S A))+$","",normalized,flags=re.I)
    return "".join(ch for ch in normalized if ch.isalnum())

def canonical_pdf_supplier(con,cid,name):
    """Reutiliza grafia existente só para o mesmo nome, sem unir empresas distintas."""
    normal=receiving.canonical_supplier(con,cid,name)
    if normal!=name:return normal
    alias=supplier_alias_key(name)
    if not alias:return name
    candidates={row["supplier"] for row in con.execute(
      "SELECT supplier FROM purchase_items WHERE control_id=?",(cid,))
      if row["supplier"] and supplier_alias_key(row["supplier"])==alias}
    if len(candidates)==1:return next(iter(candidates))
    return name

def layout_text(page):
    """Recompõe linhas horizontais usando coordenadas das palavras do PDF."""
    try:words=page.get_text("words",sort=True)
    except Exception:return ""
    buckets=[]
    for w in sorted(words,key=lambda row:(row[1],row[0])):
        x,y,_,_,label=w[:5]
        if not label.strip():continue
        if buckets and abs(y-buckets[-1][0])<=4:
            buckets[-1][1].append((x,label))
        else:buckets.append([y,[(x,label)]])
    return "\n".join(" ".join(label for _,label in sorted(values)) for _,values in buckets)

def parse_rows(text):
    """Heurística conservadora: produto + quantidade/unidade na mesma linha.
    Também suporta linhas de produto terminadas pela quantidade em linha seguinte.
    Dúvidas continuam editáveis na prévia.
    """
    lines=[clean_line(x) for x in text.splitlines() if clean_line(x)]
    items=[]
    for i,line in enumerate(lines):
        if len(items)>=MAX_ITEMS:break
        normalized=normalize_text(line)
        if SKIP_LINE.match(normalized) and not normalized.startswith(("ITEM ","PRODUTO:","DESCRICAO:")):
            continue
        # Padrões linha: DESCRICAO ... 2000 KG; ou código, produto, QTD, unidade, preço.
        candidate=[]
        for pattern in (ROW_QTY,ROW_UNIT_FIRST):
            for match in pattern.finditer(line):
                pre=line[:match.start()].strip(" :-|")
                if not plausible_product(pre):continue
                # Se houver múltiplos pares preço/quantidade, o primeiro válido da linha prevalece.
                candidate.append((match.start(),pre,match["qty"],match["unit"]))
        if not candidate:
            # Em pedidos com descrição e quantidade em linhas separadas.
            if i+1<len(lines) and plausible_product(line):
                following=lines[i+1]
                m=ROW_QTY.match(following) or ROW_UNIT_FIRST.match(following)
                if m and m.start()==0 and len(following)<=42:
                    candidate.append((0,line,m["qty"],m["unit"]))
        if not candidate:continue
        _,prod,qty,unit=sorted(candidate,key=lambda x:x[0])[0]
        product=clean_product(prod)
        if not plausible_product(product):continue
        try:
            amount=number(qty)
        except ValueError:
            continue
        items.append({"product":product,"ordered_qty":amount,"unit":unit_name(unit)})
    # Nenhum item é inventado quando OCR não consegue identificar a tabela.
    return items[:MAX_ITEMS]

def extract_pdf(pdf_bytes):
    if not isinstance(pdf_bytes,bytes) or not pdf_bytes.startswith(PDF_PREFIX):
        raise ValueError("Envie um arquivo PDF válido.")
    if len(pdf_bytes)>MAX_PDF_BYTES:raise ValueError("O PDF excede 7 MB.")
    try:
        import fitz
        doc=fitz.open(stream=pdf_bytes,filetype="pdf")
    except Exception as e:
        raise ValueError("Não foi possível abrir o PDF. Confira se não está corrompido.") from e
    if doc.is_encrypted:raise ValueError("PDF protegido por senha. Envie uma versão desbloqueada.")
    if not 1<=doc.page_count<=MAX_PAGES:
        raise ValueError("Cada PDF deve ter de 1 a 16 páginas.")
    pages=[];ocr_pages=0
    for page in doc:
        raw=page.get_text("text",sort=True)
        aligned=layout_text(page) if raw.strip() else ""
        if len(raw.strip())<90 and not parse_rows(raw):
            try:
                png=page.get_pixmap(matrix=fitz.Matrix(2,2),colorspace=fitz.csGRAY,alpha=False).tobytes("png")
                result=subprocess.run(["tesseract","stdin","stdout","-l","por+eng","--psm","3"],
                    input=png,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                    timeout=23,check=False)
                if result.returncode!=0:
                    raise ValueError("OCR indisponível para PDF digitalizado.")
                detected=result.stdout.decode("utf-8",errors="replace")
                if len(detected.strip())>len(raw.strip()):raw=detected
                ocr_pages+=1
            except subprocess.TimeoutExpired as e:
                raise ValueError("O OCR demorou demais nesta página. Tente um PDF menor.") from e
        if aligned and len(parse_rows(aligned))>len(parse_rows(raw)):
            raw=aligned
        pages.append(raw)
    doc.close()
    body="\n".join(pages)
    lines=[clean_line(s) for s in body.splitlines() if clean_line(s)]
    return {"order_number":find_order(lines),"supplier":find_supplier(lines),
            "items":parse_rows(body),"ocr_pages":ocr_pages,"pages":len(pages)}

def initialize(con):
    con.execute("""CREATE TABLE IF NOT EXISTS receiving_pdf_batches(
      id INTEGER PRIMARY KEY,
      control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      filename TEXT NOT NULL,
      extracted_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(control_id,fingerprint)
    )""")

def _existing(con,cid,fingerprint):
    return con.execute("""SELECT * FROM receiving_pdf_batches
        WHERE control_id=? AND fingerprint=?""",(cid,fingerprint)).fetchone()

def preview(con,cid,payload):
    receiving.ensure_control(con,cid)
    if not isinstance(payload,dict):raise ValueError("Envie um PDF.")
    name=receiving.text(payload.get("filename"),"o nome do arquivo",180)
    if not name.lower().endswith(".pdf"):raise ValueError("Envie um arquivo .pdf.")
    data=payload.get("base64")
    if not isinstance(data,str) or len(data)>MAX_PDF_BYTES*4//3+100:
        raise ValueError("PDF muito grande ou inválido.")
    try:raw=base64.b64decode(data,validate=True)
    except (ValueError, Exception) as e:raise ValueError("O conteúdo do PDF está inválido.") from e
    fingerprint=hashlib.sha256(raw).hexdigest()
    previous=_existing(con,cid,fingerprint)
    if previous and previous["status"]=="imported":
        return {"fingerprint":fingerprint,"filename":name,"already_imported":True,
                "items":[],"order_number":"","supplier":"","ocr_pages":0,"pages":0}
    # PDF inédito ou prévia refeita: manter leitura e fingerprint idênticos.
    parsed=extract_pdf(raw)
    if not parsed["items"]:
        parsed["items"]=[{"product":"","ordered_qty":"","unit":"un"}]
        parsed["needs_manual_review"]=True
    else:
        parsed["needs_manual_review"]=not(parsed["order_number"] and parsed["supplier"])
    parsed["fingerprint"]=fingerprint
    parsed["filename"]=name
    parsed["already_imported"]=False
    # Armazenar só os campos estruturados; nunca persistir o próprio PDF.
    payload_json=json.dumps(parsed,ensure_ascii=False)
    if previous:
        con.execute("""UPDATE receiving_pdf_batches SET extracted_json=?,filename=?,status='pending',
                       created_at=CURRENT_TIMESTAMP WHERE id=?""",
                    (payload_json,name,previous["id"]))
    else:
        con.execute("""INSERT INTO receiving_pdf_batches(control_id,fingerprint,filename,extracted_json)
                       VALUES(?,?,?,?)""",(cid,fingerprint,name,payload_json))
    con.commit()
    return parsed

def confirm(con,cid,data):
    receiving.ensure_control(con,cid)
    if not isinstance(data,dict) or not isinstance(data.get("files"),list) or not 1<=len(data["files"])<=20:
        raise ValueError("Confira os PDFs antes de confirmar.")
    files=data["files"]
    fingerprints=[f.get("fingerprint") for f in files if isinstance(f,dict)]
    if len(fingerprints)!=len(files) or len(set(fingerprints))!=len(files):
        raise ValueError("Existem PDFs repetidos neste lote.")
    total_items=sum(len(f.get("items",[])) for f in files)
    if not 1<=total_items<=MAX_ITEMS*20:
        raise ValueError("Selecione de 1 a 3000 produtos.")
    if not con.in_transaction:con.execute("BEGIN IMMEDIATE")
    to_insert=[]
    for f in files:
        fingerprint=f.get("fingerprint")
        if not isinstance(fingerprint,str) or not re.fullmatch("[a-f0-9]{64}",fingerprint):
            raise ValueError("Identificação do PDF inválida.")
        found=_existing(con,cid,fingerprint)
        if found is None:raise ValueError("Prévia não encontrada. Reenvie o PDF.")
        if found["status"]=="imported":
            raise ValueError("O PDF "+found["filename"]+" já foi importado. Nenhuma linha duplicada foi criada.")
        original=json.loads(found["extracted_json"])
        original_items=original.get("items",[])
        rows=f.get("items")
        if not isinstance(rows,list) or not 1<=len(rows)<=MAX_ITEMS:
            raise ValueError("Lista de produtos inválida para "+found["filename"])
        indexes=set()
        for incoming in rows:
            if not isinstance(incoming,dict) or type(incoming.get("index")) is not int:
                raise ValueError("Identificação do produto inválida.")
            index=incoming["index"]
            if index<0 or index>=MAX_ITEMS or index in indexes:
                raise ValueError("Produto repetido na prévia.")
            indexes.add(index)
            row=receiving.validate_item({
                "order_number":incoming.get("order_number"),
                "supplier":incoming.get("supplier",""),
                "product":incoming.get("product"),
                "unit":incoming.get("unit"),
                "ordered_qty":incoming.get("ordered_qty")
            })
            if not row["supplier"]:
                raise ValueError("Preencha o fornecedor antes de confirmar: "+row["product"]+".")
            to_insert.append(row)
    for row in to_insert:
        row["supplier"]=canonical_pdf_supplier(con,cid,row["supplier"])
        con.execute("""INSERT INTO purchase_items
            (control_id,order_number,supplier,product,unit,ordered_qty)
            VALUES(?,?,?,?,?,?)""",(cid,*row.values()))
    for fingerprint in fingerprints:
        con.execute("""UPDATE receiving_pdf_batches SET status='imported'
            WHERE control_id=? AND fingerprint=?""",(cid,fingerprint))
    con.commit()
    return {"imported":len(to_insert),"files":len(files),"receipts_created":0}

def handle(handler,con,method,path):
    m=re.fullmatch(r"/api/controls/(\d+)/receiving/pdf/(preview|confirm)",path)
    if not m or method!="POST":raise LookupError("Rota de importação inválida.")
    cid=int(m[1])
    body=handler.input(max_bytes=10*1024*1024 if m[2]=="preview" else 512*1024)
    if m[2]=="preview":
        return handler.send(preview(con,cid,body))
    return handler.send(confirm(con,cid,body),201)
