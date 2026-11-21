"use strict";
/* Funcionários — UI nativa única, sem reabrir o aplicativo de Contas.
 * Todos os pagamentos vêm do banco CONTAS por leitura. Os vínculos
 * confirmados são os únicos dados gravados no journal da Central. */
(() => {
  if (!location.pathname.startsWith("/central/modules/funcionarios")) return;
  const $=id=>document.getElementById(id);
  const state={data:null,openId:null,loading:false,filters:{q:"",status:"all"}};
  const fmt=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
  const number=value=>{const x=Number(value);return Number.isFinite(x)?x:0};
  const br=value=>fmt.format(number(value));
  const norm=value=>String(value||"").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").trim();
  function e(tag,cls,contents){
    const element=document.createElement(tag);
    if(cls)element.className=cls;
    if(contents!==undefined)element.textContent=String(contents);
    return element;
  }
  function label(value,kind=""){
    const element=e("span","nhf-pill"+(kind?" "+kind:""),value);
    return element;
  }
  function setText(id,value){$(id).textContent=String(value??"—")}
  function toast(message,error=false){
    const el=$("toast");el.textContent=message;el.classList.toggle("error",error);
    el.hidden=!message;
    window.clearTimeout(toast.timer);
    if(message)toast.timer=window.setTimeout(()=>{el.hidden=true},6000);
  }
  function loadingBusy(isBusy){
    state.loading=isBusy;$("refresh").disabled=isBusy;
    $("refresh").textContent=isBusy?"Consultando…":"Atualizar";
  }
  async function json(path,payload){
    const response=await fetch(path,{
      method:payload===undefined?"GET":"POST",
      credentials:"same-origin",cache:"no-store",
      headers:payload===undefined?{"Accept":"application/json"}:
        {"Content-Type":"application/json","Accept":"application/json"},
      body:payload===undefined?undefined:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({erro:"Resposta inválida da Central."}));
    if(!response.ok)throw new Error(data.erro||data.error||"Não foi possível consultar funcionários.");
    return data;
  }
  function actionButton(text,callback,cls="nhf-mini"){
    const button=e("button",cls,text);button.type="button";
    if(typeof callback==="function")button.addEventListener("click",callback);
    return button;
  }
  function initials(name){
    const words=String(name||"").trim().split(/\s+/);
    return ((words[0]||"?")[0]+(words.length>1?words[words.length-1][0]:"")).toUpperCase();
  }
  function safeDate(value){
    const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match?match[3]+"/"+match[2]+"/"+match[1]:"Não informado";
  }
  function record(title,details,value,status,action){
    const row=e("div","nhf-record");
    if(status==="Pendente")row.setAttribute("aria-label","pendente");
    const information=e("div","nhf-record-main");
    information.append(e("strong","",title),e("small","",details));
    const end=e("div","nhf-record-end");
    end.append(e("b","",br(value)),e("small","",status));
    if(action)end.append(action);
    row.append(information,end);
    return row;
  }
  function block(title,count,wide=false){
    const section=e("section","nhf-detail-section"+(wide?" wide":""));
    const head=e("div","nhf-detail-heading");
    head.append(e("strong","",title),e("span","nhf-section-count",count));
    section.append(head);
    return section;
  }
  function appendPayInfo(section,staff){
    const tools=e("div","nhf-staff-tools");
    const left=e("div","nhf-actions");
    left.append(label(staff.pix_cadastrado?"Pix cadastrado":"Pix não cadastrado",
      staff.pix_cadastrado?"good":"warn"));
    const count=staff.vales_ids.length;
    left.append(label(count?count+" cadastro(s) de vales":"Sem vales vinculados",
      count?"good":""));
    tools.append(left);
    if(staff.chave_pix){
      const right=e("div","nhf-actions");
      const reveal=actionButton("Mostrar Pix",()=>{
        const visible=reveal.dataset.shown==="1";
        reveal.dataset.shown=visible?"0":"1";
        reveal.textContent=visible?"Mostrar Pix":"Ocultar Pix";
        display.textContent=visible?"":staff.chave_pix;
      });
      const display=e("small","nhf-pix-reveal","");
      const copy=actionButton("Copiar Pix",async()=>{
        try{await navigator.clipboard.writeText(staff.chave_pix);toast("Chave Pix copiada.")}catch{
          toast("Não foi possível copiar. Use Mostrar Pix.",true)}
      });
      right.append(display,reveal,copy);tools.append(right);
    }
    section.append(tools);
  }
  function renderPayroll(staff,month){
    const selected=staff.holerites.filter(x=>x.competencia===month);
    const section=block("Holerites da competência",selected.length+" registro(s)");
    if(!selected.length)section.append(e("p","nhf-muted","Nenhum holerite cadastrado neste mês."));
    for(const payroll of selected){
      const linked=staff.descontos.filter(x=>Number(x.conta_id)===Number(payroll.id));
      const discount=linked.reduce((sum,x)=>sum+number(x.valor),0);
      const paid=payroll.paga;
      const stateText=paid?"Pago":"Pendente";
      const details=[
        "Conta #"+payroll.id,
        "Vencimento "+safeDate(payroll.vencimento),
        linked.length?"Original "+br(linked[0].original_holerite)+" · Vales "+br(discount):
          "Sem desconto vinculado"
      ].join(" · ");
      const btn=e("a","nhf-mini","Abrir no Contas");
      btn.href="/central/modules/contas/";
      btn.title="Acesse a aba Contas para conferir/pagar a conta #"+payroll.id;
      section.append(record(payroll.fornecedor||"Holerite",details,payroll.valor,stateText,btn));
    }
    const historical=staff.holerites.filter(x=>x.competencia!==month);
    if(historical.length){
      const count=e("details","nhf-history");
      const summary=e("summary","nhf-muted","Ver histórico de "+historical.length+" holerite(s) de outros meses");
      count.append(summary);
      for(const h of historical.slice(0,40))
        count.append(record("Holerite "+(h.competencia||"—"),"Conta #"+h.id,
          h.valor,h.paga?"Pago":"Pendente"));
      section.append(count);
    }
    return section;
  }
  function renderVales(staff,month){
    const current=staff.parcelas.filter(x=>x.competencia===month);
    const late=staff.parcelas.filter(x=>x.competencia<month&&number(x.saldo_a_descontar)>0);
    const section=block("Vales do funcionário",
      current.length+" parcela(s) na competência");
    if(!staff.vales_ids.length)
      section.append(e("p","nhf-muted","Nenhum controle de Vales vinculado a este funcionário."));
    if(staff.vales_ids.length&&!current.length)
      section.append(e("p","nhf-muted","Sem parcela prevista para este mês."));
    const list=e("div","nhf-vales-table");
    for(const val of current){
      const part=e("div","nhf-vale");
      const info=e("div");
      info.append(e("b","",val.titulo),e("small","",
        "Parcela "+val.parcela+" · saldo bruto "+br(number(val.valor)-number(val.ja_descontado))));
      const money=e("div");
      money.append(e("strong","",br(val.saldo_a_descontar)));
      const committed=number(val.reservado);
      money.append(e("small","",committed?
        br(committed)+" já reservado em holerite":
        number(val.saldo_a_descontar)?"A descontar":"Descontado/quitado"));
      part.append(info,money);list.append(part);
    }
    section.append(list);
    if(late.length)section.append(e("p","nhf-note",
      late.length+" parcela(s) de meses anteriores em aberto. Não somadas automaticamente ao holerite."));
    if(staff.descontos.some(x=>x.status==="error"))
      section.append(label("Conciliação pendente","warn"));
    return section;
  }
  function renderOther(staff){
    const section=block("Outras contas vinculadas",staff.outras_contas.length+" registro(s)");
    if(!staff.outras_contas.length)
      section.append(e("p","nhf-muted","Nenhuma outra conta vinculada e confirmada."));
    for(const acc of staff.outras_contas){
      const btn=e("a","nhf-mini","Abrir no Contas");
      btn.href="/central/modules/contas/";
      btn.title="Localize a conta #"+acc.id+" no Contas";
      section.append(record(acc.fornecedor||acc.documento||"Conta",
        "Conta #"+acc.id+" · "+(acc.documento||acc.referencia||"")+
        " · venc. "+safeDate(acc.vencimento),
        acc.valor,acc.paga?"Paga":"Pendente",btn));
    }
    return section;
  }
  async function approveAccount(acc,employeeId,btn){
    if(!window.confirm("Confirmar que a conta #"+acc.id+" de "+acc.fornecedor+
        " pertence a este funcionário? O vínculo será usado no total a pagar."))return;
    btn.disabled=true;
    try{
      await json("/central/api/funcionarios/vincular-conta",{
        conta_id:acc.id,funcionario_id:employeeId
      });
      toast("Conta vinculada ao funcionário.");
      await refresh();
    }catch(error){toast(error.message,true);btn.disabled=false}
  }
  function renderSuggested(staff){
    const section=block("Contas sugeridas pelo nome",
      staff.sugestoes.length+" para conferir",true);
    section.append(e("p","nhf-note",
      "Estas contas ainda NÃO fazem parte do total a pagar. Confirme apenas se são realmente deste funcionário."));
    if(!staff.sugestoes.length)section.append(e("p","nhf-muted","Nenhuma outra conta sugerida."));
    for(const acc of staff.sugestoes){
      const row=e("div","nhf-suggest");
      const line=e("div","nhf-suggest-row");
      const info=e("div","nhf-suggest-details");
      info.append(e("strong","",acc.fornecedor+" · "+br(acc.valor)),
        e("small","","Conta #"+acc.id+" · "+
          safeDate(acc.vencimento)+(acc.paga?" · Paga":" · Pendente")));
      const button=actionButton("Confirmar vínculo");
      button.addEventListener("click",()=>approveAccount(acc,staff.id,button));
      line.append(info,button);row.append(line);section.append(row);
    }
    return section;
  }
  function renderAccountFinder(staff){
    const section=block("Vincular outra conta existente","Busca segura",true);
    section.append(e("p","nhf-note",
      "A conta não precisa ter o nome do funcionário como fornecedor. "+
      "Pesquise o lançamento existente no Contas e confirme a associação."));
    const controls=e("div","nhf-actions");
    const search=e("input","nhf-link-select");
    search.type="search";search.placeholder="Fornecedor ou número da conta…";
    search.autocomplete="off";
    search.setAttribute("aria-label","Buscar contas para vincular a "+staff.nome);
    const button=actionButton("Buscar contas");
    const result=e("div","nhf-account-search-results");
    button.addEventListener("click",async()=>{
      const query=search.value.trim();
      if(query.length<2)return toast("Digite ao menos 2 caracteres para buscar.",true);
      button.disabled=true;
      result.replaceChildren(e("p","nhf-muted","Buscando contas existentes…"));
      try{
        const found=await json("/central/api/funcionarios/buscar-contas?q="+
          encodeURIComponent(query));
        result.replaceChildren();
        if(!found.contas?.length){
          result.append(e("p","nhf-muted","Nenhuma conta disponível para vínculo."));
          return;
        }
        for(const acc of found.contas){
          const row=e("div","nhf-suggest");
          const line=e("div","nhf-suggest-row");
          const info=e("div","nhf-suggest-details");
          info.append(e("strong","",acc.fornecedor+" · "+br(acc.valor)),
            e("small","","Conta #"+acc.id+" · "+safeDate(acc.vencimento)+
              (acc.paga?" · Paga":" · Pendente")));
          const confirm=actionButton("Vincular");
          confirm.addEventListener("click",()=>approveAccount(acc,staff.id,confirm));
          line.append(info,confirm);row.append(line);result.append(row);
        }
      }catch(err){
        result.replaceChildren(e("p","nhf-failed",err.message));
      }finally{button.disabled=false}
    });
    search.addEventListener("keydown",event=>{
      if(event.key==="Enter"){event.preventDefault();button.click()}
    });
    controls.append(search,button);section.append(controls,result);
    return section;
  }
  function createStaffCard(person,month){
    const card=e("article","nhf-staff");card.dataset.personId=String(person.id);
    card.dataset.name=norm(person.nome);
    const total=person.totais;
    const header=e("button","nhf-staff-summary");
    header.type="button";header.setAttribute("aria-expanded","false");
    const who=e("span","nhf-person");
    const avatar=e("span","nhf-avatar",initials(person.nome));
    const copy=e("span","nhf-person-text");
    copy.append(e("strong","",person.nome),e("small","",
      person.totais.holerites_pendentes_mes+" holerite(s) aberto(s) · "+
      (person.pix_cadastrado?"Pix cadastrado":"Pix pendente")));
    who.append(avatar,copy);header.append(who);
    function cell(title,value,primary=false){
      const block=e("span","nhf-stat"+(primary?" primary":""));
      block.append(e("span","",title),e("strong","",value));return block;
    }
    header.append(
      cell("A pagar",br(total.total_a_pagar),true),
      cell("Vales previstos",br(total.vales_previstos)),
      cell("Vales já reservados",br(total.vales_reservados)),
      e("span","nhf-chevron","⌄")
    );
    const details=e("div","nhf-staff-details");details.hidden=true;
    header.addEventListener("click",()=>{
      const opened=details.hidden;details.hidden=!opened;
      header.setAttribute("aria-expanded",String(opened));
      card.classList.toggle("is-open",opened);
      state.openId=opened?person.id:null;
    });
    appendPayInfo(details,person);
    const grid=e("div","nhf-detail-grid");
    grid.append(renderPayroll(person,month),renderVales(person,month),
      renderOther(person),renderSuggested(person),renderAccountFinder(person));
    details.append(grid);
    card.append(header,details);
    if(person.id===state.openId){
      details.hidden=false;header.setAttribute("aria-expanded","true");
      card.classList.add("is-open");
    }
    return card;
  }
  function applyFilters(){
    const q=norm(state.filters.q),filter=state.filters.status;
    const staff=state.data?.funcionarios||[];
    let shown=0;
    for(const item of staff){
      const card=$("staffList").querySelector('[data-person-id="'+item.id+'"]');
      if(!card)continue;
      const value=item.totais;
      const fits=!q||norm(item.nome).includes(q);
      const status=filter==="all"||
        (filter==="pending"&&number(value.total_a_pagar)>0)||
        (filter==="vales"&&(item.vales_ids.length||number(value.vales_previstos)>0))||
        (filter==="links"&&Number(value.sugestoes_contas)>0);
      card.hidden=!(fits&&status);if(!card.hidden)shown++;
    }
    setText("listSubtitle",shown+" de "+staff.length+" funcionário(s) exibido(s)");
    const empty=$("emptyFiltered");
    if(empty)empty.hidden=shown!==0;
  }
  async function linkVale(val,select,button){
    const id=Number(select.value);
    if(!id)return toast("Selecione o funcionário correto no Contas.",true);
    const staff=state.data.funcionarios.find(x=>x.id===id);
    if(!staff)return toast("Funcionário não encontrado.",true);
    if(!window.confirm("Vincular "+val.nome+" (Vales) a "+staff.nome+
      " (Contas)? Essa associação será mantida nos próximos holerites."))return;
    button.disabled=true;
    try{
      await json("/central/api/vales-holerites/vincular",{
        vale_employee_id:val.vale_employee_id,contas_employee_id:id
      });
      toast("Funcionários vinculados com sucesso.");await refresh();
    }catch(err){toast(err.message,true);button.disabled=false}
  }
  function renderUnlinked(data){
    const section=$("unlinkedSection"),list=$("unlinkedList");
    const vales=data.vales_sem_vinculo||[];
    section.hidden=vales.length===0;list.replaceChildren();
    setText("unlinkedCount",vales.length+" pendente(s)");
    for(const val of vales){
      const row=e("div","nhf-unlinked-row");
      const info=e("div","nhf-unlinked-info");
      info.append(e("strong","",val.nome),e("small","",
        "Controle #"+val.control_id+" · "+
        br(val.vales_previstos)+" previstos no mês"));
      const controls=e("div","nhf-unlinked-controls");
      const select=e("select","nhf-link-select");
      select.setAttribute("aria-label","Vincular "+val.nome+" ao funcionário");
      const blank=e("option","","Escolher funcionário no Contas…");
      blank.value="";select.append(blank);
      for(const person of data.funcionarios){
        const opt=e("option","",person.nome);
        opt.value=String(person.id);select.append(opt);
      }
      if(val.sugestao_funcionario_id)
        select.value=String(val.sugestao_funcionario_id);
      const button=actionButton("Confirmar vínculo");
      button.addEventListener("click",()=>linkVale(val,select,button));
      controls.append(select,button);row.append(info,controls);list.append(row);
    }
  }
  function render(data){
    state.data=data;
    const k=data.indicadores,month=data.competencia;
    setText("metricPeople",k.funcionarios_com_pagamentos);
    setText("metricPayroll",k.holerites_pendentes_mes);
    setText("metricVales",br(k.vales_a_descontar));
    setText("metricTotal",br(k.total_a_pagar));
    setText("metricPaid",k.holerites_pagos_mes);
    setText("payrollSubtitle",k.holerites_mes+" cadastrado(s) na competência");
    const list=$("staffList");list.replaceChildren();
    const ordered=data.funcionarios.slice().sort((a,b)=>
      number(b.totais.total_a_pagar)-number(a.totais.total_a_pagar)||
      a.nome.localeCompare(b.nome,"pt-BR"));
    for(const employee of ordered)
      list.append(createStaffCard(employee,month));
    const empty=e("p","nhf-empty","Nenhum funcionário corresponde a esses filtros.");
    empty.id="emptyFiltered";empty.hidden=true;list.append(empty);
    renderUnlinked(data);applyFilters();
  }
  async function refresh(){
    if(state.loading)return;
    loadingBusy(true);
    try{
      const q=new URLSearchParams({competencia:$("competence").value});
      const data=await json("/central/api/funcionarios/painel?"+q);
      render(data);
    }catch(error){
      toast(error.message,true);
      if(!state.data){
        $("staffList").replaceChildren(e("p","nhf-failed",
          "Não foi possível consultar os funcionários. Confira a ligação entre Contas e Vales e tente atualizar."));
      }
    }finally{loadingBusy(false)}
  }
  const today=new Date();
  $("competence").value=today.getFullYear()+"-"+String(today.getMonth()+1).padStart(2,"0");
  $("competence").addEventListener("change",()=>{state.openId=null;refresh()});
  $("search").addEventListener("input",event=>{
    state.filters.q=event.target.value;applyFilters();
  });
  $("statusFilter").addEventListener("change",event=>{
    state.filters.status=event.target.value;applyFilters();
  });
  $("refresh").addEventListener("click",refresh);
  refresh();
})();
