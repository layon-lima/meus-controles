"""Leitura complementar de tabelas de pedidos PDF (sem inferir quantidades).
Cada produto precisa ter descricao, quantidade e unidade claramente reconhecidas.
"""
import re

DESCRIPTION = re.compile(r"(?:DESCRI|PRODUTO|MATERIAL|MERCADORIA|INSUMO|ITEM)", re.I)
QUANTITY = re.compile(r"(?:QUANT|QTD|QTDE|VOLUME|PESO)", re.I)
UNIT = re.compile(r"^(?:UN|UNID|UNIDADE|UND|UM|U/M|U\.M\.?|MEDIDA)$", re.I)
CODE = re.compile(r"(?:CODIGO|COD\.|COD\b|REFERENCIA|SKU)", re.I)

def normalize_cell(value):
    return " ".join(str(value or "").replace("\xa0"," ").split())

def parse_table(page, pdf, clip=None):
    """Extrai linhas de tabelas identificadas por PyMuPDF, sem misturar preco com quantidade."""
    result=[]
    try:
        tables=getattr(page.find_tables(clip=clip) if clip is not None else page.find_tables(),"tables",[])
    except (AttributeError,ValueError,RuntimeError):
        return result
    for table in tables:
        try:
            matrix=table.extract()
        except (AttributeError,ValueError,RuntimeError):
            continue
        if not matrix or len(matrix)<2:
            continue
        rows=[[normalize_cell(cell) for cell in row] for row in matrix if row]
        header=None
        for idx,row in enumerate(rows[:4]):
            labels=[pdf.normalize_text(v) for v in row]
            desc=next((n for n,v in enumerate(labels) if DESCRIPTION.search(v) and not QUANTITY.search(v)),None)
            qty=next((n for n,v in enumerate(labels) if QUANTITY.search(v) and not re.search(r"PRECO|VALOR|UNITARIO",v)),None)
            unit=next((n for n,v in enumerate(labels) if UNIT.fullmatch(v.replace(" ",""))),None)
            code=next((n for n,v in enumerate(labels) if CODE.search(v)),None)
            if desc is not None and qty is not None and desc!=qty:
                header=(idx,desc,qty,unit,code)
                break
        if header is None:
            continue
        start,desc_col,qty_col,unit_col,code_col=header
        previous=None
        for row in rows[start+1:]:
            if max(desc_col,qty_col,unit_col if unit_col is not None else 0)>=len(row):
                continue
            raw_product=row[desc_col]
            raw_qty=row[qty_col]
            raw_unit=row[unit_col] if unit_col is not None else ""
            if not raw_qty.strip():
                # Descricao eventualmente continua na segunda linha fisica da tabela.
                if previous and raw_product and pdf.plausible_product(raw_product):
                    merged=(previous["product"]+" "+pdf.clean_product(raw_product)).strip()[:160]
                    previous["product"]=merged
                continue
            quantity_match=re.match(r"^\s*([\d.,\s]+)\s*([A-Za-z²³]+)?\s*$",raw_qty)
            if quantity_match:
                raw_qty=quantity_match[1].strip()
                if not raw_unit: raw_unit=quantity_match[2] or ""
            else:
                unit_first=re.match(r"^([A-Za-z²³]+)\s+([\d.,\s]+)$",raw_qty)
                if unit_first:
                    if not raw_unit: raw_unit=unit_first[1]
                    raw_qty=unit_first[2].strip()
            if not raw_unit:
                continue
            unit=pdf.unit_name(raw_unit)
            if unit=="un" and pdf.normalize_text(raw_unit) not in ("UN","UND","UNID","UNIDADE","UNIDADES"):
                continue
            product=pdf.clean_product(raw_product)
            if not pdf.plausible_product(product):
                continue
            try: amount=pdf.number(raw_qty)
            except (ValueError,TypeError):continue
            item={"product":product,"unit":unit,"ordered_qty":amount}
            if code_col is not None and code_col<len(row):
                code=normalize_cell(row[code_col])
                if code and len(code)<=24:
                    item["product_code"]=code
            result.append(item)
            previous=item
            if len(result)>=pdf.MAX_ITEMS:
                return result
    return result


def _row_words(words):
    """Agrupa palavras pelas suas coordenadas Y sem depender da ordem do texto PDF."""
    groups=[]
    for word in sorted(words,key=lambda w:((w[1]+w[3])/2,w[0])):
        if len(word)<5 or not str(word[4]).strip():
            continue
        mid=(word[1]+word[3])/2
        if groups and abs(mid-groups[-1][0])<5:
            groups[-1][1].append(word)
        else:
            groups.append([mid,[word]])
    return [sorted(group,key=lambda w:w[0]) for _,group in groups]


def _canonical_unit(raw,pdf):
    unit=pdf.unit_name(raw)
    known=("UN","UND","UNID","UNIDADE","UNIDADES","U/M","UM")
    return unit if unit!="un" or pdf.normalize_text(raw).strip(". ") in known else None


def parse_unheaded_rows(words,pdf):
    """Lê linhas isoladas marcadas pelo usuário, mesmo sem cabeçalho de colunas.
    Exige quantidade seguida de uma unidade conhecida; nunca infere unidade.
    """
    result=[]
    for row in _row_words(words):
        labels=[str(w[4]).strip() for w in row]
        candidate=None
        for i in range(1,len(labels)):
            unit=_canonical_unit(labels[i],pdf)
            if unit is None:
                continue
            qty=labels[i-1]
            if not re.fullmatch(r"[\d][\d.,\s]*",qty):
                continue
            product=pdf.clean_product(" ".join(labels[:i-1]))
            if not pdf.plausible_product(product):
                continue
            try:amount=pdf.number(qty)
            except (ValueError,TypeError):continue
            if float(amount)<=0:
                continue
            candidate={"product":product,"ordered_qty":amount,"unit":unit}
            break
        if candidate:
            result.append(candidate)
        if len(result)>=pdf.MAX_ITEMS:break
    return result


def parse_words(words,pdf):
    """Captura produtos em colunas mesmo quando o PDF entrega texto por bloco,
    e não na sequência visual de cada linha. A tabela precisa ter cabeçalho
    identificando produto, quantidade e unidade; não usa preço como quantidade.
    """
    groups=_row_words(words)
    header=None
    for i,row in enumerate(groups[:80]):
        descriptors=[w for w in row if DESCRIPTION.search(pdf.normalize_text(w[4]))]
        quantities=[w for w in row if QUANTITY.search(pdf.normalize_text(w[4]))]
        units=[w for w in row if UNIT.fullmatch(pdf.normalize_text(w[4]).replace(" ",""))]
        if descriptors and quantities and units:
            desc_x=descriptors[0][0];qty_x=quantities[0][0];unit_x=units[0][0]
            if len({desc_x,qty_x,unit_x})<3:
                continue
            header=(i,desc_x,qty_x,unit_x)
            break
    if header is None:
        return parse_unheaded_rows(words,pdf)
    start,desc_x,qty_x,unit_x=header
    column_order=sorted([("desc",desc_x),("qty",qty_x),("unit",unit_x)],
                        key=lambda x:x[1])
    result=[]
    last_item_y=None
    for row in groups[start+1:]:
        row_y=(row[0][1]+row[0][3])/2
        # O fim de cada coluna é próximo ao início da próxima;
        # 12 pontos de folga permitem valores alinhados à esquerda.
        cells={"desc":[],"qty":[],"unit":[]}
        for w in row:
            x=w[0]
            matched=None
            for i,(name,left) in enumerate(column_order):
                right=(column_order[i+1][1]-12) if i+1<len(column_order) else float("inf")
                if x>=left-17 and x<right:
                    matched=name
                    break
            if matched:
                cells[matched].append(str(w[4]))
        description=" ".join(cells["desc"]).strip()
        quantity=" ".join(cells["qty"]).strip()
        # Apenas a primeira palavra é unidade; ignorar preço e total à direita.
        unit_text=(cells["unit"][0] if cells["unit"] else "").strip()
        if not quantity and not unit_text:
            if (result and description and pdf.plausible_product(description) and
                last_item_y is not None and 0<row_y-last_item_y<20):
                result[-1]["product"]=(result[-1]["product"]+" "+pdf.clean_product(description))[:160]
                last_item_y=row_y
            continue
        if not quantity or not unit_text:
            continue
        unit=_canonical_unit(unit_text,pdf)
        if not unit:
            continue
        if not pdf.plausible_product(description):
            continue
        try:
            amount=pdf.number(quantity)
        except (ValueError,TypeError):
            continue
        if float(amount)<=0:
            continue
        result.append({"product":pdf.clean_product(description),
                       "ordered_qty":amount,"unit":unit})
        last_item_y=row_y
        if len(result)>=pdf.MAX_ITEMS:
            break
    return result
