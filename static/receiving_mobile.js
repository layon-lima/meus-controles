/* MEUS CONTROLES — painel mobile somente leitura.
   Uma seção por fornecedor, produtos diretos sem agrupamento por pedido.
   Não cria, altera ou exclui pedidos/recebimentos. */
"use strict";
(function(){
  if(typeof window==="undefined"||typeof document==="undefined")return;
  const media=window.matchMedia("(max-width: 820px), (hover: none) and (pointer: coarse)");
  if(!media.matches)return;

  const $=id=>document.getElementById(id);
  const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const normalize=value=>String(value??"").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").trim().replace(/\s+/g," ");
  const unit=code=>({
    "l":"L","lt":"L","lts":"L","litro":"L","litros":"L",
    "kg":"kg","kgs":"kg","t":"t","ton":"t","tn":"t","toneladas":"t",
    "un":"un","und":"un","unidade":"un","unidades":"un",
    "sc":"sc","cx":"cx","pct":"pct","m":"m","m²":"m²","m³":"m³"
  })[String(code||"un").trim().toLocaleLowerCase("pt-BR")]||String(code||"un");
  const fmt=value=>new Intl.NumberFormat("pt-BR",{maximumFractionDigits:3})
    .format(Number(value)||0);
  const state={
    control:null,data:null,closed:new Set(),loading:false,lastSuccess:0,error:null
  };

  async function json(path){
    const response=await fetch(path,{method:"GET",cache:"no-store",credentials:"same-origin"});
    if(!response.ok)throw new Error("Servidor indisponível ("+response.status+").");
    return response.json();
  }

  function groupsOf(items){
    const suppliers=new Map();
    for(const item of items||[]){
      const name=String(item.supplier||"Fornecedor não informado").trim();
      const key=normalize(name);
      if(!suppliers.has(key))suppliers.set(key,{key,name,items:[]});
      suppliers.get(key).items.push(item);
    }
    return [...suppliers.values()].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"))
      .map(group=>({
        ...group,
        // Preserva cada produto cadastrado em seu pedido, sem somar
        // quantidades de pedidos diferentes e sem exibir o número do pedido.
        items:group.items.sort((a,b)=>
          String(a.product||"").localeCompare(String(b.product||""),"pt-BR",
          {numeric:true})||Number(a.id)-Number(b.id))
      }));
  }

  function renderProduct(item){
    const label=escape(item.product||"Produto sem nome");
    const u=escape(unit(item.unit));
    const received=fmt(item.received_qty);
    const remaining=fmt(item.remaining_qty);
    return '<article class="mr-product">'+
      '<h3 class="mr-product-title">'+label+'</h3>'+
      '<div class="mr-product-values">'+
        '<div class="mr-value mr-value-received">'+
          '<span>Recebido</span><strong>'+received+' <small>'+u+'</small></strong>'+
        '</div>'+
        '<div class="mr-value mr-value-remaining">'+
          '<span>Falta receber</span><strong>'+remaining+' <small>'+u+'</small></strong>'+
        '</div>'+
      '</div></article>';
  }

  function renderGroups(){
    const root=$("mobileReceivingList");
    if(!root)return;
    if(!state.data)return;
    const groups=groupsOf(state.data.items);
    root.innerHTML=groups.length?groups.map(group=>{
      const expanded=!state.closed.has(group.key);
      return '<section class="mr-supplier">'+
        '<h2 class="mr-supplier-heading"><button type="button" class="mr-supplier-toggle" '+
          'data-supplier="'+escape(group.key)+'" aria-expanded="'+expanded+'" '+
          'aria-label="'+escape((expanded?"Recolher":"Expandir")+" fornecedor "+group.name)+'">'+
          escape(group.name)+'</button></h2>'+
        (expanded?
          '<div class="mr-supplier-products">'+group.items.map(renderProduct).join("")+'</div>':"")+
      '</section>';
    }).join(""):
      '<div class="mr-empty"><strong>Nenhum pedido cadastrado.</strong>'+
      '<p>Os produtos aparecerão aqui quando forem cadastrados.</p></div>';
  }

  function showError(message){
    state.error=message;
    const box=$("mobileReceivingFeedback");
    if(box){box.hidden=false;box.textContent=message;}
    if(!state.data){
      $("mobileReceivingList").innerHTML=
        '<div class="mr-empty"><strong>Não foi possível carregar os recebimentos.</strong>'+
        '<p>Confira a conexão. A consulta será repetida automaticamente.</p></div>';
    }
  }

  async function refresh(){
    if(state.loading)return;
    state.loading=true;
    try{
      let control=state.control;
      if(!control){
        const response=await json("/api/state");
        const all=(response.controls||[]).filter(c=>c.mode==="recebimento");
        const folders=new Set((response.boards||[])
          .filter(b=>normalize(b.name)==="recebimentos").map(b=>b.id));
        const candidates=all.filter(c=>folders.has(c.board_id));
        if(candidates.length>1)throw new Error("Mais de uma central de recebimentos encontrada.");
        control=candidates[0]||
          all.find(c=>normalize(c.name)==="recebimento de produtos")||
          (all.length===1?all[0]:null);
        if(!control)throw new Error("Central de Recebimento de Produtos não encontrada.");
        state.control=control;
      }
      const data=await json("/api/controls/"+encodeURIComponent(control.id)+"/receiving");
      if(!Array.isArray(data.items))throw new Error("Dados de pedidos inválidos.");
      state.data=data;
      state.lastSuccess=Date.now();
      state.error=null;
      const notice=$("mobileReceivingFeedback");
      if(notice){notice.hidden=true;notice.textContent="";}
      renderGroups();
    }catch(err){
      showError(err.message||"Falha na conexão com os recebimentos.");
    }finally{
      state.loading=false;
    }
  }

  const root=$("mobileReceiving");
  if(!root)return;
  document.title="Recebimentos | Meus Controles";
  root.addEventListener("click",event=>{
    const button=event.target.closest("[data-supplier]");
    if(!button)return;
    const key=button.dataset.supplier;
    if(state.closed.has(key))state.closed.delete(key);
    else state.closed.add(key);
    renderGroups();
  });
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden&&Date.now()-state.lastSuccess>30000)refresh();
  });
  window.addEventListener("online",refresh);
  window.MobileReceiving={refresh,isMobile:true,groupsOf};
  refresh();
  window.setInterval(()=>{if(!document.hidden)refresh();},60000);
  media.addEventListener?.("change",()=>window.location.reload());
})();
