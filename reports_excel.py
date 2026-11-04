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


def build_xlsx(summaries,rows,grouped):
    """Arquivo Excel real, escrito por XlsxWriter (sem montar OOXML à mão).

    A biblioteca valida internamente as partes do pacote XLSX. Células que
    começam com '=' continuam sendo TEXTO, nunca fórmula importada.
    """
    import xlsxwriter

    output=io.BytesIO()
    # constant_memory mantém a geração estável mesmo em planilhas longas.
    workbook=xlsxwriter.Workbook(output,{
        "constant_memory":True,
        "strings_to_formulas":False,
        "strings_to_urls":False,
        "default_date_format":"dd/mm/yyyy",
    })
    workbook.set_properties({
        "title":"Relatório de lançamentos dos controles",
        "subject":"Exportação de controles selecionados",
        "author":"Central de Controles",
        "comments":"Gerado pela Central de Controles; não altera dados.",
    })
    title_fmt=workbook.add_format({
        "font_name":"Aptos","font_size":15,"bold":True,
        "font_color":"#073C45","bg_color":"#EAF4F1",
        "valign":"vcenter",
    })
    subtitle_fmt=workbook.add_format({
        "font_name":"Aptos","font_size":10,"font_color":"#536D75",
    })
    header_fmt=workbook.add_format({
        "font_name":"Aptos","font_size":10,"bold":True,
        "font_color":"#FFFFFF","bg_color":"#116D66",
        "valign":"vcenter","text_wrap":True,
    })
    regular_fmt=workbook.add_format({"font_name":"Aptos","font_size":10})
    money_fmt=workbook.add_format({
        "font_name":"Aptos","font_size":10,
        "num_format":'"R$" #,##0.00;[Red]("R$" #,##0.00)',
    })
    qty_fmt=workbook.add_format({
        "font_name":"Aptos","font_size":10,"num_format":"#,##0.000",
    })
    date_fmt=workbook.add_format({
        "font_name":"Aptos","font_size":10,"num_format":"dd/mm/yyyy",
    })
    int_fmt=workbook.add_format({
        "font_name":"Aptos","font_size":10,"num_format":"0",
    })
    summary_headers=("Pasta","Controle","Modelo","Lançamentos","NF-e pendentes")
    summary_widths=(22,38,28,17,19)
    widths=(22,34,22,15,30,24,43,34,35,17,20,17,12,45,52,25)
    now=datetime.now().strftime("%d/%m/%Y %H:%M")
    subtitle="Exportado em "+now+" · Valores monetários e quantidades em colunas separadas"

    def write_sheet(sheet_name,items,headers,title,sub,widths,is_summary=False):
        ws=workbook.add_worksheet(sheet_name)
        ws.hide_gridlines(2)
        ws.set_zoom(90)
        ws.set_default_row(19)
        ws.set_row(0,31)
        ws.set_row(1,24)
        ws.set_row(3,34)
        for col_number,width in enumerate(widths):
            ws.set_column(col_number,col_number,width)
        last=len(headers)-1
        ws.merge_range(0,0,0,last,title,title_fmt)
        ws.merge_range(1,0,1,last,sub,subtitle_fmt)
        ws.write_row(3,0,headers,header_fmt)
        ws.freeze_panes(4,0)
        ws.autofilter(3,0,max(3,len(items)+3),last)

        for idx,values in enumerate(items,4):
            for col_number,value in enumerate(values):
                if value is None or value=="":
                    continue
                if isinstance(value,(float,int,Decimal)) and not isinstance(value,bool):
                    n=money(value)
                    if n is not None:
                        fmt=(int_fmt if is_summary else
                             money_fmt if col_number in (9,10) else
                             qty_fmt if col_number==11 else regular_fmt)
                        ws.write_number(idx,col_number,n,fmt)
                        continue
                if not is_summary and col_number==3 and isinstance(value,str):
                    if re.fullmatch(r"\d{4}-\d{2}-\d{2}",value):
                        try:
                            parsed=datetime.strptime(value,"%Y-%m-%d")
                            ws.write_datetime(idx,col_number,parsed,date_fmt)
                            continue
                        except ValueError:
                            pass
                # write_string é deliberado: impedir formula injection em
                # descrição, observações e nomes de fornecedores.
                ws.write_string(idx,col_number,as_text(value)[:32767],regular_fmt)
        return ws

    used={"resumo","lançamentos"}
    try:
        write_sheet("Resumo",summaries,summary_headers,
                    "RELATÓRIO DE CONTROLES",subtitle,summary_widths,True)
        write_sheet("Lançamentos",rows,HEADERS,
                    "TODOS OS LANÇAMENTOS",subtitle,widths)
        for control,group in grouped:
            name=unique_sheet_name(control["name"],used)
            write_sheet(name,group,HEADERS,control["name"],
                        "Pasta: "+control["folder"]+" · "+subtitle,widths)
        workbook.close()
    except Exception:
        try:workbook.close()
        except Exception:pass
        raise
    return output.getvalue()

def generate(con,ids):
    return build_xlsx(*report_data(con,ids))
