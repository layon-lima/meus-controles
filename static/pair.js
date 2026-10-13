"use strict";
/* Modelo A x B: lançamentos bilaterais e fechamento por período. */
const abToday=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const abDate=s=>s?String(s).slice(8,10)+"/"+String(s).slice(5,7)+"/"+String(s).slice(0,4):"—";
const abInput=(name,value,attrs="")=>'<input name="'+name+'" value="'+E(value??"")+'" '+attrs+'>';
const abField=(label,control)=>'<div class="field"><label>'+E(label)+'</label>'+control+'</div>';
const abResult=s=>s?.debtor?'<b>'+E(s.debtor)+'</b> deve a <b>'+E(s.creditor)+'</b>':'<b>Ninguém deve nada. Contas acertadas!</b>';

Object.assign(App,{
  async renderPair(){
    const c=this.s.detail?.control;
    if(!c||c.mode!=="acerto_ab")return;
    const id=c.id;
    document.getElementById("main").innerHTML='<div class="empty-state">Carregando o acerto...</div>';
    try{
      const data=await this.api("/api/controls/"+id+"/pair");
      if(this.s.route!=="control"||this.s.id!==id)return;
      if(this.s.pairId!==id){
        this.s.pairTab="entries";this.s.pairAll=false;
        this.s.pairPreview=null;this.s.pairClosure=null;this.s.pairDates=null;
      }
      this.s.pairId=id;this.s.pairData=data;
      this.renderPairView();
    }catch(e){document.getElementById("main").innerHTML='<div class="empty-state">'+E(e.message)+'</div>'}
  },
  renderPairView(){
    const data=this.s.pairData;if(!data)return;
    const a=data.settings.party_a,b=data.settings.party_b,t=data.totals,s=t.settlement;
    const tab=this.s.pairTab||"entries";
    const intro='<div class="ab-top"><div><div class="eyebrow">ACERTO ENTRE DUAS PESSOAS</div>'+
      '<h2>'+E(a)+' <span>×</span> '+E(b)+'</h2></div>'+
      '<button class="btn btn-sm" onclick="App.pairSettings('+data.control_id+')">'+icon("settings")+' Ajustes</button></div>'+
      '<section class="ab-balance"><div><small>SALDO LÍQUIDO ATUAL</small>'+
      '<p>'+abResult(s)+'</p><span>Dívidas nos dois sentidos e pagamentos reais reduzem ou aumentam o saldo conforme quem deve e quem paga.</span></div>'+
      '<strong>'+currency(s.amount)+'</strong></section>'+
      '<div class="ab-stats"><div><small>Dívidas: '+E(a)+' → '+E(b)+'</small>'+
      '<strong>'+currency(t.a_to_b)+'</strong></div><div><small>Dívidas: '+E(b)+' → '+E(a)+'</small>'+
      '<strong>'+currency(t.b_to_a)+'</strong></div>'+
      '<div><small>Pagamentos reais: '+E(a)+' → '+E(b)+'</small><strong>'+currency(t.payments_a_to_b||0)+'</strong></div>'+
      '<div><small>Pagamentos reais: '+E(b)+' → '+E(a)+'</small><strong>'+currency(t.payments_b_to_a||0)+'</strong></div>'+
      '<div><small>Saldo trazido do último fechamento</small><strong>'+currency(Math.abs(Number(t.opening_balance)))+'</strong></div></div>';
    const nav='<div class="ab-tabs" role="tablist">'+
      '<button class="ab-tab '+(tab==="entries"?"active":"")+'" role="tab" aria-selected="'+(tab==="entries")+
      '" onclick="App.pairSelectTab(&quot;entries&quot;)">Lançamentos</button>'+
      '<button class="ab-tab '+(tab==="closures"?"active":"")+'" role="tab" aria-selected="'+(tab==="closures")+
      '" onclick="App.pairSelectTab(&quot;closures&quot;)">Fechamentos</button></div>';
    document.getElementById("main").innerHTML='<div class="ab-view">'+intro+nav+
      (tab==="entries"?this.pairEntriesHTML():this.pairClosuresHTML())+'</div>';
  },
  pairSelectTab(tab){
    if(!["entries","closures"].includes(tab))return;
    this.s.pairTab=tab;this.renderPairView();
  },
  pairEntriesHTML(){
    const data=this.s.pairData,n=data.settings,all=!!this.s.pairAll;
    const entries=all?data.history:data.entries;
    const body=entries.map(e=>{
      const who=e.debtor==="A"?n.party_a:n.party_b;
      const to=e.debtor==="A"?n.party_b:n.party_a;
      const locked=!!(data.current_from&&e.entry_date<data.current_from);
      const paid=e.entry_kind==="payment";
      return '<tr><td>'+abDate(e.entry_date)+'</td>'+
        '<td><span class="ab-kind '+(paid?"ab-kind-payment":"ab-kind-debt")+'">'+
        (paid?"Pagamento real":"Dívida / compensação")+'</span><b>'+E(e.description)+'</b>'+
        (e.notes?'<small class="ab-note">'+E(e.notes)+'</small>':'')+'</td>'+
        '<td><small class="ab-direction">'+(paid?"Pagador → Recebedor":"Devedor → Credor")+'</small>'+
        E(who)+' <span class="ab-arrow">→</span> '+E(to)+'</td>'+
        '<td class="numeric">'+currency(e.amount)+'</td>'+
        '<td><div class="table-actions">'+(locked?'<span class="ab-frozen">'+icon("lock")+' Fechado</span>':
        '<button class="mini-action" onclick="App.pairEntryForm('+e.id+')">'+icon("edit")+' Editar</button>'+
        '<button class="mini-action" onclick="App.pairDeleteEntry('+e.id+')">'+icon("trash")+' Excluir</button>')+
        '</div></td></tr>';
    }).join("");
    return '<div class="ab-row-head"><div><h3>'+(all?"Histórico completo":"Lançamentos do período aberto")+'</h3>'+
      (data.current_from?'<small>Desde '+abDate(data.current_from)+'</small>':'')+'</div>'+
      '<div class="ab-row-actions"><button class="btn btn-sm" onclick="App.pairToggleHistory()">'+icon("list")+
      (all?" Período atual":" Ver histórico")+'</button>'+
      '<button class="btn btn-sm" onclick="App.pairEntryForm(null,&quot;payment&quot;)">'+icon("wallet")+' Registrar pagamento</button>'+
      '<button class="btn btn-primary btn-sm" onclick="App.pairEntryForm(null,&quot;debt&quot;)">'+icon("plus")+' Nova dívida</button></div></div>'+
      '<section class="panel ab-table">'+(entries.length?
      '<div class="table-wrap"><table><thead><tr><th>Data</th><th>Tipo e descrição</th><th>Quem deve / Quem pagou → Para quem</th>'+
      '<th class="numeric">Valor</th><th>Ações</th></tr></thead><tbody>'+body+'</tbody></table></div>':
      '<div class="empty-state"><strong>Sem lançamentos neste período.</strong>'+
      '<p>Cadastre dívidas ou pagamentos reais para calcular o saldo de cada pessoa.</p>'+
      '<button class="btn btn-primary" onclick="App.pairEntryForm()">'+icon("plus")+' Novo lançamento</button></div>')+
      '</section>';
  },
  pairToggleHistory(){this.s.pairAll=!this.s.pairAll;this.renderPairView()},
  pairEntryForm(id=null,initialKind="debt"){
    if(!this.canOpenForm())return;
    const data=this.s.pairData;if(!data)return;
    const old=id?data.history.find(e=>e.id===id):null;
    if(id&&!old)return this.toast("Lançamento não encontrado.",true);
    if(old&&data.current_from&&old.entry_date<data.current_from)return this.toast("Este lançamento já foi fechado.",true);
    const a=data.settings.party_a,b=data.settings.party_b;
    const kind=old?.entry_kind||initialKind;
    this.s.modal="pair-entry";this.s.modalContext={controlId:data.control_id,old:old?deep(old):null};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal ab-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">'+(old?"Editar lançamento":"Novo lançamento A × B")+'</h2>'+
      '<p>Escolha entre dívida/compensação ou pagamento real e informe a direção.</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="abEntryForm" onsubmit="event.preventDefault();App.pairSaveEntry()">'+
      '<div class="form-grid">'+
      '<div class="field full"><label for="abKind">Tipo de lançamento</label>'+
      '<select id="abKind" name="kind" onchange="App.pairKindChanged()" required>'+
      '<option value="debt" '+(kind==="debt"?"selected":"")+' >Dívida / compensação (alguém passa a dever)</option>'+
      '<option value="payment" '+(kind==="payment"?"selected":"")+' >Pagamento real (dinheiro entregue)</option>'+
      '</select></div>'+
      abField("Data",abInput("date",old?.entry_date||abToday(),'type="date" required'))+
      abField("Valor (R$)",abInput("amount",old?.amount||"",'required inputmode="decimal" placeholder="Ex.: 100,00"'))+
      '<div class="field full"><label id="abPartyLabel" for="abParty">'+(kind==="payment"?"Quem pagou para quem?":"Quem deve para quem?")+'</label>'+
      '<select name="debtor" id="abParty" required>'+
      '<option value="A" '+((old?.debtor||"A")==="A"?"selected":"")+'>'+
      E(a)+(kind==="payment"?" pagou a ":" deve a ")+E(b)+'</option>'+
      '<option value="B" '+(old?.debtor==="B"?"selected":"")+'>'+
      E(b)+(kind==="payment"?" pagou a ":" deve a ")+E(a)+'</option>'+
      '</select></div><div class="field full"><label>Descrição obrigatória</label>'+
      abInput("description",old?.description||"",'required maxlength="220" placeholder="Ex.: Frete, peças, pagamento..."')+
      '</div><div class="field full"><label>Observações (opcional)</label>'+
      '<textarea name="notes" rows="2" maxlength="1500">'+E(old?.notes||"")+'</textarea></div></div></form>'+
      '<p class="ab-hint" id="abKindHint">'+(kind==="payment"?
      "Pagamento real diminui o que o pagador deve ao recebedor. Não confundir com uma dívida no sentido inverso.":
      "Dívidas em sentidos opostos se compensam automaticamente. Nenhum lançamento antigo é apagado.")+'</p></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.pairSaveEntry()">'+icon("check")+' Salvar lançamento</button></div></div></div>';
  },
  pairKindChanged(){
    const kind=document.getElementById("abKind")?.value;
    const party=document.getElementById("abParty");
    const names=this.s.pairData?.settings;
    if(!party||!names)return;
    document.getElementById("abPartyLabel").textContent=kind==="payment"?"Quem pagou para quem?":"Quem deve para quem?";
    const sides=[[names.party_a,names.party_b],[names.party_b,names.party_a]];
    [...party.options].forEach((opt,i)=>{
      opt.textContent=sides[i][0]+(kind==="payment"?" pagou a ":" deve a ")+sides[i][1];
    });
    const hint=document.getElementById("abKindHint");
    if(hint)hint.textContent=kind==="payment"?
      "Pagamento real diminui o que o pagador deve ao recebedor. Não confundir com dívida no sentido inverso.":
      "Dívidas em sentidos opostos se compensam automaticamente. Nenhum lançamento antigo é apagado.";
  },
  async pairSaveEntry(){
    const form=document.getElementById("abEntryForm"),ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    const f=new FormData(form),kind=f.get("kind");
    const p={date:f.get("date"),kind,amount:f.get("amount"),
      description:f.get("description"),notes:f.get("notes")};
    p[kind==="payment"?"payer":"debtor"]=f.get("debtor");
    try{
      await this.api(ctx.old?"/api/pair-entries/"+ctx.old.id:
        "/api/controls/"+ctx.controlId+"/pair/entries",ctx.old?"PUT":"POST",p);
      this.closeModal();await this.renderPair();await this.load();
      this.toast(kind==="payment"?"Pagamento real registrado. Saldo atualizado.":"Dívida registrada. Saldo atualizado.");
    }catch(e){this.toast(e.message,true)}
  },
  async pairDeleteEntry(id){
    if(!confirm("Excluir este lançamento e recalcular o saldo?"))return;
    try{
      await this.api("/api/pair-entries/"+id,"DELETE");
      await this.renderPair();await this.load();this.toast("Lançamento excluído.");
    }catch(e){this.toast(e.message,true)}
  },
  pairClosuresHTML(){
    const d=this.s.pairData;
    const last=d.closures[0],prev=this.s.pairPreview;
    const start=this.s.pairDates?.start||d.current_from||
      (d.history.length?d.history[d.history.length-1].entry_date:abToday());
    const end=this.s.pairDates?.end||abToday();
    const result=prev?'<div class="ab-preview">'+
      '<div class="ab-preview-line"><small>RESULTADO DO FECHAMENTO</small><strong>'+currency(prev.settlement.amount)+'</strong></div>'+
      '<p>'+abResult(prev.settlement)+'</p>'+
      '<div class="ab-bits"><span>Saldo inicial: '+currency(Math.abs(Number(prev.opening_balance)))+'</span>'+
      '<span>Movimento líquido: '+currency(Math.abs(Number(prev.movement_balance)))+'</span>'+
      '<span>'+prev.count+' lançamento(s)</span>'+
      '<span>'+((prev.movement_totals?.payment_count)||0)+' pagamento(s) real(is)</span></div>'+
      '<p class="ab-hint">O saldo restante será transferido para o próximo período. Lançamentos fechados não podem ser editados.</p>'+
      '<button class="btn btn-primary" onclick="App.pairConfirmClose()">'+icon("check")+' Confirmar fechamento</button>'+
      '</div>':"";
    const saved=d.closures.map(x=>'<div class="ab-archive-line"><div><strong>'+
      abDate(x.start_date)+' a '+abDate(x.end_date)+'</strong><small>'+
      x.entry_count+' lançamento(s) · Saldo final '+currency(Math.abs(Number(x.closing_balance)))+'</small></div>'+
      '<div class="ab-row-actions"><button class="btn btn-sm" onclick="App.pairViewClosure('+x.id+')">'+icon("list")+
      ' Consultar</button><button class="btn btn-sm" onclick="App.pairExportClose('+x.id+')">'+icon("download")+
      ' CSV</button></div></div>').join("");
    const archive=this.s.pairClosure;
    const details=archive?'<section class="panel ab-section"><div class="panel-header"><h3>Arquivo fechado: '+
      abDate(archive.start_date)+' a '+abDate(archive.end_date)+'</h3>'+
      '<button class="btn btn-sm" onclick="App.pairHideClosure()">'+icon("x")+' Fechar</button></div>'+
      '<div class="ab-section-body"><p>'+abResult(archive.settlement)+' · '+currency(archive.settlement.amount)+'</p>'+
      archive.entries.map(e=>{
        const a=archive.settings.party_a,b=archive.settings.party_b;
        const paid=e.entry_kind==="payment";
        return '<div class="ab-archive-line"><div><b>'+E(e.description)+'</b><small>'+
        (paid?"Pagamento real · ":"Dívida / compensação · ")+abDate(e.entry_date)+' · '+
        E(e.debtor==="A"?a:b)+' → '+E(e.debtor==="A"?b:a)+'</small></div><strong>'+currency(e.amount)+'</strong></div>';
      }).join("")+'</div></section>':"";
    return '<div class="ab-close-section"><h3>Fechamento por período</h3>'+
      '<section class="panel ab-section"><div class="ab-section-body"><div class="ab-date-row">'+
      '<label>De <input type="date" id="abCloseStart" value="'+E(start)+'" onchange="App.pairRangeChanged()" required></label>'+
      '<label>Até <input type="date" id="abCloseEnd" value="'+E(end)+'" onchange="App.pairRangeChanged()" required></label>'+
      '<button class="btn btn-primary" onclick="App.pairPreviewClose()">'+icon("search")+' Verificar acerto</button></div>'+
      (last?'<p class="ab-hint">Último fechamento em '+abDate(last.end_date)+
       '. Próximo período começa em '+abDate(d.current_from)+'.</p>':'')+
      result+'</div></section>'+
      '<section class="panel ab-section"><div class="panel-header"><h3>Fechamentos anteriores</h3></div>'+
      '<div class="ab-section-body">'+(saved||'<p class="secondary-text">Nenhum fechamento ainda.</p>')+'</div></section>'+
      details+'</div>';
  },
  pairRangeChanged(){
    this.s.pairDates={start:document.getElementById("abCloseStart")?.value,
      end:document.getElementById("abCloseEnd")?.value};
    this.s.pairPreview=null;
    document.querySelector(".ab-preview")?.remove();
  },
  async pairPreviewClose(){
    const start=document.getElementById("abCloseStart")?.value;
    const end=document.getElementById("abCloseEnd")?.value;
    if(!start||!end)return this.toast("Escolha as duas datas.",true);
    this.s.pairDates={start,end};this.s.pairPreview=null;
    try{
      this.s.pairPreview=await this.api("/api/controls/"+this.s.id+"/pair/preview","POST",{start,end});
      this.renderPairView();
    }catch(e){this.toast(e.message,true)}
  },
  async pairConfirmClose(){
    const p=this.s.pairPreview;
    if(!p?.fingerprint)return;
    if(!confirm("Fechar definitivamente o período de "+abDate(p.start_date)+" a "+abDate(p.end_date)+
      "? O histórico ficará protegido e o saldo restante seguirá para o próximo período."))return;
    try{
      await this.api("/api/controls/"+this.s.id+"/pair/closures","POST",{
        start:p.start_date,end:p.end_date,fingerprint:p.fingerprint
      });
      this.s.pairPreview=null;this.s.pairDates=null;this.s.pairTab="entries";this.s.pairAll=false;
      await this.renderPair();await this.load();this.toast("Fechamento realizado. Saldo transferido.");
    }catch(e){this.toast(e.message,true)}
  },
  async pairViewClosure(id){
    try{
      this.s.pairClosure=await this.api("/api/pair-closures/"+id);
      this.renderPairView();
    }catch(e){this.toast(e.message,true)}
  },
  pairHideClosure(){this.s.pairClosure=null;this.renderPairView()},
  pairExportClose(id){window.location.href="/api/pair-closures/"+id+"/export.csv"},
  pairSettings(id){
    if(!this.canOpenForm())return;
    const c=this.s.state?.controls?.find(x=>x.id===id),d=this.s.pairData;
    if(!c||!d)return this.toast("Controle não encontrado.",true);
    this.s.modal="pair-settings";this.s.modalContext={controlId:id};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal ab-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Ajustes A × B</h2>'+
      '<p>Alterar nomes não altera os valores das dívidas nem dos pagamentos reais.</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="abSettingsForm" onsubmit="event.preventDefault();App.pairSaveSettings()">'+
      '<div class="form-grid"><div class="field full"><label>Nome do controle</label>'+
      abInput("name",c.name,'required maxlength="150"')+'</div>'+
      abField("Pessoa A",abInput("party_a",d.settings.party_a,'required maxlength="160"'))+
      abField("Pessoa B",abInput("party_b",d.settings.party_b,'required maxlength="160"'))+
      '</div></form><p class="ab-hint">A e B mantêm suas posições originais. Fechamentos anteriores preservam os nomes históricos.</p></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.pairSaveSettings()">'+icon("check")+' Salvar ajustes</button></div></div></div>';
  },
  async pairSaveSettings(){
    const f=document.getElementById("abSettingsForm"),ctx=this.s.modalContext;
    if(!f||!ctx||!f.reportValidity())return;
    const values=new FormData(f);
    try{
      await this.api("/api/controls/"+ctx.controlId+"/pair/settings","PUT",{
        name:values.get("name"),party_a:values.get("party_a"),party_b:values.get("party_b")
      });
      this.closeModal();await this.renderPair();await this.load();this.toast("Ajustes salvos.");
    }catch(e){this.toast(e.message,true)}
  }
});
