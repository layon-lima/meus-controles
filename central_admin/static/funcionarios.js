"use strict";
/* Central / Funcionários: quadro exclusivamente de valores em aberto.
 * Sem vínculos ou histórico pago. Gerenciamento de Pix separado.
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
    // Nunca trazer para a tela contas, holerites ou vales já quitados.
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
      detail.append(makeTable(person));
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
        (status==="vales"&&vales>0);
      card.hidden=!(matchName&&matchStatus);
      if(!card.hidden)shown++;
    }
    setText("listSubtitle",shown+" de "+people.length);
    $("emptyFiltered").hidden=shown!==0;
  }
  let pixSaving=false;
  function pixFeedback(message,error=false){
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
      function reset(){
        input.value=person.chave_pix||"";input.type="password";input.readOnly=true;
        show.textContent="Mostrar";edit.hidden=false;save.hidden=cancel.hidden=true;
        copy.disabled=!input.value;
      }
      edit.addEventListener("click",()=>{
        input.readOnly=false;input.type="text";show.textContent="Ocultar";
        edit.hidden=true;save.hidden=cancel.hidden=false;copy.disabled=true;
        input.focus?.();
      });
      cancel.addEventListener("click",reset);
      save.addEventListener("click",async()=>{
        if(pixSaving)return;
        const key=input.value.trim(),previous=person.chave_pix||"";
        if(key===previous){reset();return;}
        if(!window.confirm((key?"Salvar nova chave Pix de ":"Remover a chave Pix de ")+person.nome+"?"))return;
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
  function togglePix(open){
    if(pixSaving)return;
    $("pixPanel").hidden=!open;
    $("managePix").setAttribute("aria-expanded",String(open));
    if(open)renderPix();else $("pixList").replaceChildren();
  }
  $("managePix").addEventListener("click",()=>togglePix($("pixPanel").hidden));
  $("closePix").addEventListener("click",()=>togglePix(false));
  function render(data){
    if(!Array.isArray(data.funcionarios))
      throw new Error("Lista de funcionários indisponível.");
    state.data=data;state.cards.clear();
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
    const empty=e("p","nhf-empty","Nenhum funcionário com valores em aberto neste filtro.");
    empty.id="emptyFiltered";empty.hidden=true;list.append(empty);
    applyFilters();
    if(!$('pixPanel').hidden)renderPix();
  }
  async function refresh(){
    if(state.loading||pixSaving)return;
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
  $("refresh").addEventListener("click",refresh);
  refresh();
})();
