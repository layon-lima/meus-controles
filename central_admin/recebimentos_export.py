"""Exportação local do recorte visível do resumo, sem acesso de escrita a bancos."""
import io
import json
import math
import zipfile
from xml.sax.saxutils import escape

from . import access

MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
HEADERS = ("Fornecedor", "Pedido", "Produto", "Unidade", "Qtd. pedida", "Recebido", "Falta receber")


def workbook(rows):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 20000:
        raise ValueError("Nenhum resultado ou quantidade de linhas inválida.")
    def text_cell(ref, value, style=0):
        if not isinstance(value, str) or len(value)>32767:
            raise ValueError("Texto inválido.")
        value = "".join(c for c in value if c in "\t\n\r" or 32 <= ord(c) <= 0xD7FF or 0xE000 <= ord(c) <= 0xFFFD or 0x10000 <= ord(c) <= 0x10FFFF)
        return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'
    output = ['<row r="1">'+''.join(text_cell(f"{col}1",v,1) for col,v in zip("ABCDEFG",HEADERS))+'</row>']
    for n,row in enumerate(rows,2):
        if not isinstance(row,list) or len(row)!=7:
            raise ValueError("Linha inválida.")
        cells=[text_cell(f"{col}{n}",v) for col,v in zip("ABCD",row[:4])]
        for col,v in zip("EFG",row[4:]):
            if isinstance(v,bool) or not isinstance(v,(float,int)) or not math.isfinite(v):
                raise ValueError("Quantidade inválida.")
            cells.append(f'<c r="{col}{n}" s="2"><v>{v}</v></c>')
        output.append(f'<row r="{n}">'+''.join(cells)+'</row>')
    sheet = f'<worksheet xmlns="{NS}"><dimension ref="A1:G{len(rows)+1}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="25" customWidth="1"/><col min="3" max="3" width="55" customWidth="1"/><col min="4" max="4" width="12" customWidth="1"/><col min="5" max="7" width="19" customWidth="1"/></cols><sheetData>'+''.join(output)+f'</sheetData><autoFilter ref="A1:G{len(rows)+1}"/></worksheet>'
    styles = f'<styleSheet xmlns="{NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF303740"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    types='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
    parts={"[Content_Types].xml":types,
           "_rels/.rels":f'<Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
           "xl/workbook.xml":f'<workbook xmlns="{NS}" xmlns:r="{REL}"><sheets><sheet name="Resumo" sheetId="1" r:id="rId1"/></sheets></workbook>',
           "xl/_rels/workbook.xml.rels":f'<Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="{REL}/styles" Target="styles.xml"/></Relationships>',
           "xl/styles.xml":styles,"xl/worksheets/sheet1.xml":sheet}
    out=io.BytesIO()
    with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
        for name,xml in parts.items():
            z.writestr(name,'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+xml)
    return out.getvalue()


def export_summary(handler):
    if not handler.authorized():
        return handler.respond(401,{"ok":False,"erro":"Sessão não autorizada."})
    if not access.trusted_origin(handler.headers.get("Origin","")):
        return handler.respond(403,{"ok":False,"erro":"Origem não autorizada."})
    if handler.headers.get("Content-Type","").split(";")[0].strip()!="application/json":
        return handler.respond(415,{"ok":False,"erro":"Formato inválido."})
    try:
        size=int(handler.headers.get("Content-Length","0"))
        if not 2<=size<=4_000_000:
            raise ValueError("Tamanho inválido.")
        payload=json.loads(handler.rfile.read(size))
        result=workbook(payload.get("rows") if isinstance(payload,dict) else None)
    except (ValueError,TypeError,OverflowError):
        return handler.respond(400,{"ok":False,"erro":"Dados do resumo inválidos."})
    return handler.respond(200,result,MIME)
