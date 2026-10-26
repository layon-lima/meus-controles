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
    const activeTab=this.s.receivingTab?.controlId===c.id&&this.s.receivingTab.value==="notas"?
      "notas":"pedidos";
    const savedSearch=this.s.receivingSearch?.controlId===c.id?
      (this.s.receivingSearch.queries?.[activeTab]||""):"";
    const supplierCatalog=rxSupplierCatalog(r.items);
    const supplierGroups=rxSupplierGroups(r.items,supplierCatalog);
    const renderRow=p=>{
      const status=p.status==="complete"?"Recebido":p.status==="partial"?"Parcial":"Pendente";
      const action=p.status==="complete"?"":'<button class="mini-action" onclick="App.receivingReceiptForm('+p.id+')">'+icon("plus")+' Receber</button>';
      const canDelete=!p.receipts_count;
      return '<tr data-receiving-id="'+p.id+'" data-receiving-selectable="'+(canDelete?"1":"0")+'" data-receiving-search="'+E([p.order_number,p.supplier,p.product].join(" ").toLowerCase())+'">'+
        '<td class="receiving-select-cell"><input type="checkbox" data-receiving-checkbox="'+p.id+'" aria-label="Selecionar '+E(p.product)+'" '+(canDelete?'':'disabled title="Exclua as entregas antes de excluir este produto" ')+(selected.includes(p.id)?'checked ':'')+'onchange="App.receivingSelectItem('+p.id+',this.checked)"></td>'+
        '<td><strong>'+E(p.order_number)+'</strong></td><td>'+E(p.supplier)+'</td><td><strong>'+E(p.product)+'</strong></td>'+
        '<td class="numeric">'+rxNum(p.ordered_qty)+' '+E(p.unit)+'</td>'+
        '<td class="numeric">'+rxNum(p.received_qty)+' '+E(p.unit)+'</td>'+
        '<td class="numeric receiving-remaining">'+rxNum(p.remaining_qty)+' '+E(p.unit)+'</td>'+
        '<td><span class="receiving-status '+E(p.status)+'">'+status+'</span></td>'+
        '<td><div class="table-actions">'+action+
        '<button class="mini-action" onclick="App.receivingItemForm('+p.id+')">'+icon("edit")+' Editar</button>'+
        '<button class="mini-action" onclick="App.receivingDeleteItem('+p.id+')">'+icon("trash")+' Excluir</button></div></td></tr>';
    };
    const rows=supplierGroups.map(group=>{
      const orders=new Set(group.items.map(p=>p.order_number)).size;
      return '<tr class="receiving-supplier-group" data-receiving-supplier="'+E(group.key)+'"><td colspan="9">'+
        '<strong>'+E(group.name)+'</strong>'+
        '<span class="receiving-group-count">'+orders+' pedido'+(orders===1?"":"s")+' · '+group.items.length+
        ' produto'+(group.items.length===1?"":"s")+'</span></td></tr>'+
        group.items.map(renderRow).join("");
    }).join("");
    const receipts=r.receipts.map(p=>
      '<tr data-receiving-search="'+E([p.invoice_number,p.order_number,p.product,p.supplier].join(" ").toLowerCase())+'">'+
      '<td>'+rxDate(p.received_date)+'</td><td><b>'+E(p.invoice_number)+'</b></td>'+
      '<td>'+E(p.order_number)+'</td><td>'+E(p.product)+'</td><td class="receiving-supplier">'+E(p.supplier)+'</td>'+
      '<td class="numeric">'+rxNum(p.received_qty)+' '+E(p.unit)+'</td><td><div class="table-actions">'+
      '<button class="mini-action" onclick="App.receivingReceiptForm('+p.item_id+','+p.id+')">'+icon("edit")+' Editar</button>'+
      '<button class="mini-action" onclick="App.receivingDeleteReceipt('+p.id+')">'+icon("trash")+' Excluir</button>'+
      '</div></td></tr>').join("");
    document.getElementById("main").innerHTML=
      '<div class="receiving-head"><div><div class="eyebrow">RECEBIMENTO DE PRODUTOS</div>'+
      '<p>Controle de pedidos, fornecedores e entregas por nota fiscal.</p></div>'+
      '<div class="receiving-header-actions">'+
      (activeTab==="pedidos"&&t.items===0?'<button class="btn btn-sm" onclick="App.receivingChooseImport()">'+icon("download")+' Importar pedidos</button>':'')+
      '<button class="btn btn-sm" onclick="App.receivingSettings('+c.id+')">'+icon("settings")+' Ajustes</button>'+
      (activeTab==="pedidos"?'<button class="btn btn-primary" onclick="App.receivingItemForm()">'+icon("plus")+' Cadastrar produto do pedido</button>':'')+
      '</div></div>'+
      '<input type="file" accept=".json,application/json" id="receivingImportInput" hidden onchange="App.receivingLoadImportFile(this.files[0])">'+
      '<div class="receiving-tabs" role="tablist" aria-label="Seções do recebimento de produtos">'+
      '<button type="button" role="tab" aria-selected="'+(activeTab==="pedidos")+'" class="'+(activeTab==="pedidos"?"active":"")+
      '" onclick="App.receivingSwitchTab(&quot;pedidos&quot;)">Pedidos</button>'+
      '<button type="button" role="tab" aria-selected="'+(activeTab==="notas")+'" class="'+(activeTab==="notas"?"active":"")+
      '" onclick="App.receivingSwitchTab(&quot;notas&quot;)">Notas fiscais</button></div>'+
      '<div class="receiving-section-heading"><h3>'+(activeTab==="pedidos"?"Pedidos e produtos":"Histórico de notas fiscais")+'</h3>'+
      '<div class="receiving-toolbar">'+
      (activeTab==="pedidos"?'<span id="receivingSelectedCount" class="receiving-selected-count" hidden></span>'+
      '<button id="receivingBulkDeleteBtn" class="btn btn-sm receiving-delete-selected" onclick="App.receivingBulkDelete()" hidden>'+icon("trash")+' Excluir selecionados</button>':'')+
      '<label class="receiving-search">'+icon("search")+
      '<input id="receivingSearch" type="search" value="'+E(savedSearch)+'" placeholder="'+
      (activeTab==="pedidos"?"Buscar pedido, fornecedor ou produto...":"Buscar nota, pedido, fornecedor ou produto...")+
      '" aria-label="Pesquisar '+(activeTab==="pedidos"?"pedidos":"notas fiscais")+
      '" oninput="App.receivingFilter(this.value)"></label></div></div>'+
      (activeTab==="pedidos"?
        '<section class="panel receiving-table">'+
        (t.items?'<div class="table-wrap"><table class="receiving-grid receiving-orders"><thead><tr><th class="receiving-select-cell"><input type="checkbox" id="receivingSelectAll" aria-label="Selecionar todos os produtos exibidos que não possuem entregas" onchange="App.receivingToggleAll(this.checked)"></th><th>Pedido</th><th>Fornecedor</th><th>Produto</th>'+
        '<th class="numeric">Quantidade pedida</th><th class="numeric">Recebido</th><th class="numeric">Falta receber</th>'+
        '<th>Status</th><th>Ações</th></tr></thead><tbody>'+rows+'</tbody></table></div>':
        '<div class="empty-state"><strong>Nenhum produto cadastrado</strong><p>Cadastre um pedido para começar.</p>'+
        '</div>')+'</section>'
      :
        '<section class="panel receiving-table">'+
        (t.receipts?'<div class="table-wrap"><table class="receiving-grid receiving-invoices"><thead><tr><th>Data</th><th>Nº nota fiscal</th><th>Pedido</th>'+
        '<th>Produto</th><th>Fornecedor</th><th class="numeric">Quantidade</th><th>Ações</th></tr></thead><tbody>'+receipts+'</tbody></table></div>':
        '<p class="receiving-no-receipts">Ainda não existem recebimentos lançados.</p>')+'</section>');
    // Aplicar novamente apos redesenhar a tabela (ex.: salvar/editar/excluir NF).
    this.receivingApplyFilter(savedSearch);
  },
  receivingSwitchTab(tab){
    if(tab!=="pedidos"&&tab!=="notas")return;
    const controlId=this.s.detail?.control?.id;
    if(controlId==null||this.s.detail?.control?.mode!=="recebimento")return;
    this.s.receivingTab={controlId,value:tab};
    this.renderReceivingView();
  },
  receivingFilter(query){
    const controlId=this.s.detail?.control?.id;
    if(controlId==null)return;
    const tab=this.s.receivingTab?.controlId===controlId&&this.s.receivingTab.value==="notas"?"notas":"pedidos";
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
    const max=Number(item.remaining_qty)+Number(old?.received_qty||0);
    if(max<=0)return this.toast("Este pedido já foi totalmente recebido.",true);
    this.s.modal="receiving-receipt";
    this.s.modalContext={itemId,receipt:old?deep(old):null};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal receiving-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">'+(old?"Editar recebimento":"Registrar recebimento")+'</h2>'+
      '<p>Registre a quantidade recebida e a nota fiscal.</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><div class="receiving-item-context"><strong>'+E(item.product)+'</strong>'+
      '<span>Pedido '+E(item.order_number)+' · '+E(item.supplier)+'</span>'+
      '<span>Disponível: <b>'+rxNum(max)+' '+E(item.unit)+'</b></span></div>'+
      '<form id="receivingReceiptForm" onsubmit="event.preventDefault();App.receivingSaveReceipt()">'+
      '<div class="form-grid">'+
      rxField("Data da entrega",rxInput("date",old?.received_date||rxToday(),'type="date" required'))+
      rxField("Número da nota fiscal",rxInput("invoice_number",old?.invoice_number||"",'required maxlength="100" placeholder="Ex.: 123456"'))+
      '<div class="field full"><label>Quantidade recebida ('+E(item.unit)+')</label>'+
      rxInput("quantity",old?.received_qty||"",'required inputmode="decimal" placeholder="Ex.: 450"')+'</div>'+
      '<div class="field full"><label>Observações (opcional)</label>'+
      '<textarea rows="2" name="notes" maxlength="1200">'+E(old?.notes||"")+'</textarea></div>'+
      '</div></form><div class="receiving-hint">Esta quantidade será descontada automaticamente do saldo pendente.</div></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.receivingSaveReceipt()">'+icon("check")+' Salvar entrega</button></div></div></div>';
  },
  async receivingSaveReceipt(){
    const form=document.getElementById("receivingReceiptForm"),ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    const f=new FormData(form),payload={
      date:f.get("date"),invoice_number:f.get("invoice_number"),
      quantity:f.get("quantity"),notes:f.get("notes")
    };
    try{
      await this.api(ctx.receipt?"/api/receiving-receipts/"+ctx.receipt.id:
        "/api/receiving-items/"+ctx.itemId+"/receipts",ctx.receipt?"PUT":"POST",payload);
      this.closeModal();await this.load();this.toast("Recebimento salvo. Saldo atualizado.");
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
