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

def parse_table(page, pdf):
    """Extrai linhas de tabelas identificadas por PyMuPDF, sem misturar preco com quantidade."""
    result=[]
    try:
        tables=getattr(page.find_tables(),"tables",[])
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
