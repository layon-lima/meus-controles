"""Troca reversível de tipo dos controles, sem apagar lançamentos antigos.

O mesmo ID de controle mantém os dados de todos os modelos. Ao trocar,
apenas o modo ativo e as configurações iniciais necessárias mudam.
"""
from decimal import Decimal
import debt
import pair
import truck

MODELS = {
    "calculo": "Cálculos personalizados",
    "saldo": "Saldo devedor (avançado)",
    "financeiro": "Entradas e saídas",
    "caminhao": "Controle de Caminhão",
    "divida": "Controle de Dívidas",
    "divida_sem_valor": "Dívidas sem valor fixo",
    "recebimento": "Recebimento de Produtos",
    "acerto_ab": "Acerto A × B",
    "vale_funcionarios": "Vales de Funcionários",
}
GROUPS = {
    "calculo": "generic", "saldo": "generic", "financeiro": "generic",
    "caminhao": "truck", "divida": "debt",
    "divida_sem_valor": "debt", "recebimento": "receiving", "acerto_ab": "pair",
    "vale_funcionarios": "vales"
}

def initialize(con):
    con.execute("""CREATE TABLE IF NOT EXISTS control_type_changes(
      id INTEGER PRIMARY KEY,
      control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
      previous_mode TEXT NOT NULL,
      new_mode TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")

def control(con,cid):
    row=con.execute("SELECT id,name,mode FROM controls WHERE id=?",(cid,)).fetchone()
    if row is None:
        raise LookupError("Controle não encontrado.")
    if row["mode"] not in MODELS:
        raise ValueError("O tipo atual não é reconhecido.")
    return dict(row)

def counts(con,cid):
    return {
        "generic": con.execute("SELECT COUNT(*) FROM entries WHERE control_id=?",(cid,)).fetchone()[0],
        "truck": con.execute("SELECT COUNT(*) FROM truck_entries WHERE control_id=?",(cid,)).fetchone()[0],
        "debt": con.execute("SELECT COUNT(*) FROM debt_payments WHERE control_id=?",(cid,)).fetchone()[0],
        "receiving": con.execute("SELECT COUNT(*) FROM purchase_items WHERE control_id=?",(cid,)).fetchone()[0],
        "pair": con.execute("SELECT COUNT(*) FROM pair_entries WHERE control_id=?",(cid,)).fetchone()[0],
        "vales": con.execute("SELECT COUNT(*) FROM vale_debts WHERE control_id=?",(cid,)).fetchone()[0],
    }

def preview(con,cid):
    c=control(con,cid)
    previous=con.execute("""SELECT previous_mode,new_mode,changed_at
        FROM control_type_changes WHERE control_id=?
        ORDER BY id DESC LIMIT 10""",(cid,)).fetchall()
    debt_saved=con.execute("SELECT opening_amount FROM debt_settings WHERE control_id=?",(cid,)).fetchone()
    pair_saved=con.execute("SELECT party_a,party_b FROM pair_settings WHERE control_id=?",(cid,)).fetchone()
    truck_saved=con.execute("SELECT 1 FROM truck_settings WHERE control_id=?",(cid,)).fetchone()
    return {
        "control_id":cid,"name":c["name"],"current_mode":c["mode"],
        "models":[{"mode":mode,"label":label,"group":GROUPS[mode]} for mode,label in MODELS.items()],
        "counts":counts(con,cid),
        "saved_settings":{
            "divida":dict(debt_saved) if debt_saved else None,
            "acerto_ab":dict(pair_saved) if pair_saved else None,
            "caminhao":bool(truck_saved)
        },
        "payments_total":debt.money(debt.total_paid(con,cid)),
        "recent_changes":[dict(row) for row in previous]
    }

def change(con,cid,payload):
    if not isinstance(payload,dict):
        raise ValueError("Selecione o novo tipo de controle.")
    target=payload.get("mode")
    if not isinstance(target,str) or target not in MODELS:
        raise ValueError("Tipo de controle inválido.")
    # Não aceitar conversão/migração destrutiva, só alternar mecânicas visíveis.
    if not con.in_transaction:
        con.execute("BEGIN IMMEDIATE")
    c=control(con,cid)
    if target==c["mode"]:
        return {"id":cid,"mode":target,"previous_mode":target,"changed":False}
    debt_settings=con.execute(
        "SELECT opening_amount FROM debt_settings WHERE control_id=?",(cid,)).fetchone()
    pair_settings=con.execute(
        "SELECT party_a,party_b FROM pair_settings WHERE control_id=?",(cid,)).fetchone()
    truck_settings=con.execute(
        "SELECT 1 FROM truck_settings WHERE control_id=?",(cid,)).fetchone()

    # Adiciona a mecânica do novo modelo primeiro, sem apagar tabelas antigas.
    con.execute("UPDATE controls SET mode=? WHERE id=?",(target,cid))
    if target=="divida":
        if "opening_amount" in payload:
            debt.save_settings(con,cid,{"opening_amount":payload["opening_amount"]})
        elif debt_settings is None:
            raise ValueError("Informe a dívida inicial para ativar o modelo de valor fixo.")
        elif Decimal(debt_settings["opening_amount"]) < debt.total_paid(con,cid):
            raise ValueError("A dívida inicial anterior é menor que os pagamentos acumulados. Informe um novo valor inicial.")
    elif target=="acerto_ab":
        if "pair_settings" in payload:
            pair.save_settings(con,cid,payload["pair_settings"])
        elif pair_settings is None:
            raise ValueError("Informe os nomes das duas pessoas para ativar o Acerto A × B.")
    elif target=="caminhao" and truck_settings is None:
        truck.save_settings(con,cid,{})

    con.execute("""INSERT INTO control_type_changes(control_id,previous_mode,new_mode)
       VALUES(?,?,?)""",(cid,c["mode"],target))
    con.commit()
    return {"id":cid,"previous_mode":c["mode"],"mode":target,"changed":True}
