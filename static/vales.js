"use strict";
/* Vales de funcionários: pessoas, novas dívidas, parcelas previstas e descontos reais. */
const vfMoney=n=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(n||0));
const vfNum=v=>{
  const s=String(v??"").trim().replace(/\s/g,"");
  return Number(s.includes(",")?s.replace(/\./g,"").replace(",","."):s);
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
          '<button class="btn btn-sm" onclick="App.valesManageDebt('+i.employeeId+')">Gerenciar</button></td></tr>';
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
    const totalsRows=all.filter(emp=>selected==="all"||String(emp.id)===selected).map(emp=>
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
    const detailEmp=all.find(e=>e.id===this.s.valesDetailEmployee&&
      (selected==="all"||String(e.id)===selected));
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
      '<span>'+all.length+' funcionário(s) cadastrado(s)</span></div>'+
      '<table class="vf-summary-table"><thead><tr><th>Funcionário</th><th>Total emprestado</th>'+
      '<th>Total descontado</th><th>Em aberto</th><th>Vales</th><th>Ações</th></tr></thead>'+
      '<tbody>'+(totalsRows||'<tr><td colspan="6" class="vf-table-empty">Nenhum funcionário encontrado.</td></tr>')+
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
    const value=existing?.amount||"";
    const first=existing?.first_month||vfCurrentMonth();
    const count=existing?.installments?.length||1;
    this.s.valesDebtCtx={employeeId,debtId,plan:existing?.installments.map(i=>({month:i.due_month,amount:i.amount}))||[]};
    const form='<div class="vf-form-grid">'+
      vfField("Funcionário",'<input value="'+E(emp.name)+'" disabled>')+
      vfField("Título da dívida *",vfInput("title",existing?.title||existing?.description||"",'required maxlength="160" placeholder="Ex.: Adiantamento salarial" '+(existing?"disabled":"")))+
      vfField("Descrição (opcional)",vfInput("description",existing?.description||"",'maxlength="500" placeholder="Informações adicionais" '+(existing?"disabled":"")))+
      vfField("Valor total (R$)",vfInput("amount",value,'required inputmode="decimal" '+(existing?"readonly":"oninput=&quot;App.valesPropose()&quot;")))+
      vfField("Primeiro desconto (mês/ano)",'<input type="month" name="first_month" value="'+E(first)+'" required onchange="App.valesPropose()">')+
      vfField("Número de parcelas",'<input type="number" min="1" max="120" step="1" name="count" value="'+count+'" required oninput="App.valesPropose()">')+
      vfField("Valor desejado por parcela (R$)",vfInput("each","",'inputmode="decimal" placeholder="Automático (parcelas iguais)" oninput="App.valesPropose()"'))+
      '</div><p class="secondary-text">A sugestão divide igualmente. Você pode alterar o valor e o mês de cada parcela antes de salvar.</p>'+
      '<div id="vf-plan-editor" class="vf-plan-editor"></div><div id="vf-plan-total" class="vf-plan-total"></div>';
    this.valesOpenModal(existing?"Dividir / ajustar parcelas":"Novo vale",
      "Funcionário: "+emp.name+" · descontos mensais sem necessidade de informar o dia.",
      form,"valesSaveDebt",existing?"Salvar parcelas":"Cadastrar vale");
    if(existing)this.valesShowPlan(this.s.valesDebtCtx.plan);
    else this.valesPropose();
  },
  valesPropose(){
    const form=document.getElementById("vf-form");if(!form||!this.s.valesDebtCtx)return;
    const fd=new FormData(form);
    const amount=vfNum(fd.get("amount")),each=String(fd.get("each")||"").trim();
    const count=Number(fd.get("count")),first=fd.get("first_month");
    if(!Number.isFinite(amount)||amount<=0||!Number.isInteger(count)||count<1||count>120||!/^\d{4}-\d{2}$/.test(first)){
      document.getElementById("vf-plan-editor").innerHTML='<p class="secondary-text">Informe valor, mês inicial e número de parcelas.</p>';
      document.getElementById("vf-plan-total").textContent="";this.s.valesDebtCtx.plan=[];return;
    }
    const cents=Math.round(amount*100),basic=Math.floor(cents/count),extra=cents%count;
    if(cents<count){this.toast("Número de parcelas maior que o valor em centavos.",true);return}
    let parts=Array.from({length:count},(_,i)=>basic+(i<extra?1:0));
    if(each){
      const fixed=Math.round(vfNum(each)*100);
      if(!(fixed>0&&fixed*(count-1)<cents)){
        document.getElementById("vf-plan-editor").innerHTML='<p class="secondary-text">Valor por parcela inválido para a quantidade escolhida.</p>';
        this.s.valesDebtCtx.plan=[];return;
      }
      parts=Array(count-1).fill(fixed).concat(cents-fixed*(count-1));
    }
    const plan=parts.map((c,i)=>({month:vfAddMonth(first,i),amount:(c/100).toFixed(2)}));
    this.valesShowPlan(plan);
  },
  valesShowPlan(plan){
    this.s.valesDebtCtx.plan=plan;
    document.getElementById("vf-plan-editor").innerHTML='<table><thead><tr><th>Parcela</th><th>Mês de desconto</th><th>Valor (R$)</th></tr></thead><tbody>'+
      plan.map((p,i)=>'<tr><td>'+Number(i+1)+'/'+plan.length+'</td>'+
      '<td><input type="month" value="'+E(p.month)+'" onchange="App.valesEditPlan('+i+',&quot;month&quot;,this.value)"></td>'+
      '<td><input type="text" inputmode="decimal" value="'+E(p.amount)+'" onchange="App.valesEditPlan('+i+',&quot;amount&quot;,this.value)"></td></tr>').join("")+
      '</tbody></table>';
    this.valesPlanTotal();
  },
  valesEditPlan(index,key,value){
    const ctx=this.s.valesDebtCtx;if(!ctx?.plan[index])return;
    ctx.plan[index][key]=value;this.valesPlanTotal();
  },
  valesPlanTotal(){
    const ctx=this.s.valesDebtCtx,field=document.querySelector('#vf-form input[name="amount"]');
    const planned=ctx.plan.reduce((s,p)=>s+Math.round(vfNum(p.amount)*100||0),0)/100;
    const original=vfNum(field?.value);
    const good=Number.isFinite(original)&&Math.round(original*100)===Math.round(planned*100);
    document.getElementById("vf-plan-total").innerHTML=
      'Soma das parcelas: <b>'+vfMoney(planned)+'</b> / Total do vale: <b>'+vfMoney(original)+'</b>'+
      (good?'<span class="vf-paid">Confere</span>':'<strong class="vf-error"> Ajuste os valores para igualar o total.</strong>');
  },
  async valesSaveDebt(){
    const form=document.getElementById("vf-form");if(!form?.reportValidity())return;
    const ctx=this.s.valesDebtCtx;
    if(!ctx)return;
    const fd=new FormData(form);
    const installments=ctx.plan.map(p=>({month:p.month,amount:String(vfNum(p.amount).toFixed(2))}));
    const sum=Math.round(installments.reduce((s,p)=>s+Number(p.amount),0)*100);
    const amount=Math.round(vfNum(fd.get("amount"))*100);
    if(!installments.length||sum!==amount){this.toast("As parcelas precisam somar exatamente o valor do vale.",true);return}
    if(installments[0].month!==fd.get("first_month")){this.toast("A primeira parcela precisa começar no mês selecionado.",true);return}
    try{
      const id=ctx.debtId;
      const payload=id?{installments}:{
        title:fd.get("title"),description:fd.get("description"),
        amount:fd.get("amount"),first_month:fd.get("first_month"),installments
      };
      await this.api(id?"/api/vales-debts/"+id+"/plan":"/api/vales-employees/"+ctx.employeeId+"/debts",id?"PUT":"POST",payload);
      this.closeModal();this.s.valeExpandedDebt=id||null;
      await this.valesRefresh();this.toast(id?"Parcelas atualizadas.":"Vale cadastrado.");
    }catch(e){this.toast(e.message,true)}
  },
  valesDebtTitleForm(id){
    if(!this.canOpenForm())return;
    const d=this.s.valesData?.employees.flatMap(e=>e.debts).find(x=>x.id===id);
    if(!d)return;
    this.s.valesDetailsId=id;
    this.valesOpenModal("Editar título da dívida","Apenas o título e a descrição serão alterados, sem recalcular valores ou parcelas.",
      vfField("Título *",vfInput("title",d.title||d.description||"",'required maxlength="160"'))+
      vfField("Descrição (opcional)",vfInput("description",d.description||"",'maxlength="500"')),
      "valesSaveDebtTitle","Salvar alterações");
  },
  async valesSaveDebtTitle(){
    const form=document.getElementById("vf-form");
    if(!form?.reportValidity())return;
    try{
      const fd=new FormData(form);
      await this.api("/api/vales-debts/"+this.s.valesDetailsId,"PATCH",
        {title:fd.get("title"),description:fd.get("description")});
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
      vfField("Valor realmente descontado (R$)",vfInput("amount",item.remaining,'required inputmode="decimal"'))+'</div>'+
      vfField("Observações (opcional)",vfInput("notes","",'maxlength="500"'));
    this.valesOpenModal("Registrar desconto","Este valor reduzirá a dívida do funcionário.",body,"valesSavePayment","Confirmar desconto");
  },
  async valesSavePayment(){
    const form=document.getElementById("vf-form");if(!form?.reportValidity())return;
    try{
      const f=new FormData(form);
      await this.api("/api/vales-installments/"+this.s.valesPaymentCtx.id+"/payments","POST",
        {month:f.get("month"),amount:f.get("amount"),notes:f.get("notes")});
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
