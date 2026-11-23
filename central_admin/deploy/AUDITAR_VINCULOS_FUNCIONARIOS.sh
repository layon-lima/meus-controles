#!/usr/bin/env bash
# AUDITORIA SOMENTE LEITURA — CONTAS 4 + VALES DE FUNCIONÁRIOS
# Executar como root na VPS. NÃO vincula, NÃO baixa vale, NÃO paga conta.
set -Eeuo pipefail
umask 077
CONTAINER="central-novo-horizonte-painel-1"
REPORT="/root/AUDITORIA_VINCULOS_FUNCIONARIOS.txt"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: Docker indisponível." >&2; exit 2
fi
if ! docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo "ERRO: Central não está em execução: $CONTAINER." >&2; exit 2
fi
echo "Auditoria SOMENTE LEITURA dos funcionários e vales..."
echo "Não serão alterados bancos, vínculos ou pagamentos."
docker exec -i "$CONTAINER" python - <<'PY' | tee "$REPORT"
import os, sys, json, sqlite3, http.client, unicodedata
from pathlib import Path
from urllib.parse import urlsplit
from decimal import Decimal, InvalidOperation
from collections import Counter, defaultdict
from datetime import datetime, timezone

def abort(message):
    raise SystemExit("ERRO NA AUDITORIA: " + message)

def normalize(value):
    raw=unicodedata.normalize("NFKD",str(value or "").strip().upper())
    return " ".join("".join(c for c in raw if not unicodedata.combining(c)).split())

def dec(value):
    try:
        value=Decimal(str(value))
    except (ValueError,TypeError,InvalidOperation):
        abort("Valor de parcela inválido em Vales.")
    if not value.is_finite() or value<0:
        abort("Valor negativo ou infinito em Vales.")
    return value

def money(value):
    return "R$ "+f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

def fetch(path):
    origin=os.environ.get("CENTRAL_CONTROLES_ORIGIN","https://controles.fazendanovohorizonte.com")
    upstream=os.environ.get("CENTRAL_CONTROLES_UPSTREAM","http://central-controles-api:18765")
    remote=urlsplit(upstream)
    source=urlsplit(origin)
    if remote.scheme!="http":
        abort("O endereço do motor original não é HTTP privado.")
    try:
        conn=http.client.HTTPConnection(remote.hostname,remote.port or 80,timeout=15)
        try:
            conn.request("GET",path,headers={
                "Host":source.netloc,"Origin":origin,"Accept":"application/json"})
            response=conn.getresponse()
            content=response.read(8_000_000)
            if response.status!=200:
                abort("Motor de Vales retornou HTTP "+str(response.status)+" em "+path)
            data=json.loads(content)
            if not isinstance(data,dict):
                abort("Resposta inesperada de "+path)
            return data
        finally:
            conn.close()
    except (OSError,ValueError) as exc:
        abort("Não foi possível consultar o Meus Controles: "+str(exc)[:170])

def sqlite_ro(path):
    p=Path(path)
    if not p.is_file():
        abort("Banco não encontrado (sem alterações): "+str(p))
    return sqlite3.connect(p.resolve().as_uri()+"?mode=ro",uri=True,timeout=8)

# 1. CONTAS — leitura dos nomes/IDs, nunca de Pix/CPF/dados de pagamento.
contas_path=os.environ.get("CENTRAL_CONTAS_DB","/contas-data/controle_contas.db")
with sqlite_ro(contas_path) as con:
    try:
        accounts=[
            {"id":int(row[0]),"name":str(row[1])}
            for row in con.execute(
                "SELECT id,nome FROM holerite_funcionarios ORDER BY nome COLLATE NOCASE")
        ]
    except sqlite3.Error as exc:
        abort("Tabela de funcionários do CONTAS inacessível: "+str(exc))
if not accounts:
    abort("Nenhum funcionário foi encontrado no CONTAS; impossível auditar vínculos.")
by_account={person["id"]:person for person in accounts}

# 2. MEUS CONTROLES — APIs ORIGINAIS. Nenhuma consulta SQL ao PostgreSQL.
controls=fetch("/api/state").get("controls")
if not isinstance(controls,list):
    abort("A API /api/state não trouxe controls[]; pode ser versão antiga.")
vale_controls=[row for row in controls if row.get("mode")=="vale_funcionarios"]
if not vale_controls:
    abort("Não foi encontrado controle em modo vale_funcionarios.")
vales=[]
for control in vale_controls:
    cid=int(control["id"])
    data=fetch(f"/api/controls/{cid}/vales")
    people=data.get("employees")
    if not isinstance(people,list):
        abort("A API do controle "+str(cid)+" não trouxe employees[].")
    for person in people:
        debts=person.get("debts")
        if not isinstance(debts,list):
            abort("A API de Vales não trouxe debts[] de "+str(person.get("name")))
        pending_count=0
        pending_total=Decimal("0")
        pending_rows=[]
        for debt in debts:
            parts=debt.get("installments")
            if not isinstance(parts,list):
                abort("O vale de "+str(person.get("name"))+" não trouxe installments[].")
            for part in parts:
                remaining=dec(part.get("amount"))-dec(part.get("paid"))
                if remaining<0:
                    abort("Vale tem baixa superior ao valor original: parcela "+str(part.get("id")))
                if remaining>0:
                    pending_count+=1
                    pending_total+=remaining
                    pending_rows.append((str(part.get("due_month")),remaining))
        vales.append({
            "id":int(person["id"]),
            "name":str(person.get("name") or ""),
            "control_id":cid,
            "pending":pending_count,
            "total":pending_total,
            "months":sorted({m for m,v in pending_rows if v>0}),
        })
vale_ids=[x["id"] for x in vales]
if len(set(vale_ids))!=len(vale_ids):
    abort("IDs repetidos entre os cadastros de Vales; associação insegura.")

# 3. JORNAL DA CENTRAL — abrir SQLite em modo ro; jamais criar tabelas.
journal_path=os.environ.get("CENTRAL_VALES_DB","/central-data/vales_holerites.db")
explicit={}
journal_present=Path(journal_path).is_file()
if journal_present:
    with sqlite_ro(journal_path) as con:
        tables={r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if "staff_links" in tables:
            explicit={
                int(row[0]):int(row[1])
                for row in con.execute(
                    "SELECT vale_employee_id,contas_employee_id FROM staff_links")
            }
else:
    print("AVISO: journal de vínculos não encontrado. Verificar se a integração foi instalada.")

# 4. Compara vínculos gravados, correspondência exata e sugestões
source_names=Counter(normalize(x["name"]) for x in vales)
target_names=Counter(normalize(x["name"]) for x in accounts)
targets_by_name=defaultdict(list)
for x in accounts:
    targets_by_name[normalize(x["name"])].append(x)

def fuzzy_suggestions(value):
    words=normalize(value).split()
    if not words: return []
    first=words[0]
    matches=[]
    for person in accounts:
        other=normalize(person["name"]).split()
        if not other:continue
        if first==other[0]:
            if len(first)>=5 or (len(words)>1 and len(other)>1 and words[1]==other[1]):
                matches.append(person)
        elif len(first)>=7 and len(other[0])>=7:
            a,b=first,other[0]
            if abs(len(a)-len(b))<=1:
                # Distância de edição <= 1. Apenas sugestão, nunca vínculo.
                i=j=changes=0
                if len(a)>len(b):a,b=b,a
                while i<len(a) and j<len(b):
                    if a[i]==b[j]:i+=1;j+=1;continue
                    changes+=1
                    if changes>1:break
                    if len(a)==len(b):i+=1
                    j+=1
                if changes+len(b)-j<=1:matches.append(person)
    return matches

used_destinations=set(explicit.values())
result=[]
for val in vales:
    vid=val["id"]
    name=normalize(val["name"])
    dest=None
    if vid in explicit:
        dest=by_account.get(explicit[vid])
        status=("GRAVADO / NOMES CONFEREM" if dest and normalize(dest["name"])==name
            else "GRAVADO / NOMES DIFERENTES — REVISAR" if dest
            else "ERRO: ID CONTAS INEXISTENTE")
    elif source_names[name]==1 and target_names[name]==1:
        candidate=targets_by_name[name][0]
        if candidate["id"] not in used_destinations:
            dest=candidate
            used_destinations.add(candidate["id"])
            status="AUTO POR NOME / NÃO GRAVADO"
        else:
            status="CONFLITO COM VÍNCULO GRAVADO"
    elif source_names[name]>1 or target_names[name]>1:
        status="NOME REPETIDO / CONFERIR"
    else:
        possible=fuzzy_suggestions(val["name"])
        if len(possible)==1:
            dest=possible[0]
            status="SUGESTÃO / CONFIRMAR"
        elif len(possible)>1:
            status="AMBÍGUO / CONFERIR"
        else:
            status="SEM CORRESPONDÊNCIA"
    result.append((val,dest,status))
    
ghost=[(src,dst) for src,dst in explicit.items() if src not in vale_ids]
counts=Counter(status for _,_,status in result)
pending=sum((p["pending"] for p in vales),0)
total=sum((p["total"] for p in vales),Decimal("0"))

print("="*92)
print("AUDITORIA READ-ONLY — FUNCIONÁRIOS / CONTAS x MEUS CONTROLES")
print("Data UTC:",datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"))
print("Funcionários CONTAS:",len(accounts),"| Perfis de Vales:",len(vales),
      "| Controles de Vales:",len(vale_controls))
print("Parcelas não descontadas:",pending,"| Saldo total:",money(total))
print("Vínculos gravados:",len(explicit),
      "| Journal:", "encontrado" if journal_present else "AUSENTE")
print("="*92)
for val,dest,status in result:
    print(f"VALE #{val['id']:>4} | {val['name']} | {val['pending']} pendente(s) "
          f"| {money(val['total'])}")
    print("   STATUS:",status)
    print("   CONTAS:",f"#{dest['id']} — {dest['name']}" if dest else "(não identificado)")
    if val["months"] and val["pending"]:
        print("   COMPETÊNCIAS:",", ".join(val["months"]))
    print("-"*92)

if ghost:
    print("ALERTA: Vínculos persistidos para IDs de Vales inexistentes:",ghost)
print("RESUMO POR STATUS")
for name,count in counts.most_common():
    print(f"  {name}: {count}")
print("="*92)
if any("ERRO" in status or "CONFLITO" in status or
       "NOMES DIFERENTES" in status or "NOME REPETIDO" in status
       for _,_,status in result) or ghost:
    print("RESULTADO: REQUER REVISÃO. Há vínculos potencialmente incorretos.")
elif any(status not in ("GRAVADO / NOMES CONFEREM",
                        "AUTO POR NOME / NÃO GRAVADO")
         and v["pending"]>0 for v,_,status in result):
    print("RESULTADO: PARCIAL. Há vales pendentes sem vínculo seguro.")
else:
    print("RESULTADO: SEM CONFLITOS DETECTADOS PELOS NOMES/IDs.")
print("ATENÇÃO: correspondência de nome NÃO comprova identidade civil.")
print("NENHUM DADO FOI ALTERADO.")
PY
echo
echo "Relatório salvo em: $REPORT"
echo "Envie o texto do relatório (sem Pix ou dados bancários) para conferência."
