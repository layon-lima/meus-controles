"use strict";
/* Controle de Caminhão: modelo pronto, sem editor de fórmulas. */
const TRUCK_EXPENSES = ["Manutenção","Abastecimento","Seguro do caminhão","Pedágio","Salário motorista","Outros gastos"];
const TRUCK_FREIGHTS = ["Frete Normal","Frete Morto"];
const TRUCK_ADVANCES = ["Vale motorista","Acerto motorista"];
const truckMoney = n => currency(n);
const truckNum = value => {
  let s=String(value??"0").trim().replace(/\s/g,"");
  if(s.includes(",")) s=s.replace(/\./g,"").replace(",",".");
  const n=Number(s);
  return Number.isFinite(n)?n:0;
};
const truckDate=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const truckOptions=(arr,selected)=>arr.map(n=>'<option value="'+E(n)+'"'+(n===selected?' selected':'')+'>'+E(n)+'</option>').join("");
const truckField=(label,html)=>'<div class="field"><label>'+E(label)+'</label>'+html+'</div>';
const truckInput=(name,value,more="")=>'<input name="'+name+'" value="'+E(value??"")+'" '+more+'>';
const truckStat=(caption,value,explanation)=>'<div class="stat truck-stat"><div class="stat-kicker">'+E(caption)+'</div><div class="stat-value">'+truckMoney(value)+'</div><div class="stat-foot">'+E(explanation)+'</div></div>';

Object.assign(App,{
  async renderTruck(){
    const c=this.s.detail?.control;
    if(!c||c.mode!=="caminhao")return;
    const cid=c.id;
    if(this.s.truckControlId!==cid){this.s.truckTab="entries";this.s.truckMonth="";}
    const main=document.getElementById("main");
    main.innerHTML='<div class="empty-state">Carregando lançamentos do caminhão...</div>';
    try{
      const report=await this.api("/api/controls/"+cid+"/truck"+(this.s.truckMonth?"?month="+encodeURIComponent(this.s.truckMonth):""));
      if(this.s.route!=="control"||this.s.id!==cid)return;
      this.s.truckReport=report;this.s.truckControlId=cid;
      this.renderTruckView();
    }catch(err){main.innerHTML='<div class="empty-state"><strong>Não foi possível carregar este controle.</strong><p>'+E(err.message)+'</p></div>';}
  },
  renderTruckView(){
    const r=this.s.truckReport,control=this.s.detail?.control;
    if(!r||!control)return;
    const t=r.totals;
    const active=this.s.truckTab==="details"?"details":"entries";
    const months=[["","Todos os períodos"],...(r.available_months||[]).map(m=>[m,m.slice(5,7)+"/"+m.slice(0,4)])];
    const monthOptions=months.map(([value,label])=>'<option value="'+E(value)+'" '+(value===(this.s.truckMonth||"")?"selected":"")+'>'+E(label)+'</option>').join("");
    const monthFilter='<label class="truck-month-filter" for="truckMonthSelect">Período'+
       '<select id="truckMonthSelect" onchange="App.truckSetMonth(this.value)">'+monthOptions+'</select></label>';
    const overview=(list,emptyText)=>list.length?list.map(x=>'<div class="info-row"><span>'+E(x.name)+'</span><strong>'+truckMoney(x.total)+'</strong></div>').join(""):
       '<p class="secondary-text">'+E(emptyText)+'</p>';
    const tab=(name,title)=>'<button type="button" role="tab" id="truck-tab-'+name+'" aria-controls="truck-panel-'+name+'" aria-selected="'+(active===name?"true":"false")+'" class="truck-tab '+(active===name?"active":"")+'" onclick="App.truckSetTab(\''+name+'\')">'+title+'</button>';
    const nav='<div class="truck-nav"><div class="truck-tablist" role="tablist" aria-label="Visualização do controle">'+
       tab("entries","Lançamentos")+tab("details","Resumo detalhado")+'</div>'+
       '<button type="button" class="btn btn-sm truck-adjust" onclick="App.truckSettings('+control.id+')">'+icon("settings")+' Ajustes</button></div>';
    const rows=r.entries.map(x=>{
      const isFreight=x.kind==="freight";
      const stamp=x.event_date.slice(8,10)+"/"+x.event_date.slice(5,7)+"/"+x.event_date.slice(0,4);
      const sign=isFreight?"+":"−";
      const subtitle=isFreight?'<span class="secondary-text">'+number(x.weight_kg)+' kg × '+truckMoney(x.price_tonne)+'/t · comissão '+truckMoney(x.commission_amount)+'</span>':"";
      return '<tr><td>'+E(stamp)+'</td><td><b>'+E(x.description)+'</b>'+subtitle+'</td><td><span class="chip">'+E(x.category)+'</span></td>'+
        '<td class="numeric '+(isFreight?"positive":"negative")+'">'+sign+truckMoney(x.amount)+'</td>'+
        '<td><div class="table-actions"><button class="mini-action" onclick="App.truckForm(null,'+x.id+')">'+icon("edit")+' Editar</button>'+
        '<button class="mini-action" onclick="App.truckDelete('+x.id+')">'+icon("trash")+' Excluir</button></div></td></tr>';
    }).join("");
    const ledger='<section class="panel truck-ledger"><div class="panel-header"><h3>Todos os lançamentos</h3>'+
      '<div class="actions-end"><span class="secondary-text">'+t.count+' registros</span>'+
      '<button class="btn btn-sm" onclick="App.truckExport('+control.id+')">'+icon("download")+' Exportar CSV</button></div></div>'+
      (r.entries.length?'<div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th>'+
      '<th style="text-align:right">Valor</th><th>Ações</th></tr></thead><tbody>'+rows+'</tbody></table></div>':
      '<div class="empty-state truck-empty"><strong>Nenhum lançamento neste período</strong>'+
      '<p>Registre um frete, uma despesa ou um vale para começar.</p>'+
      '<button class="btn btn-primary" onclick="App.truckForm(\'freight\')">'+icon("plus")+' Registrar frete</button></div>')+'</section>';
    const quick='<div class="truck-quick-actions" aria-label="Novo lançamento">'+
      '<button class="truck-quick freight" onclick="App.truckForm(\'freight\')">'+icon("truck")+' Registrar frete</button>'+
      '<button class="truck-quick" onclick="App.truckForm(\'expense\')">'+icon("circle-minus")+' Registrar despesa</button>'+
      '<button class="truck-quick" onclick="App.truckForm(\'advance\')">'+icon("wallet")+' Vale / acerto motorista</button></div>';
    let body;
    if(active==="entries"){
      body='<div id="truck-panel-entries" class="truck-view truck-entries-view" role="tabpanel" aria-labelledby="truck-tab-entries">'+
        '<div class="truck-fast-summary" aria-label="Resumo rápido do período">'+
        '<div class="truck-fast-total"><span>Entradas do período</span><strong>'+truckMoney(t.freight)+'</strong></div>'+
        '<div class="truck-fast-total"><span>Saídas do período</span><strong>'+truckMoney(t.cash_out)+'</strong></div></div>'+
        '<div class="truck-action-filter-row">'+quick+monthFilter+'</div>'+
        ledger+'</div>';
    }else{
      body='<div id="truck-panel-details" class="truck-view truck-details-view" role="tabpanel" aria-labelledby="truck-tab-details">'+
        '<div class="truck-details-filter">'+monthFilter+
        '<span class="secondary-text">Comissão padrão '+E(r.settings.commission_pct)+'%'+(r.settings.driver_name?' · '+E(r.settings.driver_name):"")+'</span></div>'+
        '<div class="truck-kpis">'+truckStat("Fretes acumulados",t.freight,"Receitas dos fretes")+
        truckStat("Saídas do caixa",t.cash_out,"Despesas + vales pagos")+
        truckStat("Saldo do caixa",t.cash_balance,(this.s.truckMonth?"No período":"Inclui saldo inicial configurado"))+
        truckStat("Resultado do caminhão",t.operating_result,"Fretes − despesas − comissão gerada")+
        truckStat("Comissão a pagar",t.driver_due,"Saldo histórico do motorista")+'</div>'+
        '<div class="truck-columns"><section class="panel"><div class="panel-header"><h3>Receitas por tipo de frete</h3></div>'+
        '<div class="panel-body">'+overview(r.by_freight,"Nenhum frete neste período.")+'</div></section>'+
        '<section class="panel"><div class="panel-header"><h3>Saídas por categoria</h3></div><div class="panel-body">'+overview(r.by_expense,"Nenhuma saída neste período.")+
        '<div class="truck-note">Comissão gerada no período: <b>'+truckMoney(t.commission_earned)+'</b>. Vales são saídas de caixa e não descontam essa despesa outra vez.</div></div></section>'+
        '<section class="panel"><div class="panel-header"><h3>Conta do motorista</h3></div><div class="panel-body">'+
        '<div class="info-row"><span>Saldo anterior</span><strong>'+truckMoney(t.outstanding_opening)+'</strong></div>'+
        '<div class="info-row"><span>Comissões geradas</span><strong>'+truckMoney(t.driver_earned_all)+'</strong></div>'+
        '<div class="info-row"><span>Vales e acertos pagos</span><strong>−'+truckMoney(t.driver_paid_all)+'</strong></div>'+
        '<div class="info-row truck-due"><span>Comissão em aberto</span><strong>'+truckMoney(t.driver_due)+'</strong></div>'+
        '</div></section></div></div>';
    }
    document.getElementById("main").innerHTML=nav+body;
  },
  truckSetTab(tab){
    if(!["entries","details"].includes(tab)||this.s.truckTab===tab)return;
    this.s.truckTab=tab;
    this.renderTruckView();
  },
  async truckSetMonth(month){this.s.truckMonth=month;await this.renderTruck()},
  truckExport(id){window.location.href="/api/controls/"+id+"/truck/export.csv"},
  truckForm(kind,id){
    if(!this.canOpenForm())return;
    const record=id?this.s.truckReport?.entries.find(x=>x.id===id):null;
    if(id&&!record){this.toast("Lançamento não encontrado.",true);return}
    this.s.modal="truck-record";
    this.s.modalContext={
      controlId:this.s.detail.control.id,
      entry:record?deep(record):null,
      settings:deep(this.s.truckReport.settings),
      kind:record?.kind||kind||"freight"
    };
    this.renderTruckForm();
  },
  renderTruckForm(){
    const ctx=this.s.modalContext,r=ctx.entry||{},kind=ctx.kind;
    const fields=kind==="freight"?
      truckField("Tipo de frete",'<select name="category">'+truckOptions(TRUCK_FREIGHTS,r.category||"Frete Normal")+'</select>')+
      truckField("Peso carregado (kg)",truckInput("weight_kg",r.weight_kg||"",'required inputmode="decimal" oninput="App.truckPreview()"'))+
      truckField("Preço por tonelada (R$)",truckInput("price_tonne",r.price_tonne||"",'required inputmode="decimal" oninput="App.truckPreview()"')):
      kind==="expense"?
      truckField("Categoria da despesa",'<input name="category" list="truckExpenseList" maxlength="90" required value="'+E(r.category||"Manutenção")+'"><datalist id="truckExpenseList">'+TRUCK_EXPENSES.map(c=>'<option value="'+E(c)+'">').join("")+'</datalist>')+
      truckField("Valor pago (R$)",truckInput("amount",r.amount||"",'required inputmode="decimal" oninput="App.truckPreview()"')):
      truckField("Tipo de pagamento",'<select name="category">'+truckOptions(TRUCK_ADVANCES,r.category||"Vale motorista")+'</select>')+
      truckField("Valor pago ao motorista (R$)",truckInput("amount",r.amount||"",'required inputmode="decimal" oninput="App.truckPreview()"'));
    const heading={"freight":"Registrar frete","expense":"Registrar despesa","advance":"Vale / acerto do motorista"}[kind];
    document.getElementById("modalRoot").innerHTML=
     '<div class="modal-backdrop"><div class="modal truck-entry-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
     '<div class="modal-header"><div><h2 id="modalTitle">'+E(ctx.entry?"Editar lançamento":heading)+'</h2>'+
     '<p>As movimentações são calculadas automaticamente.</p></div>'+
     '<button class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
     '<div class="modal-body">'+
     '<div class="truck-tabs">'+[["freight","Frete"],["expense","Despesa"],["advance","Vale motorista"]].map(([v,label])=>
       '<button class="'+(kind===v?"active":"")+'" type="button" onclick="App.truckChangeKind(\''+v+'\')">'+label+'</button>').join("")+'</div>'+
     '<form id="truckForm" onsubmit="event.preventDefault();App.truckSave()">'+
     '<div class="form-grid">'+truckField("Data",truckInput("date",r.event_date||truckDate(),'type="date" required'))+
     truckField("Descrição",truckInput("description",r.description||"",'maxlength="200" required placeholder="Ex.: Calcário para Jonas"'))+
     fields+
     '<div class="field full"><label>Observações (opcional)</label><textarea name="notes" maxlength="1500" rows="2">'+E(r.notes||"")+'</textarea></div>'+
     '</div></form>'+
     '<div id="truckPreview" class="calc-preview"></div>'+
     '</div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
     '<button class="btn btn-primary" onclick="App.truckSave()">'+icon("plus")+' Salvar lançamento</button></div></div></div>';
    this.truckPreview();
  },
  truckChangeKind(kind){
    if(!["freight","expense","advance"].includes(kind))return;
    const ctx=this.s.modalContext;
    if(!ctx||ctx.kind===kind)return;
    const form=document.getElementById("truckForm");
    if(form){
      const data=new FormData(form);
      const common={event_date:data.get("date"),description:data.get("description"),notes:data.get("notes")};
      ctx.entry={...(ctx.entry?.id?{id:ctx.entry.id}:{}),...common};
    }
    ctx.kind=kind;
    this.renderTruckForm();
  },
  truckPreview(){
    const ctx=this.s.modalContext;
    const form=document.getElementById("truckForm");
    const preview=document.getElementById("truckPreview");
    if(!ctx||!form||!preview)return;
    const f=new FormData(form);
    const kind=ctx.kind;
    let title, lines;
    if(kind==="freight"){
      const kg=truckNum(f.get("weight_kg")),pt=truckNum(f.get("price_tonne"));
      const total=Math.round(kg/1000*pt*100)/100;
      const commission=Math.round(total*truckNum(ctx.settings.commission_pct)/100*100)/100;
      title="Cálculo do frete";
      lines=[["Total do frete",total],["Comissão do motorista ("+ctx.settings.commission_pct+"%)",commission],
             ["Resultado antes de outras despesas",total-commission]];
    }else{
      const amount=truckNum(f.get("amount"));
      title=kind==="advance"?"Pagamento do motorista":"Despesa do caminhão";
      lines=[["Saída do caixa",amount]];
    }
    preview.innerHTML='<strong>'+E(title)+'</strong>'+
      lines.map(([label,value])=>'<div class="calc-line"><span>'+E(label)+'</span><b>'+truckMoney(value)+'</b></div>').join("")+
      (kind==="advance"?'<div class="truck-note">Este valor diminui o caixa e a comissão a pagar ao motorista. Não vira outra despesa do resultado.</div>':
       kind==="expense"?'<div class="truck-note">A despesa diminui o caixa e o resultado do caminhão.</div>':'');
  },
  async truckSave(){
    const ctx=this.s.modalContext,form=document.getElementById("truckForm");
    if(!ctx||!form||!form.reportValidity())return;
    const f=new FormData(form);
    const payload={date:f.get("date"),description:f.get("description"),kind:ctx.kind,category:f.get("category"),
                   notes:f.get("notes"),amount:f.get("amount"),weight_kg:f.get("weight_kg"),
                   price_tonne:f.get("price_tonne")};
    try{
      const entryId=ctx.entry?.id;
      await this.api(entryId?"/api/truck-entries/"+entryId:"/api/controls/"+ctx.controlId+"/truck/entries",
                      entryId?"PUT":"POST",payload);
      this.closeModal();
      await this.load();
      this.toast(entryId?"Lançamento atualizado.":"Lançamento registrado.");
    }catch(e){this.toast(e.message,true)}
  },
  async truckDelete(id){
    if(!confirm("Excluir este lançamento? Os saldos serão recalculados automaticamente."))return;
    try{
      await this.api("/api/truck-entries/"+id,"DELETE");
      await this.load();
      this.toast("Lançamento excluído.");
    }catch(e){this.toast(e.message,true)}
  },
  async truckSettings(cid){
    if(!this.canOpenForm())return;
    try{
      const source=this.s.state?.controls?.find(c=>c.id===cid);
      if(!source)throw Error("Controle não encontrado.");
      const res=await this.api("/api/controls/"+cid+"/truck");
      this.s.modalContext={controlId:cid,config:res.settings,source:deep(source)};
      this.s.modal="truck-settings";
      this.renderTruckSettings();
    }catch(e){this.toast(e.message,true)}
  },
  renderTruckSettings(){
    const ctx=this.s.modalContext,conf=ctx.config;
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Configurar caminhão</h2>'+
      '<p>Apenas os dados básicos. Os cálculos já estão prontos.</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="truckSettingsForm" onsubmit="event.preventDefault();App.truckSaveSettings()">'+
      '<div class="form-grid">'+truckField("Nome do controle",truckInput("name",ctx.source.name,'required maxlength="150"'))+
      truckField("Nome do motorista (opcional)",truckInput("driver_name",conf.driver_name,'maxlength="100"'))+
      truckField("Comissão padrão (%)",truckInput("commission_pct",conf.commission_pct,'required inputmode="decimal"'))+
      truckField("Comissão anterior a pagar (R$)",truckInput("opening_commission",conf.opening_commission,'required inputmode="decimal"'))+
      truckField("Saldo inicial do caixa (R$)",truckInput("opening_cash",conf.opening_cash,'required inputmode="decimal"'))+
      '</div></form><div class="hint" style="margin-top:18px">Alterar a porcentagem vale para novos fretes e lançamentos editados. Fretes antigos mantêm a comissão original.</div></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.truckSaveSettings()">Salvar ajustes</button></div></div></div>';
  },
  async truckSaveSettings(){
    const ctx=this.s.modalContext;
    const form=document.getElementById("truckSettingsForm");
    if(!ctx||!form||!form.reportValidity())return;
    const f=new FormData(form);
    const payload={name:f.get("name"),commission_pct:f.get("commission_pct"),
      opening_cash:f.get("opening_cash"),opening_commission:f.get("opening_commission"),
      driver_name:f.get("driver_name")};
    try{
      await this.api("/api/controls/"+ctx.controlId+"/truck/settings","PUT",payload);
      this.closeModal();
      await this.load();
      this.toast("Configurações salvas.");
    }catch(e){this.toast(e.message,true)}
  }
});
