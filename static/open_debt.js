"use strict";
/* Dívidas sem valor fixo — cada pagamento apenas aumenta o total acumulado. */
const odToday=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const odDate=s=>!s?"—":String(s).length===7?String(s).slice(5,7)+"/"+String(s).slice(0,4):String(s).slice(8,10)+"/"+String(s).slice(5,7)+"/"+String(s).slice(0,4);
const odInput=(name,val,attrs="")=>'<input name="'+name+'" value="'+E(val??"")+'" '+attrs+'>';
Object.assign(App,{
  async renderOpenDebt(){
    const c=this.s.detail?.control;
    if(c?.mode!=="divida_sem_valor")return;
    const id=c.id;
    document.getElementById("main").innerHTML='<div class="empty-state">Carregando pagamentos...</div>';
    try{
      const data=await this.api("/api/controls/"+id+"/open-debt");
      if(this.s.route!=="control"||this.s.id!==id)return;
      this.s.openDebtData=data;
      this.s.openDebtId=id;
      this.renderOpenDebtView();
    }catch(e){
      document.getElementById("main").innerHTML='<div class="empty-state"><strong>Erro ao abrir pagamentos.</strong><p>'+E(e.message)+'</p></div>';
    }
  },
  renderOpenDebtView(){
    const data=this.s.openDebtData,c=this.s.detail?.control;
    if(!data||!c||data.control_id!==c.id)return;
    const t=data.totals;
    const rows=data.payments.map(p=>
      '<tr><td>'+E(odDate(p.payment_date))+'</td>'+
      '<td><strong>'+E(p.description)+'</strong>'+
      (p.notes?'<small class="open-debt-note">'+E(p.notes)+'</small>':"")+'</td>'+
      '<td class="numeric">'+currency(p.amount)+'</td>'+
      '<td><div class="table-actions">'+
      '<button class="mini-action" onclick="App.openDebtForm('+p.id+')">'+icon("edit")+' Editar</button>'+
      '<button class="mini-action" onclick="App.openDebtDelete('+p.id+')">'+icon("trash")+' Excluir</button>'+
      '</div></td></tr>').join("");
    document.getElementById("main").innerHTML=
      '<div class="open-debt-heading"><div><div class="eyebrow">DÍVIDAS SEM VALOR FIXO</div>'+
      '<h2>'+E(c.name)+'</h2><p>Registre os pagamentos. Não há valor final nem limite de lançamentos.</p></div>'+
      '<div class="open-debt-header-actions"><button class="btn btn-sm btn-primary" onclick="App.openDebtForm()">'+icon("plus")+' Registrar pagamento</button>'+
      '<button class="btn btn-sm" onclick="App.openDebtSettings('+c.id+')">'+icon("settings")+' Ajustes</button></div></div>'+
      '<section class="open-debt-total"><div><small>TOTAL ACUMULADO DE PAGAMENTOS</small>'+
      '<strong>'+currency(t.paid)+'</strong><p>Cada novo pagamento é somado ao total.</p></div>'+
      '<div class="open-debt-count"><strong>'+t.count+'</strong><span>pagamento(s)</span></div></section>'+
      '<section class="panel open-debt-ledger"><div class="panel-header"><h3>Histórico de pagamentos</h3>'+
      '<div class="actions-end"><button class="btn btn-sm" onclick="App.openDebtExport('+c.id+')">'+icon("download")+' Exportar CSV</button>'+
      '</div></div>'+
      (data.payments.length?'<div class="table-wrap"><table><thead><tr>'+
      '<th>Data</th><th>Descrição</th><th class="numeric">Valor pago</th><th>Ações</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>':
      '<div class="empty-state open-debt-empty"><strong>Nenhum pagamento registrado.</strong>'+
      '<p>Registre o primeiro pagamento para começar a somar.</p>'+
      '</div>')+
      '</section>';
  },
  openDebtForm(id){
    if(!this.canOpenForm())return;
    const c=this.s.detail?.control,data=this.s.openDebtData;
    if(!c||!data)return;
    const old=id?data.payments.find(p=>p.id===id):null;
    if(id&&!old)return this.toast("Pagamento não encontrado.",true);
    this.s.modal="open-debt-payment";
    this.s.modalContext={controlId:c.id,entry:old?deep(old):null};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal open-debt-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">'+(old?"Editar pagamento":"Registrar pagamento")+'</h2>'+
      '<p>Informe data, descrição e valor pago.</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="openDebtPaymentForm" onsubmit="event.preventDefault();App.openDebtSave()">'+
      '<div class="form-grid"><div class="field"><label>Data do pagamento</label>'+
      odInput("date",old?.payment_date||odToday(),'required type="'+(old?.payment_date?.length===7?"text":"date")+'"'+(old?.payment_date?.length===7?' placeholder="AAAA-MM"':""))+
      '</div><div class="field"><label>Valor pago (R$)</label>'+
      odInput("amount",old?.amount||"",'required inputmode="decimal" placeholder="Ex.: 1500,00"')+
      '</div><div class="field full"><label>Descrição</label>'+
      odInput("description",old?.description||"",'required maxlength="200" placeholder="Ex.: PIX, parcela, depósito..."')+
      '</div><div class="field full"><label>Observações (opcional)</label>'+
      '<textarea name="notes" maxlength="1500" rows="2">'+E(old?.notes||"")+'</textarea></div></div></form>'+
      '<p class="open-debt-hint">Sem saldo a quitar ou limite: os pagamentos apenas se acumulam.</p></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.openDebtSave()">'+icon("check")+' Salvar pagamento</button>'+
      '</div></div></div>';
  },
  async openDebtSave(){
    const form=document.getElementById("openDebtPaymentForm"),ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    const data=new FormData(form),old=ctx.entry;
    const body={date:data.get("date"),description:data.get("description"),
      amount:data.get("amount"),notes:data.get("notes")};
    try{
      await this.api(old?"/api/open-debt-payments/"+old.id:
          "/api/controls/"+ctx.controlId+"/open-debt/payments",old?"PUT":"POST",body);
      this.closeModal();await this.load();
      this.toast(old?"Pagamento atualizado. Total recalculado.":"Pagamento somado ao total.");
    }catch(e){this.toast(e.message,true)}
  },
  async openDebtDelete(id){
    if(!confirm("Excluir o pagamento? O total acumulado será recalculado."))return;
    try{
      await this.api("/api/open-debt-payments/"+id,"DELETE");
      await this.load();this.toast("Pagamento excluído. Total recalculado.");
    }catch(e){this.toast(e.message,true)}
  },
  openDebtExport(id){window.location.href="/api/controls/"+id+"/open-debt/export.csv"},
  openDebtSettings(id){
    if(!this.canOpenForm())return;
    const c=this.s.state?.controls?.find(c=>Number(c.id)===Number(id));
    if(!c)return this.toast("Controle não encontrado.",true);
    this.s.modal="open-debt-settings";this.s.modalContext={controlId:id};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal open-debt-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Ajustes do controle</h2>'+
      '<p>Altere o nome sem alterar os pagamentos.</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="openDebtSettingsForm" onsubmit="event.preventDefault();App.openDebtSaveSettings()">'+
      '<div class="field"><label>Nome do controle</label>'+
      odInput("name",c.name,'required maxlength="150"')+'</div></form></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.openDebtSaveSettings()">'+icon("check")+' Salvar ajustes</button>'+
      '</div></div></div>';
  },
  async openDebtSaveSettings(){
    const form=document.getElementById("openDebtSettingsForm"),ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    try{
      const f=new FormData(form);
      await this.api("/api/controls/"+ctx.controlId+"/open-debt/settings","PUT",{name:f.get("name")});
      this.closeModal();await this.load();this.toast("Nome atualizado.");
    }catch(e){this.toast(e.message,true)}
  }
});
