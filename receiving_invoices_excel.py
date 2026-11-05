"""Exportação Excel do histórico de notas fiscais de um controle de recebimentos.

A ordem e os campos são os mesmos da aba Notas fiscais. A busca respeita o
filtro visual e o emitente vem da NF-e, nunca do fornecedor do pedido.
A operação é exclusivamente de leitura.
"""
import io
import re
import unicodedata
from datetime import datetime
from decimal import Decimal, InvalidOperation

import receiving


HEADERS=(
    "Data","Nº nota fiscal","Chave da NF-e","Pedido",
    "Produto","Fornecedor","Quantidade"
)
MAX_ROWS=75000


def search_key(value):
    value=unicodedata.normalize("NFD",str(value or ""))
    return " ".join("".join(ch for ch in value if unicodedata.category(ch)!="Mn")
                    .casefold().split())


def invoice_rows(con,control_id,query=""):
    if not isinstance(query,str) or len(query)>200:
        raise ValueError("Filtro de pesquisa inválido.")
    # Também valida que o controle existe e é do tipo recebimento.
    summary=receiving.summary(con,control_id)
    normalized=search_key(query)
    result=[]
    for row in summary["receipts"]:
        # Igual à pesquisa da tela: número, chave, pedido, produto e emitente.
        haystack=search_key(" ".join(str(x or "") for x in (
            row["invoice_number"],row["access_key"],row["order_number"],
            row["product"],row["supplier"],
        )))
        if normalized and normalized not in haystack:
            continue
        result.append(row)
        if len(result)>MAX_ROWS:
            raise ValueError("Há mais de 75 mil notas no resultado. Refine a pesquisa.")
    if not result:
        raise ValueError("Nenhuma nota fiscal encontrada para exportar com a pesquisa atual.")
    return result


def generate(con,control_id,query=""):
    """Retorna XLSX válido; texto fiscal é preservado sem notação científica."""
    import xlsxwriter
    rows=invoice_rows(con,control_id,query)
    output=io.BytesIO()
    book=xlsxwriter.Workbook(output,{
        "constant_memory":True,
        "strings_to_formulas":False,
        "strings_to_urls":False,
    })
    book.set_properties({
        "title":"Histórico de notas fiscais - Recebimentos",
        "subject":"Notas fiscais registradas no controle de recebimentos",
        "author":"Central de Controles",
        "comments":"Exportação somente leitura.",
    })
    ws=book.add_worksheet("Notas fiscais")
    ws.hide_gridlines(2)
    ws.set_zoom(90)
    ws.set_landscape()
    ws.fit_to_pages(1,0)
    ws.set_margins(0.25,0.25,0.4,0.4)
    ws.set_header("&CCentral de Controles - Notas fiscais")
    ws.set_footer("&CPágina &P de &N")
    for col,width in enumerate((16,18,53,26,35,43,20)):
        ws.set_column(col,col,width)
    title=book.add_format({
        "bold":True,"font_name":"Aptos","font_size":15,
        "font_color":"#FFFFFF","bg_color":"#126E60","valign":"vcenter",
    })
    subtitle=book.add_format({
        "font_name":"Aptos","font_size":10,"font_color":"#4E6B64",
    })
    header=book.add_format({
        "bold":True,"font_name":"Aptos","font_size":10,
        "font_color":"#FFFFFF","bg_color":"#0E816A",
        "valign":"vcenter","text_wrap":True,
        "bottom":1,"bottom_color":"#0B6B56",
    })
    textfmt=[
        book.add_format({"font_name":"Aptos","font_size":10,"valign":"vcenter",
                         "bottom":1,"bottom_color":"#E3EBE7"}),
        book.add_format({"font_name":"Aptos","font_size":10,"valign":"vcenter",
                         "bg_color":"#F1F8F4","bottom":1,"bottom_color":"#E3EBE7"}),
    ]
    datefmt=[
        book.add_format({"font_name":"Aptos","font_size":10,"num_format":"dd/mm/yyyy",
                         "bottom":1,"bottom_color":"#E3EBE7"}),
        book.add_format({"font_name":"Aptos","font_size":10,"num_format":"dd/mm/yyyy",
                         "bg_color":"#F1F8F4","bottom":1,"bottom_color":"#E3EBE7"}),
    ]
    quantityfmt={}
    ws.set_row(0,32)
    ws.merge_range(0,0,0,6,"HISTÓRICO DE NOTAS FISCAIS",title)
    ws.merge_range(1,0,1,6,
        f"{len(rows)} lançamento(s) · Exportado em {datetime.now():%d/%m/%Y %H:%M}"+
        (" · Pesquisa: "+query.strip() if query.strip() else " · Todas as notas"),
        subtitle)
    ws.set_row(3,26)
    ws.write_row(3,0,HEADERS,header)
    ws.freeze_panes(4,0)
    ws.autofilter(3,0,3+len(rows),6)

    for index,note in enumerate(rows):
        rowindex=4+index
        style=index%2
        ws.set_row(rowindex,20)
        day=note["received_date"]
        try:
            ws.write_datetime(rowindex,0,datetime.strptime(day,"%Y-%m-%d"),datefmt[style])
        except (ValueError,TypeError):
            ws.write_string(rowindex,0,str(day or ""),textfmt[style])
        # A chave (44 dígitos) e o nº da NF são sempre TEXTO, nunca número.
        fields=(
            str(note["invoice_number"] or ""),
            str(note["access_key"] or ""),
            str(note["order_number"] or ""),
            str(note["product"] or ""),
            str(note["invoice_issuer"] or "Emitente não registrado"),
        )
        for column,value in enumerate(fields,1):
            ws.write_string(rowindex,column,value[:32767],textfmt[style])

        try:
            quantity=Decimal(str(note["received_qty"]))
            if not quantity.is_finite():
                raise InvalidOperation
        except (ValueError,TypeError,InvalidOperation):
            ws.write_string(rowindex,6,str(note["received_qty"] or ""),textfmt[style])
            continue
        # Uma única coluna como na tela; valor numérico com unidade visual.
        unit=str(note["unit"] or "").strip()
        safe_unit=unit if re.fullmatch(r"[\w²³%./-]{1,12}",unit) else ""
        fmtkey=(safe_unit,style)
        if fmtkey not in quantityfmt:
            number_format='#,##0.###'+(' " '+safe_unit+'"' if safe_unit else "")
            quantityfmt[fmtkey]=book.add_format({
                "font_name":"Aptos","font_size":10,
                "num_format":number_format,
                "bg_color":"#F1F8F4" if style else "#FFFFFF",
                "align":"right",
                "bottom":1,"bottom_color":"#E3EBE7",
            })
        ws.write_number(rowindex,6,float(quantity),quantityfmt[fmtkey])
    book.close()
    return output.getvalue()
