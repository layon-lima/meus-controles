"""Leitura tabular conservadora de pedidos PDF, inclusive Qtde sem unidade explícita."""
import re

DESCRIPTION = re.compile(r"(?:DESCRI|PRODUTO|MATERIAL|MERCADORIA|INSUMO|ITEM)", re.I)
QUANTITY = re.compile(r"(?:QUANT|QTDE|QTD|QUANTIDADE|VOLUME|PESO)", re.I)
UNIT = re.compile(r"^(?:UN|UNID|UNIDADE|UND|UM|U/M|U\.M\.?|MEDIDA)$", re.I)
CODE = re.compile(r"(?:^NRO$|^N[ÚU]M\.?$|^ITEM$|C[ÓO]D(?:IGO)?\.?|REFERENCIA|SKU)", re.I)
DELIVERY = re.compile(r"(?:TIPO\s*(?:DE)?\s*ENTREGA|BONIFIC|ENTREGA)", re.I)
PURE_AMOUNT = re.compile(r"^\s*\d+(?:[.\s]\d{3})*(?:,\d{1,3})?\s*$")


def normalize_cell(value):
    return " ".join(str(value or "").replace("\xa0"," ").split())


def _cell_text(page, table, index, column, fallback):
    """Preferir texto original do retângulo, que preserva _ e linhas do produto."""
    try:
        cells=table.rows[index].cells
        box=cells[column]
        if box:
            text=normalize_cell(page.get_text("text",clip=box,sort=True))
            if text:return text
    except (AttributeError,IndexError,TypeError,ValueError,RuntimeError):
        pass
    return normalize_cell(fallback)


def _row_overlaps(table,index,region):
    if region is None:return True
    try:
        cells=[c for c in table.rows[index].cells if c]
        if not cells:return False
        y0=min(c[1] for c in cells)
        y1=max(c[3] for c in cells)
        # Requer sobreposição real da linha; não lê fora da marcação.
        overlap=max(0,min(region.y1,y1)-max(region.y0,y0))
        return overlap>=min(2,(y1-y0)*.25)
    except (AttributeError,IndexError,TypeError,ValueError):
        return True


def parse_table(page,pdf,clip=None):
    """Lê todas as linhas de produto pela coluna Qtde, sem confundir preços e volumes.

    No PDF FMC, Qtde=300 e VELITREX_5L_BR descreve a embalagem. Como o
    documento não informa unidade separada para a quantidade, usa 'un' e
    preserva 300; NUNCA transforma em 5L nem multiplica por 5.
    Em seleção manual, clip filtra linhas de uma tabela detectada na página
    inteira, ainda que a pessoa não inclua o cabeçalho no retângulo.
    """
    result=[]
    try:
        tables=getattr(page.find_tables(),"tables",[])
    except (AttributeError,ValueError,RuntimeError):
        return result
    for table in tables:
        try:matrix=table.extract()
        except (AttributeError,ValueError,RuntimeError):continue
        if not matrix:continue
        data=[[normalize_cell(v) for v in row] for row in matrix if row is not None]
        header=None
        for i,row in enumerate(data[:6]):
            names=[pdf.normalize_text(v) for v in row]
            desc=next((j for j,v in enumerate(names) if DESCRIPTION.search(v) and
                       not QUANTITY.search(v)),None)
            qty=next((j for j,v in enumerate(names) if QUANTITY.search(v) and
                      not re.search(r"PRECO|VALOR|UNITARIO|SUB.?TOTAL",v)),None)
            unit=next((j for j,v in enumerate(names) if UNIT.fullmatch(v.replace(" ",""))),None)
            code=next((j for j,v in enumerate(names) if CODE.search(v)),None)
            delivery=next((j for j,v in enumerate(names) if DELIVERY.search(v)),None)
            if desc is not None and qty is not None and desc!=qty:
                header=(i,desc,qty,unit,code,delivery)
                break
        # Continuação em outra página: tabela inicia diretamente com os itens
        # e não repete cabeçalhos (exemplo: item 000140 na página 2 da FMC).
        if header is None:
            first=data[0]
            if (len(first)>=5 and re.fullmatch(r"\d{4,8}",first[0] or "") and
                any(ch.isalpha() for ch in first[1]) and PURE_AMOUNT.fullmatch(first[4] or "")):
                header=(-1,1,4,None,0,3)
            else:
                continue
        first,desc_col,qty_col,unit_col,code_col,delivery_col=header
        for index in range(first+1,len(data)):
            if not _row_overlaps(table,index,clip):continue
            row=data[index]
            if max(desc_col,qty_col,unit_col or 0)>=len(row):continue
            raw_qty=_cell_text(page,table,index,qty_col,row[qty_col])
            if not raw_qty:continue
            qty_match=re.fullmatch(r"\s*(\d+(?:[.\s]\d{3})*(?:,\d{1,3})?)\s*([A-Za-z²³]+)?\s*",raw_qty)
            if not qty_match:continue
            raw_amount=qty_match[1]
            raw_unit=_cell_text(page,table,index,unit_col,row[unit_col]) if unit_col is not None else (qty_match[2] or "")
            # Sem coluna de unidade => quantidade de itens/embalagens, não
            # conteúdo da embalagem inferido pelo nome do produto.
            unit=pdf.unit_name(raw_unit) if raw_unit else "un"
            if raw_unit and unit=="un" and pdf.normalize_text(raw_unit) not in (
                 "UN","UND","UNID","UNIDADE","UNIDADES","UM"):
                continue
            product=_cell_text(page,table,index,desc_col,row[desc_col])
            product=pdf.clean_product(product)
            if not pdf.plausible_product(product):continue
            try:amount=pdf.number(raw_amount)
            except (ValueError,TypeError):continue
            if float(amount)<=0:continue
            item={"product":product,"ordered_qty":amount,"unit":unit}
            if code_col is not None and code_col<len(row):
                line=_cell_text(page,table,index,code_col,row[code_col])
                if re.fullmatch(r"[A-Za-z0-9./_-]{1,24}",line):
                    item["source_line"]=line
            if delivery_col is not None and delivery_col<len(row):
                delivery=_cell_text(page,table,index,delivery_col,row[delivery_col])
                if delivery:item["delivery_type"]=delivery[:80]
            result.append(item)
            if len(result)>=pdf.MAX_ITEMS:return result
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
