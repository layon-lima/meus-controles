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

// A digitação é totalmente livre; interpretar/formatar apenas ao sair ou salvar.
// Formatos aceitos: 221026, 22102026, 22/10/26, 22/10/2026, 2026-10-22.
const truckParseDate=value=>{
  const raw=String(value??"").trim();
  let day,month,year;
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
    [year,month,day]=raw.split("-").map(Number);
  }else{
    const digits=raw.replace(/[\/.\-\s]/g,"");
    // Com barras aceitamos dia e mês com um dígito, sem impor tamanho fixo.
    // Sem separadores só há duas formas inequívocas: DDMMAA ou DDMMAAAA.
    const compact=/^\d{6}(?:\d{2})?$/;
    const separated=/^\d{1,2}[\/.\-\s]\d{1,2}[\/.\-\s]\d{2}(?:\d{2})?$/;
    if(!compact.test(raw)&&!separated.test(raw))return null;
    if(separated.test(raw)){
      const parts=raw.split(/[\/.\-\s]/);
      day=Number(parts[0]);month=Number(parts[1]);year=Number(parts[2]);
      if(parts[2].length===2)year+=2000;
    }else{
      day=Number(digits.slice(0,2));month=Number(digits.slice(2,4));
      year=Number(digits.slice(4));
      if(digits.length===6)year+=2000;
    }
  }
  if(!Number.isInteger(year)||year<1||year>9999||
     !Number.isInteger(month)||month<1||month>12||
     !Number.isInteger(day)||day<1)return null;
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const length=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
  if(day>length)return null;
  const pad=n=>String(n).padStart(2,"0");
  const yyyy=String(year).padStart(4,"0");
  return {iso:yyyy+"-"+pad(month)+"-"+pad(day),display:pad(day)+"/"+pad(month)+"/"+yyyy};
};
const truckDateDisplay=value=>truckParseDate(value)?.display??String(value??"");
const truckFreeDateInput=value=>
  '<div class="truck-free-date">'+
  '<input type="text" id="truckDateText" name="date" required inputmode="numeric" autocomplete="off" maxlength="18" '+
  'placeholder="dd/mm/aaaa" aria-label="Data em dia, mês e ano; digitação livre" '+
  'value="'+E(truckDateDisplay(value))+'" oninput="this.setCustomValidity(&quot;&quot;)" '+
  'onblur="App.truckDateBlur(this)">'+
  '<button type="button" class="truck-date-picker-button" aria-label="Escolher data no calendário" onclick="App.truckOpenDatePicker()">'+icon("calendar-days")+'</button>'+
  '<input type="date" class="truck-date-native" id="truckDatePicker" tabindex="-1" aria-label="Calendário" '+
  'value="'+E(truckParseDate(value)?.iso||truckDate())+'" onchange="App.truckDatePicked(this)">'+
  '</div>';

const truckOptions=(arr,selected)=>arr.map(n=>'<option value="'+E(n)+'"'+(n===selected?' selected':'')+'>'+E(n)+'</option>').join("");
const truckField=(label,html)=>'<div class="field"><label>'+E(label)+'</label>'+html+'</div>';
const truckInput=(name,value,more="")=>'<input name="'+name+'" value="'+E(value??"")+'" '+more+'>';

Object.assign(App,{
  async renderTruck(){
    const c=this.s.detail?.control;
    if(!c||c.mode!=="caminhao")return;
    const cid=c.id;
    if(this.s.truckControlId!==cid){
      this.s.truckTab="entries";this.s.truckMonth="";
      this.s.truckReviewPreview=null;this.s.truckClosePreview=null;
      this.s.truckReviewRange=null;this.s.truckCloseRange=null;
      this.s.truckClosureDetail=null;
    }
    const main=document.getElementById("main");
    main.innerHTML='<div class="empty-state">Carregando lançamentos do caminhão...</div>';
    try{
      const filter=this.s.truckMonth==="@todos"?"?scope=all":
      this.s.truckMonth?"?month="+encodeURIComponent(this.s.truckMonth):"";
    const report=await this.api("/api/controls/"+cid+"/truck"+filter);
      if(this.s.route!=="control"||this.s.id!==cid)return;
      this.s.truckReport=report;this.s.truckControlId=cid;
      this.renderTruckView();
    }catch(err){main.innerHTML='<div class="empty-state"><strong>Não foi possível carregar este controle.</strong><p>'+E(err.message)+'</p></div>';}
  },
  renderTruckView(){
    const r=this.s.truckReport,control=this.s.detail?.control;
    if(!r||!control)return;
    const t=r.totals;
    const enabled=r.workflow?.enabled===true;
    const active=enabled&&["checks","closures"].includes(this.s.truckTab)?this.s.truckTab:
      this.s.truckTab==="details"?"details":"entries";
    const months=(enabled?[["","Capítulo atual"],["@todos","Todo o histórico"]]:
      [["","Todos os períodos"]]).concat((r.available_months||[]).map(m=>[m,m.slice(5,7)+"/"+m.slice(0,4)]));
    const monthOptions=months.map(([value,label])=>'<option value="'+E(value)+'" '+(value===(this.s.truckMonth||"")?"selected":"")+'>'+E(label)+'</option>').join("");
    const monthFilter='<label class="truck-month-filter" for="truckMonthSelect">Período'+
       '<select id="truckMonthSelect" onchange="App.truckSetMonth(this.value)">'+monthOptions+'</select></label>';
    const overview=(list,emptyText)=>list.length?list.map(x=>
       '<div class="info-row truck-category-row-summary"><span class="truck-category-title">'+
       E(x.name)+(enabled?'<small class="truck-category-count">'+Number(x.count||0)+' '+(Number(x.count||0)===1?'lançamento':'lançamentos')+'</small>':'')+
       '</span><strong>'+truckMoney(x.total)+'</strong></div>').join(""):
       '<p class="secondary-text">'+E(emptyText)+'</p>';
    const tab=(name,title)=>'<button type="button" role="tab" id="truck-tab-'+name+'" aria-controls="truck-panel-'+name+'" aria-selected="'+(active===name?"true":"false")+'" class="truck-tab '+(active===name?"active":"")+'" onclick="App.truckSetTab(\''+name+'\')">'+title+'</button>';
    const nav='<div class="truck-nav"><div class="truck-tablist" role="tablist" aria-label="Visualização do controle">'+
       tab("entries","Lançamentos")+tab("details","Resumo detalhado")+
       (enabled?tab("checks","Conferência")+tab("closures","Fechamentos"):"")+'</div>'+
       '<div class="truck-nav-actions"><button type="button" class="btn btn-sm btn-primary" onclick="App.truckForm()">'+icon("plus")+' Novo lançamento</button>'+
       '<button type="button" class="btn btn-sm truck-adjust" onclick="App.truckSettings('+control.id+')">'+icon("settings")+' Ajustes</button></div></div>';
    const rows=r.entries.map(x=>{
      const isFreight=x.kind==="freight";
      const stamp=x.event_date.slice(8,10)+"/"+x.event_date.slice(5,7)+"/"+x.event_date.slice(0,4);
      const sign=isFreight?"+":"−";
      const lockStatus=this.truckEntryStatus(x.event_date);
      const subtitle=isFreight?'<span class="secondary-text">'+number(x.weight_kg)+' kg × '+truckMoney(r.settings.price_basis==="kg"?Number(x.price_tonne)/1000:x.price_tonne)+(r.settings.price_basis==="kg"?"/kg":"/t")+' · comissão '+truckMoney(x.commission_amount)+'</span>':"";
      return '<tr><td>'+E(stamp)+'</td><td><b>'+E(x.description)+'</b>'+subtitle+'</td><td><span class="chip">'+E(x.category)+'</span></td>'+
        '<td class="numeric '+(isFreight?"positive":"negative")+'">'+sign+truckMoney(x.amount)+'</td>'+
        '<td><div class="table-actions">'+(lockStatus?'<span class="truck-record-lock">'+icon("lock")+' '+E(lockStatus)+'</span>':
        '<button class="mini-action" onclick="App.truckForm(null,'+x.id+')">'+icon("edit")+' Editar</button>'+
        '<button class="mini-action" onclick="App.truckDelete('+x.id+')">'+icon("trash")+' Excluir</button>')+'</div></td></tr>';
    }).join("");
    const ledger='<section class="panel truck-ledger"><div class="panel-header"><h3>Todos os lançamentos</h3>'+
      '<div class="actions-end"><span class="secondary-text">'+t.count+' registros</span>'+
      '<button class="btn btn-sm" onclick="App.truckExport('+control.id+')">'+icon("download")+' Exportar CSV</button></div></div>'+
      (r.entries.length?'<div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th>'+
      '<th style="text-align:right">Valor</th><th>Ações</th></tr></thead><tbody>'+rows+'</tbody></table></div>':
      '<div class="empty-state truck-empty"><strong>Nenhum lançamento neste período</strong>'+
      '<p>Utilize Novo lançamento no topo para começar.</p>'+
      '</div>')+'</section>';
    let body;
    if(active==="entries"){
      body='<div id="truck-panel-entries" class="truck-view truck-entries-view" role="tabpanel" aria-labelledby="truck-tab-entries">'+
        '<div class="truck-fast-summary" aria-label="Resumo rápido do período">'+
        '<div class="truck-fast-total"><span>Entradas do período</span><strong>'+truckMoney(t.freight)+'</strong></div>'+
        '<div class="truck-fast-total"><span>Saídas do período</span><strong>'+truckMoney(t.cash_out)+'</strong></div></div>'+
        '<div class="truck-action-filter-row">'+monthFilter+'</div>'+
        ledger+'</div>';
    }else if(active==="checks"){
      body=this.truckReviewMarkup();
    }else if(active==="closures"){
      body=this.truckCloseMarkup();
    }else{
      body='<div id="truck-panel-details" class="truck-view truck-details-view" role="tabpanel" aria-labelledby="truck-tab-details">'+
        '<div class="truck-details-filter">'+monthFilter+
        '<span class="secondary-text">Comissão padrão '+E(r.settings.commission_pct)+'%'+(r.settings.driver_name?' · '+E(r.settings.driver_name):"")+'</span></div>'+
        '<div class="truck-columns truck-detail-cards">'+
        '<section class="panel truck-detail-card truck-detail-freights"><div class="panel-header truck-detail-header">'+
        '<span class="truck-detail-symbol">'+icon("truck")+'</span><h3>FRETES</h3></div>'+
        '<div class="panel-body">'+overview(r.by_freight,"Nenhum frete neste período.")+'</div></section>'+
        '<section class="panel truck-detail-card truck-detail-expenses"><div class="panel-header truck-detail-header">'+
        '<span class="truck-detail-symbol">'+icon("circle-minus")+'</span><h3>GASTOS</h3></div>'+
        '<div class="panel-body">'+overview(r.by_expense,"Nenhuma outra despesa operacional neste período.")+
        '<div class="info-row truck-commission-expense"><span>Comissão gerada no período</span><strong>'+truckMoney(t.commission_earned)+'</strong></div></div></section>'+
        '<section class="panel truck-detail-card truck-detail-commission"><div class="panel-header truck-detail-header">'+
        '<span class="truck-detail-symbol">'+icon("coin")+'</span><h3>COMISSÃO MOTORISTA</h3></div><div class="panel-body">'+
        '<div class="info-row"><span>Comissão gerada</span><strong>'+truckMoney(t.driver_earned_all)+'</strong></div>'+
        '<div class="info-row"><span>Vales e acertos neste período</span><strong>'+truckMoney(t.driver_advances)+'</strong></div>'+
        '<div class="info-row"><span>Comissão paga</span><strong>'+truckMoney(t.driver_paid_all)+'</strong></div>'+
        '<div class="info-row truck-due"><span>Comissão em aberto</span><strong>'+truckMoney(t.driver_due)+'</strong></div>'+
        '</div></section></div></div>';
    }
    document.getElementById("main").innerHTML=nav+body;
  },
  truckSetTab(tab){
    if(!["entries","details","checks","closures"].includes(tab)||this.s.truckTab===tab)return;
    if(["checks","closures"].includes(tab)&&!this.s.truckReport?.workflow?.enabled)return;
    this.s.truckTab=tab;
    this.renderTruckView();
  },
  async truckSetMonth(month){this.s.truckMonth=month;await this.renderTruck()},
  truckExport(id){
    const selected=this.s.truckMonth;
    const filter=selected==="@todos"?"?scope=all":selected?"?month="+encodeURIComponent(selected):"";
    window.location.href="/api/controls/"+id+"/truck/export.csv"+filter;
  },
  truckForm(kind,id){
    if(!this.canOpenForm())return;
    const record=id?this.s.truckReport?.entries.find(x=>x.id===id):null;
    if(id&&!record){this.toast("Lançamento não encontrado.",true);return}
    this.s.modal="truck-record";
    this.s.modalContext={
      controlId:this.s.detail.control.id,
      entry:record?deep(record):null,
      settings:deep(this.s.truckReport.settings),
      kind:record?.kind||kind||"freight",
       category:record?.category||null
    };
    this.renderTruckForm();
  },
  renderTruckForm(){
    const ctx=this.s.modalContext,r=ctx.entry||{},kind=ctx.kind;
    const expenses=ctx.settings.categories||TRUCK_EXPENSES;
    const freights=ctx.settings.freight_types||TRUCK_FREIGHTS;
    const options=[...freights.map(n=>({kind:"freight",category:n,label:n})),
      ...expenses.map(n=>({kind:"expense",category:n,label:n})),
      {kind:"advance",category:"Vale motorista",label:"Vale Motorista"}];
    const chosen=ctx.category||r.category||(kind==="freight"?freights[0]:
      kind==="expense"?expenses[0]:"Vale motorista");
    ctx.category=chosen;
    if(!options.some(o=>o.kind===kind&&o.category===chosen))
      options.push({kind,category:chosen,label:chosen});
    const select=options.map(o=>'<option value="'+E(JSON.stringify([o.kind,o.category]))+'"'+
      (o.kind===kind&&o.category===chosen?" selected":"")+'>'+E(o.label)+'</option>').join("");
    const isKg=ctx.settings.price_basis==="kg";
    const rateName=isKg?"price_kg":"price_tonne";
    const rateValue=isKg?(r.price_kg??(r.price_tonne?String(truckNum(r.price_tonne)/1000):"")):(r.price_tonne||"");
    const fields=kind==="freight"?
      truckField("Peso carregado (kg)",truckInput("weight_kg",r.weight_kg||"",'required inputmode="decimal" oninput="App.truckPreview()"'))+
      truckField(isKg?"Valor por kg (R$/kg)":"Preço por tonelada (R$/t)",
        truckInput(rateName,rateValue,'required inputmode="decimal" oninput="App.truckPreview()"')):
      truckField(kind==="advance"?"Valor pago ao motorista (R$)":"Valor da despesa (R$)",
        truckInput("amount",r.amount||"",'required inputmode="decimal" oninput="App.truckPreview()"'));
    document.getElementById("modalRoot").innerHTML=
     '<div class="modal-backdrop"><div class="modal truck-entry-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
     '<div class="modal-header"><div><h2 id="modalTitle">'+(ctx.entry?.id?"Editar lançamento":"Novo lançamento")+'</h2>'+
     '<p>O cálculo se adapta automaticamente ao tipo.</p></div>'+
     '<button class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
     '<div class="modal-body"><form id="truckForm" onsubmit="event.preventDefault();App.truckSave()">'+
     '<div class="field truck-entry-type"><label for="truckEntryType">Tipo de lançamento *</label>'+
     '<div class="truck-entry-type-actions"><select id="truckEntryType" required onchange="App.truckChangeType(this.value)">'+select+'</select>'+
     '<button type="button" class="btn btn-sm" onclick="App.truckNewCategory()">'+icon("plus")+' Nova categoria</button></div></div>'+
     '<div class="form-grid">'+truckField("Data",truckFreeDateInput(r.event_date??truckDate()))+
     truckField("Descrição",truckInput("description",r.description||"",'maxlength="200" required placeholder="Descreva o lançamento"'))+
     fields+'<div class="field full"><label>Observações (opcional)</label><textarea name="notes" maxlength="1500" rows="2">'+E(r.notes||"")+'</textarea></div>'+
     '</div></form><div id="truckPreview" class="calc-preview"></div></div>'+
     '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
     '<button class="btn btn-primary" onclick="App.truckSave()">'+icon("check")+' Salvar lançamento</button></div></div></div>';
    this.truckPreview();
  },
  truckDateBlur(input){
    const date=truckParseDate(input.value);
    if(date){
      input.value=date.display;
      input.setCustomValidity("");
      const picker=document.getElementById("truckDatePicker");
      if(picker)picker.value=date.iso;
    }
    // Não mudar textos incompletos: Backspace e edição do mês/ano continuam livres.
  },
  truckOpenDatePicker(){
    const picker=document.getElementById("truckDatePicker");
    if(!picker)return;
    const text=document.getElementById("truckDateText");
    const date=truckParseDate(text?.value);
    if(date)picker.value=date.iso;
    if(typeof picker.showPicker==="function"){
      try{picker.showPicker();return}catch(_){}
    }
    picker.focus();
    picker.click();
  },
  truckDatePicked(picker){
    const input=document.getElementById("truckDateText");
    const date=truckParseDate(picker.value);
    if(!input||!date)return;
    input.value=date.display;
    input.setCustomValidity("");
  },
  truckChangeType(value){
    const ctx=this.s.modalContext;
    if(!ctx||this.s.modal!=="truck-record")return;
    let tuple;
    try{tuple=JSON.parse(value)}catch{return}
    if(!Array.isArray(tuple)||tuple.length!==2)return;
    const [kind,category]=tuple;
    const allowed=kind==="freight"?(ctx.settings.freight_types||TRUCK_FREIGHTS):
      kind==="expense"?(ctx.settings.categories||TRUCK_EXPENSES):
      kind==="advance"?TRUCK_ADVANCES:[];
    if(!allowed.includes(category))return;
    const form=document.getElementById("truckForm");
    if(form){
      const values=new FormData(form);
      ctx.entry={...ctx.entry,event_date:values.get("date"),
        description:values.get("description"),notes:values.get("notes"),
        amount:values.get("amount")||ctx.entry?.amount||"",
        weight_kg:values.get("weight_kg")||ctx.entry?.weight_kg||"",
        price_kg:values.get("price_kg")||ctx.entry?.price_kg||"",
        price_tonne:values.get("price_tonne")||ctx.entry?.price_tonne||""};
    }
    ctx.kind=kind;ctx.category=category;
    this.renderTruckForm();
  },
  async truckNewCategory(){
    const ctx=this.s.modalContext;
    if(!ctx||this.s.modal!=="truck-record")return;
    const raw=prompt("Nome da nova categoria de gastos:");
    if(raw===null)return;
    const name=raw.trim();
    if(!name||name.length>90){this.toast("Informe uma categoria de até 90 caracteres.",true);return}
    const existing=[...(ctx.settings.categories||[]),...(ctx.settings.freight_types||[]),...TRUCK_ADVANCES];
    if(existing.some(c=>normalizeSearch(c)===normalizeSearch(name))){
      this.toast("Já existe uma categoria com esse nome.",true);return;
    }
    const form=document.getElementById("truckForm");
    if(form){
      const data=new FormData(form);
      ctx.entry={...ctx.entry,event_date:data.get("date"),description:data.get("description"),
        notes:data.get("notes"),amount:data.get("amount")||"",
        weight_kg:data.get("weight_kg")||"",price_kg:data.get("price_kg")||"",
        price_tonne:data.get("price_tonne")||""};
    }
    try{
      const saved=await this.api("/api/controls/"+ctx.controlId+"/truck/categories","POST",{name});
      if(this.s.modal!=="truck-record"||this.s.modalContext!==ctx)return;
      ctx.settings.categories=saved.categories;
      if(this.s.truckReport?.settings)this.s.truckReport.settings.categories=saved.categories;
      ctx.kind="expense";ctx.category=saved.name;
      this.renderTruckForm();this.toast("Categoria criada e selecionada.");
    }catch(err){this.toast(err.message,true)}
  },
  truckCategoryList(){
    return this.s.modalContext?.settings?.categories||TRUCK_EXPENSES;
  },
  truckCategoryClose(){
    const options=document.getElementById("truckExpenseOptions");
    const input=document.getElementById("truckExpenseCategory");
    const arrow=document.querySelector(".truck-expense-arrow");
    if(options)options.hidden=true;
    if(input){
      input.setAttribute("aria-expanded","false");
      input.removeAttribute("aria-activedescendant");
    }
    if(arrow)arrow.setAttribute("aria-expanded","false");
    this.s.truckCategoryMatches=[];
    this.s.truckCategoryActive=-1;
  },
  truckCategoryRender(showAll=false){
    const input=document.getElementById("truckExpenseCategory");
    const options=document.getElementById("truckExpenseOptions");
    const arrow=document.querySelector(".truck-expense-arrow");
    if(!input||!options)return;
    const query=normalizeSearch(input.value.trim());
    const all=this.truckCategoryList();
    const matches=all.map((name,index)=>({name,index}))
      .filter(item=>showAll||!query||normalizeSearch(item.name).includes(query));
    this.s.truckCategoryMatches=matches.map(item=>item.index);
    this.s.truckCategoryActive=-1;
    this.s.truckCategoryAll=showAll;
    options.innerHTML=matches.length?matches.map(item=>
      '<button type="button" role="option" class="truck-expense-option" id="truckExpenseOption-'+item.index+'" aria-selected="false" onpointerdown="event.preventDefault()" onclick="App.truckCategoryPick('+item.index+')">'+E(item.name)+'</button>'
    ).join(""):'<div class="truck-expense-no-match">Nenhuma categoria encontrada. Adicione em Ajustes.</div>';
    options.hidden=false;
    input.setAttribute("aria-expanded","true");
    if(arrow)arrow.setAttribute("aria-expanded","true");
  },
  truckCategoryFocus(){
    const input=document.getElementById("truckExpenseCategory");
    if(input)this.truckCategoryRender(!input.value.trim());
  },
  truckCategoryInput(input){
    input.setCustomValidity("");
    this.truckCategoryRender(false);
  },
  truckCategoryToggle(){
    const options=document.getElementById("truckExpenseOptions");
    const input=document.getElementById("truckExpenseCategory");
    if(!options||!input)return;
    if(!options.hidden&&this.s.truckCategoryAll){
      this.truckCategoryClose();
    }else{
      this.truckCategoryRender(true);
    }
    input.focus();
  },
  truckCategoryPick(index){
    const input=document.getElementById("truckExpenseCategory");
    const name=this.truckCategoryList()[index];
    if(!input||typeof name!=="string")return;
    input.value=name;
    input.setCustomValidity("");
    this.truckCategoryClose();
    input.focus();
  },
  truckCategoryKeydown(event){
    const input=document.getElementById("truckExpenseCategory");
    const options=document.getElementById("truckExpenseOptions");
    if(!input||!options)return;
    if(event.key==="Escape"){
      this.truckCategoryClose();
      event.stopPropagation();
      return;
    }
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();
      if(options.hidden)this.truckCategoryRender(!input.value.trim());
      const matches=this.s.truckCategoryMatches||[];
      if(!matches.length)return;
      const current=this.s.truckCategoryActive??-1;
      this.s.truckCategoryActive=event.key==="ArrowDown"
        ?(current+1)%matches.length
        :(current<0?matches.length-1:(current-1+matches.length)%matches.length);
      const pos=this.s.truckCategoryActive;
      options.querySelectorAll('[role="option"]').forEach((node,i)=>{
        node.setAttribute("aria-selected",String(i===pos));
        node.classList.toggle("active",i===pos);
      });
      const id="truckExpenseOption-"+matches[pos];
      input.setAttribute("aria-activedescendant",id);
      document.getElementById(id)?.scrollIntoView({block:"nearest"});
    }else if(event.key==="Enter"&&!options.hidden&&(this.s.truckCategoryMatches||[]).length){
      event.preventDefault();
      const idx=this.s.truckCategoryActive>=0?this.s.truckCategoryActive:0;
      this.truckCategoryPick(this.s.truckCategoryMatches[idx]);
    }
  },
  truckCategoryBlur(){
    const input=document.getElementById("truckExpenseCategory");
    if(input)this.truckValidateExpenseCategory(input,true);
    this.truckCategoryClose();
  },
  truckValidateExpenseCategory(input,complete=false){
    const list=this.s.modalContext?.settings?.categories||TRUCK_EXPENSES;
    const normalized=v=>normalizeSearch(String(v||"").trim());
    const value=normalized(input.value);
    const exact=list.find(item=>normalized(item)===value);
    const starts=list.filter(item=>normalized(item).startsWith(value));
    const includes=list.filter(item=>normalized(item).includes(value));
    const selected=exact||(complete&&value?(starts.length===1?starts[0]:includes.length===1?includes[0]:null):null);
    if(selected)input.value=selected;
    const valid=!!selected || !complete;
    input.setCustomValidity(valid?"":"Selecione uma categoria cadastrada nos Ajustes.");
    return !!selected;
  },
  truckChangeKind(kind){
    const ctx=this.s.modalContext;
    if(!ctx)return;
    const name=kind==="freight"?(ctx.settings.freight_types||TRUCK_FREIGHTS)[0]:
      kind==="expense"?(ctx.settings.categories||TRUCK_EXPENSES)[0]:"Vale motorista";
    this.truckChangeType(JSON.stringify([kind,name]));
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
      const kg=truckNum(f.get("weight_kg"));
      const pt=truckNum(f.get(ctx.settings.price_basis==="kg"?"price_kg":"price_tonne"));
      const total=Math.round(kg*(ctx.settings.price_basis==="kg"?pt:pt/1000)*100)/100;
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
    if(!ctx||!form)return;
    const dateInput=document.getElementById("truckDateText");
    const parsedDate=truckParseDate(dateInput?.value);
    if(dateInput){
      dateInput.setCustomValidity(parsedDate?"":"Informe uma data válida. Ex.: 221026 ou 22/10/2026.");
    }
    if(!form.reportValidity())return;
    if(dateInput&&parsedDate)dateInput.value=parsedDate.display;
    const f=new FormData(form);
    const payload={date:parsedDate.iso,description:f.get("description"),kind:ctx.kind,category:ctx.category,
                   notes:f.get("notes"),amount:f.get("amount"),weight_kg:f.get("weight_kg"),
                   price_tonne:f.get("price_tonne"),price_kg:f.get("price_kg")};
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
      this.s.modalContext={
        controlId:cid,config:deep(res.settings),source:deep(source),
        categoriesDraft:(res.settings.categories||TRUCK_EXPENSES).map(name=>({original:name,name})),
        freightsDraft:(res.settings.freight_types||TRUCK_FREIGHTS).map(name=>({original:name,name})),
        usedExpenseCategories:new Set(res.entries.filter(e=>e.kind==="expense").map(e=>e.category)),
        usedFreightTypes:new Set(res.entries.filter(e=>e.kind==="freight").map(e=>e.category))
      };
      this.s.modal="truck-settings";
      this.renderTruckSettings();
    }catch(e){this.toast(e.message,true)}
  },
  truckRememberSettingsFields(){
    const ctx=this.s.modalContext,form=document.getElementById("truckSettingsForm");
    if(!ctx||!form)return;
    const values=new FormData(form);
    ctx.source.name=String(values.get("name")||"");
    for(const key of ["driver_name","commission_pct","opening_commission","opening_cash"]){
      ctx.config[key]=String(values.get(key)??"");
    }
  },
  truckEditCategory(index,value){
    const row=this.s.modalContext?.categoriesDraft?.[index];
    if(row)row.name=value;
  },
  truckAddCategory(){
    const ctx=this.s.modalContext;
    if(!ctx||ctx.categoriesDraft.length>=80)return this.toast("Limite de 80 categorias.",true);
    this.truckRememberSettingsFields();
    ctx.categoriesDraft.push({original:null,name:""});
    this.renderTruckSettings();
    document.getElementById("truckCategory-"+(ctx.categoriesDraft.length-1))?.focus();
  },
  truckRemoveCategory(index){
    const ctx=this.s.modalContext,row=ctx?.categoriesDraft?.[index];
    if(!row)return;
    if(ctx.categoriesDraft.length<=1)return this.toast("Mantenha pelo menos uma categoria.",true);
    if(row.original&&ctx.usedExpenseCategories.has(row.original)){
      return this.toast("Esta categoria possui lançamentos. Renomeie-a em vez de excluí-la.",true);
    }
    this.truckRememberSettingsFields();
    ctx.categoriesDraft.splice(index,1);
    this.renderTruckSettings();
  },
  truckEditFreight(index,value){
    const row=this.s.modalContext?.freightsDraft?.[index];
    if(row)row.name=value;
  },
  truckAddFreight(){
    const ctx=this.s.modalContext;
    if(!ctx||ctx.freightsDraft.length>=80)return this.toast("Limite de 80 tipos de frete.",true);
    this.truckRememberSettingsFields();
    ctx.freightsDraft.push({original:null,name:""});
    this.renderTruckSettings();
    document.getElementById("truckFreight-"+(ctx.freightsDraft.length-1))?.focus();
  },
  truckRemoveFreight(index){
    const ctx=this.s.modalContext,row=ctx?.freightsDraft?.[index];
    if(!row)return;
    if(ctx.freightsDraft.length<=1)return this.toast("Mantenha pelo menos um tipo de frete.",true);
    if(row.original&&ctx.usedFreightTypes.has(row.original)){
      return this.toast("Este tipo tem fretes cadastrados. Renomeie-o em vez de excluir.",true);
    }
    this.truckRememberSettingsFields();
    ctx.freightsDraft.splice(index,1);
    this.renderTruckSettings();
  },
  renderTruckSettings(){
    const ctx=this.s.modalContext,conf=ctx.config;
    const freights=ctx.freightsDraft.map((row,i)=>
      '<div class="truck-category-row"><input id="truckFreight-'+i+'" type="text" maxlength="90" value="'+E(row.name)+'" placeholder="Nome do tipo de frete" aria-label="Tipo de frete '+(i+1)+'" oninput="App.truckEditFreight('+i+',this.value)">'+
      '<button type="button" class="btn btn-sm truck-category-remove" title="Remover tipo de frete" onclick="App.truckRemoveFreight('+i+')">'+icon("trash")+'</button></div>'
    ).join("");
    const categories=ctx.categoriesDraft.map((row,i)=>
      '<div class="truck-category-row"><input id="truckCategory-'+i+'" type="text" maxlength="90" value="'+E(row.name)+'" placeholder="Nome da categoria" aria-label="Categoria de despesa '+(i+1)+'" oninput="App.truckEditCategory('+i+',this.value)">'+
      '<button type="button" class="btn btn-sm truck-category-remove" aria-label="Excluir categoria '+E(row.name)+'" title="Remover categoria" onclick="App.truckRemoveCategory('+i+')">'+icon("trash")+'</button></div>'
    ).join("");
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
      '</div><section class="truck-category-settings"><div class="truck-category-settings-head"><div><h3>Tipos de frete</h3>'+
      '<p>Personalize os tipos disponíveis ao registrar fretes, por exemplo Frete Normal e Frete Morto.</p></div>'+
      '<button class="btn btn-sm" type="button" onclick="App.truckAddFreight()">'+icon("plus")+' Adicionar tipo</button></div>'+
      '<div class="truck-category-list">'+freights+'</div>'+
      '<p class="truck-category-help">Renomear um tipo atualiza os nomes dos fretes anteriores ainda não conferidos. Um tipo com lançamentos não pode ser excluído.</p></section>'+
      '<section class="truck-category-settings"><div class="truck-category-settings-head"><div><h3>Categorias de despesa</h3>'+
      '<p>Estas são as únicas opções disponíveis ao registrar gastos neste caminhão.</p></div>'+
      '<button class="btn btn-sm" type="button" onclick="App.truckAddCategory()">'+icon("plus")+' Adicionar categoria</button></div>'+
      '<div class="truck-category-list">'+categories+'</div>'+
      '<p class="truck-category-help">Renomear uma categoria também atualiza seu nome nos lançamentos anteriores, sem alterar os valores. Categorias em uso não podem ser excluídas.</p></section></form>'+
      '<div class="hint" style="margin-top:18px">Alterar a porcentagem vale para novos fretes e lançamentos editados. Fretes antigos mantêm a comissão original.</div></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.truckSaveSettings()">Salvar ajustes</button></div></div></div>';
  },
  async truckSaveSettings(){
    const ctx=this.s.modalContext;
    const form=document.getElementById("truckSettingsForm");
    if(!ctx||!form||!form.reportValidity())return;
    const categories=ctx.categoriesDraft.map(row=>row.name.trim());
    const freights=ctx.freightsDraft.map(row=>row.name.trim());
    const names=categories.map(normalizeSearch);
    const freightNames=freights.map(normalizeSearch);
    if(freights.some(name=>!name)){
      this.toast("Preencha todos os tipos de frete.",true);return;
    }
    if(new Set(freightNames).size!==freightNames.length){
      this.toast("Não repita nomes de tipos de frete.",true);return;
    }
    if(categories.some(name=>!name)){
      this.toast("Preencha o nome de todas as categorias.",true);return
    }
    if(new Set(names).size!==names.length){
      this.toast("Não repita nomes de categorias.",true);return
    }
    if(categories.some(name=>[...TRUCK_ADVANCES,...freights].some(v=>normalizeSearch(v)===normalizeSearch(name)))){
      this.toast("Fretes e vales possuem lançamentos próprios.",true);return
    }
    const renames=ctx.categoriesDraft.filter(row=>row.original&&row.original!==row.name.trim()).map(row=>({
      old:row.original,new:row.name.trim()
    }));
    const freightRenames=ctx.freightsDraft.filter(row=>row.original&&row.original!==row.name.trim()).map(row=>({
      old:row.original,new:row.name.trim()
    }));
    const f=new FormData(form);
    const payload={name:f.get("name"),commission_pct:f.get("commission_pct"),
      opening_cash:f.get("opening_cash"),opening_commission:f.get("opening_commission"),
      driver_name:f.get("driver_name"),price_basis:ctx.settings.price_basis||"tonne",categories,category_renames:renames,
      freight_types:freights,freight_type_renames:freightRenames};
    try{
      await this.api("/api/controls/"+ctx.controlId+"/truck/settings","PUT",payload);
      this.closeModal();
      await this.load();
      this.toast("Configurações salvas.");
    }catch(e){this.toast(e.message,true)}
  }
});
