"use strict";
/*
 * Holerites ↔ Vales — dentro da tela EXISTENTE de Holerites do CONTAS 4.
 *
 * Não substitui renderPayroll, não altera o motor de contas e nunca realiza
 * baixa ou desconto via DOM. Usa exclusivamente a API consolidada da Central.
 * A inserção ocorre depois de cada renderização original (MutationObserver
 * do filho direto, não observa os elementos acrescentados).
 */
(() => {
  if (!location.pathname.startsWith("/central/modules/contas/")) return;
  const list=document.getElementById("payrollList");
  const view=document.getElementById("holeritesView");
  if (!list||!view||typeof MutationObserver==="undefined") return;

  const BASE="/central/api/";
  const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
  const fmt=value=>money.format(Number(value)||0);
  const numeric=value=>Number(value)||0;
  let dashboard=null;
  let until=0;
  let pending=null;
  let renderSerial=0;
  let noticeTimer=null;

  function el(tag,cls,text){
    const result=document.createElement(tag);
    if(cls)result.className=cls;
    if(text!==undefined)result.textContent=String(text);
    return result;
  }
  function month(){
    const dt=new Date();
    return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0");
  }
  function error(text){
    let line=document.getElementById("nhp-vale-error");
    if(!text){line?.remove();return}
    if(!line){
      line=el("div","nhp-vale-error");
      line.id="nhp-vale-error";
      view.querySelector(".payroll-head")?.after(line);
    }
    line.textContent="Vales: "+text+" Os holerites originais continuam disponíveis.";
  }
  async function data(force=false){
    if(!force&&dashboard&&Date.now()<until)return dashboard;
    if(pending)return pending;
    const q=new URLSearchParams({competencia:month()});
    pending=fetch(BASE+"funcionarios/painel?"+q,{
      credentials:"same-origin",cache:"no-store",
      headers:{"Accept":"application/json"}
    }).then(async response=>{
      const result=await response.json();
      if(!response.ok||!Array.isArray(result.funcionarios))
        throw new Error(result.erro||"não foi possível consultar a base de Vales");
      dashboard=result;
      until=Date.now()+12000;
      error("");
      return result;
    }).finally(()=>{pending=null});
    return pending;
  }
  function getId(card){
    const button=card.querySelector("[data-payroll-edit]")||
      card.querySelector("[data-payroll-new]");
    const id=Number(button?.dataset.payrollEdit||button?.dataset.payrollNew||0);
    return Number.isSafeInteger(id)&&id>0?id:null;
  }
  function moneyBadge(label,value,mode=""){
    const badge=el("span","nhp-valebadge "+mode);
    badge.append(el("small","",label),el("strong","",fmt(value)));
    return badge;
  }
  function info(label,details,value,kind=""){
    const row=el("div","nhp-valerow "+kind);
    const left=el("div","nhp-valerow-left");
    left.append(el("strong","",label),el("small","",details));
    row.append(left,el("b","",fmt(value)));
    return row;
  }
  function payRowLabel(person,accountId,payrollRow){
    const discounts=(person.descontos||[]).filter(item=>
      Number(item.conta_id)===accountId);
    const amt=payrollRow.querySelector(".amount");
    if(!amt)return;
    const committed=discounts.reduce((sum,d)=>sum+numeric(d.valor),0);
    if(discounts.length){
      const before=numeric(discounts[0].original_holerite);
      amt.append(el("small","nhp-discount-applied",
        "Líquido do PDF: "+fmt(before)+" · vales: −"+fmt(committed)));
      if(discounts.some(d=>d.status==="error"))
        amt.append(el("small","nhp-alert-text","Desconto pendente de conciliação"));
      return;
    }
    const monthText=person.holerites?.find(x=>Number(x.id)===accountId)?.competencia;
    const available=(person.parcelas||[]).filter(x=>
      x.competencia===monthText&&numeric(x.saldo_a_descontar)>0);
    if(available.length&&payrollRow.querySelector(".pill")?.textContent.trim()!=="Paga"){
      amt.append(el("small","nhp-discount-not-applied",
        "Há vales pendentes neste mês — ainda não descontados"));
      const actions=payrollRow.querySelector("[data-payroll-account]");
      if(actions){
        const link=el("button","nhp-review-button","Conferir desconto");
        link.type="button";link.addEventListener("click",()=>{
          // Usa o menu de edição já existente do CONTAS, com as validações
          // do próprio sistema e do backend da integração.
          actions.click();
        });
        actions.parentElement?.insertBefore(link,actions);
      }
    }
  }
  function valesSection(person,report){
    const wrap=el("section","nhp-vales-inline");
    wrap.dataset.nhp="1";
    const head=el("div","nhp-vale-head");
    const title=el("div","nhp-vale-label");
    title.append(el("strong","","Vales e pagamentos"),
      el("small","","Integrados ao Meus Controles · "+report.competencia));
    head.append(title);
    const badges=el("div","nhp-vale-badges");
    badges.append(
      moneyBadge("A descontar",person.totais.vales_previstos,"pending"),
      moneyBadge("Já reservado",person.totais.vales_reservados,"reserved"),
      moneyBadge("Total em aberto",person.totais.total_a_pagar,"due")
    );
    if(numeric(person.totais.vales_atrasados)>0)
      badges.append(moneyBadge("Atrasados",person.totais.vales_atrasados,"late"));
    head.append(badges);
    wrap.append(head);
    const detail=el("details","nhp-vales-details");
    const parts=person.parcelas||[];
    const discounts=person.descontos||[];
    const acc=person.outras_contas||[];
    const count=parts.length+discounts.length+acc.length;
    detail.append(el("summary","",
      "Ver vales, descontos e outras contas ("+count+")"));
    const body=el("div","nhp-vales-body");
    const group=el("div","nhp-vales-group");
    group.append(el("h4","","Parcelas do vale"));
    if(parts.length){
      for(const item of parts){
        const rem=numeric(item.saldo_a_descontar);
        const booked=numeric(item.reservado);
        const paid=numeric(item.ja_descontado);
        const flags=[item.competencia,"Parcela "+item.parcela,
          booked?"Reservado "+fmt(booked):"",
          paid?"Baixado "+fmt(paid):"",
          rem<=0?"Sem saldo a reservar":""].filter(Boolean).join(" · ");
        group.append(info(item.titulo||"Vale",flags,rem,
          item.competencia<report.competencia?"late":""));
      }
    }else{
      group.append(el("p","nhp-empty","Sem parcelas cadastradas."));
    }
    body.append(group);
    const old=el("div","nhp-vales-group");
    old.append(el("h4","","Descontos já vinculados aos holerites"));
    if(!discounts.length){
      old.append(el("p","nhp-empty",
        "Nenhum desconto vinculado ainda. A parcela pendente não altera automaticamente o holerite já salvo."));
    }else{
      for(const rec of discounts)
        old.append(info("Holerite #"+rec.conta_id+" · parcela #"+rec.parcela_id,
          rec.competencia+" · "+(
            rec.status==="settled"?"Baixado":
            rec.status==="error"?"Pendente de conciliação":"Reservado — aguarda pagamento"
          ),rec.valor,rec.status==="error"?"late":""));
    }
    body.append(old);
    if(acc.length){
      const other=el("div","nhp-vales-group");
      other.append(el("h4","","Outras contas confirmadas"));
      for(const a of acc)
        other.append(info(a.fornecedor||"Conta",a.paga?"Paga":"Pendente",a.valor));
      body.append(other);
    }
    detail.append(body);wrap.append(detail);
    return wrap;
  }
  function linkSection(person,report){
    const candidates=(report.vales_sem_vinculo||[]).filter(val=>
      Number(val.sugestao_funcionario_id)===Number(person.id));
    const allUnlinked=report.vales_sem_vinculo||[];
    const section=el("section","nhp-vales-inline nhp-link-pending");
    const heading=el("div","nhp-link-heading");
    heading.append(el("strong","",
        candidates.length?"Vale encontrado — confirmar vínculo":"Vales ainda não vinculados"),
      el("small","",
        candidates.length?
          candidates.map(x=>x.nome+" · previsto "+fmt(x.vales_previstos)).join(" / ")+
          ". Confirme a pessoa antes de descontar.":
          allUnlinked.length?
            "É possível vincular um cadastro de Vales, inclusive com nome diferente.":
            "Nenhum vale identificado para este funcionário."));
    section.append(heading);
    // Mesmo sem vínculo gravado, mostrar os Vales REAIS do funcionário
    // sugerido para que não sumam da lista de holerites. Não descontar
    // nada antes da confirmação de identidade.
    if(candidates.length===1){
      const candidate=candidates[0];
      const preview=el("details","nhp-vales-details nhp-prelink-preview");
      const rows=candidate.parcelas_pendentes||[];
      const current=rows.filter(x=>x.competencia===report.competencia);
      preview.append(el("summary","",
        current.length+" vale(s) de "+report.competencia+
        " · "+fmt(candidate.vales_previstos)+
        " — identificação ainda não confirmada"));
      const body=el("div","nhp-vales-body");
      const group=el("div","nhp-vales-group");
      group.append(el("h4","","Vales identificados em Meus Controles"));
      for(const item of rows){
        group.append(info(item.titulo,
          "Parcela "+item.parcela+" · Descontar em "+item.competencia+
          " · já pago "+fmt(item.ja_descontado),
          item.saldo,item.competencia<report.competencia?"late":""));
      }
      if(!rows.length)
        group.append(el("p","nhp-empty","Sem parcelas ainda pendentes."));
      body.append(group);preview.append(body);section.append(preview);
    }
    if(!allUnlinked.length)return section;
    const controls=el("div","nhp-link-controls");
    const select=el("select","nhp-link-select");
    select.setAttribute("aria-label","Vincular cadastro de Vales ao funcionário");
    const blank=el("option","","Selecionar funcionário em Vales…");
    blank.value="";select.append(blank);
    for(const candidate of allUnlinked){
      const option=el("option","",
        candidate.nome+" · vale do mês "+fmt(candidate.vales_previstos));
      option.value=String(candidate.vale_employee_id);
      if(candidates.length===1&&Number(candidates[0].vale_employee_id)===
          Number(candidate.vale_employee_id))option.selected=true;
      select.append(option);
    }
    if(candidates.length===1)select.value=String(candidates[0].vale_employee_id);
    const button=el("button","nhp-confirm-link","Confirmar vínculo");
    button.type="button";button.addEventListener("click",async()=>{
      const selected=allUnlinked.find(x=>Number(x.vale_employee_id)===Number(select.value));
      if(!selected)return;
      button.disabled=true;
      try{
        const response=await fetch(BASE+"vales-holerites/vincular",{
          method:"POST",credentials:"same-origin",cache:"no-store",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            vale_employee_id:selected.vale_employee_id,contas_employee_id:person.id
          })
        });
        const saved=await response.json();
        if(!response.ok||!saved.ok)throw new Error(saved.erro||"Não foi possível vincular.");
        dashboard=null;until=0;
        await hydrate(true);
      }catch(e){
        error(e.message||"Falha ao vincular cadastro de Vales");
      }finally{button.disabled=false}
    });
    controls.append(select,button);
    section.append(controls);
    return section;
  }
  async function hydrate(force=false){
    if(view.hidden)return;
    const serial=++renderSerial;
    let report;
    try{report=await data(force)}
    catch(e){if(serial===renderSerial)error(e.message);return}
    if(serial!==renderSerial||view.hidden)return;
    const people=new Map(report.funcionarios.map(person=>[Number(person.id),person]));
    for(const card of list.querySelectorAll(".payroll-person")){
      const id=getId(card),person=people.get(id);
      if(!id||!person)continue;
      card.querySelectorAll(".nhp-vales-inline,.nhp-review-button,.nhp-discount-applied,.nhp-discount-not-applied,.nhp-alert-text")
        .forEach(n=>n.remove());
      const head=card.querySelector(".payroll-person-head");
      if(!head)continue;
      head.after(person.vales_ids?.length?
        valesSection(person,report):linkSection(person,report));
      for(const btn of card.querySelectorAll("[data-payroll-account]")){
        const row=btn.closest(".payroll-month");
        if(row)payRowLabel(person,Number(btn.dataset.payrollAccount),row);
      }
    }
    error("");
  }

  // A rotina original substitui os cards via innerHTML. Observar apenas
  // os filhos diretos impede o loop gerado pelos nossos próprios detalhes.
  const observer=new MutationObserver(()=>void hydrate());
  observer.observe(list,{childList:true});
  if(!view.hidden)void hydrate();
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden&&!view.hidden)void hydrate();
  });
})();
