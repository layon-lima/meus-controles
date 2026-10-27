"use strict";
/* Pedidos, produtos e recebimentos parciais por nota fiscal. */
const rxToday=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const rxNum=x=>Number(x||0).toLocaleString("pt-BR",{maximumFractionDigits:3});
const rxDate=x=>x?x.slice(8,10)+"/"+x.slice(5,7)+"/"+x.slice(0,4):"—";
const rxInput=(name,value,attr="")=>'<input name="'+name+'" value="'+E(value??"")+'" '+attr+'>';
const rxField=(title,widget)=>'<div class="field"><label>'+E(title)+'</label>'+widget+'</div>';
const rxUnitList=["un","kg","t","L","sc","cx","pct","m","m²","m³"];
const rxSupplierKey=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g," ");
// Nomes repetidos com diferenca de acento/maiuscula sao o mesmo fornecedor visual.
function rxSupplierCatalog(items){
  const entries=new Map();
  (items||[]).forEach(item=>{
    const name=String(item.supplier||"").trim(),key=rxSupplierKey(name);
    if(!key)return;
    if(!entries.has(key))entries.set(key,{key,variants:new Map(),total:0});
    const row=entries.get(key);
    row.variants.set(name,(row.variants.get(name)||0)+1);
    row.total++;
  });
  return [...entries.values()].map(entry=>({
    key:entry.key,
    name:[...entry.variants].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"pt-BR"))[0][0],
    total:entry.total
  })).sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
}
// Distancia com troca de letras adjacentes, para "ARGE X" e erros similares.
function rxSupplierDistance(a,b){
  if(Math.abs(a.length-b.length)>2)return 99;
  const n=a.length,m=b.length,dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
  for(let i=0;i<=n;i++)dp[i][0]=i;
  for(let j=0;j<=m;j++)dp[0][j]=j;
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++){
    dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,
      dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]){
      dp[i][j]=Math.min(dp[i][j],dp[i-2][j-2]+1);
    }
  }
  return dp[n][m];
}
function rxSupplierMatches(value,catalog){
  const q=rxSupplierKey(value);
  const matches=[];
  (catalog||[]).forEach(row=>{
    const s=row.key;
    let score=99;
    if(!q)score=10;
    else if(s===q)score=0;
    else if(s.startsWith(q))score=1+(s.length-q.length)/100;
    else if(s.includes(" "+q))score=2;
    else if(q.startsWith(s))score=3+(q.length-s.length)/100;
    else if(s.includes(q))score=4;
    else if(q.length>=3&&Math.abs(s.length-q.length)<=2){
      const distance=rxSupplierDistance(s,q);
      if(distance<=Math.min(2,Math.max(1,Math.floor(Math.max(s.length,q.length)*.23))))score=5+distance;
    }
    if(score<99)matches.push({name:row.name,key:row.key,score});
  });
  return matches.sort((a,b)=>a.score-b.score||a.name.localeCompare(b.name,"pt-BR")).slice(0,6);
}

// Pesquisa textual sem diferenciar maiúsculas, acentos ou espaços repetidos.
function rxPickNormalize(value){
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLocaleLowerCase("pt-BR").trim().replace(/\s+/g," ");
}
function rxPickLabel(p){
  return (p.supplier||"Sem fornecedor")+" · "+p.order_number+" · "+p.product+
    " (restante "+rxNum(p.remaining_qty)+" "+p.unit+")";
}
function rxPickMatches(items,query){
  const terms=rxPickNormalize(query).split(" ").filter(Boolean);
  return (items||[]).filter(p=>{
    if(p.closed||!(Number(p.remaining_qty)>0))return false;
    const search=rxPickNormalize([p.supplier,p.order_number,p.product].join(" "));
    return terms.every(term=>search.includes(term));
  }).sort((a,b)=>String(a.supplier).localeCompare(String(b.supplier),"pt-BR")||
    String(a.order_number).localeCompare(String(b.order_number),"pt-BR",{numeric:true})||
    String(a.product).localeCompare(String(b.product),"pt-BR"));
}

function rxSupplierGroups(items,catalog){
  const canonical=new Map(catalog.map(x=>[x.key,x.name]));
  const groups=new Map();
  (items||[]).forEach(item=>{
    const key=rxSupplierKey(item.supplier),name=canonical.get(key)||"Fornecedor não informado";
    if(!groups.has(key))groups.set(key,{key,name,items:[]});
    groups.get(key).items.push(item);
  });
  return [...groups.values()].sort((a,b)=>
    (!a.key)-(!b.key)||a.name.localeCompare(b.name,"pt-BR")).map(group=>{
    group.items.sort((a,b)=>String(a.order_number).localeCompare(String(b.order_number),"pt-BR",{numeric:true})||
      String(a.product).localeCompare(String(b.product),"pt-BR")||a.id-b.id);
    return group;
  });
}

Object.assign(App,{
  async renderReceiving(){
    const ctrl=this.s.detail?.control;
    if(!ctrl||ctrl.mode!=="recebimento")return;
    const id=ctrl.id;
    // Cada controle tem sua propria busca. Uma atualizacao dos dados nao a apaga.
    if(this.s.receivingTab?.controlId!==id){
      this.s.receivingTab={controlId:id,value:"pedidos"};
    }
    if(this.s.receivingSearch?.controlId!==id){
      this.s.receivingSearch={controlId:id,queries:{pedidos:"",notas:""}};
    }
    document.getElementById("main").innerHTML='<div class="empty-state">Carregando pedidos...</div>';
    try{
      const data=await this.api("/api/controls/"+id+"/receiving");
      if(this.s.route!=="control"||this.s.id!==id)return;
      this.s.receivingData=data;
      this.renderReceivingView();
    }catch(err){
      document.getElementById("main").innerHTML='<div class="empty-state">'+E(err.message)+'</div>';
    }
  },
  renderReceivingView(){
    const r=this.s.receivingData,c=this.s.detail?.control;
    if(!r||!c)return;
    const t=r.totals;
    const available=new Set(r.items.filter(p=>!p.receipts_count).map(p=>p.id));
    if(this.s.receivingSelection?.controlId!==c.id){
      this.s.receivingSelection={controlId:c.id,ids:[]};
    }
    this.s.receivingSelection.ids=this.s.receivingSelection.ids.filter(id=>available.has(id));
    const selected=this.s.receivingSelection.ids;
    if(this.s.receivingFocused?.controlId!==c.id)this.s.receivingFocused={controlId:c.id,itemId:null};
    if(!r.items.some(p=>p.id===this.s.receivingFocused.itemId))this.s.receivingFocused.itemId=null;
    const activeTab=this.s.receivingTab?.controlId===c.id?this.s.receivingTab.value:"pedidos";
    const savedSearch=this.s.receivingSearch?.controlId===c.id?
      (this.s.receivingSearch.queries?.[activeTab]||""):"";
    const supplierCatalog=rxSupplierCatalog(r.items);
    const supplierGroups=rxSupplierGroups(r.items,supplierCatalog);
    const renderRow=p=>{
      const status=p.closed?"Concluído":p.status==="complete"?"Recebido":p.status==="partial"?"Parcial":"Pendente";
      const canDelete=!p.receipts_count;
      return '<tr class="'+(p.closed?'receiving-closed':'')+'" data-receiving-id="'+p.id+'" data-receiving-selectable="'+(canDelete?"1":"0")+
        '" data-receiving-search="'+E([p.order_number,p.supplier,p.product].join(" ").toLowerCase())+
        '" tabindex="0" title="Clique para selecionar; duplo clique para gerenciar" '+
        'onclick="App.receivingFocusItem('+p.id+')" ondblclick="App.receivingManageItem('+p.id+')" '+
        'onkeydown="if(event.key===&quot;Enter&quot;){event.preventDefault();App.receivingManageItem('+p.id+')}">'+
        '<td class="receiving-select-cell"><input type="checkbox" data-receiving-checkbox="'+p.id+'" aria-label="Selecionar '+E(p.product)+'" '+
        (canDelete?'':'disabled title="Exclua as entregas antes de excluir este produto" ')+(selected.includes(p.id)?'checked ':'')+
        'onclick="event.stopPropagation()" onchange="App.receivingSelectItem('+p.id+',this.checked)"></td>'+
        '<td><strong>'+E(p.order_number)+'</strong></td><td>'+E(p.supplier)+'</td><td><strong>'+E(p.product)+'</strong></td>'+
        '<td class="numeric">'+rxNum(p.ordered_qty)+' '+E(p.unit)+'</td>'+
        '<td class="numeric">'+rxNum(p.received_qty)+' '+E(p.unit)+'</td>'+
        '<td class="numeric receiving-remaining">'+rxNum(p.remaining_qty)+' '+E(p.unit)+'</td>'+
        '<td><span class="receiving-status '+(p.closed?'closed':E(p.status))+'">'+status+'</span></td></tr>';
    };
    const rows=supplierGroups.map(group=>{
      const orders=new Set(group.items.map(p=>p.order_number)).size;
      return '<tr class="receiving-supplier-group" data-receiving-supplier="'+E(group.key)+'"><td colspan="8">'+
        '<strong>'+E(group.name)+'</strong>'+
        '<span class="receiving-group-count">'+orders+' pedido'+(orders===1?"":"s")+' · '+group.items.length+
        ' produto'+(group.items.length===1?"":"s")+'</span></td></tr>'+
        group.items.map(renderRow).join("");
    }).join("");
    const receipts=r.receipts.map(p=>
      '<tr data-receiving-search="'+E([p.invoice_number,p.access_key||"",p.order_number,p.product,p.supplier].join(" ").toLowerCase())+
      '" tabindex="0" title="Duplo clique para editar ou excluir a nota" '+
      'ondblclick="App.receivingManageReceipt('+p.id+')" '+
      'onkeydown="if(event.key===&quot;Enter&quot;){event.preventDefault();App.receivingManageReceipt('+p.id+')}">'+
      '<td>'+rxDate(p.received_date)+'</td><td><b>'+E(p.invoice_number)+'</b></td>'+
      '<td class="receiving-key">'+E(p.access_key||"—")+'</td><td>'+E(p.order_number)+'</td>'+
      '<td>'+E(p.product)+'</td><td class="receiving-supplier">'+E(p.supplier)+'</td>'+
      '<td class="numeric">'+rxNum(p.received_qty)+' '+E(p.unit)+'</td></tr>').join("");
    document.getElementById("main").innerHTML=
      '<div class="receiving-head"><div><div class="eyebrow">RECEBIMENTO DE PRODUTOS</div>'+
      '<p>Controle de pedidos, fornecedores e entregas por nota fiscal.</p></div>'+
      '<div class="receiving-header-actions">'+
      (activeTab==="pedidos"&&t.items===0?'<button class="btn btn-sm" onclick="App.receivingChooseImport()">'+icon("download")+' Importar pedidos</button>':'')+
      (activeTab==="pedidos"?'<button class="btn btn-sm receiving-pdf-button" onclick="App.receivingPdfChoose()">'+
      icon("download")+' Importar PDFs (OCR)</button>':'')+
      (activeTab==="pedidos"?'<button class="btn btn-sm" onclick="App.receivingXMLChoose()">'+icon("file-code")+' Importar XML NF-e</button>':'')+
      '<button class="btn btn-sm" onclick="App.receivingSettings('+c.id+')">'+icon("settings")+' Ajustes</button>'+
      (activeTab==="pedidos"?'<button class="btn btn-primary" onclick="App.receivingItemForm()">'+icon("plus")+' Cadastrar produto do pedido</button>':'')+
      '</div></div>'+
      '<input type="file" accept=".json,application/json" id="receivingImportInput" hidden onchange="App.receivingLoadImportFile(this.files[0])">'+
      '<input id="receivingXMLFile" type="file" accept=".xml,application/xml,text/xml" hidden onchange="App.receivingXMLLoad(this.files)">'+
      '<input type="file" accept="application/pdf,.pdf" id="receivingPdfFile" multiple hidden '+
      'onchange="App.receivingPdfLoad(this.files)">'+
      '<div class="receiving-tabs" role="tablist" aria-label="Seções do recebimento de produtos">'+
      '<button type="button" role="tab" aria-selected="'+(activeTab==="pedidos")+'" class="'+(activeTab==="pedidos"?"active":"")+
      '" onclick="App.receivingSwitchTab(&quot;pedidos&quot;)">Pedidos</button>'+
      '<button type="button" role="tab" aria-selected="'+(activeTab==="notas")+'" class="'+(activeTab==="notas"?"active":"")+
      '" onclick="App.receivingSwitchTab(&quot;notas&quot;)">Notas fiscais</button>'+
      '<button type="button" role="tab" aria-selected="'+(activeTab==="sem-pedido")+'" class="'+(activeTab==="sem-pedido"?"active":"")+
      '" onclick="App.receivingSwitchTab(&quot;sem-pedido&quot;)">Sem pedido</button></div>'+
      '<div class="receiving-search-band"><label class="receiving-search">'+icon("search")+
      '<input id="receivingSearch" type="search" value="'+E(savedSearch)+'" placeholder="'+
      (activeTab==="pedidos"?"Pesquisar pedido, fornecedor ou produto...":"Pesquisar número, chave da NF-e, pedido ou produto...")+
      '" aria-label="Pesquisar '+(activeTab==="pedidos"?"pedidos":"notas fiscais")+
      '" oninput="App.receivingFilter(this.value)"></label></div>'+
      '<div class="receiving-section-heading"><h3>'+(activeTab==="pedidos"?"Pedidos e produtos":activeTab==="sem-pedido"?"Recebimentos aguardando pedido":"Histórico de notas fiscais")+'</h3>'+
      '<div class="receiving-toolbar">'+
      (activeTab==="pedidos"?'<span id="receivingSelectedCount" class="receiving-selected-count" hidden></span>'+
      '<button id="receivingBulkDeleteBtn" class="btn btn-sm receiving-delete-selected" onclick="App.receivingBulkDelete()" hidden>'+
      icon("trash")+' Excluir selecionados</button>':'')+'</div></div>'+

      (activeTab==="sem-pedido"?
        '<section class="panel receiving-table"><div id="receivingPendingList">Carregando lançamentos sem pedido...</div></section>':
      activeTab==="pedidos"?
        '<section class="panel receiving-table">'+
        (t.items?'<div class="table-wrap"><table class="receiving-grid receiving-orders"><thead><tr><th class="receiving-select-cell"><input type="checkbox" id="receivingSelectAll" aria-label="Selecionar todos os produtos exibidos que não possuem entregas" onchange="App.receivingToggleAll(this.checked)"></th><th>Pedido</th><th>Fornecedor</th><th>Produto</th>'+
        '<th class="numeric">Quantidade pedida</th><th class="numeric">Recebido</th><th class="numeric">Falta receber</th>'+
        '<th>Status</th></tr></thead><tbody>'+rows+'</tbody></table></div>':
        '<div class="empty-state"><strong>Nenhum produto cadastrado</strong><p>Cadastre um pedido para começar.</p>'+
        '</div>')+'</section>'
      :
        '<section class="panel receiving-table">'+
        (t.receipts?'<div class="table-wrap"><table class="receiving-grid receiving-invoices"><thead><tr><th>Data</th><th>Nº nota fiscal</th><th>Chave da NF-e</th><th>Pedido</th>'+
        '<th>Produto</th><th>Fornecedor</th><th class="numeric">Quantidade</th></tr></thead><tbody>'+receipts+'</tbody></table></div>':
        '<p class="receiving-no-receipts">Ainda não existem recebimentos lançados.</p>')+'</section>')+
      '<button type="button" class="receiving-fab" onclick="App.receivingFloatingAdd()" '+
      'title="Registrar recebimento" aria-label="Novo recebimento">'+icon("plus")+'</button>';
    // Aplicar novamente apos redesenhar a tabela (ex.: salvar/editar/excluir NF).
    // Zona real de recebimento: impedir que o navegador navegue para o XML.
    const surface=document.getElementById("main");
    if(surface){
      surface.ondragenter=event=>{event.preventDefault();document.body.classList.add("receiving-xml-drag");};
      surface.ondragover=event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect="copy";};
      surface.ondragleave=event=>{if(!surface.contains(event.relatedTarget))document.body.classList.remove("receiving-xml-drag");};
      surface.ondrop=event=>{
        event.preventDefault();
        event.stopPropagation();
        document.body.classList.remove("receiving-xml-drag");
        const files=event.dataTransfer?.files;
        if(files?.length!==1){this.toast("Arraste apenas um arquivo XML por vez.",true);return;}
        if(typeof this.receivingXMLLoad==="function")this.receivingXMLLoad(files);
        else this.toast("Importador XML indisponível. Atualize a página.",true);
      };
    }
    this.receivingApplyFilter(savedSearch);
    this.receivingHighlightFocused();
    if(activeTab==="sem-pedido"&&typeof this.receivingXMLPendingLoad==="function")this.receivingXMLPendingLoad();
  },
  receivingSwitchTab(tab){
    if(!["pedidos","notas","sem-pedido"].includes(tab))return;
    const controlId=this.s.detail?.control?.id;
    if(controlId==null||this.s.detail?.control?.mode!=="recebimento")return;
    this.s.receivingTab={controlId,value:tab};
    this.renderReceivingView();
  },
  receivingFilter(query){
    const controlId=this.s.detail?.control?.id;
    if(controlId==null)return;
    const tab=this.s.receivingTab?.controlId===controlId?this.s.receivingTab.value:"pedidos";
    const queries={...(this.s.receivingSearch?.controlId===controlId?this.s.receivingSearch.queries:{}),
      [tab]:String(query??"")};
    this.s.receivingSearch={controlId,queries};
    this.receivingApplyFilter(queries[tab]);
  },
  receivingApplyFilter(query){
    const value=rxSupplierKey(query);
    document.querySelectorAll("[data-receiving-search]").forEach(el=>{
      el.hidden=!rxSupplierKey(el.getAttribute("data-receiving-search")).includes(value);
    });
    document.querySelectorAll(".receiving-supplier-group").forEach(group=>{
      let row=group.nextElementSibling,count=0;
      const orders=new Set();
      while(row&&!row.classList.contains("receiving-supplier-group")){
        if(!row.hidden){count++;orders.add(row.children[1]?.textContent||"");}
        row=row.nextElementSibling;
      }
      group.hidden=count===0;
      const summary=group.querySelector(".receiving-group-count");
      if(summary)summary.textContent=orders.size+" pedido"+(orders.size===1?"":"s")+" · "+
        count+" produto"+(count===1?"":"s");
    });
    this.receivingUpdateSelectionToolbar();
  },
  receivingFocusItem(id){
    const controlId=this.s.detail?.control?.id;
    if(!this.s.receivingData?.items.some(p=>p.id===id)||controlId==null)return;
    this.s.receivingFocused={controlId,itemId:id};
    this.receivingHighlightFocused();
  },
  receivingHighlightFocused(){
    const focus=this.s.receivingFocused;
    document.querySelectorAll(".receiving-orders tbody tr[data-receiving-id]").forEach(row=>{
      row.classList.toggle("receiving-focused",!!focus&&Number(row.dataset.receivingId)===focus.itemId);
    });
  },
  receivingFloatingAdd(){
    if(!this.canOpenForm())return;
    // Cada clique no "+" inicia uma seleção NOVA. A linha que ficou marcada
    // no controle não pode obrigar os lançamentos seguintes ao mesmo pedido.
    this.receivingChooseReceiptProduct();
  },
  receivingChooseReceiptProduct(){
    if(!this.canOpenForm())return;
    const available=rxPickMatches(this.s.receivingData?.items,"");
    if(!available.length)return this.toast("Todos os produtos já foram recebidos ou não existem pedidos.",true);
    this.s.receivingFocused={controlId:this.s.detail?.control?.id,itemId:null};
    this.receivingHighlightFocused();
    this.s.receivingPick={
      controlId:this.s.detail?.control?.id,
      query:"",selectedId:null,highlight:0,expanded:true
    };
    this.s.modal="receiving-pick";
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal receiving-form" role="dialog" aria-modal="true" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Novo recebimento</h2><p>Digite para localizar ou clique em um produto.</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><label class="receiving-pick-label" for="receivingPickSearch">Pedido / produto</label>'+
      '<div class="receiving-pick-combobox">'+
      '<input id="receivingPickSearch" class="receiving-pick-input" type="search" autocomplete="off" spellcheck="false" '+
      'placeholder="Digite o pedido, fornecedor ou produto..." role="combobox" aria-autocomplete="list" '+
      'aria-controls="receivingPickResults" aria-expanded="true" '+
      'oninput="App.receivingFilterPick(this.value)" onkeydown="App.receivingPickKeydown(event)" '+
      'onfocus="App.receivingPickFocus()">'+
      '<button type="button" class="receiving-pick-show" aria-label="Exibir produtos" '+
      'onclick="App.receivingPickShowAll()">'+icon("chevron-down")+'</button></div>'+
      '<div id="receivingPickResults" class="receiving-pick-results" role="listbox" aria-label="Produtos correspondentes"></div>'+
      '<div id="receivingPickFeedback" class="receiving-pick-feedback" aria-live="polite"></div>'+
      '</div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button id="receivingPickContinue" class="btn btn-primary" disabled onclick="App.receivingPickReceiptProduct()">Continuar</button>'+
      '</div></div></div>';
    this.receivingRenderPick();
    document.getElementById("receivingPickSearch")?.focus();
  },
  receivingRenderPick(){
    const picker=this.s.receivingPick,items=this.s.receivingData?.items||[];
    if(!picker)return;
    const matches=rxPickMatches(items,picker.query);
    const results=document.getElementById("receivingPickResults");
    const feedback=document.getElementById("receivingPickFeedback");
    const input=document.getElementById("receivingPickSearch");
    const continueBtn=document.getElementById("receivingPickContinue");
    if(!results||!input)return;
    picker.highlight=Math.max(0,Math.min(picker.highlight,matches.length-1));
    const limited=matches.slice(0,60);
    results.hidden=!picker.expanded;
    results.innerHTML=matches.length?
      limited.map((p,index)=>
        '<button type="button" role="option" id="receivingPickOption'+p.id+'" class="receiving-pick-option'+
        (index===picker.highlight?' highlighted':'')+'" aria-selected="'+(p.id===picker.selectedId)+
        '" onclick="App.receivingPickSelect('+p.id+')">'+
        '<strong>'+E(p.product)+'</strong><small>'+E(p.supplier||"Sem fornecedor")+
        ' · '+E(p.order_number)+' · Restante: '+rxNum(p.remaining_qty)+' '+E(p.unit)+
        '</small></button>').join(""):
      '<p class="receiving-pick-empty">Nenhum produto encontrado. Tente outro termo.</p>';
    if(feedback)feedback.textContent=picker.selectedId?
      'Produto selecionado. Clique em Continuar para registrar o recebimento.':
      matches.length>60?'Mostrando 60 de '+matches.length+' produtos. Digite mais para refinar.':
      matches.length+' produto(s) encontrado(s)';
    const valid=items.some(p=>p.id===picker.selectedId&&Number(p.remaining_qty)>0);
    if(continueBtn)continueBtn.disabled=!valid;
    input.setAttribute("aria-expanded",String(picker.expanded));
    const active=limited[picker.highlight];
    if(picker.expanded&&active)input.setAttribute("aria-activedescendant","receivingPickOption"+active.id);
    else input.removeAttribute("aria-activedescendant");
  },
  receivingFilterPick(value){
    const picker=this.s.receivingPick;
    if(!picker)return;
    picker.query=String(value||"");
    picker.selectedId=null;
    picker.highlight=0;
    picker.expanded=true;
    this.receivingRenderPick();
  },
  receivingPickSelect(id){
    const picker=this.s.receivingPick;
    const selected=this.s.receivingData?.items.find(p=>p.id===id&&Number(p.remaining_qty)>0);
    if(!picker||!selected)return;
    picker.selectedId=id;
    picker.query=rxPickLabel(selected);
    picker.expanded=false;
    const input=document.getElementById("receivingPickSearch");
    if(input)input.value=picker.query;
    this.receivingRenderPick();
  },
  receivingPickShowAll(){
    const picker=this.s.receivingPick;
    if(!picker)return;
    picker.query="";picker.selectedId=null;picker.highlight=0;picker.expanded=true;
    const input=document.getElementById("receivingPickSearch");
    if(input){input.value="";input.focus()}
    this.receivingRenderPick();
  },
  receivingPickFocus(){
    const picker=this.s.receivingPick;
    if(!picker||picker.expanded||picker.selectedId)return;
    picker.expanded=true;
    this.receivingRenderPick();
  },
  receivingPickKeydown(event){
    const picker=this.s.receivingPick;
    if(!picker)return;
    const matches=rxPickMatches(this.s.receivingData?.items,picker.query).slice(0,60);
    if(event.key==="Escape"&&picker.expanded){
      event.preventDefault();picker.expanded=false;this.receivingRenderPick();return;
    }
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();
      if(!picker.expanded)picker.expanded=true;
      if(matches.length){
        picker.highlight=(picker.highlight+(event.key==="ArrowDown"?1:-1)+matches.length)%matches.length;
      }
      this.receivingRenderPick();
      const highlighted=matches[picker.highlight];
      if(highlighted)document.getElementById("receivingPickOption"+highlighted.id)?.scrollIntoView({block:"nearest"});
      return;
    }
    if(event.key==="Enter"){
      event.preventDefault();
      if(picker.selectedId){this.receivingPickReceiptProduct();return}
      if(picker.expanded&&matches.length)this.receivingPickSelect(matches[picker.highlight].id);
    }
  },
  receivingPickReceiptProduct(){
    const picker=this.s.receivingPick;
    const id=picker?.selectedId;
    if(!picker||picker.controlId!==this.s.detail?.control?.id||
       !this.s.receivingData?.items.some(p=>p.id===id&&!p.closed&&Number(p.remaining_qty)>0)){
      this.toast("Selecione um produto da lista antes de continuar.",true);return;
    }
    this.closeModal();
    this.receivingFocusItem(id);
    this.receivingReceiptForm(id);
  },
  receivingManageItem(id){
    if(!this.canOpenForm())return;
    const item=this.s.receivingData?.items.find(p=>p.id===id);
    if(!item)return;
    this.receivingFocusItem(id);
    this.s.modal="receiving-manage-item";
    this.s.modalContext={itemId:id};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal receiving-manage" role="dialog" aria-modal="true" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Gerenciar pedido</h2>'+
      '<p>'+E(item.order_number)+' · '+E(item.product)+'</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><p>Escolha o que deseja fazer com este produto.</p>'+
      '<div class="receiving-manage-actions">'+
      '<button class="btn btn-primary" onclick="App.receivingManageAction(&quot;edit&quot;)">'+icon("edit")+' Editar pedido</button>'+
      '<button class="btn receiving-danger" onclick="App.receivingManageAction(&quot;delete&quot;)">'+icon("trash")+' Excluir pedido</button>'+
      (!item.closed?'<button class="btn receiving-complete-action" onclick="App.receivingManageAction(&quot;complete&quot;)">'+icon("check-circle")+' Concluir recebimento</button>':'<span class="receiving-completed-note">Recebimento concluído</span>')+
      '</div></div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button></div></div></div>';
  },
  receivingManageAction(action){
    const id=this.s.modalContext?.itemId;
    if(!id)return;
    this.closeModal();
    if(action==="edit")this.receivingItemForm(id);
    if(action==="delete")this.receivingDeleteItem(id);
    if(action==="complete")this.receivingCompleteOrder(id);
  },
  async receivingCompleteOrder(id){
    const item=this.s.receivingData?.items.find(p=>p.id===id);
    if(!item||item.closed)return;
    if(!window.confirm("Concluir o recebimento do pedido "+item.order_number+"? Todos os produtos desse pedido e fornecedor serão bloqueados para novos lançamentos."))return;
    try{
      await this.api("/api/receiving-items/"+id+"/complete","POST",{});
      this.toast("Recebimento concluído.");
      await this.renderReceiving();
    }catch(err){this.toast(err.message,true);}
  },
  receivingManageReceipt(id){
    if(!this.canOpenForm())return;
    const receipt=this.s.receivingData?.receipts.find(p=>p.id===id);
    if(!receipt)return;
    this.s.modal="receiving-manage-receipt";
    this.s.modalContext={receiptId:id};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal receiving-manage" role="dialog" aria-modal="true" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Gerenciar nota fiscal</h2>'+
      '<p>NF-e '+E(receipt.invoice_number)+' · '+E(receipt.product)+'</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><div class="receiving-manage-actions">'+
      '<button class="btn btn-primary" onclick="App.receivingManageReceiptAction(&quot;edit&quot;)">'+icon("edit")+' Editar recebimento</button>'+
      '<button class="btn receiving-danger" onclick="App.receivingManageReceiptAction(&quot;delete&quot;)">'+icon("trash")+' Excluir recebimento</button>'+
      '</div></div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button></div></div></div>';
  },
  receivingManageReceiptAction(action){
    const id=this.s.modalContext?.receiptId;
    const receipt=this.s.receivingData?.receipts.find(p=>p.id===id);
    if(!receipt)return;
    this.closeModal();
    if(action==="edit")this.receivingReceiptForm(receipt.item_id,id);
    if(action==="delete")this.receivingDeleteReceipt(id);
  },
  receivingSelectItem(id,checked){
    const item=this.s.receivingData?.items.find(p=>p.id===id);
    if(!item||item.receipts_count)return;
    const ids=new Set(this.s.receivingSelection?.ids||[]);
    if(checked)ids.add(id);
    else ids.delete(id);
    this.s.receivingSelection.ids=[...ids];
    this.receivingUpdateSelectionToolbar();
  },
  receivingToggleAll(checked){
    const ids=new Set(this.s.receivingSelection?.ids||[]);
    document.querySelectorAll(".receiving-orders tbody tr[data-receiving-selectable='1']").forEach(row=>{
      if(row.hidden)return;
      const id=Number(row.dataset.receivingId);
      if(checked)ids.add(id);
      else ids.delete(id);
      const checkbox=row.querySelector("input[type=checkbox]");
      if(checkbox)checkbox.checked=checked;
    });
    this.s.receivingSelection.ids=[...ids];
    this.receivingUpdateSelectionToolbar();
  },
  receivingUpdateSelectionToolbar(){
    const selected=new Set(this.s.receivingSelection?.ids||[]);
    const rows=[...document.querySelectorAll(".receiving-orders tbody tr[data-receiving-id]")];
    const eligible=rows.filter(row=>!row.hidden&&row.dataset.receivingSelectable==="1");
    let visibleSelected=0;
    rows.forEach(row=>{
      const checked=selected.has(Number(row.dataset.receivingId));
      row.classList.toggle("receiving-selected",checked);
      const checkbox=row.querySelector("input[type=checkbox]");
      if(checkbox)checkbox.checked=checked;
      if(!row.hidden&&row.dataset.receivingSelectable==="1"&&checked)visibleSelected++;
    });
    const all=document.getElementById("receivingSelectAll");
    if(all){
      all.disabled=!eligible.length;
      all.checked=eligible.length>0&&visibleSelected===eligible.length;
      all.indeterminate=visibleSelected>0&&visibleSelected<eligible.length;
    }
    const count=document.getElementById("receivingSelectedCount");
    if(count){
      count.hidden=!selected.size;
      count.textContent=selected.size+" selecionado"+(selected.size===1?"":"s");
    }
    const button=document.getElementById("receivingBulkDeleteBtn");
    if(button){
      button.hidden=!selected.size;
      button.disabled=!selected.size||!!this.s.receivingDeleteBusy;
    }
  },
  async receivingBulkDelete(){
    const controlId=this.s.detail?.control?.id;
    const ids=[...(this.s.receivingSelection?.ids||[])];
    if(!controlId||!ids.length||this.s.receivingDeleteBusy)return;
    if(!confirm("Excluir definitivamente "+ids.length+" produto"+(ids.length===1?"":"s")+" selecionado"+(ids.length===1?"":"s")+"? Esta ação não poderá ser desfeita."))return;
    this.s.receivingDeleteBusy=true;
    this.receivingUpdateSelectionToolbar();
    try{
      const result=await this.api("/api/controls/"+controlId+"/receiving/bulk-delete","POST",{ids});
      if(this.s.receivingSelection?.controlId===controlId)this.s.receivingSelection.ids=[];
      await this.load();
      this.toast(result.deleted+" produto"+(result.deleted===1?" excluído.":"s excluídos."));
    }catch(err){this.toast(err.message,true)}
    finally{
      this.s.receivingDeleteBusy=false;
      this.receivingUpdateSelectionToolbar();
    }
  },
  receivingSupplierSuggest(){
    const input=document.getElementById("receivingSupplierInput");
    const list=document.getElementById("receivingSupplierOptions");
    if(!input||!list)return;
    const catalog=rxSupplierCatalog(this.s.receivingData?.items||[]);
    const results=rxSupplierMatches(input.value,catalog);
    this.s.receivingSupplierResults=results;
    this.s.receivingSupplierActive=-1;
    list.hidden=!results.length;
    input.setAttribute("aria-expanded",String(results.length>0));
    list.innerHTML=results.map((row,i)=>
      '<button type="button" class="receiving-supplier-option" role="option" aria-selected="false" '+
      'onpointerdown="event.preventDefault();App.receivingChooseSupplier('+i+')" '+
      'onclick="App.receivingChooseSupplier('+i+')">'+E(row.name)+'</button>').join("");
  },
  receivingSupplierHide(){
    const list=document.getElementById("receivingSupplierOptions");
    const input=document.getElementById("receivingSupplierInput");
    if(list)list.hidden=true;
    if(input)input.setAttribute("aria-expanded","false");
  },
  receivingChooseSupplier(index){
    const item=this.s.receivingSupplierResults?.[index];
    const input=document.getElementById("receivingSupplierInput");
    if(!item||!input)return;
    input.value=item.name;
    this.receivingSupplierHide();
    input.focus();
  },
  receivingSupplierKeydown(event){
    const items=this.s.receivingSupplierResults||[];
    const list=document.getElementById("receivingSupplierOptions");
    if(!list||!items.length)return;
    if(event.key==="Escape"){
      this.receivingSupplierHide();return;
    }
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();
      if(list.hidden)this.receivingSupplierSuggest();
      const total=this.s.receivingSupplierResults.length;
      if(!total)return;
      this.s.receivingSupplierActive=event.key==="ArrowDown"?
        (this.s.receivingSupplierActive+1)%total:
        (this.s.receivingSupplierActive+total)%total;
      list.querySelectorAll(".receiving-supplier-option").forEach((node,index)=>{
        const active=index===this.s.receivingSupplierActive;
        node.classList.toggle("active",active);
        node.setAttribute("aria-selected",String(active));
      });
    }else if(event.key==="Enter"&&!list.hidden){
      event.preventDefault();
      this.receivingChooseSupplier(this.s.receivingSupplierActive>=0?this.s.receivingSupplierActive:0);
    }
  },
  receivingItemForm(id){
    if(!this.canOpenForm())return;
    const data=this.s.receivingData,ctrl=this.s.detail?.control;
    if(!data||!ctrl)return;
    const item=id?data.items.find(x=>x.id===id):null;
    if(id&&!item)return this.toast("Produto não encontrado.",true);
    this.s.modal="receiving-item";
    this.s.modalContext={controlId:ctrl.id,item:item?deep(item):null};
    const unit=item?.unit||"un";
    const all=rxUnitList.includes(unit)?rxUnitList:[unit,...rxUnitList];
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal receiving-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">'+(item?"Editar produto do pedido":"Cadastrar produto do pedido")+'</h2>'+
      '<p>Cada produto tem seu próprio saldo de recebimento.</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="receivingItemForm" onsubmit="event.preventDefault();App.receivingSaveItem()">'+
      '<div class="form-grid">'+
      rxField("Número do pedido",rxInput("order_number",item?.order_number||"",'required maxlength="100" placeholder="Ex.: PED-1254"'))+
      rxField("Fornecedor (opcional)",'<div class="receiving-supplier-picker">'+
      '<input id="receivingSupplierInput" name="supplier" autocomplete="off" maxlength="160" value="'+E(item?.supplier||"")+
      '" placeholder="Digite para localizar fornecedor cadastrado" role="combobox" aria-autocomplete="list" '+
      'aria-expanded="false" aria-controls="receivingSupplierOptions" '+
      'oninput="App.receivingSupplierSuggest()" onfocus="App.receivingSupplierSuggest()" '+
      'onkeydown="App.receivingSupplierKeydown(event)" onblur="App.receivingSupplierHide()">'+
      '<div id="receivingSupplierOptions" class="receiving-supplier-options" role="listbox" hidden></div>'+
      '</div>')+
      '<div class="field full"><label>Produto</label>'+
      rxInput("product",item?.product||"",'required maxlength="160" placeholder="Nome do produto"')+'</div>'+
      rxField("Quantidade contratada",rxInput("ordered_qty",item?.ordered_qty||"",'inputmode="decimal" required placeholder="Ex.: 1250"'))+
      rxField("Unidade",'<select name="unit" required>'+all.map(u=>
       '<option value="'+E(u)+'" '+(u===unit?"selected":"")+'>'+E(u)+'</option>').join("")+'</select>')+
      '</div></form>'+
      (item?'<div class="receiving-hint">Já recebido: <strong>'+rxNum(item.received_qty)+' '+E(item.unit)+'</strong>. Não reduza o pedido abaixo dessa quantidade.</div>':'')+
      '</div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.receivingSaveItem()">'+icon("check")+' Salvar produto</button></div></div></div>';
  },
  async receivingSaveItem(){
    const form=document.getElementById("receivingItemForm"),ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    const f=new FormData(form),payload={
      order_number:f.get("order_number"),supplier:f.get("supplier"),
      product:f.get("product"),ordered_qty:f.get("ordered_qty"),unit:f.get("unit")
    };
    const typed=String(payload.supplier||"").trim();
    const unchanged=!!ctx.item&&rxSupplierKey(typed)===rxSupplierKey(ctx.item.supplier);
    if(typed&&!unchanged){
      const options=rxSupplierMatches(typed,rxSupplierCatalog(this.s.receivingData?.items||[]));
      const suggestion=options[0];
      if(suggestion&&suggestion.key!==rxSupplierKey(typed)){
        if(confirm('Já existe um fornecedor parecido: "'+suggestion.name+'".\n\nUsar o nome cadastrado para manter os pedidos no mesmo grupo?')){
          payload.supplier=suggestion.name;
        }else if(!confirm('Cadastrar "'+typed+'" como um fornecedor DIFERENTE de "'+suggestion.name+'"?')){
          return;
        }
      }
    }
    try{
      await this.api(ctx.item?"/api/receiving-items/"+ctx.item.id:
        "/api/controls/"+ctx.controlId+"/receiving/items",ctx.item?"PUT":"POST",payload);
      this.closeModal();await this.load();this.toast(ctx.item?"Produto atualizado.":"Produto cadastrado.");
    }catch(err){this.toast(err.message,true)}
  },
  receivingReceiptForm(itemId,receiptId){
    if(!this.canOpenForm())return;
    const data=this.s.receivingData;
    const item=data?.items.find(x=>x.id===itemId);
    const old=receiptId?data?.receipts.find(x=>x.id===receiptId):null;
    if(!item||(receiptId&&!old))return this.toast("Pedido ou entrega não encontrado.",true);
    if(item.closed)return this.toast("Recebimento concluído. Novos lançamentos estão bloqueados.",true);
    const max=Number(item.remaining_qty)+Number(old?.received_qty||0);
    if(max<=0)return this.toast("Este pedido já foi totalmente recebido.",true);
    this.s.modal="receiving-receipt";
    this.s.modalContext={itemId,receipt:old?deep(old):null};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal receiving-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">'+(old?"Editar recebimento":"Registrar recebimento")+'</h2>'+
      '<p>Registre a quantidade recebida e a nota fiscal.</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><div class="receiving-item-context"><div class="receiving-receipt-switch"><strong>'+E(item.product)+'</strong>'+
      (!old?'<button type="button" class="btn btn-sm" onclick="App.receivingChangeReceiptProduct()">'+
      icon("search")+' Trocar produto / pedido</button>':'')+'</div>'+
      '<span>Pedido '+E(item.order_number)+' · '+E(item.supplier)+'</span>'+
      '<span>Disponível: <b>'+rxNum(max)+' '+E(item.unit)+'</b></span></div>'+
      '<form id="receivingReceiptForm" onsubmit="event.preventDefault();App.receivingSaveReceipt()">'+
      '<div class="form-grid">'+
      rxField("Data do recebimento",rxInput("date",old?.received_date||rxToday(),'type="date" required'))+
      rxField("Nº NF-e",rxInput("invoice_number",old?.invoice_number||"",'required maxlength="100" placeholder="Ex.: 123456"'))+
      '<div class="field full"><label>Quantidade recebida ('+E(item.unit)+')</label>'+
      rxInput("quantity",old?.received_qty||"",'required inputmode="decimal" placeholder="Ex.: 450"')+'</div>'+
      '<div class="field full"><label>Chave de acesso da NF-e (44 dígitos)</label>'+
      rxInput("access_key",old?.access_key||"",'inputmode="numeric" maxlength="64" autocomplete="off" placeholder="Cole os 44 dígitos da chave"')+
      '</div>'+
      '</div></form><div class="receiving-hint">Esta quantidade será descontada automaticamente do saldo pendente.</div></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.receivingSaveReceipt()">'+icon("check")+' Salvar entrega</button></div></div></div>';
  },
  receivingChangeReceiptProduct(){
    // Só permite trocar o vínculo antes de gravar um NOVO recebimento.
    if(this.s.modal!=="receiving-receipt"||this.s.modalContext?.receipt)return;
    this.closeModal();
    this.s.receivingFocused={controlId:this.s.detail?.control?.id,itemId:null};
    this.receivingHighlightFocused();
    this.receivingChooseReceiptProduct();
  },
  async receivingSaveReceipt(){
    const form=document.getElementById("receivingReceiptForm"),ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    const f=new FormData(form),payload={
      date:f.get("date"),invoice_number:f.get("invoice_number"),
      quantity:f.get("quantity"),access_key:f.get("access_key"),notes:ctx.receipt?.notes||""
    };
    try{
      await this.api(ctx.receipt?"/api/receiving-receipts/"+ctx.receipt.id:
        "/api/receiving-items/"+ctx.itemId+"/receipts",ctx.receipt?"PUT":"POST",payload);
      this.closeModal();
      // Nunca deixar o último pedido travado como seleção do próximo vale/recebimento.
      this.s.receivingPick=null;
      this.s.receivingFocused={controlId:this.s.detail?.control?.id,itemId:null};
      await this.load();this.toast("Recebimento salvo. Saldo atualizado.");
    }catch(e){this.toast(e.message,true)}
  },
  async receivingDeleteItem(id){
    if(!confirm("Excluir produto do pedido? Produtos com recebimentos não podem ser excluídos."))return;
    try{await this.api("/api/receiving-items/"+id,"DELETE");await this.load();this.toast("Produto excluído.")}
    catch(e){this.toast(e.message,true)}
  },
  async receivingDeleteReceipt(id){
    if(!confirm("Excluir entrega? A quantidade voltará ao saldo pendente."))return;
    try{await this.api("/api/receiving-receipts/"+id,"DELETE");await this.load();this.toast("Entrega excluída. Saldo recalculado.")}
    catch(e){this.toast(e.message,true)}
  },
  receivingSettings(id){
    if(!this.canOpenForm())return;
    const control=this.s.state?.controls?.find(x=>x.id===id);
    if(!control)return this.toast("Controle não encontrado.",true);
    this.s.modal="receiving-settings";
    this.s.modalContext={controlId:id};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal receiving-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Ajustes do controle</h2>'+
      '<p>Renomear não altera os pedidos ou as entregas.</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="receivingSettingsForm" onsubmit="event.preventDefault();App.receivingSaveSettings()">'+
      rxField("Nome do controle",rxInput("name",control.name,'required maxlength="150"'))+
      '</form></div><div class="modal-footer">'+
      '<button class="btn" onclick="App.receivingOpenImportFromSettings()">'+icon("download")+' Importar pedidos</button>'+
      '<button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.receivingSaveSettings()">Salvar nome</button></div></div></div>';
  },
  async receivingSaveSettings(){
    const form=document.getElementById("receivingSettingsForm"),ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    const c=this.s.state.controls.find(c=>c.id===ctx.controlId);
    if(!c)return;
    try{
      await this.api("/api/controls/"+ctx.controlId,"PATCH",{
        name:new FormData(form).get("name"),board_id:c.board_id,mode:c.mode,
        fields:c.fields,rules:c.rules,types:c.types
      });
      this.closeModal();await this.load();this.toast("Nome atualizado.");
    }catch(e){this.toast(e.message,true)}
  }
});
