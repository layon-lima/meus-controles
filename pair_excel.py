"""Exportação XLSX dos lançamentos de um controle Acerto A × B.

A planilha acompanha a visão ativa: período aberto ou histórico completo.
Inclui registros informativos, que NÃO modificam o saldo, e não grava no banco.
"""
from datetime import datetime
from decimal import Decimal
import io

import pair
import pair_records

HEADERS=(
    "Data","Tipo","Descrição","Devedor / Pagador / Origem",
    "Credor / Recebedor / Destino","Valor (R$)","Observações",
    "Situação","Referência"
)
MAX_ROWS=75000


def rows_for_export(con,cid,include_history=False):
    if type(include_history) is not bool:
        raise ValueError("Opção de histórico inválida.")
    data=pair.summary(con,cid)  # valida existência e tipo do controle
    records=pair_records.get(con,cid)
    names=data["settings"]
    selected=data["history"] if include_history else data["entries"]
    source=[]
    for entry in selected:
        payment=pair.kind_of(entry)=="payment"
        origin=names["party_a"] if entry["debtor"]=="A" else names["party_b"]
        destination=names["party_b"] if entry["debtor"]=="A" else names["party_a"]
        locked=bool(data["current_from"] and entry["entry_date"]<data["current_from"])
        source.append({
          "date":entry["entry_date"],
          "type":"Pagamento real" if payment else "Dívida / compensação",
          "description":entry["description"],
          "origin":origin,"destination":destination,
          "amount":entry["amount"],"notes":entry["notes"],
          "status":"Fechado" if locked else "Período aberto",
          "reference":"Lançamento "+str(entry["id"]),
          "id":int(entry["id"]), "sort":entry["entry_date"] or "",
        })
    # A própria lista do Acerto exibe TODOS os registros neutros,
    # independentemente do fechamento. Espelhar exatamente essa regra.
    for entry in records:
        day=entry["record_date"] or entry["original_date"] or ""
        source.append({
          "date":day,
          "type":"Registro informativo (não altera saldo)",
          "description":entry["description"],
          "origin":entry["from_name"],"destination":entry["to_name"],
          "amount":entry["amount"],"notes":entry["notes"],
          "status":"Informativo",
          "reference":"Registro "+str(entry["id"]),
          "id":int(entry["id"]), "sort":day,
        })
    if len(source)>MAX_ROWS:
        raise ValueError("Há mais de 75 mil lançamentos para exportar.")
    source.sort(key=lambda e:(e["sort"],e["id"]),reverse=True)
    return data,source


def generate(con,cid,include_history=False):
    import xlsxwriter
    data,rows=rows_for_export(con,cid,include_history)
    stream=io.BytesIO()
    book=xlsxwriter.Workbook(stream,{
        "constant_memory":True,
        "strings_to_formulas":False,
        "strings_to_urls":False,
        "default_date_format":"dd/mm/yyyy",
    })
    book.set_properties({
      "title":"Lançamentos de Acerto A x B",
      "subject":"Controle de acerto entre pessoas - histórico de lançamentos",
      "author":"Meus Controles",
      "comments":"Exportação em modo somente leitura; registros informativos não afetam saldo.",
    })
    ws=book.add_worksheet("Lançamentos")
    ws.hide_gridlines(2)
    ws.set_zoom(90)
    ws.freeze_panes(4,0)
    ws.set_landscape()
    ws.fit_to_pages(1,0)
    ws.set_margins(0.25,0.25,0.4,0.4)
    ws.set_header("&CMEUS CONTROLES - ACERTO")
    ws.set_footer("&CPágina &P de &N")
    for i,width in enumerate((16,40,48,29,29,21,48,21,19)):
        ws.set_column(i,i,width)
    title=book.add_format({
      "bold":True,"font_name":"Aptos","font_size":15,
      "font_color":"#FFFFFF","bg_color":"#286ECF","valign":"vcenter",
    })
    subtitle=book.add_format({
      "font_name":"Aptos","font_size":10,"font_color":"#596D88",
    })
    header=book.add_format({
      "bold":True,"font_name":"Aptos","font_size":10,
      "font_color":"#FFFFFF","bg_color":"#386FA9",
      "text_wrap":True,"valign":"vcenter",
      "bottom":1,"bottom_color":"#D9E6F3",
    })
    texts=[book.add_format({
      "font_name":"Aptos","font_size":10,"valign":"vcenter",
      "bottom":1,"bottom_color":"#E6ECF4",
      **({"bg_color":"#F4F8FD"} if i else {})
    }) for i in range(2)]
    dates=[book.add_format({
      "font_name":"Aptos","font_size":10,"valign":"vcenter",
      "num_format":"dd/mm/yyyy",
      "bottom":1,"bottom_color":"#E6ECF4",
      **({"bg_color":"#F4F8FD"} if i else {})
    }) for i in range(2)]
    currencies=[book.add_format({
      "font_name":"Aptos","font_size":10,"valign":"vcenter",
      "num_format":'"R$" #,##0.00;[Red]("R$" #,##0.00)',
      "bottom":1,"bottom_color":"#E6ECF4",
      **({"bg_color":"#F4F8FD"} if i else {})
    }) for i in range(2)]
    ws.set_row(0,32)
    people=data["settings"]
    ws.merge_range(0,0,0,8,
       "ACERTO - "+people["party_a"]+" × "+people["party_b"],title)
    subtitle_text=(
        ("Histórico completo" if include_history else "Lançamentos do período aberto")
        + " | " + str(len(rows)) + " lançamento(s) | Exportado em "
        + datetime.now().strftime("%d/%m/%Y %H:%M")
    )
    ws.merge_range(1,0,1,8,subtitle_text,subtitle)
    ws.set_row(3,30)
    ws.write_row(3,0,HEADERS,header)
    ws.autofilter(3,0,3+len(rows),8)
    for index,entry in enumerate(rows):
        nr=index+4
        ws.set_row(nr,21)
        text_fmt=texts[index%2]
        date_fmt=dates[index%2]
        amount_fmt=currencies[index%2]
        day=entry["date"]
        try:
            dt=datetime.strptime(day,"%Y-%m-%d")
            ws.write_datetime(nr,0,dt,date_fmt)
        except (ValueError,TypeError):
            ws.write_string(nr,0,str(day or ""),text_fmt)
        values=(
          entry["type"],entry["description"],entry["origin"],entry["destination"],
        )
        for i,value in enumerate(values,1):
            ws.write_string(nr,i,str(value or ""),text_fmt)
        number=Decimal(str(entry["amount"]))
        if not number.is_finite():
            raise ValueError("Valor inválido no lançamento "+entry["reference"])
        ws.write_number(nr,5,float(number),amount_fmt)
        for i,key in ((6,"notes"),(7,"status"),(8,"reference")):
            ws.write_string(nr,i,str(entry[key] or ""),text_fmt)
    book.close()
    return stream.getvalue()
