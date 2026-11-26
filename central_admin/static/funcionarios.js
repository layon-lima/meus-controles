"use strict";
/* Central / Funcionários: saldos em aberto e histórico de pagamentos separado.
 * Sem vínculos manuais nesta tela. Gerenciamento de Pix separado.
 * A consulta lê os motores originais e nunca cria descontos/pagamentos.
 */
(() => {
  if (!location.pathname.startsWith("/central/modules/funcionarios")) return;
  const $=id=>document.getElementById(id);
  const state={data:null,cards:new Map(),openId:null,loading:false,
    filters:{q:"",status:"pending"}};
  const fmt=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
  const number=value=>{
    const n=Number(value);
    return Number.isFinite(n)&&n>0?n:0;
  };
  const br=value=>fmt.format(number(value));
  const norm=value=>String(value||"").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").trim();
  function e(tag,cls,text){
    const element=document.createElement(tag);
    if(cls)element.className=cls;
    if(text!==undefined)element.textContent=String(text);
    return element;
  }
  function setText(id,value){$(id).textContent=String(value??"—")}
  function initials(name){
    const words=String(name||"").trim().split(/\s+/);
    return ((words[0]||"?")[0]+(words.length>1?words[words.length-1][0]:"")).toUpperCase();
  }
  function safeDate(value){
    const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match?match[3]+"/"+match[2]+"/"+match[1]:"—";
  }
  function monthLabel(value){
    const match=String(value||"").match(/^(\d{4})-(\d{2})$/);
    return match?match[2]+"/"+match[1]:"—";
  }
  function openAmounts(person){
    // Não incluir contas, holerites ou vales quitados nos saldos em aberto.
    // Os descontos reservados já estão no líquido do holerite e não
    // podem ser somados novamente a "Vales a descontar".
    const holerites=(person.holerites||[]).filter(a=>!a.paga&&number(a.valor)>0);
    const contas=(person.outras_contas||[]).filter(a=>!a.paga&&number(a.valor)>0);
    const vales=(person.parcelas||[]).filter(v=>number(v.saldo_a_descontar)>0);
    const pagar=[...holerites,...contas].reduce((s,a)=>s+number(a.valor),0);
    const descontar=vales.reduce((s,v)=>s+number(v.saldo_a_descontar),0);
    return {holerites,contas,vales,pagar,descontar};
  }
  function rows(person){
    const open=openAmounts(person),result=[];
    for(const h of open.holerites){
      result.push({tipo:"Holerite",descricao:"Holerite · "+monthLabel(h.competencia),
        referencia:"Venc. "+safeDate(h.vencimento),valor:number(h.valor),
        order:h.vencimento||h.competencia||""});
    }
    for(const a of open.contas){
      result.push({tipo:"Conta",descricao:a.documento||a.referencia||a.fornecedor||"Conta do funcionário",
        referencia:"Venc. "+safeDate(a.vencimento),valor:number(a.valor),
        order:a.vencimento||""});
    }
    for(const v of open.vales){
      result.push({tipo:"Vale",descricao:v.titulo||"Vale do funcionário",
        referencia:"Parcela "+v.parcela+" · "+monthLabel(v.competencia),
        valor:number(v.saldo_a_descontar),order:v.competencia||""});
    }
    result.sort((a,b)=>a.order.localeCompare(b.order)||a.tipo.localeCompare(b.tipo,"pt-BR"));
    return result;
  }
  function makeTable(person){
    const data=rows(person);
    const section=e("section","nhf-detail-section nhf-open-only");
    const head=e("div","nhf-detail-heading");
    head.append(e("strong","","Valores em aberto"),
      e("span","nhf-section-count",data.length+" lançamento(s)"));
    section.append(head);
    if(!data.length){
      section.append(e("p","nhf-muted","Nenhum valor em aberto para este funcionário."));
      return section;
    }
    const table=e("table","nhf-open-table"),thead=e("thead"),heading=e("tr");
    for(const title of ["Tipo","Descrição","Competência / vencimento","Valor"]){
      heading.append(e("th","",title));
    }
    thead.append(heading);table.append(thead);
    const body=e("tbody");
    for(const item of data){
      const tr=e("tr");
      tr.append(e("td","nhf-type",item.tipo),
        e("td","",item.descricao),
        e("td","nhf-reference",item.referencia),
        e("td","nhf-value",br(item.valor)));
      body.append(tr);
    }
    table.append(body);section.append(table);
    return section;
  }
  function paidRows(person){
    const result=[];
    for(const [tipo,accounts] of [["Holerite",person.holerites||[]],["Conta",person.outras_contas||[]]]){
      for(const a of accounts){
        if(!a.paga)continue;
        result.push({tipo,descricao:tipo==="Holerite"?"Holerite · "+monthLabel(a.competencia):
          a.documento||a.referencia||a.fornecedor||"Conta do funcionário",
          data:a.data_pagamento||"",valor:number(a.valor),id:a.id});
      }
    }
    return result.sort((a,b)=>b.data.localeCompare(a.data)||Number(b.id)-Number(a.id));
  }
  function makeHistory(person){
    const data=paidRows(person);
    const section=e("section","nhf-detail-section nhf-open-only");
    const head=e("div","nhf-detail-heading");
    head.append(e("strong","","Histórico de pagamentos"),
      e("span","nhf-section-count",data.length+" lançamento(s) quitado(s)"));
    section.append(head);
    if(!data.length){
      section.append(e("p","nhf-muted","Nenhum pagamento registrado para este funcionário."));
      return section;
    }
    const table=e("table","nhf-open-table"),thead=e("thead"),heading=e("tr");
    for(const title of ["Tipo","Descrição","Data do pagamento","Valor quitado"]){
      heading.append(e("th","",title));
    }
    thead.append(heading);table.append(thead);
    const body=e("tbody");
    for(const item of data){
      const tr=e("tr");
      tr.append(e("td","nhf-type",item.tipo),e("td","",item.descricao),
        e("td","nhf-reference",safeDate(item.data)),e("td","nhf-value",br(item.valor)));
      body.append(tr);
    }
    table.append(body);section.append(table);
    return section;
  }
  // Operações no mesmo motor original, sem uma segunda carteira de vales.
  let valeBusy=false;
  async function valeApi(payload,id){
    const response=await fetch("/central/api/funcionarios/vales"+(payload?"":"?funcionario_id="+encodeURIComponent(id)),{
      method:payload?"POST":"GET",credentials:"same-origin",cache:"no-store",
      headers:{"Accept":"application/json","Content-Type":"application/json"},
      ...(payload?{body:JSON.stringify(payload)}:{})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw new Error(data.erro||"Não foi possível operar os vales.");
    return data;
  }
  const currentMonth=()=>new Date().toLocaleDateString("sv-SE",{year:"numeric",month:"2-digit",timeZone:"America/Sao_Paulo"});
  const moneyInput=value=>{
    let raw=String(value??"").trim().replace(/\s/g,"");
    if(raw.includes(","))raw=raw.replace(/\./g,"").replace(",",".");
    if(!/^\d+(?:\.\d{1,2})?$/.test(raw)||Number(raw)<=0||Number(raw)>1e9)throw new Error("Informe um valor positivo com até duas casas decimais.");
    return Number(raw).toFixed(2);
  };
  function valeButton(label,fn,cls="nhf-mini"){
    const b=e("button",cls,label);b.type="button";b.addEventListener("click",fn);return b;
  }
  function valeDialog(title){
    const old=$("nhfValeDialog");if(old){old.close();old.remove();}
    const dialog=e("dialog","nhf-vale-dialog");dialog.id="nhfValeDialog";
    const head=e("div","nhf-detail-heading"),body=e("div","nhf-vale-body");
    head.append(e("strong","",title),valeButton("Fechar",()=>{if(!valeBusy)dialog.close();}));
    dialog.append(head,body);document.body.append(dialog);
    dialog.addEventListener("cancel",event=>{if(valeBusy)event.preventDefault();});
    dialog.addEventListener("close",()=>dialog.remove());
    dialog.showModal();return {dialog,body};
  }
  function field(form,label,name,type="text",value="",required=true){
    const wrap=e("label","nhf-vale-field"),input=e("input","");
    input.name=name;input.type=type;input.value=String(value??"");input.required=required;
    if(type==="text"&&(name==="amount"||name==="each"))input.inputMode="decimal";
    wrap.append(e("span","",label),input);form.append(wrap);return input;
  }
  function planEditor(form,principal,initial){
    const box=e("div","nhf-vale-plan");form.append(box);
    const plan=initial.map(p=>({...p}));
    function paint(){
      box.replaceChildren();
      for(const [idx,p] of plan.entries()){
        const line=e("div","nhf-vale-plan-row");
        const m=e("input",""),v=e("input","");m.type="month";m.required=true;m.value=p.month;v.type="text";v.required=true;v.inputMode="decimal";v.value=p.amount;
        m.addEventListener("input",()=>p.month=m.value);v.addEventListener("input",()=>p.amount=v.value);
        line.append(e("span","",String(idx+1)),m,v,valeButton("−",()=>{if(plan.length>1){plan.splice(idx,1);paint();}}));
        box.append(line);
      }
      box.append(valeButton("+ Parcela",()=>{if(plan.length<120){plan.push({month:nextMonth(plan.at(-1).month),amount:""});paint();}}));
    }
    paint();
    return ()=>{const rows=plan.map(p=>({month:p.month,amount:moneyInput(p.amount)}));
      if(rows.reduce((n,p)=>n+Math.round(Number(p.amount)*100),0)!==Math.round(Number(principal)*100))throw new Error("A soma das parcelas precisa ser igual ao valor do vale.");
      return rows;};
  }
  function nextMonth(month,step=1){
    const [y,m]=month.split("-").map(Number),index=y*12+m-1+step;
    return String(Math.floor(index/12)).padStart(4,"0")+"-"+String(index%12+1).padStart(2,"0");
  }
  function splitPlan(amount,month,count){
    const cents=Math.round(Number(amount)*100),base=Math.floor(cents/count),rest=cents%count;
    if(!Number.isInteger(count)||count<1||count>120||base<1)throw new Error("Quantidade de parcelas inválida.");
    return Array.from({length:count},(_,i)=>({month:nextMonth(month,i),amount:((base+(i<rest?1:0))/100).toFixed(2)}));
  }
  async function saveVale(dialog,payload,button){
    if(valeBusy)return;
    valeBusy=true;button.disabled=true;
    try{
      const result=await valeApi(payload);
      dialog.close();
      state.filters.q="";$("search").value="";
      state.filters.status="all";$("statusFilter").value="all";
      state.openId=result.funcionario_id;
      pixFeedback("Vale atualizado com sucesso.");
      await refresh();
    }catch(err){
      let feedback=dialog.querySelector(".nhf-vale-error");
      if(!feedback){feedback=e("p","nhf-failed nhf-vale-error");dialog.querySelector(".nhf-vale-body").append(feedback);}
      feedback.textContent=err.message;
    }
    finally{valeBusy=false;button.disabled=false;}
  }
  function addVale(preselected){
    if(!state.data)return pixFeedback("Carregue os funcionários primeiro.",true);
    const {dialog,body}=valeDialog("Adicionar vale");
    const form=e("form","nhf-vale-form");body.append(form);
    const select=e("select",""),wrap=e("label","nhf-vale-field");
    select.required=true;select.name="funcionario_id";
    const none=e("option","","Selecione o funcionário");none.value="";select.append(none);
    for(const person of state.data.funcionarios.slice().sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR"))){
      const opt=e("option","",person.nome);opt.value=String(person.id);select.append(opt);
    }
    if(preselected)select.value=String(preselected);
    wrap.append(e("span","","Funcionário"),select);form.append(wrap);
    const title=field(form,"Título do vale","title","text","Vale");
    title.maxLength=160;
    const desc=field(form,"Observação (opcional)","description","text","",false);desc.maxLength=500;
    const amount=field(form,"Valor (R$)","amount"),first=field(form,"Primeiro desconto","first_month","month",currentMonth());
    const count=field(form,"Número de parcelas","count","number","1");count.min="1";count.max="120";count.step="1";
    const preview=e("div","nhf-vale-plan-preview"),generate=valeButton("Conferir / ajustar parcelas",()=>{
      try{preview.replaceChildren();const principal=moneyInput(amount.value);
        form._plan=planEditor(preview,principal,splitPlan(principal,first.value,Number(count.value)));
      }catch(err){pixFeedback(err.message,true);}
    });
    const reset=()=>{preview.replaceChildren();form._plan=null;};
    for(const input of [amount,first,count])input.addEventListener("input",reset);
    form.append(generate,preview);
    const save=e("button","nhf-btn","Salvar vale");save.type="submit";form.append(save);
    form.addEventListener("submit",event=>{
      event.preventDefault();
      try{
        const principal=moneyInput(amount.value),n=Number(count.value);
        const payload={action:"add",funcionario_id:Number(select.value),title:title.value,description:desc.value,amount:principal,first_month:first.value,count:n};
        if(form._plan)payload.installments=form._plan();
        else splitPlan(principal,first.value,n);
        saveVale(dialog,payload,save);
      }catch(err){pixFeedback(err.message,true);}
    });
  }
  function registerValeEmployee(){
    const {dialog,body}=valeDialog("Cadastrar funcionário para vales"),form=e("form","nhf-vale-form");body.append(form);
    const name=field(form,"Nome completo","name");name.maxLength=160;
    const save=e("button","nhf-btn","Cadastrar");save.type="submit";form.append(save);
    form.addEventListener("submit",event=>{event.preventDefault();saveVale(dialog,{action:"register",name:name.value},save);});
  }
  async function confirmVale(message){
    return window.NHConfirm?.ask?await window.NHConfirm.ask(message,"Confirmar operação"):window.confirm(message);
  }
  async function manageVales(person){
    const {dialog,body}=valeDialog("Vales · "+person.nome);
    body.append(e("p","nhf-muted","Consultando lançamentos…"));
    try{
      const data=await valeApi(null,person.id);if(!dialog.open)return;
      body.replaceChildren(valeButton("+ Adicionar vale",()=>addVale(person.id),"nhf-btn"));
      const mutate=async(payload,b,message)=>{
        if(message&&!(await confirmVale(message)))return;
        saveVale(dialog,{funcionario_id:person.id,...payload},b);
      };
      function editForm(action,record,title,build){
        const next=valeDialog(title),form=e("form","nhf-vale-form");next.body.append(form);
        const get=build(form);const save=e("button","nhf-btn","Salvar");save.type="submit";form.append(save);
        form.addEventListener("submit",event=>{event.preventDefault();try{
          saveVale(next.dialog,{action,id:record.id,funcionario_id:person.id,...get()},save);
        }catch(err){pixFeedback(err.message,true);}});
      }
      if(!data.cadastros.length)body.append(e("p","nhf-muted","Nenhum vale cadastrado. Adicione o primeiro."));
      for(const record of data.cadastros){
        const status=e("div","nhf-vale-actions");
        status.append(e("strong","",record.active?"Cadastro ativo":"Cadastro arquivado"),
          valeButton(record.active?"Arquivar cadastro":"Reativar cadastro",event=>mutate({action:"active",id:record.id,active:!record.active},event.currentTarget,"Alterar status deste cadastro de vales?")));
        body.append(status);
        for(const debt of record.debts){
          const section=e("section","nhf-vale-record");
          section.append(e("strong","",debt.title||"Vale"),e("p","nhf-muted",safeDate(debt.created_at)+" · Valor "+br(debt.amount)+" · Descontado "+br(debt.paid)+" · Saldo "+br(debt.remaining)));
          if(debt.description)section.append(e("p","",debt.description));
          const actions=e("div","nhf-vale-actions");
          actions.append(valeButton("Editar descrição",()=>editForm("edit",debt,"Editar vale",form=>{
            const t=field(form,"Título","title","text",debt.title),d=field(form,"Observação","description","text",debt.description,false);
            return ()=>({title:t.value,description:d.value});
          })));
          const reserved=debt.installments.some(i=>number(i.reservado)>0);
          if(!reserved&&!number(debt.paid)){
            actions.append(valeButton("Ajustar parcelas",()=>editForm("plan",debt,"Ajustar parcelas",form=>{
              const read=planEditor(form,debt.amount,debt.installments.map(i=>({month:i.due_month,amount:i.amount})));
              return ()=>({installments:read()});
            })));
            actions.append(valeButton("Excluir vale",event=>mutate({action:"delete",id:debt.id},event.currentTarget,"Excluir este vale sem descontos registrados?")));
          }
          if(!reserved&&number(debt.remaining))actions.append(valeButton("Quitar vale",()=>editForm("settle",debt,"Quitar vale",form=>{
            const m=field(form,"Competência da quitação","month","month",currentMonth());return ()=>({month:m.value});
          })));
          section.append(actions);
          for(const i of debt.installments){
            const line=e("div","nhf-vale-installment");
            const available=Math.max(0,number(i.remaining)-number(i.reservado));
            line.append(e("span","","Parcela "+i.installment_number+" · "+monthLabel(i.due_month)+" · "+br(i.amount)+" · Saldo "+br(i.remaining)+(number(i.reservado)?" · Reservado "+br(i.reservado):"")));
            if(available>0)line.append(valeButton("Registrar desconto",()=>editForm("payment",i,"Registrar desconto",form=>{
              const a=field(form,"Valor do desconto","amount","text",available.toFixed(2)),m=field(form,"Competência","month","month",currentMonth()),n=field(form,"Observação","notes","text","",false);
              return ()=>({amount:moneyInput(a.value),month:m.value,notes:n.value});
            })));
            section.append(line);
          }
          body.append(section);
        }
        if(record.payments.length){
          const history=e("section","nhf-vale-record");history.append(e("strong","","Histórico de descontos"));
          for(const p of record.payments){
            const line=e("div","nhf-vale-installment");line.append(e("span","",p.title+" · "+monthLabel(p.payment_month)+" · "+br(p.amount)+(p.notes?" · "+p.notes:"")));
            if(!p.protegido)line.append(valeButton("Estornar",event=>mutate({action:"undo",id:p.id},event.currentTarget,"Estornar este desconto?")));
            history.append(line);
          }body.append(history);
        }
      }
    }catch(err){body.replaceChildren(e("p","nhf-failed",err.message));}
  }
  function createStaffCard(person){
    const balance=openAmounts(person);
    const card=e("article","nhf-staff");
    card.dataset.personId=String(person.id);
    card.dataset.name=norm(person.nome);
    const header=e("button","nhf-staff-summary");
    header.type="button";header.setAttribute("aria-expanded","false");
    const who=e("span","nhf-person"),avatar=e("span","nhf-avatar",initials(person.nome));
    const copy=e("span","nhf-person-text");
    copy.append(e("strong","",person.nome));
    who.append(avatar,copy);header.append(who);
    function stat(title,value,kind){
      const cell=e("span","nhf-stat "+kind);
      cell.append(e("span","",title),e("strong","",br(value)));
      return cell;
    }
    header.append(
      stat("Saldo a pagar ao funcionário",balance.pagar,"payable"),
      stat("Vales a descontar",balance.descontar,"deduct"),
      e("span","nhf-chevron","⌄")
    );
    const detail=e("div","nhf-staff-details");
    detail.hidden=true;
    const loadDetails=()=>{
      if(detail.dataset.loaded==="1")return;
      const controls=e("div","nhf-vale-actions");
      controls.append(valeButton("+ Adicionar vale",()=>addVale(person.id)),valeButton("Gerenciar vales ("+Number(person.quantidade_vales||0)+")",()=>manageVales(person)));
      detail.append(controls,makeTable(person),makeHistory(person));
      detail.dataset.loaded="1";
    };
    header.addEventListener("click",()=>{
      const opening=detail.hidden;
      if(opening)loadDetails();
      detail.hidden=!opening;
      header.setAttribute("aria-expanded",String(opening));
      card.classList.toggle("is-open",opening);
      state.openId=opening?person.id:null;
    });
    card.append(header,detail);
    if(person.id===state.openId){
      loadDetails();detail.hidden=false;
      header.setAttribute("aria-expanded","true");
      card.classList.add("is-open");
    }
    card.dataset.pagar=String(balance.pagar);
    card.dataset.vales=String(balance.descontar);
    card.dataset.paid=String(paidRows(person).length);
    card.dataset.valeCount=String(person.quantidade_vales||0);
    state.cards.set(person.id,card);
    return card;
  }
  function applyFilters(){
    const q=norm(state.filters.q),status=state.filters.status;
    const people=state.data?.funcionarios||[];
    let shown=0;
    for(const person of people){
      const card=state.cards.get(person.id);
      if(!card)continue;
      const amount=Number(card.dataset.pagar),vales=Number(card.dataset.vales);
      const matchName=!q||norm(person.nome).includes(q);
      const matchStatus=status==="all"||
        (status==="pending"&&(amount>0||vales>0))||
        (status==="payable"&&amount>0)||
        (status==="vales"&&vales>0)||
        (status==="paid"&&Number(card.dataset.paid)>0)||
        (status==="valeHistory"&&Number(card.dataset.valeCount)>0);
      card.hidden=!(matchName&&matchStatus);
      if(!card.hidden)shown++;
    }
    setText("listSubtitle",shown+" de "+people.length);
    $("emptyFiltered").hidden=shown!==0;
  }
  let pixSaving=false;
  function pixFeedback(message,error=false){
    if(window.NHFeedback){window.NHFeedback.notify(message,error);return;}
    const toast=$("toast");
    toast.hidden=false;toast.textContent=message;
    toast.classList.toggle("error",error);
  }
  function renderPix(){
    const list=$("pixList");
    list.replaceChildren();
    const people=(state.data?.funcionarios||[]).filter(p=>Number(p.id)>0)
      .sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR"));
    for(const person of people){
      const row=e("div","nhf-pix-row"),name=e("strong","",person.nome);
      const input=e("input","nhf-pix-input");
      input.type="password";input.value=person.chave_pix||"";input.readOnly=true;
      input.maxLength=150;input.autocomplete="off";
      input.setAttribute("aria-label","Chave Pix de "+person.nome);
      const actions=e("div","nhf-pix-actions");
      const button=label=>{const b=e("button","nhf-mini",label);b.type="button";return b;};
      const show=button("Mostrar"),copy=button("Copiar"),edit=button(input.value?"Editar":"Cadastrar");
      const save=button("Salvar"),cancel=button("Cancelar");
      save.hidden=cancel.hidden=true;copy.disabled=!input.value;
      show.addEventListener("click",()=>{
        input.type=input.type==="password"?"text":"password";
        show.textContent=input.type==="password"?"Mostrar":"Ocultar";
      });
      copy.addEventListener("click",async()=>{
        try{await navigator.clipboard.writeText(person.chave_pix||"");pixFeedback("Chave Pix copiada.");}
        catch{pixFeedback("Não foi possível copiar. Use Mostrar e copie a chave.",true);}
      });
      cancel.setAttribute("data-nh-draft-cancel","");save.setAttribute("data-nh-draft-save","");
      function reset(){
        row.removeAttribute("data-nh-draft");
        input.value=person.chave_pix||"";input.type="password";input.readOnly=true;
        show.textContent="Mostrar";edit.hidden=false;save.hidden=cancel.hidden=true;
        copy.disabled=!input.value;
      }
      edit.addEventListener("click",()=>{
        row.setAttribute("data-nh-draft","pix");
        input.readOnly=false;input.type="text";show.textContent="Ocultar";
        edit.hidden=true;save.hidden=cancel.hidden=false;copy.disabled=true;
        input.focus?.();
      });
      cancel.addEventListener("click",reset);
      save.addEventListener("click",async()=>{
        if(pixSaving)return;
        const key=input.value.trim(),previous=person.chave_pix||"";
        if(key===previous){reset();return;}
        pixSaving=true;save.disabled=cancel.disabled=true;
        try{
          const response=await fetch("/central/api/funcionarios/pix",{
            method:"POST",credentials:"same-origin",cache:"no-store",
            headers:{"Content-Type":"application/json","Accept":"application/json"},
            body:JSON.stringify({funcionario_id:person.id,chave_pix:key,chave_anterior:previous})
          });
          const result=await response.json();
          if(!response.ok||!result.ok)throw new Error(result.erro||"Não foi possível salvar o Pix.");
          person.chave_pix=key;person.pix_cadastrado=!!key;reset();
          edit.textContent=key?"Editar":"Cadastrar";
          pixFeedback("Chave Pix atualizada.");
        }catch(error){pixFeedback(error.message,true);}
        finally{pixSaving=false;save.disabled=cancel.disabled=false;}
      });
      actions.append(show,copy,edit,save,cancel);
      row.append(name,input,actions);list.append(row);
    }
    if(!people.length)list.append(e("p","nhf-muted","Nenhum funcionário cadastrado no Contas."));
  }
  function render(data){
    if(!Array.isArray(data.funcionarios))
      throw new Error("Lista de funcionários indisponível.");
    state.data=data;
    // Carrega o painel permanente sem depender de clique, filtro ou expansão.
    renderPix();
    state.cards.clear();
    const list=$("staffList");list.replaceChildren();
    const people=data.funcionarios.slice().sort((a,b)=>{
      const first=openAmounts(a),second=openAmounts(b);
      return (second.pagar+second.descontar)-(first.pagar+first.descontar)||
        a.nome.localeCompare(b.nome,"pt-BR");
    });
    let pendingPeople=0,totalPay=0,totalVale=0;
    for(const person of people){
      const open=openAmounts(person);
      totalPay+=open.pagar;totalVale+=open.descontar;
      if(open.pagar||open.descontar)pendingPeople++;
      list.append(createStaffCard(person));
    }
    setText("metricPeople",pendingPeople);
    setText("metricTotal",br(totalPay));
    setText("metricVales",br(totalVale));
    const empty=e("p","nhf-empty","Nenhum funcionário corresponde a este filtro.");
    empty.id="emptyFiltered";empty.hidden=true;list.append(empty);
    applyFilters();
  }
  async function refresh(){
    if(state.loading||pixSaving||document.querySelector?.("[data-nh-draft=\"pix\"]"))return;
    state.loading=true;$("refresh").disabled=true;
    $("refresh").textContent="Consultando…";
    try{
      const response=await fetch("/central/api/funcionarios/painel",{
        credentials:"same-origin",cache:"no-store",
        headers:{"Accept":"application/json"}
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.erro||"Falha ao consultar Funcionários.");
      render(data);
    }catch(error){
      $("pixList").replaceChildren(e("p","nhf-failed","Não foi possível carregar as chaves Pix. Use Atualizar para tentar novamente."));
      const list=$("staffList");
      list.replaceChildren(e("p","nhf-failed",
        "Não foi possível consultar os valores em aberto. "+(error.message||"")));
    }finally{
      state.loading=false;$("refresh").disabled=false;
      $("refresh").textContent="Atualizar";
    }
  }
  $("search").addEventListener("input",event=>{
    state.filters.q=event.target.value;applyFilters();
  });
  $("statusFilter").addEventListener("change",event=>{
    state.filters.status=event.target.value;applyFilters();
  });
  $("historyFilter").addEventListener("click",()=>{
    $("statusFilter").value="paid";
    state.filters.status="paid";
    applyFilters();
  });
  $("addVale").addEventListener("click",()=>addVale());
  $("registerValeEmployee").addEventListener("click",registerValeEmployee);
  $("refresh").addEventListener("click",refresh);
  refresh();
})();
