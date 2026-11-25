"use strict";
/* NOVO módulo de Recebimentos — código próprio da Central.
 * Somente os contratos de negócio existentes são usados via JSON.
 * Não existe App legado, DOM substituído depois da carga nem iframe.
 */
(() => {
  const ROOT = "/central/modules/recebimentos";
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const normal = x => String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLocaleLowerCase("pt-BR").trim();
  const money = x => (Number(x)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  const qty = x => Number(x||0).toLocaleString("pt-BR",{maximumFractionDigits:3});
  const dateBr = value => /^\d{4}-\d{2}-\d{2}/.test(value||"") ?
    String(value).slice(8,10)+"/"+String(value).slice(5,7)+"/"+String(value).slice(0,4) : (value||"—");
  const today = () => {
    const d=new Date(),p=n=>String(n).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
  };
  const dec = raw => {
    const text=String(raw||"").trim().replace(/\s/g,"").replace(",",".");
    if (!/^\d+(?:\.\d{1,3})?$/.test(text) || Number(text)<=0)
      throw new Error("Informe uma quantidade positiva, com até 3 casas decimais e sem separador de milhar.");
    return text;
  };
  const store = {
    boards:[],controls:[],controlId:null,data:null,pending:[],tab:"pedidos",
    search:"",collapsed:new Set(),busy:false,revision:0
  };
  let modal=null;
  async function api(path,method="GET",body,kind="json") {
    const resp=await fetch(ROOT+path,{
      method,credentials:"same-origin",cache:"no-store",
      headers:body===undefined?{Accept:"application/json"}:
        {"Content-Type":"application/json",Accept:kind==="blob"?"*/*":"application/json"},
      body:body===undefined?undefined:JSON.stringify(body)
    });
    if(kind==="blob"){
      if(!resp.ok)throw new Error("Não foi possível gerar o arquivo Excel.");
      return resp.blob();
    }
    const json=await resp.json().catch(()=>({error:"Resposta inválida do motor de recebimentos."}));
    if(!resp.ok)throw new Error(json.error||json.erro||"Falha ao executar operação de recebimento.");
    return json;
  }
  const cid=()=>store.controlId;
  const route=(part="")=>"/api/controls/"+cid()+"/receiving"+part;
  const items=()=>store.data?.items||[];
  const receipts=()=>store.data?.receipts||[];
  function toast(message,error=false) {
    const holder=$("#rx-notifications");
    const el=document.createElement("div");
    el.className="rx-toast"+(error?" error":"");
    el.textContent=message;
    holder.append(el);
    setTimeout(()=>el.remove(),4600);
  }
  function status(message,loading=false) {
    const el=$("#rx-status");
    el.textContent=message;
    el.classList.toggle("rx-loading",loading);
    el.hidden=!message;
  }
  function setBusy(value) {
    store.busy=!!value;
    document.querySelectorAll("[data-action],#rx-refresh,#rx-control").forEach(
      button=>button.disabled=!!value
    );
  }
  function dialog(title,subtitle,body,onSubmit,saveText="Salvar") {
    closeDialog();
    const host=$("#rx-dialog-layer");
    host.innerHTML='<div class="rx-dialog-mask" id="rx-mask"><section class="rx-dialog" role="dialog" '+
      'aria-modal="true" aria-labelledby="rx-dialog-title">'+
      '<header class="rx-dialog-head"><div><h2 id="rx-dialog-title">'+esc(title)+'</h2>'+
      (subtitle?'<p>'+esc(subtitle)+'</p>':"")+'</div>'+
      '<button class="rx-close" type="button" data-close aria-label="Fechar">×</button></header>'+
      '<form id="rx-dialog-form" class="rx-form" autocomplete="off"><div class="rx-dialog-body">'+body+'</div>'+
      '<footer class="rx-dialog-foot"><button class="rx-button" type="button" data-close>Cancelar</button>'+
      (onSubmit?'<button class="rx-button rx-button-primary" type="submit" id="rx-submit">'+esc(saveText)+'</button>':"")+
      '</footer></form></section></div>';
    const mask=$("#rx-mask"),form=$("#rx-dialog-form");
    const close=()=>closeDialog();
    mask.addEventListener("click",e=>{if(e.target===mask||e.target.closest("[data-close]"))close()});
    form.addEventListener("submit",async e=>{
      e.preventDefault();
      if(!onSubmit||store.busy||!form.reportValidity())return;
      const button=$("#rx-submit");
      try{
        setBusy(true);if(button){button.disabled=true;button.textContent="Salvando…"}
        await onSubmit(new FormData(form),form);
        closeDialog();
      }catch(error){toast(error.message,true)}
      finally{setBusy(false);if(button&&button.isConnected){button.disabled=false;button.textContent=saveText}}
    });
    modal=mask;
    mask.querySelector("input,select,button")?.focus({preventScroll:true});
    return {mask,form,body:mask.querySelector(".rx-dialog-body")};
  }
  function closeDialog(){
    if(modal){modal.remove();modal=null}
    $("#rx-dialog-layer").replaceChildren();
  }
  function field(label,name,value="",attrs="",wide=false){
    return '<label class="rx-field'+(wide?" wide":"")+'"><span>'+esc(label)+'</span>'+
      '<input name="'+esc(name)+'" value="'+esc(value)+'" '+attrs+'></label>';
  }
  function select(label,name,options,value="",wide=false) {
    return '<label class="rx-field'+(wide?" wide":"")+'"><span>'+esc(label)+'</span>'+
      '<select name="'+esc(name)+'">'+options.map(([id,text])=>
        '<option value="'+esc(id)+'" '+(String(id)===String(value)?"selected":"")+'>'+esc(text)+'</option>'
      ).join("")+'</select></label>';
  }
  function normalizeFiscal(form) {
    const v=name=>String(form.get(name)||"").trim();
    return {
      date:v("date"),invoice_number:v("invoice_number"),access_key:v("access_key"),
      quantity:dec(v("quantity")),notes:v("notes"),
      serie:v("serie"),data_emissao:v("data_emissao"),
      fornecedor:v("fornecedor"),documento_fornecedor:v("documento_fornecedor"),
      valor_unitario:v("valor_unitario").replace(",","."),
      codigo_produto:v("codigo_produto"),cfop:v("cfop"),ncm:v("ncm"),
      lote:v("lote"),validade:v("validade"),origem_arquivo:"manual"
    };
  }
  function blank(title,desc){
    return '<div class="rx-blank"><strong>'+esc(title)+'</strong><span>'+esc(desc)+'</span></div>';
  }
  function loading(){
    status("Consultando pedidos e notas fiscais…",true);
    $("#rx-results").innerHTML=blank("Carregando recebimentos","Buscando dados no motor de recebimentos.");
  }
  function currentControl(){return store.controls.find(c=>Number(c.id)===Number(cid()))||null}
  function renderControlSelect(){
    const el=$("#rx-control");
    const receiving=store.controls.filter(c=>c.mode==="recebimento");
    el.innerHTML=receiving.length?
      receiving.map(c=>'<option value="'+Number(c.id)+'">'+esc(c.name)+'</option>').join(""):
      '<option value="">Nenhum controle cadastrado</option>';
    if(receiving.length)el.value=String(cid());
    el.disabled=!receiving.length;
  }
  function renderMetrics(){
    const t=store.data?.totals;
    const entries=[
      ["Produtos",t?.items,"products",'<path d="M3 7 12 2l9 5v10l-9 5-9-5zM3 7l9 5 9-5M12 12v10M7.5 4.5l9 5"/>'],
      ["Pendentes",t?.pending,"pending",'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
      ["Parciais",t?.partial,"partial",'<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/>'],
      ["Concluídos",t?.complete,"complete",'<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10zM8 12l3 3 5-6"/>'],
      ["Entregas",t?.receipts,"deliveries",'<path d="M3 5h12v12H3zM15 9h4l3 4v4h-7M7 17v1M18 17v1"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>']
    ];
    $("#rx-metrics").innerHTML=entries.map(([name,value,kind,icon])=>
      '<article class="rx-metric rx-metric-'+kind+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icon+'</svg><span>'+name+'</span><strong>'+(value==null?"—":qty(value))+'</strong></article>').join("");
  }
  function renderOrders(){
    let rows=items().filter(p=>normal([p.order_number,p.supplier,p.product].join(" ")).includes(normal(store.search)));
    if(!rows.length)return blank("Nenhum produto encontrado","Cadastre ou importe pedidos para começar.");
    const groups=new Map();
    for(const row of rows){
      const key=normal(row.supplier)||"sem fornecedor";
      if(!groups.has(key))groups.set(key,{name:row.supplier||"Fornecedor não informado",rows:[]});
      groups.get(key).rows.push(row);
    }
    // Cards individuais; colunas com as mesmas proporções em todos.
    const columns='<colgroup><col class="rx-col-order"><col class="rx-col-product"><col class="rx-col-qty"><col class="rx-col-qty"><col class="rx-col-qty"><col class="rx-col-status"><col class="rx-col-actions"></colgroup>'+
      '<thead><tr><th scope="col">Pedido</th><th scope="col">Produto</th><th scope="col" class="rx-number">Qtd. pedida</th>'+
      '<th scope="col" class="rx-number">Recebido</th><th scope="col" class="rx-number">Falta</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead>';
    return [...groups.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name,"pt-BR"))
      .map(([key,group])=>{
        const expanded=!store.collapsed.has(key);
        return '<article class="rx-group rx-supplier-card '+(expanded?"is-open":"")+'">'+
          '<button type="button" class="rx-group-head" data-group="'+esc(key)+'" aria-expanded="'+expanded+'">'+
          '<span class="rx-supplier-label"><strong>'+esc(group.name)+'</strong><small>'+group.rows.length+' produto(s)</small></span>'+
          '<span class="rx-group-icon" aria-hidden="true">›</span></button>'+
          (expanded?'<div class="rx-group-table rx-orders-table"><table class="rx-table">'+columns+
            '<tbody>'+group.rows.map(p=>'<tr class="rx-order-line">'+
            '<td><strong>'+esc(p.order_number)+'</strong></td>'+
            '<td><strong>'+esc(p.product)+'</strong><small>'+esc(p.unit)+'</small></td>'+
            '<td class="rx-number">'+qty(p.ordered_qty)+'</td>'+
            '<td class="rx-number">'+qty(p.received_qty)+'</td>'+
            '<td class="rx-number">'+qty(p.remaining_qty)+'</td>'+
            '<td><span class="rx-pill '+esc(p.status)+'">'+
              (p.closed?"Concluído":p.status==="complete"?"Recebido":p.status==="partial"?"Parcial":"Pendente")+
            '</span></td>'+
            '<td><div class="rx-inline-actions">'+
            (!p.closed&&Number(p.remaining_qty)>0?'<button class="rx-button rx-button-small" data-action="receive" data-id="'+p.id+'">Receber</button>':"")+
            '<button class="rx-button rx-button-small" data-action="edit-item" data-id="'+p.id+'">Editar</button>'+
            '</div></td></tr>').join("")+'</tbody></table></div>':"")+
          '</article>';
      }).join("");
  }
  function renderNotes(){
    const data=receipts().filter(r=>normal([r.invoice_number,r.access_key,r.product,r.supplier,r.order_number].join(" ")).includes(normal(store.search)));
    if(!data.length)return blank("Nenhuma nota encontrada","As notas conferidas aparecem nesta área.");
    return '<div class="rx-group"><div class="rx-group-table"><table class="rx-table">'+
      '<thead><tr><th>NF-e</th><th>Data</th><th>Fornecedor / produto</th><th>Pedido</th>'+
      '<th class="rx-number">Quantidade</th><th>GFARM</th><th></th></tr></thead><tbody>'+
      data.map(r=>'<tr><td><strong>'+esc(r.invoice_number)+'</strong><small>'+esc(r.access_key||"Sem chave")+'</small></td>'+
        '<td>'+dateBr(r.received_date)+'</td>'+
        '<td><strong>'+esc(r.supplier||"Emitente não identificado")+'</strong><small>'+esc(r.product)+'</small></td>'+
        '<td>'+esc(r.order_number)+'</td><td class="rx-number">'+qty(r.received_qty)+' '+esc(r.unit)+'</td>'+
        '<td><span class="rx-pill">'+esc(r.gfarm_status||"NAO_ENVIADO").replaceAll("_"," ")+'</span></td>'+
        '<td><div class="rx-inline-actions">'+
        (r.gfarm_status==="NAO_ENVIADO"?
        '<button class="rx-button rx-button-small" data-action="gfarm" data-id="'+r.id+'">GFARM</button>':"")+
        '<button class="rx-button rx-button-small" data-action="edit-receipt" data-id="'+r.id+'">Editar</button>'+
        '</div></td></tr>').join("")+
      '</tbody></table></div></div>';
  }
  function renderPending(){
    const entries=store.pending.filter(x=>normal([x.invoice_number,x.supplier,x.product,x.access_key].join(" ")).includes(normal(store.search)));
    if(!entries.length)return blank("Nenhum item sem pedido","Itens de NF-e aguardando vínculo aparecerão aqui.");
    return '<div class="rx-group"><div class="rx-group-table"><table class="rx-table"><thead><tr>'+
      '<th>Nota</th><th>Emitente</th><th>Produto</th><th>Quantidade</th><th></th></tr></thead><tbody>'+
      entries.map(p=>'<tr><td><strong>'+esc(p.invoice_number)+'</strong></td>'+
        '<td>'+esc(p.supplier)+'</td><td>'+esc(p.product)+'</td>'+
        '<td>'+qty(p.quantity)+' '+esc(p.unit)+'</td>'+
        '<td><button class="rx-button rx-button-small" data-action="assign" data-id="'+p.id+'">Vincular pedido</button></td></tr>').join("")+
      '</tbody></table></div></div>';
  }
  function render(){
    renderControlSelect();
    $("#rx-content").hidden=!store.data;
    if(!store.data){
      document.querySelectorAll(".rx-actions [data-action]").forEach(button=>button.disabled=true);
      return;
    }
    document.querySelectorAll(".rx-actions [data-action]").forEach(button=>button.disabled=false);
    renderMetrics();
    document.querySelectorAll("[data-tab]").forEach(button=>{
      const selected=button.dataset.tab===store.tab;
      button.classList.toggle("is-active",selected);
      if(selected)button.setAttribute("aria-current","page");
      else button.removeAttribute("aria-current");
    });
    $("#rx-results").innerHTML=store.tab==="pedidos"?renderOrders():
      store.tab==="notas"?renderNotes():renderPending();
  }
  async function loadAll(preferred){
    const ticket=++store.revision;
    store.data=null;store.pending=[];$("#rx-content").hidden=true;
    renderMetrics();
    loading();
    try{
      const state=await api("/api/state");
      if(ticket!==store.revision)return;
      store.boards=state.boards||[];
      store.controls=(state.controls||[]).filter(c=>c.mode==="recebimento");
      const ids=new Set(store.controls.map(c=>Number(c.id)));
      const desired=Number(preferred||cid());
      store.controlId=ids.has(desired)?desired:(store.controls[0]?.id||null);
      renderControlSelect();
      if(!store.controlId){
        status("Nenhum controle de Recebimentos cadastrado.");
        $("#rx-results").innerHTML=blank("Cadastre o primeiro recebimento","Crie o controle e comece a registrar pedidos.");
        $("#rx-content").hidden=false;
        $("#rx-metrics").replaceChildren();
        document.querySelectorAll(".rx-actions [data-action]").forEach(button=>button.disabled=true);
        $("#rx-results").innerHTML='<div class="rx-blank"><strong>Primeiro acesso</strong>'+
          '<p>Crie um controle de Recebimentos para começar.</p>'+
          '<button type="button" data-action="create-control" class="rx-button rx-button-primary">Criar Recebimentos</button></div>';
        return;
      }
      const [data,pending]=await Promise.all([
        api(route()),
        api(route("/xml/pending")).catch(()=>({items:[]}))
      ]);
      if(ticket!==store.revision)return;
      store.data=data;
      store.pending=pending.items||[];
      status("");
      render();
    }catch(e){
      if(ticket!==store.revision)return;
      status("Não consegui consultar o motor de Recebimentos.");
      $("#rx-results").innerHTML=blank("Conexão indisponível",e.message);
      toast(e.message,true);
    }
  }
  async function refresh(){
    if(!cid())return loadAll();
    // Atualiza apenas o módulo corrente. Não mostra a home de Controles.
    const ticket=++store.revision;
    try{
      const [data,pending]=await Promise.all([
        api(route()),api(route("/xml/pending")).catch(()=>({items:[]}))
      ]);
      if(ticket!==store.revision)return;
      store.data=data;store.pending=pending.items||[];
      status("");render();
    }catch(e){if(ticket===store.revision)toast(e.message,true)}
  }
  function openItem(item){
    const old=!!item;
    const content='<div class="rx-form-grid">'+
      field("Número do pedido","order_number",item?.order_number||"",'required maxlength="100"')+
      field("Fornecedor","supplier",item?.supplier||"",'maxlength="160"')+
      field("Produto","product",item?.product||"",'required maxlength="160"',true)+
      field("Quantidade pedida","ordered_qty",item?.ordered_qty||"",'required inputmode="decimal" placeholder="Ex.: 250,5"')+
      select("Unidade","unit",["un","kg","t","L","sc","cx","pct","m","m²","m³"].map(x=>[x,x]),item?.unit||"un")+
      '</div>'+
      (old?'<p class="rx-help">Produto com entregas registradas não pode ter quantidade menor que o já recebido.</p>':"");
    const view=dialog(old?"Editar produto do pedido":"Novo produto / pedido",
      "O saldo será calculado automaticamente a partir das entregas.",content,async f=>{
        const payload={
          order_number:f.get("order_number"),supplier:f.get("supplier"),
          product:f.get("product"),ordered_qty:dec(f.get("ordered_qty")),unit:f.get("unit")
        };
        await api(old?"/api/receiving-items/"+item.id:route("/items"),old?"PUT":"POST",payload);
        await refresh();toast(old?"Produto atualizado.":"Produto cadastrado.");
      },old?"Salvar alterações":"Adicionar produto");
    if(old&&!item.closed){
      const buttons=view.mask.querySelector(".rx-dialog-foot");
      const drop=document.createElement("button");drop.type="button";
      drop.className="rx-button rx-button-danger";drop.textContent="Excluir";
      drop.addEventListener("click",async()=>{
        if(!confirm("Excluir produto? Pedidos com entregas não podem ser apagados."))return;
        try{await api("/api/receiving-items/"+item.id,"DELETE");closeDialog();await refresh();toast("Produto excluído.");}
        catch(e){toast(e.message,true)}
      });
      buttons.prepend(drop);
      const done=document.createElement("button");done.type="button";
      done.className="rx-button";done.textContent="Concluir pedido";
      done.addEventListener("click",async()=>{
        if(!confirm("Concluir todos os produtos deste pedido?"))return;
        try{await api("/api/receiving-items/"+item.id+"/complete","POST",{});closeDialog();await refresh();toast("Pedido concluído.");}
        catch(e){toast(e.message,true)}
      });
      buttons.prepend(done);
    }
  }
  function fiscalFields(record,item){
    let fiscal={};
    try{fiscal=JSON.parse(record?.fiscal_json||"{}")||{}}catch{}
    return '<div class="rx-form-grid">'+
      field("Data do recebimento","date",record?.received_date||today(),'type="date" required')+
      field("Número da NF-e","invoice_number",record?.invoice_number||"",'required maxlength="100"')+
      field("Quantidade recebida ("+esc(item?.unit||"un")+")","quantity",record?.received_qty||"",'required inputmode="decimal"')+
      field("Chave de acesso da NF-e (44 dígitos)","access_key",record?.access_key||"",'inputmode="numeric" pattern="[0-9]{44}" maxlength="44"',true)+
      field("Fornecedor/emitente","fornecedor",fiscal.fornecedor||record?.invoice_issuer||item?.supplier||"",'maxlength="160"')+
      field("CPF/CNPJ do emitente","documento_fornecedor",fiscal.documento_fornecedor||record?.invoice_issuer_document||"",'maxlength="18"')+
      field("Série","serie",fiscal.serie||"",'maxlength="20"')+
      field("Emissão","data_emissao",fiscal.data_emissao||today(),'type="date"')+
      field("Custo unitário (R$)","valor_unitario",fiscal.valor_unitario||"",'inputmode="decimal"')+
      field("Código do produto","codigo_produto",fiscal.codigo_produto||"",'maxlength="100"')+
      field("CFOP","cfop",fiscal.cfop||"",'maxlength="10"')+
      field("NCM","ncm",fiscal.ncm||"",'maxlength="12"')+
      field("Lote","lote",fiscal.lote||"",'maxlength="100"')+
      field("Validade","validade",fiscal.validade||"",'type="date"')+
      field("Observação","notes",record?.notes||"",'maxlength="1200"',true)+
      '</div>';
  }
  function openReceipt(item,record){
    if(!item){toast("Produto do pedido não encontrado.",true);return}
    const old=!!record;
    const title=(old?"Editar entrega":"Registrar entrega")+" · "+item.product;
    const view=dialog(title,"Pedido "+item.order_number+" · Saldo "+qty(item.remaining_qty)+" "+item.unit,
      fiscalFields(record,item),async f=>{
        const payload=normalizeFiscal(f);
        await api(old?"/api/receiving-receipts/"+record.id:
          "/api/receiving-items/"+item.id+"/receipts",old?"PUT":"POST",payload);
        await refresh();
        toast(old?"Recebimento atualizado.":"Entrega registrada. Saldo atualizado.");
      },old?"Salvar alterações":"Registrar recebimento");
    if(old){
      const foot=view.mask.querySelector(".rx-dialog-foot");
      const del=document.createElement("button");del.type="button";
      del.className="rx-button rx-button-danger";del.textContent="Excluir entrega";
      del.addEventListener("click",async()=>{
        if(!confirm("Excluir entrega? A quantidade retornará ao saldo pendente."))return;
        try{await api("/api/receiving-receipts/"+record.id,"DELETE");closeDialog();await refresh();toast("Entrega excluída.");}
        catch(e){toast(e.message,true)}
      });
      foot.prepend(del);
    }
  }
  function openAssign(p){
    const pending=items().filter(x=>!x.closed&&Number(x.remaining_qty)>0);
    if(!pending.length){toast("Não existem pedidos com saldo disponível.",true);return}
    const body='<div class="rx-form-grid">'+
      select("Produto/pedido de destino","item_id",
        pending.map(i=>[i.id,i.supplier+" · "+i.order_number+" · "+i.product+
          " (falta "+qty(i.remaining_qty)+" "+i.unit+")"]),"",true)+
      field("Quantidade equivalente na unidade do pedido (somente se necessário)",
        "manual_quantity","",'inputmode="decimal"',true)+
      '</div><p class="rx-help">Quantidade original: '+qty(p.quantity)+" "+esc(p.unit)+
      ". Se a unidade do pedido for diferente, informe a equivalência exata.</p>";
    dialog("Vincular NF-e sem pedido",p.product,body,async f=>{
      await api(route("/xml/pending/"+p.id+"/assign"),"POST",{
        item_id:Number(f.get("item_id")),
        manual_quantity:f.get("manual_quantity")?dec(f.get("manual_quantity")):null
      });
      await refresh();toast("NF-e vinculada ao pedido.");
    },"Vincular e registrar");
  }
  function openControlCreation(){
    const boards=store.boards||[];
    const opts=[...boards.map(b=>[b.id,b.name]),["new","Criar nova pasta RECEBIMENTOS"]];
    dialog("Criar controle de recebimentos",
      "A estrutura será criada no motor existente, sem modificar nenhum controle antigo.",
      '<div class="rx-form-grid">'+
        field("Nome do controle","name","Recebimento de Produtos",'required maxlength="150"')+
        select("Pasta","board_id",opts,boards[0]?.id||"new")+
        '</div>',async f=>{
        let bid=f.get("board_id");
        if(bid==="new"){
          const response=await api("/api/boards","POST",{name:"RECEBIMENTOS"});
          bid=response.id;
        }
        const r=await api("/api/controls","POST",{
          name:f.get("name"),board_id:Number(bid),mode:"recebimento",
          fields:[{key:"data",label:"Data",type:"date",required:true},
                  {key:"descricao",label:"Descrição",type:"text",required:true}],
          rules:[],types:[{key:"entrada",label:"Entrada",direction:1,source:"manual"},
                          {key:"saida",label:"Saída",direction:-1,source:"manual"}]
        });
        await loadAll(r.id);toast("Controle de recebimentos criado.");
      },"Criar controle");
  }
  function openManualInvoice(){
    const openItems=items().filter(p=>!p.closed&&Number(p.remaining_qty)>0);
    if(!openItems.length){toast("Cadastre pedidos com saldo disponível antes de registrar a NF-e.",true);return}
    const rows=[];
    let nextLineId=0;
    const first=openItems[0];
    const opts=openItems.map(p=>[p.id,p.order_number+" · "+p.supplier+" · "+p.product+" ("+p.unit+")"]);
    const common='<div class="rx-form-grid">'+
      field("Data de recebimento","date",today(),'type="date" required')+
      field("Número da NF-e","invoice_number","",'required maxlength="100"')+
      field("Chave da NF-e (44 dígitos)","access_key","",'required pattern="[0-9]{44}" maxlength="44" inputmode="numeric"',true)+
      field("Fornecedor emitente","fornecedor",first.supplier||"",'required maxlength="160"')+
      field("CNPJ/CPF emitente","documento_fornecedor","",'required maxlength="18"')+
      field("Série","serie","",'maxlength="20"')+
      field("Data de emissão","data_emissao",today(),'type="date" required')+
      field("Observação","notes","",'maxlength="1200"',true)+
      '</div>'+
      '<div class="rx-file-control">'+
      '<label class="rx-field"><span>Importar DANFE PDF para preencher os dados desta nota (opcional)</span>'+
      '<input id="rx-nfe-pdf" type="file" accept=".pdf,application/pdf"></label>'+
      '<p class="rx-help">Os campos identificados serão preenchidos para conferência antes de salvar. Nenhuma NF-e é lançada automaticamente.</p>'+
      '</div><hr><h3>Produtos da mesma nota</h3>'+
      '<div id="rx-invoice-lines"></div>'+
      '<button type="button" id="rx-add-line" class="rx-button">+ Adicionar produto</button>';
    let origemArquivo="manual";
    const ctx=dialog("Lançar NF-e manual","É possível incluir vários produtos da mesma nota numa única confirmação.",
      common,async f=>{
        const payload={
          date:f.get("date"),invoice_number:f.get("invoice_number"),
          access_key:f.get("access_key"),fornecedor:f.get("fornecedor"),
          documento_fornecedor:f.get("documento_fornecedor"),serie:f.get("serie"),
          data_emissao:f.get("data_emissao"),origem_arquivo:origemArquivo,notes:f.get("notes"),
          items:rows.map(i=>({
            item_id:Number(f.get("item_id_"+i)),
            quantity:dec(f.get("quantity_"+i)),
            valor_unitario:String(f.get("valor_unitario_"+i)||"").trim().replace(",","."),
            codigo_produto:f.get("codigo_produto_"+i)||"",
            cfop:f.get("cfop_"+i)||"",ncm:f.get("ncm_"+i)||"",
            lote:f.get("lote_"+i)||"",validade:f.get("validade_"+i)||""
          }))
        };
        await api(route("/invoice"),"POST",payload);
        await refresh();toast("NF-e registrada com "+rows.length+" produto(s).");
      },"Confirmar NF-e");
    const place=ctx.mask.querySelector("#rx-invoice-lines");
    const lineHtml=i=>'<div class="rx-preview-item" data-line="'+i+'">'+
      '<div class="rx-overlay-actions"><strong>Produto da NF-e</strong>'+
      '<button type="button" class="rx-button rx-button-small rx-button-danger" data-remove-line="'+i+'">Remover</button></div>'+
      '<div class="rx-form-grid">'+
      select("Produto/pedido","item_id_"+i,opts,first.id,true)+
      field("Quantidade","quantity_"+i,"",'required inputmode="decimal"')+
      field("Custo unitário","valor_unitario_"+i,"",'inputmode="decimal"')+
      field("Código produto","codigo_produto_"+i,"",'maxlength="100"')+
      field("CFOP","cfop_"+i,"",'maxlength="10"')+
      field("NCM","ncm_"+i,"",'maxlength="12"')+
      field("Lote","lote_"+i,"",'maxlength="100"')+
      field("Validade","validade_"+i,"",'type="date"')+
      '</div></div>';
    ctx.mask.querySelector("#rx-add-line").addEventListener("click",()=>{
      if(rows.length>=150){toast("Limite de 150 produtos por NF-e.",true);return}
      const i=nextLineId++;rows.push(i);
      place.insertAdjacentHTML("beforeend",lineHtml(i));
    });
    place.addEventListener("click",event=>{
      const remove=event.target.closest("[data-remove-line]");
      if(!remove)return;
      if(rows.length===1)return toast("A NF-e precisa ter pelo menos um produto.",true);
      const id=Number(remove.dataset.removeLine);
      const position=rows.indexOf(id);
      if(position<0)return;
      rows.splice(position,1);
      remove.closest("[data-line]")?.remove();
    });
    ctx.mask.querySelector("#rx-add-line").click();
    ctx.mask.querySelector("#rx-nfe-pdf").addEventListener("change",async e=>{
      const file=e.currentTarget.files?.[0];
      if(!file)return;
      try{
        if(file.size>7*1024*1024)throw new Error("O DANFE PDF deve ter no máximo 7 MB.");
        const report=await window.NHReceivingImports.readFiscalPDF(ui,file);
        for(const key of ["invoice_number","serie","data_emissao","access_key",
                          "fornecedor","documento_fornecedor"]){
          const input=ctx.form.elements.namedItem(key);
          if(report[key]&&input)input.value=String(report[key]);
        }
        const f=new FormData(ctx.form);
        rows.forEach(i=>{
          const item=items().find(p=>p.id===Number(f.get("item_id_"+i)));
          if(!item)return;
          const match=(report.products||[]).filter(p=>
            normal(p.produto)===normal(item.product)&&normal(p.unidade)===normal(item.unit));
          if(match.length!==1)return;
          for(const [key,col] of [["valor_unitario","valor_unitario"],["codigo_produto","codigo_produto"],
                                   ["cfop","cfop"],["ncm","ncm"]]){
            const input=ctx.form.elements.namedItem(key+"_"+i);
            if(input&&!input.value&&match[0][col])input.value=String(match[0][col]);
          }
        });
        origemArquivo="pdf";
        toast("DANFE lido. Revise os dados da nota e dos produtos antes de confirmar.");
        if(report.warnings?.length)toast(report.warnings.join(" | "),true);
      }catch(error){toast("Falha ao ler DANFE: "+error.message,true)}
    });
  }
  async function sendGFARM(id){
    const target=receipts().find(r=>Number(r.id)===Number(id));
    if(!target)return toast("Nota fiscal não encontrada.",true);
    if(target.gfarm_status!=="NAO_ENVIADO")
      return toast("Esta nota já possui solicitação no GFARM.",true);
    // O motor agrupa os itens pela chave exata da NF-e. Enviar um só ID
    // poderia deixar os demais produtos da mesma nota fora do GFARM.
    const group=target.gfarm_note_key
      ? receipts().filter(r=>r.gfarm_note_key===target.gfarm_note_key &&
                             r.gfarm_status==="NAO_ENVIADO")
      : [target];
    const ids=[...new Set(group.map(r=>Number(r.id)))].filter(Number.isSafeInteger);
    if(!ids.length)return toast("Nenhum produto disponível para envio.",true);
    if(!confirm("Enviar "+ids.length+" item(ns) desta NF-e para aprovação no GFARM?"))return;
    try{
      await api(route("/gfarm/send"),"POST",{receipt_ids:ids});
      await refresh();toast("NF-e enviada ao GFARM com "+ids.length+" item(ns).");
    }catch(e){toast(e.message,true)}
  }
  function quickSummary(){
    const received=items().filter(item=>Number(item.received_qty)>0);
    if(!received.length)return toast("Ainda não há produtos com recebimento registrado.",true);
    // Nunca somar quantidades de unidades diferentes em um total falso.
    const groups=new Map();
    for(const item of received){
      const key=normal(item.supplier)+"|"+item.order_number;
      if(!groups.has(key))groups.set(key,{supplier:item.supplier,order:item.order_number,items:[]});
      groups.get(key).items.push(item);
    }
    const blocks=[...groups.values()].map(g=>
      '<section class="rx-preview-item"><strong>'+esc(g.supplier)+' · Pedido '+esc(g.order)+'</strong>'+
      '<div class="rx-group-table"><table class="rx-table"><thead><tr>'+
      '<th>Produto</th><th>Pedido</th><th>Recebido</th><th>Falta receber</th></tr></thead><tbody>'+
      g.items.map(p=>'<tr><td>'+esc(p.product)+'</td>'+
        '<td>'+qty(p.ordered_qty)+' '+esc(p.unit)+'</td>'+
        '<td>'+qty(p.received_qty)+' '+esc(p.unit)+'</td>'+
        '<td>'+qty(p.remaining_qty)+' '+esc(p.unit)+'</td></tr>').join("")+
      '</tbody></table></div></section>').join("");
    dialog("Resumo rápido dos recebimentos",
      "Somente produtos com entrega registrada. Cada unidade é apresentada separadamente.",
      '<div class="rx-preview">'+blocks+'</div>');
  }
  function renameControl(){
    const current=currentControl();
    if(!current)return toast("Selecione um controle.",true);
    dialog("Renomear controle","Os pedidos, notas e históricos permanecem vinculados ao mesmo controle.",
      field("Nome do controle","name",current.name,'required maxlength="150"',true),
      async f=>{
        await api("/api/controls/"+current.id+"/rename","PATCH",{name:String(f.get("name")||"").trim()});
        await loadAll(current.id);toast("Nome atualizado, sem alterar os lançamentos.");
      },"Salvar nome");
  }

  async function exportExcel(){
    if(!cid()){toast("Selecione um controle.",true);return}
    try{
      const blob=await api(route("/invoices.xlsx"),"POST",{query:store.search},"blob");
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download="notas_fiscais_recebimentos.xlsx";
      document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      toast("Excel gerado.");
    }catch(e){toast(e.message,true)}
  }
  async function handleAction(button){
    const id=Number(button.dataset.id),action=button.dataset.action;
    if(action==="new-item")return openItem(null);
    if(action==="edit-item")return openItem(items().find(x=>x.id===id));
    if(action==="receive")return openReceipt(items().find(x=>x.id===id));
    if(action==="edit-receipt"){
      const receipt=receipts().find(x=>x.id===id);
      return openReceipt(items().find(x=>x.id===receipt?.item_id),receipt);
    }
    if(action==="assign")return openAssign(store.pending.find(x=>x.id===id));
    if(action==="create-control")return openControlCreation();
    if(action==="manual")return openManualInvoice();
    if(action==="import-json")return window.NHReceivingImports.openJSON(ui);
    if(action==="restore-issuer")return window.NHReceivingImports.restoreIssuer(ui);
    if(action==="quick-summary")return quickSummary();
    if(action==="rename-control")return renameControl();
    if(action==="gfarm")return sendGFARM(id);
    if(action==="export")return exportExcel();
    if(action==="xml")return window.NHReceivingImports.openXML(ui);
    if(action==="pdf")return window.NHReceivingImports.openPDF(ui);
  }
  const canImportXML=()=>!!cid()&&!!store.data&&!store.busy&&!modal;
  const ui={api,toast,dialog,closeDialog,refresh,cid,route,items,receipts,esc,qty,dec,field,select,today,setBusy,canImportXML};
  // A tela inteira de Recebimentos aceita um XML de NF-e, como no motor antigo.
  // Evita que o navegador abra o arquivo e abandone o aplicativo.
  const fileDrag=e=>Array.from(e.dataTransfer?.types||[]).includes("Files");
  const dragHint=$("#rx-xml-drop");
  let dragDepth=0;
  function hideDrop(){dragDepth=0;dragHint.hidden=true;}
  document.addEventListener("dragenter",e=>{
    if(!fileDrag(e))return;
    e.preventDefault();dragDepth++;
    if(canImportXML())dragHint.hidden=false;
  });
  document.addEventListener("dragover",e=>{
    if(!fileDrag(e))return;
    e.preventDefault();
    e.dataTransfer.dropEffect=canImportXML()?"copy":"none";
    if(canImportXML())dragHint.hidden=false;
  });
  document.addEventListener("dragleave",e=>{
    if(!fileDrag(e))return;
    dragDepth=Math.max(0,dragDepth-1);
    if(!dragDepth)hideDrop();
  });
  document.addEventListener("drop",e=>{
    const files=Array.from(e.dataTransfer?.files||[]);
    if(!files.length&&!fileDrag(e))return;
    e.preventDefault();hideDrop();
    if(!files.length)return;
    if(!canImportXML())return toast("Aguarde o carregamento ou feche a janela aberta.",true);
    if(files.length!==1)return toast("Solte um XML de NF-e por vez.",true);
    const task=window.NHReceivingImports.importXML(ui,files[0]);
    if(task?.catch)task.catch(err=>toast(err.message,true));
  });
  document.addEventListener("dragend",hideDrop);
  document.addEventListener("click",e=>{
    const group=e.target.closest("[data-group]");
    if(group){
      const key=group.dataset.group;
      if(store.collapsed.has(key))store.collapsed.delete(key);else store.collapsed.add(key);
      render();return;
    }
    const tab=e.target.closest("[data-tab]");
    if(tab){store.tab=tab.dataset.tab;render();return}
    const action=e.target.closest("[data-action]");
    if(action){
      try{
        const task=handleAction(action);
        if(task && typeof task.catch==="function")task.catch(e=>toast(e.message,true));
      }catch(e){toast(e.message,true)}
    }
  });
  $("#rx-search").addEventListener("input",e=>{
    store.search=e.target.value;
    if(!store.data)return;
    const renderSoon=typeof requestAnimationFrame==="function"?requestAnimationFrame:fn=>fn();
    if(store.searchFrame)return;
    store.searchFrame=renderSoon(()=>{store.searchFrame=null;render()});
  });
  $("#rx-control").addEventListener("change",e=>{
    store.controlId=Number(e.target.value);loadAll(store.controlId);
  });
  $("#rx-refresh").addEventListener("click",()=>loadAll(cid()));
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&modal)closeDialog();
  });
  loadAll();
})();
