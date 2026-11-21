"use strict";
/* Integração do holerite no formulário CONTAS original.
   O servidor revalida valor, funcionários e parcelas antes do cadastro. */
(() => {
  if (!location.pathname.startsWith("/central/modules/contas/")) return;
  const BASE="/central/api/vales-holerites/";
  const $=id=>document.getElementById(id);
  const cents=v=>{const n=Number(String(v??"").replace(",","."));return Number.isFinite(n)&&n>=0?Math.round(n*100):null};
  const amount=v=>(v/100).toFixed(2);
  const br=v=>(v/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().replace(/\s+/g," ").toUpperCase();
  const model={form:null,box:null,staff:null,quote:null,selected:new Set(),original:0,valeId:null,serial:0,busy:false,existing:false};
  async function req(path,payload){
    const res=await fetch(BASE+path,{
      method:payload===undefined?"GET":"POST",credentials:"same-origin",cache:"no-store",
      headers:payload===undefined?{"Accept":"application/json"}:
        {"Content-Type":"application/json","Accept":"application/json"},
      body:payload===undefined?undefined:JSON.stringify(payload)
    });
    const data=await res.json().catch(()=>({erro:"Resposta inválida."}));
    if(!res.ok)throw new Error(data.erro||data.error||"Integração indisponível");
    return data;
  }
  function el(tag,cls,txt){
    const node=document.createElement(tag);if(cls)node.className=cls;
    if(txt!==undefined)node.textContent=txt;
    return node;
  }
  const field=name=>model.form?.elements.namedItem(name)||null;
  function notice(message,type=""){
    const p=model.box?.querySelector(".nh-vales-message");
    if(p){p.textContent=message||"";p.dataset.kind=type}
  }
  function resetDiscount(){
    const p=field("valor"),m=field("nh_vales");
    if(p){p.readOnly=false;p.value=amount(model.original)}
    if(m)m.value="";
    model.quote=null;model.selected=new Set();
  }
  function recalc(){
    if(!model.quote)return;
    const chosen=model.quote.parcelas.filter(p=>model.selected.has(Number(p.id)));
    const discount=chosen.reduce((total,p)=>total+cents(p.amount),0);
    const net=model.original-discount;
    model.box.querySelector(".nh-vales-total").textContent=
      "Líquido original "+br(model.original)+" − vales "+br(discount)+" = "+br(Math.max(0,net));
    if(net<0){
      notice("Os vales ultrapassam o líquido. Desmarque parcelas antes de salvar.","error");
      field("nh_vales").value="";
      field("valor").readOnly=true;
      return;
    }
    const payable=field("valor"),meta=field("nh_vales");
    payable.value=amount(net);payable.readOnly=chosen.length>0;
    meta.value=chosen.length?JSON.stringify({
      original:amount(model.original),selecionadas:chosen.map(p=>Number(p.id)),
      vale_employee_id:model.valeId||null
    }):"";
    model.box.querySelector(".nh-vales-warning").textContent=
      "O PDF permanece original. O desconto será baixado no Vale depois de confirmar o pagamento.";
    if(model.box.querySelector(".nh-vales-message").dataset.kind!=="error")notice("");
  }
  function renderQuote(q){
    model.quote=q;model.selected=new Set(q.selecionadas||[]);
    const list=model.box.querySelector(".nh-vales-installments");
    list.replaceChildren();
    for(const p of q.parcelas||[]){
      const row=el("label","nh-vales-row"),checkbox=el("input");
      checkbox.type="checkbox";checkbox.checked=model.selected.has(Number(p.id));
      checkbox.addEventListener("change",()=>{
        if(checkbox.checked)model.selected.add(Number(p.id));
        else model.selected.delete(Number(p.id));
        recalc();
      });
      const detail=el("span","nh-vales-detail");
      detail.append(el("strong","",p.title||"Vale"),
        el("small","","Parcela "+p.installment+" · "+p.due_month));
      row.append(checkbox,detail,el("b","",br(cents(p.amount))));
      list.append(row);
    }
    if(!q.parcelas?.length)list.append(el("p","nh-vales-muted",
      "Sem parcelas previstas neste mês."));
    if(q.atrasadas?.length){
      list.append(el("p","nh-vales-muted",
        q.atrasadas.length+" parcela(s) de meses anteriores pendente(s). "+
        "Não incluídas automaticamente."));
    }
    if(q.parcelas?.length&&!q.selecionadas?.length)
      notice("Selecione apenas as parcelas que caibam no salário.","warning");
    else notice("");
    recalc();
  }
  function context(){
    if($("isHolerite")?.value!=="sim")return null;
    const employeeId=Number($("payrollEmployeePick")?.value||0)||null;
    const name=employeeId?model.staff?.funcionarios_contas?.find(x=>Number(x.id)===employeeId)?.nome:
      field("funcionario_nome")?.value||field("fornecedor")?.value||"";
    return {employeeId,name,competence:field("competencia")?.value||""};
  }
  async function fetchQuote(ctx,serial){
    if(serial!==model.serial)return;
    notice("Consultando as parcelas dos Vales…");
    const query=new URLSearchParams({
      funcionario_id:String(ctx.employeeId||""),
      competencia:ctx.competence,original:amount(model.original),
      vale_employee_id:String(model.valeId||"")
    });
    try{
      const data=await req("cotacao?"+query);
      if(serial===model.serial)renderQuote(data);
    }catch(e){
      if(serial===model.serial){resetDiscount();notice(e.message,"error")}
    }
  }
  async function refresh(){
    if(model.existing)return;
    const serial=++model.serial,form=model.form;
    if(!form?.isConnected||!model.box)return;
    const payroll=$("isHolerite")?.value==="sim";
    model.box.hidden=!payroll;
    if(!payroll){resetDiscount();return}
    if(!model.staff){
      notice("Consultando cadastros e vínculos…");
      try{model.staff=await req("funcionarios")}
      catch(e){if(serial===model.serial)notice(e.message,"error");return}
      if(serial!==model.serial)return;
    }
    const ctx=context();
    if(!/^\d{4}-\d{2}$/.test(ctx.competence)){
      notice("Informe a competência do holerite.","warning");resetDiscount();return;
    }
    const mapped=model.staff.funcionarios_vales.filter(x=>
      ctx.employeeId && Number(x.contas_employee_id)===ctx.employeeId);
    const suggestions=mapped.length?[]:model.staff.funcionarios_vales.filter(x=>
      !x.contas_employee_id && norm(x.name)===norm(ctx.name));
    const binding=model.box.querySelector(".nh-vales-bind");
    binding.replaceChildren();
    model.valeId=null;
    if(mapped.length){
      binding.append(el("p","nh-vales-muted",
        mapped.length+" registro(s) de Vales vinculado(s) ao funcionário."));
      await fetchQuote(ctx,serial);
      return;
    }
    resetDiscount();
    model.box.querySelector(".nh-vales-installments").replaceChildren();
    model.box.querySelector(".nh-vales-total").textContent="Sem vales aplicados.";
    if(suggestions.length===1){
      const candidate=suggestions[0];
      binding.append(el("p","nh-vales-muted",
        "Funcionário encontrado em Vales: "+candidate.name+". Confirme a associação."));
      const button=el("button","nh-vales-action","Vincular funcionário aos Vales");
      button.type="button";
      button.addEventListener("click",async()=>{
        if(!window.confirm("Confirmar o vínculo de "+candidate.name+
          " com este funcionário?"))return;
        if(ctx.employeeId){
          try{
            await req("vincular",{vale_employee_id:candidate.id,
              contas_employee_id:ctx.employeeId});
            model.staff=null;refresh();
          }catch(e){notice(e.message,"error")}
        }else{
          model.valeId=Number(candidate.id);
          binding.replaceChildren(el("p","nh-vales-muted",
            "Vínculo do novo cadastro confirmado. Será gravado ao salvar."));
          fetchQuote(ctx,serial);
        }
      });
      binding.append(button);
    }else{
      binding.append(el("p","nh-vales-muted",
        "Sem vínculo confirmado. Escolha o funcionário correspondente no controle de Vales."));
      if(ctx.employeeId){
        const available=model.staff.funcionarios_vales.filter(x=>!x.contas_employee_id);
        if(available.length){
          const select=el("select","nh-vales-choice");
          select.setAttribute("aria-label","Funcionário do controle de Vales");
          const choose=el("option","","Escolher funcionário de Vales…");
          choose.value="";select.append(choose);
          for(const person of available){
            const option=el("option","",person.name+" · controle "+person.control_id);
            option.value=String(person.id);select.append(option);
          }
          const btn=el("button","nh-vales-action","Confirmar vínculo");
          btn.type="button";
          btn.addEventListener("click",async()=>{
            const valeId=Number(select.value||0);
            if(!valeId)return notice("Selecione um funcionário dos Vales.","warning");
            const chosen=available.find(x=>Number(x.id)===valeId);
            if(!window.confirm("Confirmar que "+chosen.name+
              " (Vales) é a mesma pessoa do holerite?"))return;
            try{
              await req("vincular",{vale_employee_id:valeId,
                contas_employee_id:ctx.employeeId});
              model.staff=null;refresh();
            }catch(e){notice(e.message,"error")}
          });
          binding.append(select,btn);
        }
      }
    }
  }
  function attach(form){
    model.form=form;model.staff=null;model.quote=null;model.serial++;model.existing=false;
    model.original=cents(field("valor")?.value)??0;model.selected=new Set();model.valeId=null;
    const section=el("section","nh-vales-payroll");section.id="nh-vales-payroll";
    const head=el("header","nh-vales-heading");
    head.append(el("strong","","Vales do funcionário"),
      el("small","","Desconto por competência"));
    const original=el("label","nh-vales-original");
    original.append(el("span","","Líquido ORIGINAL do holerite (R$)"));
    const input=el("input");input.type="number";input.step="0.01";input.min="0";
    input.value=amount(model.original);
    input.addEventListener("input",()=>{
      if(model.existing)return;
      const val=cents(input.value);
      if(val===null){notice("Valor original inválido.","error");return}
      model.original=val;
      if(model.quote)recalc();
      else if(field("valor"))field("valor").value=amount(val);
    });
    original.append(input);
    const status=el("p","nh-vales-message");status.setAttribute("role","status");
    status.setAttribute("aria-live","polite");
    const hidden=el("input");hidden.type="hidden";hidden.name="nh_vales";
    section.append(head,original,el("div","nh-vales-bind"),
      el("div","nh-vales-installments"),el("strong","nh-vales-total"),
      el("p","nh-vales-warning"),status,hidden);
    form.append(section);model.box=section;
    const reset=()=>{model.valeId=null;resetDiscount();refresh()};
    ["isHolerite","payrollEmployeePick","payrollCompetence"].forEach(id=>
      $(id)?.addEventListener("change",reset));
    field("funcionario_nome")?.addEventListener("input",reset);
    field("valor")?.addEventListener("input",()=>{
      const pay=field("valor");
      if(!pay.readOnly){
        const val=cents(pay.value);
        if(val!==null){model.original=val;input.value=amount(val);refresh()}
      }
    });
    const title=String($("dialogTitle")?.textContent||"");
    const editing=/^(Editar conta|Revisar cadastro pelo PDF)/.test(title);
    const accountId=editing && typeof selected!=="undefined"?Number(selected):0;
    // Não reutilizar o ID de uma linha anteriormente selecionada quando
    // o holerite atual foi aberto pelo cadastro do funcionário.
    const record=typeof accounts!=="undefined"&&Array.isArray(accounts)?
      accounts.find(x=>Number(x.id)===accountId):null;
    const sameAccount=record&&
      cents(record.valor)===cents(field("valor")?.value)&&
      norm(record.fornecedor)===norm(field("fornecedor")?.value);
    if(editing && sameAccount && Number.isSafeInteger(accountId) && accountId>0){
      const serial=++model.serial;
      req("conta?account_id="+accountId).then(data=>{
        if(serial!==model.serial||!model.form?.isConnected)return;
        if(!data.descontos?.length){refresh();return}
        model.existing=true;
        model.original=cents(data.descontos[0].original_amount);
        input.value=amount(model.original);input.readOnly=true;
        field("valor").readOnly=true;
        const list=section.querySelector(".nh-vales-installments");
        list.replaceChildren();
        for(const row of data.descontos){
          list.append(el("p","nh-vales-muted",
            "Parcela "+row.vale_installment_id+" · −"+br(cents(row.amount))+
            " · "+(row.status==="settled"?"Baixada":"Reservada / conciliar")));
        }
        const total=data.descontos.reduce((sum,row)=>sum+cents(row.amount),0);
        section.querySelector(".nh-vales-total").textContent=
          "Original "+br(model.original)+" − vales "+br(total)+
          " = "+br(model.original-total);
        section.querySelector(".nh-vales-bind").replaceChildren(
          el("p","nh-vales-muted",
            "Descontos deste holerite já vinculados. O valor e a competência estão protegidos."));
        section.querySelector(".nh-vales-warning").textContent=
          "Para alterar descontos já reservados, revise a conciliação antes de editar a conta.";
      }).catch(e=>{
        if(serial===model.serial)notice(e.message,"error");
      });
    }else refresh();
  }
  function inspect(){
    const form=$("accountForm"),visible=$("backdrop")?.classList.contains("show");
    if(!visible||!form){model.serial++;model.form=null;model.box=null;model.staff=null;return}
    if(form!==model.form)attach(form);
  }
  const overlay=$("backdrop");if(!overlay)return;
  new MutationObserver(inspect).observe(overlay,{
    attributes:true,attributeFilter:["class"],childList:true,subtree:true
  });
  inspect();
  // Pagamentos lançados no aplicativo original continuam conciliáveis.
  // A chamada verifica primeiro o banco CONTAS e só então grava o desconto.
  window.setTimeout(()=>{
    req("reconciliar",{todos:true}).then(result=>{
      const problems=(result.pendentes||[]).filter(p=>p.status==="precisa_conferencia"||
        (p.erros||[]).length);
      if(!problems.length)return;
      const banner=el("aside","nh-vales-reconcile-warning",
        "Algumas baixas de vales precisam de conferência. Abra o holerite "+
        "e consulte o histórico de descontos.");
      banner.setAttribute("role","status");
      document.body.append(banner);
    }).catch(()=>{ /* Não impedir acesso à tela nem emitir pagamentos duplicados. */ });
  },1300);
})();
