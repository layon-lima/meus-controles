"use strict";
/* Controle de Dívidas — modelo pronto, pagamentos descritos e saldo automático. */
const debtDate=()=>{
  const d=new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
};
const debtDateLabel=s=>s?String(s).slice(8,10)+"/"+String(s).slice(5,7)+"/"+String(s).slice(0,4):"—";
const debtField=(label,widget)=>'<div class="field"><label>'+E(label)+'</label>'+widget+'</div>';
const debtInput=(name,value,extra="")=>'<input name="'+name+'" value="'+E(value??"")+'" '+extra+'>';

Object.assign(App,{
  async renderDebt(){
    const c=this.s.detail?.control;
    if(!c||c.mode!=="divida")return;
    const id=c.id;
    const main=document.getElementById("main");
    main.innerHTML='<div class="empty-state">Carregando pagamentos...</div>';
    try{
      const data=await this.api("/api/controls/"+id+"/debt");
      if(this.s.route!=="control"||this.s.id!==id)return;
      this.s.debtData=data;
      this.s.debtControlId=id;
      this.renderDebtView();
    }catch(error){
      main.innerHTML='<div class="empty-state"><strong>Não foi possível carregar a dívida.</strong><p>'+E(error.message)+'</p></div>';
    }
  },
  renderDebtView(){
    const data=this.s.debtData,c=this.s.detail?.control;
    if(!data||!c)return;
    const t=data.totals;
    const empty='<div class="empty-state debt-empty"><strong>Nenhum pagamento registrado</strong>'+
       '<p>Registre o primeiro pagamento com data, descrição e valor.</p>'+
       '<button class="btn btn-primary" onclick="App.debtPaymentForm()">'+icon("plus")+' Registrar pagamento</button></div>';
    const rows=data.payments.map(p=>
      '<tr><td>'+E(debtDateLabel(p.payment_date))+'</td>'+
      '<td><strong>'+E(p.description)+'</strong>'+
      (p.notes?'<small class="debt-note">'+E(p.notes)+'</small>':"")+'</td>'+
      '<td class="numeric">−'+currency(p.amount)+'</td>'+
      '<td><div class="table-actions">'+
      '<button class="mini-action" onclick="App.debtPaymentForm('+p.id+')">'+icon("edit")+' Editar</button>'+
      '<button class="mini-action" onclick="App.debtDeletePayment('+p.id+')">'+icon("trash")+' Excluir</button>'+
      '</div></td></tr>').join("");
    const done=!!t.paid_off;
    const initial=Number(t.opening_amount||0);
    const paid=Number(t.paid||0);
    const progress=initial>0?Math.min(100,Math.max(0,paid/initial*100)):0;
    document.getElementById("main").innerHTML=
      '<div class="debt-heading"><div><div class="eyebrow">CONTROLE DE DÍVIDAS</div><h2>'+E(c.name)+'</h2>'+
      '<p>Registre cada pagamento com uma descrição. O saldo é atualizado automaticamente.</p></div>'+
      '<button class="btn" onclick="App.debtSettings('+c.id+')">'+icon("settings")+' Ajustes</button></div>'+
      '<div class="debt-summary">'+
      '<div class="debt-metric"><span>Dívida inicial</span><strong>'+currency(t.opening_amount)+'</strong></div>'+
      '<div class="debt-metric"><span>Total pago</span><strong>'+currency(t.paid)+'</strong></div>'+
      '<div class="debt-metric debt-outstanding"><span>Saldo restante</span><strong>'+currency(t.balance)+'</strong></div></div>'+
      '<div class="debt-progress-wrap"><div class="debt-progress" role="progressbar" aria-label="Percentual pago" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(progress)+'"><span style="width:'+progress.toFixed(2)+'%"></span></div>'+
      '<small>'+(done?"Dívida quitada":progress.toFixed(1).replace(".",",")+"% da dívida paga")+'</small></div>'+
      '<section class="panel debt-ledger"><div class="panel-header"><h3>Histórico de pagamentos</h3>'+
      '<div class="actions-end"><span class="secondary-text">'+t.count+' pagamento(s)</span>'+
      '<button class="btn btn-sm" onclick="App.debtExport('+c.id+')">'+icon("download")+' CSV</button>'+
      '<button class="btn btn-sm btn-primary" onclick="App.debtPaymentForm()" '+(done?"disabled":"")+'>'+
      icon("plus")+' Registrar pagamento</button></div></div>'+
      (data.payments.length?'<div class="table-wrap"><table><thead><tr><th>Data</th>'+
      '<th>Descrição</th><th style="text-align:right">Valor pago</th><th>Ações</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>':empty)+'</section>';
  },
  debtPaymentForm(id){
    if(!this.canOpenForm())return;
    const c=this.s.detail?.control,data=this.s.debtData;
    if(!c||!data)return;
    const old=id?data.payments.find(p=>p.id===id):null;
    if(id&&!old){this.toast("Pagamento não encontrado.",true);return}
    this.s.modal="debt-payment";
    this.s.modalContext={controlId:c.id,entry:old?deep(old):null};
    const existing=old?"Editar pagamento":"Registrar pagamento";
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal debt-payment-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">'+existing+'</h2>'+
      '<p>Informe a data, a descrição e o valor pago.</p></div>'+
      '<button class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="debtPaymentForm" onsubmit="event.preventDefault();App.debtSavePayment()">'+
      '<div class="form-grid">'+
      debtField("Data do pagamento",debtInput("date",old?.payment_date||debtDate(),'type="date" required'))+
      debtField("Valor pago (R$)",debtInput("amount",old?.amount||"",'inputmode="decimal" required placeholder="Ex.: 15000,00"'))+
      '<div class="field full"><label>Descrição do pagamento</label>'+
      debtInput("description",old?.description||"",'required maxlength="200" placeholder="Ex.: Parcela da Van – julho/2026"')+
      '<small class="debt-form-hint">Obrigatória, para identificar cada pagamento no histórico.</small></div>'+
      '<div class="field full"><label>Observações (opcional)</label>'+
      '<textarea rows="2" maxlength="1500" name="notes">'+E(old?.notes||"")+'</textarea></div></div></form>'+
      '<div class="debt-remaining-hint">Saldo atual: <strong>'+currency(data.totals.balance)+'</strong></div></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.debtSavePayment()">'+icon("plus")+' Salvar pagamento</button>'+
      '</div></div></div>';
  },
  async debtSavePayment(){
    const form=document.getElementById("debtPaymentForm");
    const ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    const f=new FormData(form);
    const payload={date:f.get("date"),description:f.get("description"),
                   amount:f.get("amount"),notes:f.get("notes")};
    try{
      const id=ctx.entry?.id;
      await this.api(id?"/api/debt-payments/"+id:"/api/controls/"+ctx.controlId+"/debt/payments",
                     id?"PUT":"POST",payload);
      this.closeModal();
      await this.load();
      this.toast(id?"Pagamento atualizado.":"Pagamento registrado.");
    }catch(e){this.toast(e.message,true)}
  },
  async debtDeletePayment(id){
    if(!confirm("Excluir este pagamento? O saldo restante será recalculado."))return;
    try{
      await this.api("/api/debt-payments/"+id,"DELETE");
      await this.load();
      this.toast("Pagamento excluído e saldo atualizado.");
    }catch(e){this.toast(e.message,true)}
  },
  debtExport(id){
    window.location.href="/api/controls/"+id+"/debt/export.csv";
  },
  async debtSettings(id){
    if(!this.canOpenForm())return;
    const control=this.s.state?.controls?.find(c=>c.id===id);
    if(!control){this.toast("Controle não encontrado.",true);return}
    try{
      const data=await this.api("/api/controls/"+id+"/debt");
      this.s.modal="debt-settings";
      this.s.modalContext={controlId:id,name:control.name,opening:data.settings.opening_amount};
      document.getElementById("modalRoot").innerHTML=
        '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
        '<div class="modal-header"><div><h2 id="modalTitle">Ajustes da dívida</h2>'+
        '<p>Altere o nome ou o valor inicial sem perder os pagamentos.</p></div>'+
        '<button class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
        '<div class="modal-body"><form id="debtSettingsForm" onsubmit="event.preventDefault();App.debtSaveSettings()">'+
        '<div class="form-grid">'+
        '<div class="field full"><label>Nome do controle</label>'+
        debtInput("name",control.name,'maxlength="150" required')+'</div>'+
        '<div class="field full"><label>Dívida inicial (R$)</label>'+
        debtInput("opening_amount",data.settings.opening_amount,'inputmode="decimal" required')+'</div>'+
        '</div></form><p class="hint">O valor inicial não pode ser menor que a soma dos pagamentos já registrados.</p></div>'+
        '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
        '<button class="btn btn-primary" onclick="App.debtSaveSettings()">Salvar ajustes</button></div>'+
        '</div></div>';
    }catch(e){this.toast(e.message,true)}
  },
  async debtSaveSettings(){
    const form=document.getElementById("debtSettingsForm"),ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    const f=new FormData(form);
    try{
      await this.api("/api/controls/"+ctx.controlId+"/debt/settings","PUT",{
        name:f.get("name"),opening_amount:f.get("opening_amount")
      });
      this.closeModal();
      await this.load();
      this.toast("Dívida atualizada.");
    }catch(e){this.toast(e.message,true)}
  }
});
