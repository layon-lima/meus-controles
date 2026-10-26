"use strict";
/* Vales de funcionários: pessoas, novas dívidas, parcelas previstas e descontos reais. */
const vfMoney=n=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(n||0));
const vfNum=v=>{
  const s=String(v??"").trim().replace(/\s/g,"");
  return Number(s.includes(",")?s.replace(/\./g,"").replace(",","."):s);
};
const vfCurrentMonth=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")};
const vfMonth=m=>m?m.slice(5,7)+"/"+m.slice(0,4):"—";
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
    const selected=this.s.valesSelected||"all";
    const t=data.totals;
    const employees=data.employees.filter(p=>
      (selected==="all"||String(p.id)===String(selected))&&
      (this.s.valesShowArchived||p.active));
    const cards=employees.map(emp=>{
      const dues=emp.debts.map(d=>{
        const expanded=this.s.valeExpandedDebt===d.id;
        const remains=Number(d.remaining)>0;
        const schedule=expanded?'<div class="vf-installment-table"><table><thead><tr>'+
          '<th>Parcela</th><th>Mês de desconto</th><th>Previsto</th><th>Descontado</th><th>Restante</th><th>Ação</th>'+
          '</tr></thead><tbody>'+d.installments.map(i=>'<tr>'+
          '<td>'+i.installment_number+'/'+d.installments.length+'</td>'+
          '<td>'+vfMonth(i.due_month)+'</td><td class="numeric">'+vfMoney(i.amount)+'</td>'+
          '<td class="numeric">'+vfMoney(i.paid)+'</td><td class="numeric">'+vfMoney(i.remaining)+'</td>'+
          '<td>'+(Number(i.remaining)>0?'<button class="btn btn-sm" onclick="App.valesPaymentForm('+i.id+')">Registrar desconto</button>':
          '<span class="vf-paid">Pago</span>')+'</td></tr>').join("")+
          '</tbody></table></div>':"";
        return '<div class="vf-debt">'+
          '<div class="vf-debt-head"><div><b>'+E(d.title||d.description)+'</b>'+
          (d.description&&d.description!==(d.title||d.description)?'<div class="vf-debt-description">'+E(d.description)+'</div>':'')+
          '<div class="secondary-text">'+d.installments.length+' parcela(s) · início '+vfMonth(d.first_month)+'</div></div>'+
          '<div class="vf-debt-money"><span>'+vfMoney(d.amount)+'</span>'+
          '<small>Em aberto: <b>'+vfMoney(d.remaining)+'</b></small></div>'+
          '<div class="vf-debt-actions"><button class="btn btn-sm" onclick="App.valesToggleDebt('+d.id+')">'+
          (expanded?"Ocultar parcelas":"Ver parcelas")+'</button>'+
          '<button class="btn btn-sm" onclick="App.valesDebtTitleForm('+d.id+')">Editar título</button>'+
          (!Number(d.paid)?'<button class="btn btn-sm" onclick="App.valesDebtForm('+emp.id+','+d.id+')">Dividir / ajustar</button>':"")+
          (remains?'<button class="btn btn-sm btn-primary" onclick="App.valesSettleForm('+d.id+')">Quitar dívida</button>':
          '<span class="vf-paid">Quitado</span>')+
          (!Number(d.paid)?'<button class="btn btn-sm vf-danger" onclick="App.valesDeleteDebt('+d.id+')">Excluir</button>':"")+
          '</div></div>'+schedule+'</div>';
      }).join("");
      return '<section class="vf-person panel">'+
        '<div class="vf-person-header"><div><h3>'+E(emp.name)+'</h3>'+
        (!emp.active?'<span class="vf-archived">Arquivado</span>':'')+
        '<p>Emprestado '+vfMoney(emp.lent)+' · Pago '+vfMoney(emp.paid)+'</p></div>'+
        '<div class="vf-person-controls"><div class="vf-balance"><small>Saldo a descontar</small><strong>'+vfMoney(emp.remaining)+'</strong></div>'+
        (emp.active?'<button class="btn btn-sm btn-primary" onclick="App.valesDebtForm('+emp.id+')">'+icon("plus")+' Novo vale</button>':"")+
        '<button class="btn btn-sm" onclick="App.valesSetActive('+emp.id+','+(!emp.active)+')">'+
        (emp.active?"Arquivar funcionário":"Reativar funcionário")+'</button></div></div>'+
        (emp.debts.length?'<div class="vf-debts">'+dues+'</div>':
        '<p class="vf-empty">Nenhum vale registrado para este funcionário.</p>')+'</section>';
    }).join("");
    const choices=data.employees.map(e=>'<option value="'+e.id+'"'+
      (String(e.id)===String(selected)?" selected":"")+'>'+E(e.name)+'</option>').join("");
    const schedule=data.schedule.filter(i=>Number(i.remaining)>0).slice(0,120);
    const calendar=schedule.length?'<div class="vf-month-grid"><table><thead><tr>'+
      '<th>Competência</th><th>Funcionário</th><th>Vale</th><th>Parcela</th><th>A descontar</th>'+
      '</tr></thead><tbody>'+schedule.map(i=>'<tr><td>'+vfMonth(i.due_month)+'</td>'+
      '<td>'+E(i.employee)+'</td><td>'+E(i.debt_title||i.debt_description)+'</td>'+
      '<td>'+i.installment_number+'</td><td class="numeric">'+vfMoney(i.remaining)+'</td></tr>').join("")+
      '</tbody></table></div>':'<p class="vf-empty">Nenhuma parcela pendente.</p>';
    const payments=(this.s.valesPaymentHistory||[]).map(p=>'<tr><td>'+vfMonth(p.payment_month)+'</td>'+
      '<td>'+E(p.employee)+'</td><td>'+E(p.title||p.description)+'</td><td>'+vfMoney(p.amount)+'</td>'+
      '<td><button class="btn btn-sm vf-danger" onclick="App.valesUndoPayment('+p.id+')">Estornar</button></td></tr>').join("");
    document.getElementById("main").innerHTML='<div class="vf-page">'+
      '<div class="vf-heading"><div><div class="eyebrow">CONTROLE DE VALES</div><h2>'+E(c.name)+'</h2>'+
      '<p>Empréstimos a funcionários, descontos por mês e parcelamentos.</p></div>'+
      '<button class="btn btn-primary" onclick="App.valesEmployeeForm()">'+icon("plus")+' Cadastrar funcionário</button></div>'+
      '<div class="vf-stats"><div><small>Funcionários ativos</small><strong>'+t.active+'</strong></div>'+
      '<div><small>Total emprestado</small><strong>'+vfMoney(t.lent)+'</strong></div>'+
      '<div><small>Total descontado</small><strong>'+vfMoney(t.paid)+'</strong></div>'+
      '<div><small>Em aberto</small><strong>'+vfMoney(t.remaining)+'</strong></div></div>'+
      '<div class="vf-toolbar"><label>Funcionário <select onchange="App.valesSelectEmployee(this.value)">'+
      '<option value="all">Todos</option>'+choices+'</select></label>'+
      '<label class="vf-archive-option"><input type="checkbox" '+(this.s.valesShowArchived?"checked":"")+
      ' onchange="App.s.valesShowArchived=this.checked;App.renderValesView()"> Mostrar arquivados</label></div>'+
      '<div class="vf-people">'+(cards||'<div class="vf-empty">Nenhum funcionário encontrado. Cadastre o primeiro.</div>')+'</div>'+
      '<details class="panel vf-future" '+(this.s.valesCalendarOpen?"open":"")+' ontoggle="App.s.valesCalendarOpen=this.open">'+
      '<summary>Calendário de descontos previstos ('+schedule.length+' parcelas em aberto exibidas)</summary>'+calendar+'</details>'+
      '<details class="panel vf-history" ontoggle="if(this.open) App.valesLoadPayments()">'+
      '<summary>Histórico de descontos efetivados</summary>'+
      '<div class="vf-month-grid"><table><thead><tr><th>Mês pago</th><th>Funcionário</th><th>Vale</th><th>Valor</th><th>Ação</th></tr></thead>'+
      '<tbody id="vf-payment-history">'+(payments||'<tr><td colspan="5">Abra para carregar o histórico.</td></tr>')+'</tbody></table></div></details>'+
      '</div>';
  },
  valesSelectEmployee(value){this.s.valesSelected=value;this.renderValesView()},
  valesToggleDebt(id){this.s.valeExpandedDebt=this.s.valeExpandedDebt===id?null:id;this.renderValesView()},
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
      if(tbody)tbody.innerHTML=this.s.valesPaymentHistory.map(p=>'<tr><td>'+vfMonth(p.payment_month)+'</td>'+
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
