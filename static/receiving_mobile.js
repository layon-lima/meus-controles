/* MEUS CONTROLES — acompanhamento mobile SOMENTE LEITURA.
   Mesma API e mesmo endereço da Central. Nenhum POST, PATCH ou DELETE. */
"use strict";
(function(){
  if(typeof window==="undefined"||typeof document==="undefined")return;
  const media=window.matchMedia("(max-width: 820px)");
  if(!media.matches)return;
  const $=id=>document.getElementById(id);
  const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm=value=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
  const unit=code=>({
    "L":"L","l":"L","lt":"L","kg":"kg","t":"t","ton":"t",
    "un":"un","und":"un","sc":"sc","cx":"cx","pct":"pct",
    "m":"m","m²":"m²","m³":"m³"
  })[String(code||"").trim()]||String(code||"un");
  const fmt=n=>new Intl.NumberFormat("pt-BR",{maximumFractionDigits:3}).format(Number(n)||0);
  const state={
    data:null,control:null,filter:"all",query:"",
    collapsed:new Set(),openOrders:new Set(),openNotes:new Set(),
    loading:false,lastUpdate:null,error:null,hasInteracted:false
  };
  const status=item=>{
    const asked=Number(item.ordered_qty)||0;
    const got=Number(item.received_qty)||0;
    const remaining=Number(item.remaining_qty)||0;
    if(got>0&&(item.closed||remaining<=.0001))return "complete";
    if(got>0)return "partial";
    return "pending";
  };
  const labels={complete:"Concluído",partial:"Parcial",pending:"Pendente"};
  const symbol={complete:"✓",partial:"◐",pending:"·"};
  const quote=sel=>sel.replace(/[^a-zA-Z0-9_-]/g,"");
  const statusClass=s=>"mr-status mr-"+quote(s);
  function error(message){
    state.error=message;
    $("mobileReceivingFeedback").textContent=message;
    $("mobileReceivingFeedback").hidden=false;
  }
  function clearError(){
    state.error=null;
    $("mobileReceivingFeedback").hidden=true;
    $("mobileReceivingFeedback").textContent="";
  }
  async function json(path){
    const response=await fetch(path,{method:"GET",cache:"no-store",credentials:"same-origin"});
    if(!response.ok)throw new Error("Servidor indisponível ("+response.status+").");
    return response.json();
  }
  const groupKey=s=>norm(s).trim().replace(/\s+/g," ");
  function groupsOf(items){
    const map=new Map();
    (items||[]).forEach(item=>{
      const supplier=String(item.supplier||"Fornecedor não informado").trim();
      const sk=groupKey(supplier);
      if(!map.has(sk))map.set(sk,{key:sk,name:supplier,orders:new Map()});
      const g=map.get(sk),o=String(item.order_number||"Sem número").trim();
      const key=o.toLocaleLowerCase("pt-BR");
      if(!g.orders.has(key))g.orders.set(key,{key,number:o,items:[]});
      g.orders.get(key).items.push(item);
    });
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"))
      .map(g=>({...g,orders:[...g.orders.values()].sort((a,b)=>
        a.number.localeCompare(b.number,"pt-BR",{numeric:true}))}));
  }
  function counters(items){
    const out={all:0,pending:0,partial:0,complete:0};
    for(const item of items){out.all++;out[status(item)]++;}
    return out;
  }
  function statusChip(item){
    const s=status(item);
    return '<span class="'+statusClass(s)+'">'+symbol[s]+' '+labels[s]+'</span>';
  }
  function notesFor(item){
    const rows=(state.data?.receipts||[]).filter(x=>x.item_id===item.id);
    if(!rows.length)return "";
    const id=String(item.id);
    return '<button type="button" class="mr-notes-toggle" data-notes="'+escape(id)+'" '+
      'aria-expanded="'+state.openNotes.has(id)+'">'+
      rows.length+' nota'+(rows.length===1?'':'s')+' recebida'+(rows.length===1?'':'s')+
      '<span aria-hidden="true">⌄</span></button>'+
      (state.openNotes.has(id)?'<div class="mr-notes">'+rows.map(x=>
        '<div class="mr-note"><div><strong>NF-e '+escape(x.invoice_number||"—")+'</strong>'+
        '<span>'+escape((x.received_date||"").split("-").reverse().join("/")||"")+'</span></div>'+
        '<b>'+fmt(x.received_qty)+' '+escape(unit(item.unit))+'</b></div>').join("")+'</div>':"");
  }
  function renderProduct(item){
    const asked=Math.max(0,Number(item.ordered_qty)||0);
    const got=Math.max(0,Number(item.received_qty)||0);
    const rest=Math.max(0,Number(item.remaining_qty)||0);
    const pct=asked>0?Math.max(0,Math.min(100,got/asked*100)):0;
    const s=status(item);
    return '<article class="mr-product">'+
      '<div class="mr-product-name"><h4>'+escape(item.product||"Produto sem nome")+'</h4>'+statusChip(item)+'</div>'+
      '<div class="mr-numbers">'+
        '<div><span>Pedido</span><strong>'+fmt(asked)+'</strong></div>'+
        '<div><span>Recebido</span><strong class="mr-value-green">'+fmt(got)+'</strong></div>'+
        '<div><span>Falta receber</span><strong class="mr-value-amber">'+fmt(rest)+'</strong></div>'+
      '</div>'+
      '<div class="mr-unit">Quantidades em '+escape(unit(item.unit))+'</div>'+
      '<div class="mr-progress" role="progressbar" aria-label="Percentual recebido" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(pct)+'">'+
      '<span class="mr-progress-fill mr-fill-'+s+'" style="width:'+pct.toFixed(2)+'%"></span></div>'+
      notesFor(item)+'</article>';
  }
  function renderOrders(group){
    const search=norm(state.query.trim());
    return group.orders.map(o=>{
      const matches=o.items.filter(item=>{
        const combined=norm(group.name+" "+o.number+" "+item.product);
        return (!search||combined.includes(search))&&(state.filter==="all"||status(item)===state.filter);
      });
      if(!matches.length)return "";
      const key=group.key+"|"+o.key;
      const isOpen=state.openOrders.has(key)||Boolean(search);
      const stats=counters(matches);
      return '<div class="mr-order"><button class="mr-order-toggle" type="button" data-order="'+escape(key)+'" aria-expanded="'+isOpen+'">'+
        '<div><strong>Pedido '+escape(o.number)+'</strong><span>'+matches.length+' produto'+(matches.length===1?'':'s')+'</span></div>'+
        '<div class="mr-order-right"><span>'+stats.complete+' concluído'+(stats.complete===1?'':'s')+'</span><span class="mr-chevron '+(isOpen?'is-open':'')+'">⌄</span></div>'+
        '</button>'+(isOpen?'<div class="mr-order-products">'+matches.map(renderProduct).join("")+'</div>':"")+'</div>';
    }).join("");
  }
  function renderGroups(){
    const items=state.data?.items||[];
    const groups=groupsOf(items);
    const search=norm(state.query.trim());
    let shown=0;
    const html=groups.map(g=>{
      const entries=g.orders.flatMap(o=>o.items).filter(i=>
        (!search||norm(g.name+" "+i.order_number+" "+i.product).includes(search))&&
        (state.filter==="all"||status(i)===state.filter));
      if(!entries.length)return "";
      shown+=entries.length;
      const orders=new Set(entries.map(i=>String(i.order_number))).size;
      const open=search||!state.collapsed.has(g.key);
      const complete=entries.filter(i=>status(i)==="complete").length;
      return '<section class="mr-supplier">'+
        '<button type="button" class="mr-supplier-toggle" data-supplier="'+escape(g.key)+'" aria-expanded="'+open+'">'+
        '<span class="mr-supplier-icon">▦</span>'+
        '<span class="mr-supplier-title"><strong>'+escape(g.name)+'</strong>'+
        '<small>'+orders+' pedido'+(orders===1?'':'s')+' · '+entries.length+' produto'+(entries.length===1?'':'s')+'</small></span>'+
        '<span class="mr-supplier-right"><b>'+complete+'/'+entries.length+'</b>'+
        '<span class="mr-chevron '+(open?'is-open':'')+'">⌄</span></span></button>'+
        (open?'<div class="mr-supplier-body">'+renderOrders(g)+'</div>':"")+
        '</section>';
    }).join("");
    $("mobileReceivingList").innerHTML=html||
      '<div class="mr-empty"><strong>Nenhum produto encontrado.</strong>'+
      '<p>Experimente outra busca ou filtro.</p></div>';
    $("mobileReceivingShown").textContent=shown+' produto'+(shown===1?'':'s')+' exibido'+(shown===1?'':'s');
  }
  function render(){
    if(!state.data)return;
    const count=counters(state.data.items||[]);
    $("mobileReceivingAll").textContent=count.all;
    $("mobileReceivingComplete").textContent=count.complete;
    $("mobileReceivingPartial").textContent=count.partial;
    $("mobileReceivingPending").textContent=count.pending;
    $("mobileReceivingDate").textContent=state.lastUpdate?
      "Atualizado às "+state.lastUpdate.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):"";
    document.querySelectorAll("#mobileReceiving [data-filter]").forEach(b=>{
      const active=b.dataset.filter===state.filter;
      b.classList.toggle("is-active",active);
      b.setAttribute("aria-pressed",String(active));
    });
    renderGroups();
  }
  async function refresh(){
    if(state.loading)return;
    state.loading=true;
    $("mobileReceivingRefresh").disabled=true;
    $("mobileReceivingRefresh").classList.add("is-loading");
    try{
      let control=state.control;
      if(!control){
        const response=await json("/api/state");
        const all=(response.controls||[]).filter(x=>x.mode==="recebimento");
        const folders=new Set((response.boards||[]).filter(x=>groupKey(x.name)==="recebimentos").map(x=>x.id));
        const selected=all.filter(x=>folders.has(x.board_id));
        if(selected.length>1)throw new Error("Há mais de uma central de recebimentos. Verifique no computador.");
        control=selected[0]||all.find(x=>groupKey(x.name)==="recebimento de produtos");
        if(!control&&all.length===1)control=all[0];
        if(!control)throw new Error("Central de Recebimento de Produtos não encontrada.");
        state.control=control;
      }
      const data=await json("/api/controls/"+encodeURIComponent(control.id)+"/receiving");
      if(!Array.isArray(data.items)||!Array.isArray(data.receipts))throw new Error("Dados de recebimento inválidos.");
      state.data=data;state.lastUpdate=new Date();clearError();
      if(!state.hasInteracted){
        // Primeiro acesso: mostrar apenas fornecedores para evitar uma lista gigantesca.
        state.collapsed=new Set(groupsOf(data.items).map(g=>g.key));
        state.hasInteracted=true;
      }
      render();
    }catch(err){
      error(err.message||"Falha ao atualizar os pedidos.");
      if(!state.data)$("mobileReceivingList").innerHTML=
        '<div class="mr-empty"><strong>Não consegui carregar os pedidos.</strong>'+
        '<p>Confira a conexão e toque em Atualizar.</p></div>';
    }finally{
      state.loading=false;
      $("mobileReceivingRefresh").disabled=false;
      $("mobileReceivingRefresh").classList.remove("is-loading");
    }
  }
  const root=$("mobileReceiving");
  if(!root)return;
  root.addEventListener("click",event=>{
    const filter=event.target.closest("[data-filter]");
    if(filter){state.filter=filter.dataset.filter;render();return;}
    const supplier=event.target.closest("[data-supplier]");
    if(supplier){
      const key=supplier.dataset.supplier;
      state.collapsed.has(key)?state.collapsed.delete(key):state.collapsed.add(key);
      renderGroups();return;
    }
    const order=event.target.closest("[data-order]");
    if(order){
      const key=order.dataset.order;
      state.openOrders.has(key)?state.openOrders.delete(key):state.openOrders.add(key);
      renderGroups();return;
    }
    const notes=event.target.closest("[data-notes]");
    if(notes){
      const key=notes.dataset.notes;
      state.openNotes.has(key)?state.openNotes.delete(key):state.openNotes.add(key);
      renderGroups();
    }
  });
  $("mobileReceivingSearch").addEventListener("input",event=>{
    state.query=event.target.value;
    renderGroups();
  });
  $("mobileReceivingRefresh").addEventListener("click",()=>refresh());
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden&&state.lastUpdate&&Date.now()-state.lastUpdate.getTime()>30000)refresh();
  });
  window.addEventListener("online",()=>refresh());
  window.MobileReceiving={refresh,isMobile:true,groupsOf,status,counters};
  refresh();
  // Consulta silenciosa: acompanha lançamentos feitos na VPS sem recarregar a tela.
  window.setInterval(()=>{if(!document.hidden)refresh()},60000);
  media.addEventListener?.("change",()=>window.location.reload());
})();
