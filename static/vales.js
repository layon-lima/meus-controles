"use strict";
/* Vales de funcionários: pessoas, novas dívidas, parcelas previstas e descontos reais. */
const vfMoney=n=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(n||0));
const vfNum=v=>{
  let s=String(v??"").trim().replace(/\s/g,"");
  if(s.includes(","))s=s.replace(/\./g,"").replace(",",".");
  else if(/^\d{1,3}(?:\.\d{3})+$/.test(s))s=s.replace(/\./g,"");
  return Number(s);
};
const vfCurrentMonth=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")};
const vfMonth=m=>m?m.slice(5,7)+"/"+m.slice(0,4):"—";
const vfEntryDate=raw=>{const m=String(raw||"").match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+"/"+m[2]+"/"+m[1]:"—"};
const vfAddMonth=(value,offset)=>{
  const [y,m]=String(value).split("-").map(Number);
  const d=new Date(Date.UTC(y,m-1+offset,1));
  return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");
};
const vfInput=(name,value,attrs="")=>'<input name="'+name+'" value="'+E(value??"")+'" '+attrs+'>';
const vfField=(label,inner)=>'<div class="field"><label>'+E(label)+'</label>'+inner+'</div>';

// Distribui exatamente os centavos restantes nas parcelas ainda automáticas.
// Cada valor alterado manualmente é preservado; valores impossíveis são recusados.
const vfToCents=raw=>{
  const n=vfNum(raw);
  return Number.isFinite(n)&&n>0&&n<=1000000000&&Math.abs(n*100-Math.round(n*100))<0.00001
    ?Math.round(n*100):null;
};
const vfFromCents=cents=>(cents/100).toFixed(2);
const vfSplitCents=(total,count)=>{
  if(!Number.isSafeInteger(total)||!Number.isInteger(count)||count<1||count>120||total<count)return null;
  const base=Math.floor(total/count),rest=total%count;
  return Array.from({length:count},(_,i)=>base+(i<rest?1:0));
};
const vfRedistribute=(total,plan,editedIndex,editedCents)=>{
  if(!Number.isSafeInteger(total)||total<plan.length||!Array.isArray(plan)||!plan.length||
      !Number.isInteger(editedIndex)||editedIndex<0||editedIndex>=plan.length||
      !Number.isSafeInteger(editedCents)||editedCents<=0)return null;
  const next=plan.map((p,i)=>({...p,locked:!!p.locked}));
  next[editedIndex]={...next[editedIndex],amount:vfFromCents(editedCents),locked:true};
  const held=next.reduce((sum,p)=>sum+(p.locked?vfToCents(p.amount)||0:0),0);
  const free=next.filter(p=>!p.locked);
  if(held>total||total-held<free.length)return null;
  if(!free.length)return held===total?next:null;
  const amounts=vfSplitCents(total-held,free.length);
  if(!amounts)return null;
  let position=0;
  return next.map(p=>p.locked?p:{...p,amount:vfFromCents(amounts[position++])});
};

Object.assign(App,{
  async renderVales(){
    const ctrl=this.s.detail?.control;
    if(!ctrl||ctrl.mode!=="vale_funcionarios")return;
    const id=ctrl.id;
    document.getElementById("main").innerHTML='<div class="empty-state">Carregando vales...</div>';
    try{
      const data=await this.api("/api/controls/"+id+"/vales");
      if(this.s.route!=="control"||this.s.id!==id)return;
      this.s.valesData=data;
      this.renderValesView();
    }catch(e){this.toast(e.message,true)}
  },
  renderValesView(){
    const data=this.s.valesData,c=this.s.detail?.control;
    if(!data||!c)return;
    const selected=String(this.s.valesSelected||"all");
    const tab=this.s.valesTab||"lancamentos";
    const all=data.employees||[];
    // Cada parcela é uma linha individual, inclusive as já quitadas.
    // A data do lançamento vem do vale original; não é o mês previsto para descontar.
    const entries=all.flatMap(emp=>emp.debts.flatMap(d=>d.installments.map(i=>({
      ...i,employeeId:emp.id,employeeName:emp.name,employeeActive:emp.active,
      debtId:d.id,title:d.title||d.description,description:d.description,
      launchDate:d.created_at,numberOfInstallments:d.installments.length
    })))).filter(i=>selected==="all"||String(i.employeeId)===selected)
      .sort((a,b)=>String(b.launchDate||"").localeCompare(String(a.launchDate||""))||
        b.debtId-a.debtId||a.installment_number-b.installment_number);
    const choices=all.map(emp=>'<option value="'+emp.id+'" '+
      (String(emp.id)===selected?'selected':'')+'>'+E(emp.name)+'</option>').join("");
    const rows=entries.map(i=>{
      const status=i.status==="pago"?"Pago":i.status==="parcial"?"Parcial":"Pendente";
      const statusStyle=i.status==="pago"?"paid":i.status==="parcial"?"partial":"pending";
      const itemTitle=i.title||"Vale";
      const parts=i.numberOfInstallments>1?"Parcela "+i.installment_number+"/"+i.numberOfInstallments:"À vista";
      return '<tr class="vf-ledger-row">'+
        '<td data-label="Data">'+vfEntryDate(i.launchDate)+'</td>'+
        '<td data-label="Descrição"><strong>'+E(itemTitle)+'</strong>'+
        '<small>'+E(parts)+(i.description&&i.description!==itemTitle?" · "+E(i.description):"")+'</small></td>'+
        '<td data-label="Valor" class="numeric vf-amount">'+vfMoney(i.amount)+'</td>'+
        '<td data-label="Funcionário">'+E(i.employeeName)+'</td>'+
        '<td data-label="Descontar em">'+vfMonth(i.due_month)+'</td>'+
        '<td data-label="Situação"><span class="vf-status '+statusStyle+'">'+status+'</span>'+
        (i.status==="parcial"?'<small>'+vfMoney(i.remaining)+' restante</small>':'')+'</td>'+
        '<td data-label="Ações" class="vf-ledger-actions">'+
          (Number(i.remaining)>0?'<button class="btn btn-sm btn-primary" onclick="App.valesPaymentForm('+i.id+')">Descontar</button>':'')+
          '<button class="btn btn-sm" onclick="App.'+(Number(data.employees.find(e=>e.id===i.employeeId)?.remaining)>0?'valesManageDebt('+i.employeeId+')':'valesDebtTitleForm('+i.debtId+')')+'">'+(Number(data.employees.find(e=>e.id===i.employeeId)?.remaining)>0?'Gerenciar':'Editar título')+'</button></td></tr>';
    }).join("");
    const ledger='<div class="vf-ledger panel">'+
      '<div class="vf-table-head"><strong>Todos os lançamentos</strong><span>'+entries.length+
      ' parcela(s) / lançamento(s)</span></div>'+
      '<table class="vf-ledger-table"><colgroup><col class="vf-col-date"><col class="vf-col-desc">'+
      '<col class="vf-col-amount"><col class="vf-col-person"><col class="vf-col-month">'+
      '<col class="vf-col-status"><col class="vf-col-action"></colgroup>'+
      '<thead><tr><th>Data do lançamento</th><th>Descrição</th><th>Valor</th>'+
      '<th>Para quem foi</th><th>Quando descontar</th><th>Situação</th><th>Ações</th></tr></thead>'+
      '<tbody>'+ (rows||'<tr><td colspan="7" class="vf-table-empty">Nenhum lançamento encontrado para o funcionário selecionado.</td></tr>')+
      '</tbody></table></div>';
    const withOpenBalance=all.filter(emp=>Number(emp.remaining)>0);
    const visibleTotals=withOpenBalance.filter(emp=>selected==="all"||String(emp.id)===selected);
    const totalsRows=visibleTotals.map(emp=>
      '<tr><td data-label="Funcionário"><strong>'+E(emp.name)+'</strong>'+
      (!emp.active?'<small>Arquivado</small>':'')+'</td>'+
      '<td data-label="Total emprestado" class="numeric">'+vfMoney(emp.lent)+'</td>'+
      '<td data-label="Total descontado" class="numeric">'+vfMoney(emp.paid)+'</td>'+
      '<td data-label="Em aberto" class="numeric"><strong>'+vfMoney(emp.remaining)+'</strong></td>'+
      '<td data-label="Vales" class="numeric">'+emp.debts.length+'</td>'+
      '<td data-label="Ações" class="vf-summary-actions">'+
        (emp.active?'<button class="btn btn-sm btn-primary" onclick="App.valesDebtForm('+emp.id+')">Novo vale</button>':'')+
        '<button class="btn btn-sm" onclick="App.valesEmployeeDetails('+emp.id+')">Detalhes</button>'+
        '<button class="btn btn-sm" onclick="App.valesSetActive('+emp.id+','+(!emp.active)+')">'+
        (emp.active?"Arquivar":"Reativar")+'</button></td></tr>').join("");
    const detailEmp=visibleTotals.find(e=>e.id===this.s.valesDetailEmployee);
    const detailDebts=detailEmp?'<section class="vf-details"><div class="vf-details-heading"><h3>Vales de '+E(detailEmp.name)+'</h3>'+
      '<button class="btn btn-sm" onclick="App.valesEmployeeDetails(null)">Fechar detalhes</button></div>'+
      (detailEmp.debts.length?detailEmp.debts.map(d=>{
        const canEdit=!Number(d.paid),remaining=Number(d.remaining)>0;
        return '<div class="vf-detail-debt"><div class="vf-detail-title"><strong>'+E(d.title||d.description)+'</strong>'+
        (d.description&&d.description!==d.title?'<small>'+E(d.description)+'</small>':'')+
        '<small>'+d.installments.length+' parcela(s) · início '+vfMonth(d.first_month)+'</small></div>'+
        '<div class="vf-detail-balances">Emprestado '+vfMoney(d.amount)+
        ' · Pago '+vfMoney(d.paid)+' · <b>Em aberto '+vfMoney(d.remaining)+'</b></div>'+
        '<div class="vf-detail-actions">'+
        '<button class="btn btn-sm" onclick="App.valesDebtTitleForm('+d.id+')">Editar título</button>'+
        (canEdit?'<button class="btn btn-sm" onclick="App.valesDebtForm('+detailEmp.id+','+d.id+')">Ajustar parcelas</button>':'')+
        (remaining?'<button class="btn btn-sm btn-primary" onclick="App.valesSettleForm('+d.id+')">Quitar dívida</button>':'')+
        (canEdit?'<button class="btn btn-sm vf-danger" onclick="App.valesDeleteDebt('+d.id+')">Excluir vale</button>':'')+
        '</div></div>';
      }).join(""):'<p class="vf-table-empty">Nenhum vale para este funcionário.</p>')+
      '</section>':"";
    const summary='<section class="vf-summary panel"><div class="vf-table-head"><strong>Totais por funcionário</strong>'+
      '<span>'+visibleTotals.length+' funcionário(s) com saldo em aberto</span></div>'+
      '<table class="vf-summary-table"><thead><tr><th>Funcionário</th><th>Total emprestado</th>'+
      '<th>Total descontado</th><th>Em aberto</th><th>Vales</th><th>Ações</th></tr></thead>'+
      '<tbody>'+(totalsRows||'<tr><td colspan="6" class="vf-table-empty">Nenhum funcionário com vales em aberto.</td></tr>')+
      '</tbody></table>'+detailDebts+'</section>'+
      '<details class="panel vf-history" ontoggle="if(this.open) App.valesLoadPayments()">'+
      '<summary>Histórico de descontos realizados</summary>'+
      '<div class="vf-month-grid"><table><thead><tr><th>Mês pago</th><th>Funcionário</th>'+
      '<th>Vale</th><th>Valor descontado</th><th>Ação</th></tr></thead>'+
      '<tbody id="vf-payment-history"><tr><td colspan="5">Abra para consultar os descontos registrados.</td></tr></tbody>'+
      '</table></div></details>';
    document.getElementById("main").innerHTML='<div class="vf-page">'+
      '<div class="vf-heading"><div><div class="eyebrow">CONTROLE DE VALES</div><h2>'+E(c.name)+'</h2></div>'+
      '<div class="vf-heading-actions"><button class="btn btn-primary" onclick="App.valesNewDebt()">'+
      icon("plus")+' Novo vale</button>'+
      '<button class="btn" onclick="App.valesEmployeeForm()">'+icon("user-plus")+' Cadastrar funcionário</button></div></div>'+
      '<div class="vf-tabs" role="tablist" aria-label="Seções do controle de vales">'+
      '<button role="tab" aria-selected="'+(tab==="lancamentos")+'" class="'+(tab==="lancamentos"?"active":"")+
      '" onclick="App.valesSwitchTab(&quot;lancamentos&quot;)">Lançamentos</button>'+
      '<button role="tab" aria-selected="'+(tab==="totais")+'" class="'+(tab==="totais"?"active":"")+
      '" onclick="App.valesSwitchTab(&quot;totais&quot;)">Totais por funcionário</button></div>'+
      '<div class="vf-toolbar"><label>Filtrar funcionário <select onchange="App.valesSelectEmployee(this.value)">'+
      '<option value="all">Todos os funcionários</option>'+choices+'</select></label></div>'+
      (tab==="totais"?summary:ledger)+'</div>';
  },
  valesSwitchTab(tab){
    if(tab!=="lancamentos"&&tab!=="totais")return;
    this.s.valesTab=tab;
    this.renderValesView();
  },
  valesEmployeeDetails(id){
    this.s.valesDetailEmployee=this.s.valesDetailEmployee===id?null:id;
    this.s.valesTab="totais";
    this.renderValesView();
  },
  valesManageDebt(employeeId){
    this.s.valesDetailEmployee=employeeId;
    this.s.valesTab="totais";
    this.renderValesView();
  },
  valesNewDebt(){
    if(!this.canOpenForm())return;
    const employees=(this.s.valesData?.employees||[]).filter(e=>e.active);
    if(!employees.length){this.toast("Cadastre ou reative um funcionário primeiro.",true);return}
    const selected=employees.find(e=>String(e.id)===String(this.s.valesSelected));
    if(selected){this.valesDebtForm(selected.id);return}
    if(employees.length===1){this.valesDebtForm(employees[0].id);return}
    this.valesOpenModal("Novo vale","Selecione o funcionário que receberá o vale.",
      vfField("Funcionário",'<select name="employee" required>'+
        '<option value="">Selecione...</option>'+employees.map(e=>
          '<option value="'+e.id+'">'+E(e.name)+'</option>').join("")+'</select>'),
      "valesSelectNewDebt","Continuar");
  },
  valesSelectNewDebt(){
    const form=document.getElementById("vf-form");
    if(!form?.reportValidity())return;
    const id=Number(new FormData(form).get("employee"));
    if(!this.s.valesData?.employees.some(e=>e.id===id&&e.active)){
      this.toast("Selecione um funcionário válido.",true);return;
    }
    this.closeModal();
    this.valesDebtForm(id);
  },
  valesSelectEmployee(value){this.s.valesSelected=value;this.renderValesView()},

  async valesRefresh(){
    const id=this.s.detail?.control?.id;
    const [data]=await Promise.all([this.api("/api/controls/"+id+"/vales"),this.load()]);
    if(this.s.route!=="control"||this.s.id!==id)return;
    this.s.valesData=data;this.renderValesView();
  },
  valesOpenModal(title,description,body,action,label){
    this.s.modal="vales";this.s.modalContext={type:action};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal vf-modal" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">'+E(title)+'</h2><p>'+E(description)+'</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="vf-form" onsubmit="event.preventDefault();App.'+action+'()">'+body+'</form></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.'+action+'()">'+E(label)+'</button></div></div></div>';
  },
  valesEmployeeForm(){
    if(!this.canOpenForm())return;
    this.valesOpenModal("Cadastrar funcionário","O funcionário ficará disponível para receber vales.",
      vfField("Nome ou apelido",vfInput("name","",'required maxlength="160" placeholder="Ex.: João, Zé, Maria"')),
      "valesSaveEmployee","Cadastrar");
  },
  async valesSaveEmployee(){
    const form=document.getElementById("vf-form");if(!form.reportValidity())return;
    try{
      const fd=new FormData(form),cid=this.s.detail.control.id;
      await this.api("/api/controls/"+cid+"/vales/employees","POST",{name:fd.get("name")});
      this.closeModal();await this.valesRefresh();this.toast("Funcionário cadastrado.");
    }catch(e){this.toast(e.message,true)}
  },
  valesDebtForm(employeeId,debtId=null){
    if(!this.canOpenForm())return;
    const emp=this.s.valesData?.employees.find(x=>x.id===employeeId);
    if(!emp)return;
    const existing=debtId?emp.debts.find(d=>d.id===debtId):null;
    if(debtId&&!existing)return;
    if(existing&&Number(existing.paid)>0){this.toast("Esse vale já possui descontos e não pode ser redividido.",true);return}
    const amount=existing?.amount||"";
    const first=existing?.first_month||vfCurrentMonth();
    const count=existing?.installments?.length||1;
    this.s.valesDebtCtx={
      employeeId,debtId,plan:existing?.installments.map(i=>({
        month:i.due_month,amount:i.amount,locked:false
      }))||[]
    };
    const form='<div class="vf-form-grid">'+
      vfField("Funcionário",'<input value="'+E(emp.name)+'" disabled>')+
      vfField("Título da dívida *",vfInput("title",existing?.title||existing?.description||"",
        'required maxlength="160" placeholder="Ex.: Vale pessoal" '+(existing?"disabled":"")))+
      vfField("Valor total (R$)",vfInput("amount",amount,'required inputmode="decimal" '+
        (existing?'readonly':'oninput="App.valesPropose()"')))+
      vfField("Primeiro desconto (mês/ano)",'<input type="month" name="first_month" value="'+E(first)+
        '" required onchange="App.valesPropose(true)">')+
      vfField("Quantidade de parcelas",'<input type="number" min="1" max="120" step="1" name="count" value="'+count+
        '" required oninput="App.valesPropose()">')+'</div>'+
      '<div class="vf-plan-help">O valor é distribuído automaticamente. Altere qualquer parcela para distribuir o restante nas outras.</div>'+
      '<div id="vf-plan-editor" class="vf-plan-editor"></div>'+
      '<div id="vf-plan-total" class="vf-plan-total"></div>';
    this.valesOpenModal(existing?"Ajustar parcelas":"Novo vale",
      "Funcionário: "+emp.name+" · os descontos são definidos pelo mês, sem informar o dia.",
      form,"valesSaveDebt",existing?"Salvar parcelas":"Cadastrar vale");
    if(existing)this.valesShowPlan(this.s.valesDebtCtx.plan);
    else this.valesPropose();
  },
  valesPropose(regenerateMonths=false){
    const form=document.getElementById("vf-form"),ctx=this.s.valesDebtCtx;
    if(!form||!ctx)return;
    const fd=new FormData(form);
    const cents=vfToCents(fd.get("amount"));
    const count=Number(fd.get("count")),first=fd.get("first_month");
    const editor=document.getElementById("vf-plan-editor");
    if(cents===null||!Number.isInteger(count)||count<1||count>120||
       !/^\d{4}-(0[1-9]|1[0-2])$/.test(first)){
      editor.innerHTML='<p class="secondary-text">Preencha o valor, o primeiro mês e a quantidade de parcelas.</p>';
      document.getElementById("vf-plan-total").textContent="";
      ctx.plan=[];return;
    }
    const parts=vfSplitCents(cents,count);
    if(!parts){
      editor.innerHTML='<p class="vf-error">O total não comporta essa quantidade de parcelas.</p>';
      document.getElementById("vf-plan-total").textContent="";
      ctx.plan=[];return;
    }
    const preserveMonths=!regenerateMonths&&ctx.plan.length===count&&
      ctx.plan[0]?.month===first;
    const plan=parts.map((amount,i)=>({
      month:preserveMonths?ctx.plan[i].month:vfAddMonth(first,i),
      amount:vfFromCents(amount),locked:false
    }));
    this.valesShowPlan(plan);
  },
  valesShowPlan(plan){
    const ctx=this.s.valesDebtCtx;
    if(!ctx)return;
    ctx.plan=plan.map(p=>({...p,locked:!!p.locked}));
    const single=plan.length===1;
    document.getElementById("vf-plan-editor").innerHTML='<table><thead><tr>'+
      '<th>Parcela</th><th>Mês de desconto</th><th>Valor (R$)</th></tr></thead><tbody>'+
      ctx.plan.map((p,i)=>'<tr><td>'+(i+1)+'/'+ctx.plan.length+'</td>'+
      '<td><input type="month" value="'+E(p.month)+'" onchange="App.valesEditPlan('+i+',&quot;month&quot;,this.value)"></td>'+
      '<td>'+(single?'<strong class="vf-single-amount">'+vfMoney(p.amount)+'</strong>':
        '<input type="text" inputmode="decimal" data-vf-amount="'+i+'" value="'+E(p.amount)+
        '" aria-label="Valor da parcela '+(i+1)+'" onchange="App.valesEditPlan('+i+',&quot;amount&quot;,this.value)">')+
      '</td></tr>').join("")+'</tbody></table>';
    this.valesPlanTotal();
  },
  valesEditPlan(index,key,raw){
    const ctx=this.s.valesDebtCtx;
    if(!ctx?.plan[index])return;
    const original=ctx.plan.map(p=>({...p}));
    if(key==="amount"){
      const total=vfToCents(document.querySelector('#vf-form input[name="amount"]')?.value);
      const edited=vfToCents(raw);
      const adjusted=total===null||edited===null?null:vfRedistribute(total,ctx.plan,index,edited);
      if(!adjusted){
        this.toast("Valor inválido. As parcelas não podem ultrapassar a dívida e devem somar o total.",true);
        this.valesShowPlan(original);return;
      }
      this.valesShowPlan(adjusted);
      return;
    }
    if(key==="month"){
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)||
        (index>0&&raw<=ctx.plan[index-1].month)||
        (index<ctx.plan.length-1&&raw>=ctx.plan[index+1].month)){
        this.toast("Os meses precisam estar em ordem crescente, sem repetições.",true);
        this.valesShowPlan(original);return;
      }
      ctx.plan[index].month=raw;
      if(index===0){
        const first=document.querySelector('#vf-form input[name="first_month"]');
        if(first)first.value=raw;
      }
      this.valesShowPlan(ctx.plan);
    }
  },
  valesPlanTotal(){
    const ctx=this.s.valesDebtCtx;
    if(!ctx)return;
    const total=vfToCents(document.querySelector('#vf-form input[name="amount"]')?.value);
    const amounts=ctx.plan.map(p=>vfToCents(p.amount));
    const sum=amounts.every(n=>n!==null)?amounts.reduce((a,b)=>a+b,0):null;
    const valid=total!==null&&sum===total;
    document.getElementById("vf-plan-total").innerHTML=
      'Total das parcelas: <b>'+vfMoney(sum===null?0:sum/100)+'</b> / Vale: <b>'+
      vfMoney(total===null?0:total/100)+'</b>'+
      (valid?'<span class="vf-paid">Valores conferem</span>':
        '<strong class="vf-error"> As parcelas devem somar exatamente o total.</strong>');
  },
  async valesSaveDebt(){
    const form=document.getElementById("vf-form");
    if(!form?.reportValidity())return;
    const ctx=this.s.valesDebtCtx;
    if(!ctx)return;
    const fd=new FormData(form);
    const total=vfToCents(fd.get("amount"));
    const amounts=ctx.plan.map(p=>vfToCents(p.amount));
    if(total===null||!amounts.length||amounts.includes(null)||
       amounts.reduce((a,b)=>a+b,0)!==total){
      this.toast("As parcelas devem somar exatamente o valor do vale.",true);return;
    }
    if(ctx.plan[0].month!==fd.get("first_month")||
      ctx.plan.some((p,i)=>i>0&&p.month<=ctx.plan[i-1].month)){
      this.toast("Confira os meses de desconto, que precisam estar em ordem crescente.",true);return;
    }
    const installments=ctx.plan.map((p,i)=>({month:p.month,amount:vfFromCents(amounts[i])}));
    try{
      const id=ctx.debtId;
      const payload=id?{installments}:{
        title:fd.get("title"),amount:vfFromCents(total),
        first_month:fd.get("first_month"),installments
      };
      await this.api(id?"/api/vales-debts/"+id+"/plan":
        "/api/vales-employees/"+ctx.employeeId+"/debts",id?"PUT":"POST",payload);
      this.closeModal();await this.valesRefresh();
      this.toast(id?"Parcelas atualizadas.":"Vale cadastrado.");
    }catch(e){this.toast(e.message,true)}
  },
  valesDebtTitleForm(id){
    if(!this.canOpenForm())return;
    const d=this.s.valesData?.employees.flatMap(e=>e.debts).find(x=>x.id===id);
    if(!d)return;
    this.s.valesDetailsId=id;
    this.valesOpenModal("Editar título da dívida","A alteração não modifica valores nem parcelas.",
      vfField("Título *",vfInput("title",d.title||d.description||"",'required maxlength="160"')),
      "valesSaveDebtTitle","Salvar alterações");
  },
  async valesSaveDebtTitle(){
    const form=document.getElementById("vf-form");
    if(!form?.reportValidity())return;
    try{
      const fd=new FormData(form);
      await this.api("/api/vales-debts/"+this.s.valesDetailsId,"PATCH",
        {title:fd.get("title")});
      this.closeModal();await this.valesRefresh();this.toast("Título atualizado.");
    }catch(e){this.toast(e.message,true)}
  },
  valesPaymentForm(id){
    if(!this.canOpenForm())return;
    const item=this.s.valesData?.schedule.find(i=>i.id===id);if(!item)return;
    this.s.valesPaymentCtx={id};
    const body='<p>Funcionário: <b>'+E(item.employee)+'</b> · Vale: <b>'+E(item.debt_title||item.debt_description)+'</b></p>'+
      '<p>Parcela de '+vfMonth(item.due_month)+' · Restante '+vfMoney(item.remaining)+'</p>'+
      '<div class="vf-form-grid">'+vfField("Mês em que foi descontado",'<input type="month" name="month" value="'+vfCurrentMonth()+'" required>')+
      vfField("Valor realmente descontado (R$)",vfInput("amount",item.remaining,'required inputmode="decimal"'))+'</div>';
    this.valesOpenModal("Registrar desconto","Este valor reduzirá a dívida do funcionário.",body,"valesSavePayment","Confirmar desconto");
  },
  async valesSavePayment(){
    const form=document.getElementById("vf-form");if(!form?.reportValidity())return;
    try{
      const f=new FormData(form);
      await this.api("/api/vales-installments/"+this.s.valesPaymentCtx.id+"/payments","POST",
        {month:f.get("month"),amount:f.get("amount")});
      this.closeModal();await this.valesRefresh();this.toast("Desconto registrado.");
    }catch(e){this.toast(e.message,true)}
  },
  valesSettleForm(did){
    if(!this.canOpenForm())return;
    const d=this.s.valesData?.employees.flatMap(e=>e.debts).find(x=>x.id===did);if(!d)return;
    this.s.valesSettleId=did;
    this.valesOpenModal("Quitar dívida","O sistema marcará todas as parcelas restantes como pagas.",
      '<p>Valor total a quitar: <b>'+vfMoney(d.remaining)+'</b></p>'+
      vfField("Mês do desconto ou quitação",'<input type="month" name="month" value="'+vfCurrentMonth()+'" required>'),
      "valesSaveSettle","Confirmar quitação");
  },
  async valesSaveSettle(){
    const f=document.getElementById("vf-form");if(!f?.reportValidity())return;
    try{
      await this.api("/api/vales-debts/"+this.s.valesSettleId+"/pay","POST",
        {month:new FormData(f).get("month")});
      this.closeModal();await this.valesRefresh();this.toast("Dívida quitada.");
    }catch(e){this.toast(e.message,true)}
  },
  async valesSetActive(id,active){
    if(!confirm(active?"Reativar funcionário?":"Arquivar funcionário? O histórico de dívidas e descontos será preservado."))return;
    try{
      await this.api("/api/vales-employees/"+id,"PATCH",{active});
      await this.valesRefresh();this.toast(active?"Funcionário reativado.":"Funcionário arquivado.");
    }catch(e){this.toast(e.message,true)}
  },
  async valesDeleteDebt(id){
    if(!confirm("Excluir este vale sem descontos? Essa ação não pode ser desfeita."))return;
    try{
      await this.api("/api/vales-debts/"+id,"DELETE");
      await this.valesRefresh();this.toast("Vale excluído.");
    }catch(e){this.toast(e.message,true)}
  },
  async valesLoadPayments(){
    if(this.s.route!=="control"||!this.s.valesData)return;
    try{
      this.s.valesPaymentHistory=await this.api("/api/controls/"+this.s.detail.control.id+"/vales/payments");
      const tbody=document.getElementById("vf-payment-history");
      const selected=String(this.s.valesSelected||"all");
      const selectedEmployee=this.s.valesData.employees.find(e=>String(e.id)===selected);
      const filtered=selectedEmployee?this.s.valesPaymentHistory.filter(p=>p.employee===selectedEmployee.name):this.s.valesPaymentHistory;
      if(tbody)tbody.innerHTML=filtered.map(p=>'<tr><td>'+vfMonth(p.payment_month)+'</td>'+
        '<td>'+E(p.employee)+'</td><td>'+E(p.title||p.description)+'</td><td class="numeric">'+vfMoney(p.amount)+'</td>'+
        '<td><button class="btn btn-sm vf-danger" onclick="App.valesUndoPayment('+p.id+')">Estornar</button></td></tr>').join("")||
        '<tr><td colspan="5">Nenhum desconto registrado.</td></tr>';
    }catch(e){this.toast(e.message,true)}
  },
  async valesUndoPayment(id){
    if(!confirm("Estornar este desconto? A dívida voltará a ter o valor em aberto."))return;
    try{
      await this.api("/api/vales-payments/"+id,"DELETE");
      this.s.valesPaymentHistory=null;await this.valesRefresh();this.toast("Desconto estornado.");
    }catch(e){this.toast(e.message,true)}
  }
});
