"use strict";
/* Pedidos, produtos e recebimentos parciais por nota fiscal. */
const rxToday=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const rxNum=x=>Number(x||0).toLocaleString("pt-BR",{maximumFractionDigits:3});
const rxDate=x=>x?x.slice(8,10)+"/"+x.slice(5,7)+"/"+x.slice(0,4):"—";
const rxInput=(name,value,attr="")=>'<input name="'+name+'" value="'+E(value??"")+'" '+attr+'>';
const rxField=(title,widget)=>'<div class="field"><label>'+E(title)+'</label>'+widget+'</div>';
const rxUnitList=["un","kg","t","L","sc","cx","pct","m","m²","m³"];

Object.assign(App,{
  async renderReceiving(){
    const ctrl=this.s.detail?.control;
    if(!ctrl||ctrl.mode!=="recebimento")return;
    const id=ctrl.id;
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
    const rows=r.items.map(p=>{
      const status=p.status==="complete"?"Recebido":p.status==="partial"?"Parcial":"Pendente";
      const action=p.status==="complete"?"":'<button class="mini-action" onclick="App.receivingReceiptForm('+p.id+')">'+icon("plus")+' Receber</button>';
      return '<tr data-receiving-search="'+E([p.order_number,p.supplier,p.product].join(" ").toLowerCase())+'">'+
        '<td><strong>'+E(p.order_number)+'</strong></td><td>'+E(p.supplier)+'</td><td><strong>'+E(p.product)+'</strong></td>'+
        '<td class="numeric">'+rxNum(p.ordered_qty)+' '+E(p.unit)+'</td>'+
        '<td class="numeric">'+rxNum(p.received_qty)+' '+E(p.unit)+'</td>'+
        '<td class="numeric"><b>'+rxNum(p.remaining_qty)+' '+E(p.unit)+'</b></td>'+
        '<td><span class="receiving-status '+E(p.status)+'">'+status+'</span></td>'+
        '<td><div class="table-actions">'+action+
        '<button class="mini-action" onclick="App.receivingItemForm('+p.id+')">'+icon("edit")+' Editar</button>'+
        '<button class="mini-action" onclick="App.receivingDeleteItem('+p.id+')">'+icon("trash")+' Excluir</button></div></td></tr>';
    }).join("");
    const receipts=r.receipts.map(p=>
      '<tr data-receiving-search="'+E([p.invoice_number,p.order_number,p.product,p.supplier].join(" ").toLowerCase())+'">'+
      '<td>'+rxDate(p.received_date)+'</td><td><b>'+E(p.invoice_number)+'</b></td>'+
      '<td>'+E(p.order_number)+'</td><td>'+E(p.product)+'<small class="receiving-subline">'+E(p.supplier)+'</small></td>'+
      '<td class="numeric">'+rxNum(p.received_qty)+' '+E(p.unit)+'</td><td><div class="table-actions">'+
      '<button class="mini-action" onclick="App.receivingReceiptForm('+p.item_id+','+p.id+')">'+icon("edit")+' Editar</button>'+
      '<button class="mini-action" onclick="App.receivingDeleteReceipt('+p.id+')">'+icon("trash")+' Excluir</button>'+
      '</div></td></tr>').join("");
    document.getElementById("main").innerHTML=
      '<div class="receiving-head"><div><div class="eyebrow">RECEBIMENTO DE PRODUTOS</div>'+
      '<p>Controle de pedidos, fornecedores e entregas por nota fiscal.</p></div>'+
      '<div class="receiving-header-actions">'+
      (t.items===0?'<button class="btn btn-sm" onclick="App.receivingChooseImport()">'+icon("download")+' Importar pedidos</button>':'')+
      '<button class="btn btn-sm" onclick="App.receivingSettings('+c.id+')">'+icon("settings")+' Ajustes</button>'+
      '<button class="btn btn-primary" onclick="App.receivingItemForm()">'+icon("plus")+' Cadastrar produto do pedido</button></div></div>'+
      '<input type="file" accept=".json,application/json" id="receivingImportInput" hidden onchange="App.receivingLoadImportFile(this.files[0])">'+
      '<div class="receiving-kpis">'+
      [['Produtos cadastrados',t.items],['Totalmente recebidos',t.complete],['Parcialmente recebidos',t.partial],['Entregas registradas',t.receipts]].map(x=>
      '<div class="receiving-kpi"><span>'+x[0]+'</span><strong>'+x[1]+'</strong></div>').join("")+'</div>'+
      '<div class="receiving-section-heading"><h3>Pedidos e produtos</h3>'+
      '<label class="receiving-search">'+icon("search")+
      '<input type="search" placeholder="Buscar pedido, fornecedor, produto ou nota..." aria-label="Pesquisar" oninput="App.receivingFilter(this.value)"></label></div>'+
      '<section class="panel receiving-table">'+
      (t.items?'<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Fornecedor</th><th>Produto</th>'+
       '<th class="numeric">Quantidade pedida</th><th class="numeric">Recebido</th><th class="numeric">Falta receber</th>'+
       '<th>Status</th><th>Ações</th></tr></thead><tbody>'+rows+'</tbody></table></div>':
       '<div class="empty-state"><strong>Nenhum produto cadastrado</strong><p>Cadastre um pedido para começar.</p>'+
       '<button class="btn btn-primary" onclick="App.receivingItemForm()">'+icon("plus")+' Cadastrar produto</button></div>')+'</section>'+
      '<section class="panel receiving-table"><div class="panel-header"><h3>Histórico de notas fiscais</h3>'+
      '<span class="secondary-text">'+t.receipts+' entrega(s)</span></div>'+
      (t.receipts?'<div class="table-wrap"><table><thead><tr><th>Data</th><th>Nº nota fiscal</th><th>Pedido</th>'+
       '<th>Produto / fornecedor</th><th class="numeric">Quantidade</th><th>Ações</th></tr></thead><tbody>'+receipts+'</tbody></table></div>':
       '<p class="receiving-no-receipts">Ainda não existem recebimentos lançados.</p>')+'</section>';
  },
  receivingFilter(query){
    const value=String(query||"").trim().toLowerCase();
    document.querySelectorAll("[data-receiving-search]").forEach(el=>{
      el.hidden=!el.getAttribute("data-receiving-search").toLowerCase().includes(value);
    });
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
      rxField("Fornecedor",rxInput("supplier",item?.supplier||"",'required maxlength="160" placeholder="Nome do fornecedor"'))+
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
