"""Exportação multi-controle em Excel, sem dependências externas.

O relatório conserva o tipo, o ID e o contexto dos lançamentos. Valores de
produtos são quantidades, não reais; registros informativos não são somados.
"""
import io
import json
import re
import zipfile
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from html import escape
from xml.etree import ElementTree

HEADERS=("Pasta","Controle","Modelo","Data","Tipo de lançamento","Categoria",
         "Descrição","Envolvidos / direção","Referência / NF","Valor (R$)",
         "Impacto saldo (R$)","Quantidade","Unidade","Observações",
         "Detalhes","ID origem")
MODE={"saldo":"Saldo devedor","financeiro":"Financeiro","calculo":"Calculado",
      "caminhao":"Transportadora","divida":"Dívidas","divida_sem_valor":"Pagamentos acumulados",
      "recebimento":"Recebimentos","acerto_ab":"Acerto entre pessoas",
      "vale_funcionarios":"Vales de funcionários"}
LIMIT_CONTROLS=80
LIMIT_ROWS=75000


def money(value):
    if value is None or value=="":return None
    try:
        result=Decimal(str(value))
        if not result.is_finite():return None
        return float(result)
    except (ValueError,InvalidOperation,TypeError):
        return None


def as_text(value):
    if value is None:return ""
    if isinstance(value,(dict,list)):
        return json.dumps(value,ensure_ascii=False,sort_keys=True,default=str)
    return str(value)


def details(value):
    if isinstance(value,str):
        try:value=json.loads(value)
        except (ValueError,TypeError):return value
    if isinstance(value,dict):
        return " | ".join(str(k)+": "+as_text(v) for k,v in value.items()
                        if v is not None and str(v)!="")
    return as_text(value)


def select_controls(con,ids):
    if not isinstance(ids,list) or not 1<=len(ids)<=LIMIT_CONTROLS:
        raise ValueError("Selecione de 1 a 80 controles para exportar.")
    if any(type(x) is not int or x<=0 for x in ids) or len(set(ids))!=len(ids):
        raise ValueError("A seleção contém IDs inválidos ou repetidos.")
    marks=",".join("?" for _ in ids)
    found=[dict(r) for r in con.execute(
        """SELECT c.id,c.name,c.mode,b.name AS folder,c.fields_json
           FROM controls c JOIN boards b ON b.id=c.board_id
           WHERE c.id IN ("""+marks+")",ids)]
    if len(found)!=len(ids):raise ValueError("Um dos controles selecionados não existe.")
    byid={c["id"]:c for c in found}
    return [byid[x] for x in ids]


def collect(con,control):
    """Um registro por lançamento efetivo, sem somar quantidades com dinheiro."""
    cid=control["id"]
    mode=control["mode"]
    base=(control["folder"],control["name"],MODE.get(mode,mode))
    results=[]

    def add(day="",kind="",category="",description="",who="",ref="",amount=None,
            effect=None,quantity=None,unit="",notes="",extra="",ident=""):
        results.append((*base,as_text(day)[:10],kind,as_text(category),
                        as_text(description),as_text(who),as_text(ref),
                        money(amount),money(effect),money(quantity),as_text(unit),
                        as_text(notes),as_text(extra),as_text(ident)))

    if mode in ("saldo","financeiro","calculo"):
        try:fields=json.loads(control["fields_json"])
        except (TypeError,ValueError):fields=[]
        date_key=next((x.get("key") for x in fields if x.get("type")=="date"),None)
        title_key=next((x.get("key") for x in fields if x.get("type")=="text"),None)
        for row in con.execute("SELECT * FROM entries WHERE control_id=? ORDER BY id",(cid,)):
            e=dict(row)
            try:info=json.loads(e["data_json"])
            except (TypeError,ValueError):info={}
            try:calc=json.loads(e["calculated_json"])
            except (TypeError,ValueError):calc={}
            amount=money(e["amount"])
            description=info.get(title_key) if title_key else ""
            add(info.get(date_key) if date_key else e["created_at"],
                e["type_label"],e["category"],description or "Lançamento",
                "",e["type_key"],amount,amount*e["direction"] if amount is not None else None,
                notes=e["notes"],extra=details(info)+(" | Cálculos: "+details(calc) if calc else ""),
                ident="entries:"+str(e["id"]))

    elif mode=="acerto_ab":
        people=con.execute("SELECT party_a,party_b FROM pair_settings WHERE control_id=?",(cid,)).fetchone()
        a=people["party_a"] if people else "Pessoa A"
        b=people["party_b"] if people else "Pessoa B"
        for row in con.execute("SELECT * FROM pair_entries WHERE control_id=? ORDER BY id",(cid,)):
            e=dict(row);payer=a if e["debtor"]=="A" else b;other=b if e["debtor"]=="A" else a
            payment=e["entry_kind"]=="payment"
            amount=money(e["amount"])
            sign=(1 if e["debtor"]=="B" else -1)*(-1 if payment else 1)
            add(e["entry_date"],"Pagamento real" if payment else "Dívida / compensação","",
                e["description"],payer+(" pagou a " if payment else " deve a ")+other,
                "",amount,amount*sign if amount is not None else None,
                notes=e["notes"],ident="pair_entries:"+str(e["id"]))
        for row in con.execute("SELECT * FROM pair_records WHERE control_id=? ORDER BY id",(cid,)):
            e=dict(row)
            add(e["record_date"] or e["original_date"],"Registro informativo (não altera saldo)","",
                e["description"],e["from_name"]+" → "+e["to_name"],"",
                e["amount"],0,notes=e["notes"],
                extra=details({"tipo na origem":e["original_type"],
                               "saldo original informado":e["original_balance"],
                               "lote":e["batch_id"],"linha":e["source_row"]}),
                ident="pair_records:"+str(e["id"]))

    elif mode=="caminhao":
        labels={"freight":"Frete","expense":"Gasto operacional",
                "advance":"Vale motorista (abatimento da comissão)"}
        for row in con.execute("SELECT * FROM truck_entries WHERE control_id=? ORDER BY id",(cid,)):
            e=dict(row)
            more=details({"peso_kg":e["weight_kg"],"preço_tonelada":e["price_tonne"],
                          "comissão_%":e["commission_pct"],
                          "comissão_gerada":e["commission_amount"]})
            add(e["event_date"],labels.get(e["kind"],e["kind"]),e["category"],
                e["description"],"", "",e["amount"],None,
                notes=e["notes"],extra=more,ident="truck_entries:"+str(e["id"]))

    elif mode in ("divida","divida_sem_valor"):
        kind="Pagamento de dívida" if mode=="divida" else "Pagamento acumulado"
        for row in con.execute("SELECT * FROM debt_payments WHERE control_id=? ORDER BY id",(cid,)):
            e=dict(row)
            add(e["payment_date"],kind,"",e["description"],"", "",
                e["amount"],None,notes=e["notes"],ident="debt_payments:"+str(e["id"]))

    elif mode=="recebimento":
        for row in con.execute("SELECT * FROM purchase_items WHERE control_id=? ORDER BY id",(cid,)):
            e=dict(row)
            add(e["created_at"],"Pedido cadastrado","",e["product"],e["supplier"],
                e["order_number"],None,None,e["ordered_qty"],e["unit"],
                extra="Status: "+("Concluído" if e.get("closed") else "Aberto"),
                ident="purchase_items:"+str(e["id"]))
        for row in con.execute("""SELECT r.*,i.product,i.supplier,i.order_number,i.unit
                FROM purchase_receipts r
                JOIN purchase_items i ON i.id=r.item_id
                WHERE i.control_id=? ORDER BY r.id""",(cid,)):
            e=dict(row)
            add(e["received_date"],"Recebimento NF-e","",e["product"],e["supplier"],
                "Pedido "+e["order_number"]+" · NF "+e["invoice_number"],
                None,None,e["received_qty"],e["unit"],notes=e["notes"],
                extra="Chave NF-e: "+as_text(e["access_key"]),
                ident="purchase_receipts:"+str(e["id"]))
        for row in con.execute("SELECT * FROM receiving_xml_pending WHERE control_id=? ORDER BY id",(cid,)):
            e=dict(row)
            add(e["issued_date"],"NF-e sem pedido (pendente)","",e["product"],e["supplier"],
                "NF "+e["invoice_number"],None,None,e["quantity"],e["unit"],
                extra="Chave NF-e: "+as_text(e["access_key"]),
                ident="receiving_xml_pending:"+str(e["id"]))

    elif mode=="vale_funcionarios":
        for row in con.execute("""SELECT d.*,e.name AS employee FROM vale_debts d
                JOIN vale_employees e ON e.id=d.employee_id
                WHERE d.control_id=? ORDER BY d.id""",(cid,)):
            e=dict(row)
            add(e["first_month"],"Vale concedido","",e["title"] or e["description"],
                e["employee"],"",e["amount"],None,notes=e["description"],
                ident="vale_debts:"+str(e["id"]))
        for row in con.execute("""SELECT p.*,e.name AS employee,d.title,d.description,
                    i.installment_number,d.id AS debt_id FROM vale_payments p
                JOIN vale_installments i ON i.id=p.installment_id
                JOIN vale_debts d ON d.id=i.debt_id
                JOIN vale_employees e ON e.id=d.employee_id
                WHERE d.control_id=? ORDER BY p.id""",(cid,)):
            e=dict(row)
            add(e["payment_month"],"Desconto de vale","",e["title"] or e["description"],
                e["employee"],"Vale "+str(e["debt_id"])+", parcela "+str(e["installment_number"]),
                e["amount"],None,notes=e["notes"],ident="vale_payments:"+str(e["id"]))

    else:
        raise ValueError("Modelo de controle não suportado: "+mode)
    return results


def report_data(con,ids):
    controls=select_controls(con,ids)
    records=[]
    summaries=[]
    grouped=[]
    for c in controls:
        subset=collect(con,c)
        if len(records)+len(subset)>LIMIT_ROWS:
            raise ValueError("Relatório muito grande. Selecione menos controles (limite de 75 mil linhas).")
        records.extend(subset)
        grouped.append((c,subset))
        summaries.append((c["folder"],c["name"],MODE.get(c["mode"],c["mode"]),len(subset),
                          sum(x[4].endswith("(pendente)") for x in subset)))
    return summaries,records,grouped


def clean_xml(value):
    # XML 1.0 não permite caracteres de controle, mesmo escapados.
    value=re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "",as_text(value))
    return escape(value,quote=False)


def col(index):
    index+=1;out=""
    while index:
        index,rem=divmod(index-1,26);out=chr(65+rem)+out
    return out


def cell(value,row,index,currency=False,qty=False):
    address=col(index)+str(row)
    if value is None or value=="":return ""
    if isinstance(value,(float,int,Decimal)) and not isinstance(value,bool):
        n=money(value)
        if n is not None:
            return '<c r="'+address+'" s="'+("2" if currency else "3" if qty else "0")+'"><v>'+str(n)+'</v></c>'
    if index==3 and isinstance(value,str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}",value):
        try:
            dt=date.fromisoformat(value)
            serial=(dt-date(1899,12,30)).days
            return '<c r="'+address+'" s="4"><v>'+str(serial)+'</v></c>'
        except ValueError:pass
    text=clean_xml(value)
    if len(text)>32767:text=text[:32767]
    return '<c r="'+address+'" t="inlineStr"><is><t xml:space="preserve">'+text+'</t></is></c>'


def worksheet(rows,headers,title,subtitle,widths):
    count=len(headers)
    def xmlrow(number,values,style=0):
        pieces=[]
        for j,value in enumerate(values):
            if style:
                pieces.append('<c r="'+col(j)+str(number)+'" s="'+str(style)+'" t="inlineStr"><is><t>'+clean_xml(value)+'</t></is></c>')
            else:
                pieces.append(cell(value,number,j,currency=j in (9,10),qty=j==11))
        return '<row r="'+str(number)+'">'+''.join(pieces)+'</row>'
    parts=['<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
           '<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
           '<sheetFormatPr defaultRowHeight="16"/>',
           '<cols>'+''.join('<col min="'+str(i+1)+'" max="'+str(i+1)+'" width="'+str(w)+'" customWidth="1"/>'
                           for i,w in enumerate(widths))+'</cols>',
           '<sheetData>',xmlrow(1,[title],5),xmlrow(2,[subtitle],6),xmlrow(4,headers,1)]
    for n,r in enumerate(rows,5):
        parts.append(xmlrow(n,r))
    parts+=['</sheetData>',
            '<autoFilter ref="A4:'+col(count-1)+str(max(len(rows)+4,4))+'"/>',
            '<mergeCells count="2"><mergeCell ref="A1:'+col(count-1)+'1"/><mergeCell ref="A2:'+col(count-1)+'2"/></mergeCells>',
            '</worksheet>']
    return "".join(parts).encode("utf-8")


def unique_sheet_name(name,used):
    invalid=re.sub(r"[:\\/?*\[\]]"," ",name).strip(" '")
    base=(invalid or "Controle")[:29]
    attempt=base;n=2
    while attempt.casefold() in used:
        suffix=" "+str(n);attempt=base[:31-len(suffix)]+suffix;n+=1
    used.add(attempt.casefold())
    return attempt


def block_headers(mode):
    """Sete colunas B:H; A identifica o controle, como no modelo aprovado."""
    if mode=="recebimento":
        return ("Data","Tipo","Produto","Fornecedor","Pedido / NF","Quantidade","Unidade / observações")
    return ("Data","Tipo","Descrição","Origem / destino","Referência","Valor (R$)","Observações")


def block_line(record,mode):
    """Da linha consolidada original para as sete colunas visíveis do bloco."""
    day,kind,category,description,who,ref=record[3:9]
    amount,impact,quantity,unit,notes,extra,ident=record[9:16]
    notes_all=" | ".join(x for x in (as_text(notes),as_text(extra)) if x)
    if ident:
        notes_all+=((" | " if notes_all else "")+"Origem: "+ident)
    if mode=="recebimento":
        unit_notes=" | ".join(x for x in (as_text(unit),notes_all) if x)
        return (day,kind,description,who,ref,quantity,unit_notes)
    # Categoria, quando existir, permanece junto do tipo, sem perder informação.
    if category:
        kind=kind+" · "+category
    return (day,kind,description,who,ref,amount,notes_all)


def block_totals(rows,mode):
    """Totais separados por natureza, para não apresentar somas enganosas.

    O primeiro item é sempre TOTAIS. Subtotais adicionais distinguem, por
    exemplo, adiantamentos de despesas, pedidos de entregas e unidades.
    Retorna (descrição, valor numérico ou None, explicação).
    """
    def sum_amount(predicate):
        return round(sum((r[9] or 0) for r in rows if predicate(r)),2)

    n=len(rows)
    count_note=str(n)+" lançamento(s)"
    if mode=="recebimento":
        # Pedido cadastrado e NF-e pendente NÃO são mercadoria recebida.
        received=[r for r in rows if r[4]=="Recebimento NF-e"]
        by_unit={}
        for r in received:
            unit=as_text(r[12]).strip() or "sem unidade"
            by_unit[unit]=round(by_unit.get(unit,0)+(r[11] or 0),3)
        if len(by_unit)==1:
            unit,amount=next(iter(by_unit.items()))
            return [("TOTAIS · "+count_note,amount,"Total recebido em "+unit+
                     "; pedidos e NF-e pendentes não somados")]
        result=[("TOTAIS · "+count_note,None,
                 "Recebimentos de unidades diferentes não são somados" if by_unit
                 else "Nenhum recebimento lançado")]
        for unit,amount in sorted(by_unit.items()):
            result.append(("Recebido · "+unit,amount,"Subtotal somente de recebimentos"))
        return result

    if mode=="acerto_ab":
        impact=round(sum((r[10] or 0) for r in rows),2)
        return [("TOTAIS · "+count_note,impact,
                 "Impacto líquido dos lançamentos; registros informativos não alteram saldo")]

    if mode in ("saldo","financeiro","calculo"):
        impact=round(sum((r[10] or 0) for r in rows),2)
        return [("TOTAIS · "+count_note,impact,
                 "Impacto líquido dos lançamentos (direções positivas e negativas)")]

    if mode=="caminhao":
        freight=sum_amount(lambda r:r[4]=="Frete")
        expenses=sum_amount(lambda r:r[4]=="Gasto operacional")
        advances=sum_amount(lambda r:r[4].startswith("Vale motorista"))
        commission=round(sum((money(re.search(
            r"(?:^| \| )comissão_gerada: ([^|]+)",r[14] or ""
        ).group(1)) or 0) if re.search(
            r"(?:^| \| )comissão_gerada: ([^|]+)",r[14] or ""
        ) else 0 for r in rows if r[4]=="Frete"),2)
        return [
            ("TOTAIS · "+count_note,freight,"Total dos fretes realizados"),
            ("Comissão gerada (despesa)",commission,"Comissão operacional; não descontar os vales novamente"),
            ("Outros gastos operacionais",expenses,"Despesas sem os vales de motorista"),
            ("Vales do motorista",advances,"Apenas abatimento da comissão, não nova despesa"),
        ]

    if mode=="vale_funcionarios":
        granted=sum_amount(lambda r:r[4]=="Vale concedido")
        deducted=sum_amount(lambda r:r[4]=="Desconto de vale")
        return [
            ("TOTAIS · "+count_note,granted,"Valor dos vales concedidos"),
            ("Descontos registrados",deducted,"Abatimentos dos vales; não representam nova concessão"),
        ]

    return [("TOTAIS · "+count_note,round(sum((r[9] or 0) for r in rows),2),
             "Soma dos pagamentos registrados")]


def build_xlsx(summaries,rows,grouped):
    """Uma única aba; blocos verdes por controle, linhas e totais, como na imagem."""
    import xlsxwriter
    output=io.BytesIO()
    workbook=xlsxwriter.Workbook(output,{
        "constant_memory":True,"strings_to_formulas":False,
        "strings_to_urls":False,"default_date_format":"dd/mm/yyyy",
    })
    workbook.set_properties({
        "title":"Relatório de lançamentos por controle",
        "subject":"Controles em blocos verticais",
        "author":"Central de Controles",
        "comments":"Relatório de consulta. Não altera o banco de dados.",
    })
    ws=workbook.add_worksheet("Relatório")
    ws.hide_gridlines(2)
    ws.set_zoom(85)
    ws.set_landscape()
    ws.fit_to_pages(1,0)
    ws.set_margins(0.3,0.3,0.4,0.4)
    ws.set_header("&CCentral de Controles — Relatório de lançamentos")
    ws.set_footer("&CPágina &P de &N")
    widths=(32,15.664,33.664,42.664,34.664,37,19,59)
    for c,width in enumerate(widths):
        ws.set_column(c,c,width)

    band=workbook.add_format({
        "font_name":"Aptos","font_size":10,"bold":True,"font_color":"#FFFFFF",
        "bg_color":"#00AD64","valign":"vcenter","text_wrap":True,
        "bottom":1,"bottom_color":"#008B50",
    })
    # Referência arualizada.xlsx fornecida pelo usuário: a faixa do nome
    # é verde-escura e o cabeçalho A:E é verde-claro (#92D050).
    pair_header=workbook.add_format({
        "font_name":"Aptos","font_size":10,"bold":True,
        "font_color":"#FFFFFF","bg_color":"#92D050",
        "valign":"vcenter","text_wrap":True,
        "bottom":1,"bottom_color":"#008B50",
    })
    pair_date=workbook.add_format({
        "font_name":"Aptos","font_size":10,"valign":"vcenter",
        "num_format":"dd/mm/yy",
    })
    pair_date_alt=workbook.add_format({
        "font_name":"Aptos","font_size":10,"bg_color":"#F4F9F6",
        "valign":"vcenter","num_format":"dd/mm/yy",
    })
    row_plain=workbook.add_format({
        "font_name":"Aptos","font_size":10,"valign":"vcenter",
        "bottom":1,"bottom_color":"#ECF0EE",
    })
    row_alt=workbook.add_format({
        "font_name":"Aptos","font_size":10,"bg_color":"#F4F9F6",
        "valign":"vcenter","bottom":1,"bottom_color":"#ECF0EE",
    })
    money_fmt=workbook.add_format({"num_format":'"R$" #,##0.00;[Red]("R$" #,##0.00)',
                                   "font_name":"Aptos","font_size":10})
    money_alt=workbook.add_format({"num_format":'"R$" #,##0.00;[Red]("R$" #,##0.00)',
                                   "font_name":"Aptos","font_size":10,
                                   "bg_color":"#F4F9F6"})
    qty_fmt=workbook.add_format({"num_format":"#,##0.000",
                                 "font_name":"Aptos","font_size":10})
    qty_alt=workbook.add_format({"num_format":"#,##0.000",
                                 "font_name":"Aptos","font_size":10,
                                 "bg_color":"#F4F9F6"})
    date_fmt=workbook.add_format({"num_format":"dd/mm/yyyy",
                                  "font_name":"Aptos","font_size":10})
    date_alt=workbook.add_format({"num_format":"dd/mm/yyyy",
                                  "font_name":"Aptos","font_size":10,
                                  "bg_color":"#F4F9F6"})
    total=workbook.add_format({"font_name":"Aptos","font_size":10,
                               "bold":True,"bg_color":"#E1EFE9",
                               "top":1,"top_color":"#A1C9B8"})
    total_money=workbook.add_format({"font_name":"Aptos","font_size":10,
                                     "bold":True,"bg_color":"#E1EFE9",
                                     "num_format":'"R$" #,##0.00;[Red]("R$" #,##0.00)',
                                     "top":1,"top_color":"#A1C9B8"})
    total_qty=workbook.add_format({"font_name":"Aptos","font_size":10,
                                   "bold":True,"bg_color":"#E1EFE9",
                                   "num_format":"#,##0.000",
                                   "top":1,"top_color":"#A1C9B8"})
    empty_fmt=workbook.add_format({"font_name":"Aptos","italic":True,
                                   "font_color":"#687F74","font_size":10})
    subtitle_fmt=workbook.add_format({"font_name":"Aptos","font_size":9,
                                      "font_color":"#637C70"})
    current=1  # A primeira faixa verde fica na linha 2 do Excel.
    for control,group in grouped:
        mode=control["mode"]
        if mode=="acerto_ab":
            # MODELO A × B: seguir exatamente A:E do arquivo de referência.
            # Título (A:E), cabeçalho (A:E), dados, Total Em aberto (D:E)
            # e DUAS linhas em branco antes do próximo controle.
            ws.set_row(current,21)
            ws.write_string(current,0,as_text(control["name"])[:32767],band)
            for c in range(1,5):
                ws.write_blank(current,c,None,band)
            current+=1
            for c,heading in enumerate((
                "Data","Tipo","Descrição","Origem / destino","Valor (R$)")):
                ws.write_string(current,c,heading,pair_header)
            current+=1
            ordered=sorted(group,key=lambda r:r[3] or "",reverse=True)
            for i,record in enumerate(ordered):
                ws.set_row(current,20.25)
                # Valores ficam POSITIVOS no lançamento, conforme a planilha
                # modelo. O sinal só participa do Total Em aberto.
                date_value,kind,description,who=record[3],record[4],record[6],record[7]
                amount=record[9]
                ordinary=row_alt if i%2 else row_plain
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}",as_text(date_value)):
                    try:
                        ws.write_datetime(current,0,datetime.strptime(date_value,"%Y-%m-%d"),
                                          pair_date_alt if i%2 else pair_date)
                    except ValueError:
                        ws.write_string(current,0,as_text(date_value),ordinary)
                else:
                    ws.write_string(current,0,as_text(date_value),ordinary)
                for col,value in enumerate((kind,description,who),1):
                    ws.write_string(current,col,as_text(value)[:32767],ordinary)
                if amount is not None:
                    ws.write_number(current,4,float(amount),
                                    money_alt if i%2 else money_fmt)
                else:
                    ws.write_blank(current,4,None,ordinary)
                current+=1
            if not ordered:
                ws.write_string(current,1,"Nenhum lançamento neste controle",empty_fmt)
                current+=1
            ws.set_row(current,21.75)
            for c in range(5):
                ws.write_blank(current,c,None,total)
            ws.write_string(current,3,"Total Em aberto",total)
            # Usar a mesma regra de impacto do acerto A × B, não a soma bruta
            # dos valores: dívida e pagamento têm sinais opostos.
            balance=round(sum((r[10] or 0) for r in group),2)
            ws.write_number(current,4,balance,total_money)
            current+=3
            continue
        headers=block_headers(mode)
        ws.set_row(current,30)
        ws.write_string(current,0,as_text(control["name"])[:32767],band)
        for c,heading in enumerate(headers,1):
            ws.write_string(current,c,heading,band)
        current+=1
        # Inclui as linhas com data mais recente primeiro.
        ordered=sorted(group,key=lambda r:r[3] or "",reverse=True)
        for i,record in enumerate(ordered):
            vals=block_line(record,mode)
            ordinary=row_alt if i%2 else row_plain
            ws.set_row(current,20)
            for colnum,value in enumerate(vals,1):
                if value is None or value=="":
                    ws.write_blank(current,colnum,None,ordinary)
                elif colnum==1 and isinstance(value,str) and re.fullmatch(
                        r"\d{4}-\d{2}-\d{2}",value):
                    try:
                        ws.write_datetime(current,colnum,
                                          datetime.strptime(value,"%Y-%m-%d"),
                                          date_alt if i%2 else date_fmt)
                    except ValueError:
                        ws.write_string(current,colnum,value,ordinary)
                elif colnum==6 and isinstance(value,(int,float,Decimal)):
                    numeric=money(value)
                    if numeric is not None:
                        ws.write_number(current,colnum,numeric,
                                        (qty_alt if i%2 else qty_fmt)
                                        if mode=="recebimento"
                                        else (money_alt if i%2 else money_fmt))
                    else:
                        ws.write_string(current,colnum,as_text(value),ordinary)
                else:
                    # Nunca permitir que observações virem fórmulas.
                    ws.write_string(current,colnum,as_text(value)[:32767],ordinary)
            current+=1
        if not ordered:
            ws.write_string(current,1,"Nenhum lançamento neste controle",empty_fmt)
            current+=1

        for description,amount,note in block_totals(group,mode):
            ws.set_row(current,22)
            # Uma faixa discreta para totais, sem misturar espécies distintas.
            for colnum in range(8):
                ws.write_blank(current,colnum,None,total)
            ws.write_string(current,1,description[:32767],total)
            if amount is not None:
                ws.write_number(current,6,amount,
                                total_qty if mode=="recebimento" else total_money)
            ws.write_string(current,7,note[:32767],total)
            current+=1

        # Uma linha com identificação da pasta e outra em branco.
        ws.write_string(current,1,
                        "Pasta: "+as_text(control["folder"])+" · "+MODE.get(mode,mode),
                        subtitle_fmt)
        current+=2

    if not grouped:
        ws.write_string(current,1,"Nenhum controle selecionado",empty_fmt)
    workbook.close()
    return output.getvalue()

def generate(con,ids):
    return build_xlsx(*report_data(con,ids))
