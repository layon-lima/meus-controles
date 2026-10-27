"use strict";
/* Importação XML de NF-e: somente prévia e confirmação explícita. */
(function(){
  const escapeHTML=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const isReceiving=()=>typeof App!=="undefined"&&App.s?.detail?.control?.mode==="recebimento"&&!!document.querySelector(".receiving-head");
  const toBase64=file=>new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("Não foi possível ler o XML."));
    reader.onload=()=>resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
  async function loadXML(file){
    if(!file||!isReceiving())return;
    if(!/\.xml$/i.test(file.name)&&!String(file.type).includes("xml")){
      App.toast("Arraste um arquivo XML de NF-e.",true);return;
    }
    if(file.size>2_000_000){App.toast("XML maior que 2 MB.",true);return;}
    try{
      const xml=await toBase64(file);
      const cid=App.s.detail.control.id;
      App.toast("Analisando XML e buscando pedidos...");
      const report=await App.api("/api/controls/"+cid+"/receiving/xml/preview","POST",{xml});
      App.s.receivingXML={xml,report,cid};
      render();
    }catch(err){App.toast(err.message,true);}
  }
  function render(){
    const ctx=App.s.receivingXML;
    if(!ctx)return;
    const report=ctx.report;
    App.s.modal="receiving-xml";
    const lines=report.lines.map((line,index)=>{
      const open=App.s.receivingData?.items||[];
      const allowed=new Map(line.options.map(x=>[x.id,x]));
      const choices=line.options.filter(x=>x.eligible).map(x=>
        '<option value="'+x.id+'"'+(line.suggested_id===x.id?' selected':'')+'>'+
        escapeHTML(x.order+' · '+x.supplier+' · '+x.product+' · '+x.quantity+' '+x.unit+
          ' (disponível '+x.remaining+' '+x.unit+')')+'</option>').join("");
      const manual=open.filter(x=>!x.closed&&Number(x.remaining_qty)>0&&!allowed.has(x.id))
        .map(x=>'<option value="'+x.id+'">'+escapeHTML(x.order+' · '+x.supplier+' · '+x.product+
          ' ('+x.remaining_qty+' '+x.unit+' disponíveis)')+'</option>').join("");
      const alternatives=line.options.filter(x=>!x.eligible).map(x=>
        '<option value="'+x.id+'">'+escapeHTML(x.order+' · '+x.product+' · '+x.quantity+' '+x.unit+
          ' (conferir correspondência)')+'</option>').join("");
      const selected=line.suggested_id;
      return '<div class="receiving-xml-line"><strong>'+escapeHTML(line.name)+'</strong>'+
        '<small>NF-e: '+escapeHTML(line.quantity+' '+line.unit)+(line.code?' · Código '+escapeHTML(line.code):'')+'</small>'+
        '<label>Vincular ao pedido</label><select class="receiving-xml-choice" data-index="'+index+'">'+
        '<option value="">Selecione o pedido para lançar</option><option value="pending">Sem pedido — guardar para vincular depois</option>'+
        (choices?'<optgroup label="Correspondências verificadas">'+choices+'</optgroup>':'')+
        (alternatives?'<optgroup label="Opções para conferência manual">'+alternatives+'</optgroup>':'')+
        (manual?'<optgroup label="Outros pedidos abertos">'+manual+'</optgroup>':'')+
        '</select><small class="receiving-xml-hint">'+(selected?'Sugestão encontrada. Confirme os dados antes de gravar.':
          'Nenhuma correspondência segura automática. Indique o pedido após conferir fornecedor, produto e quantidade.')+'</small></div>';
    }).join("");
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal receiving-xml-modal" role="dialog" aria-modal="true">'+
      '<div class="modal-header"><div><h2>Conferir NF-e XML</h2>'+
      '<p>NF '+escapeHTML(report.invoice_number)+' · '+escapeHTML(report.supplier)+
      (report.cnpj?' · '+escapeHTML(report.cnpj):'')+'</p>'+
      '<p class="receiving-xml-key">Chave de acesso: <strong>'+escapeHTML(report.access_key||'Não encontrada')+'</strong></p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><p class="receiving-xml-warning">Confira o pedido de cada produto. Conversões compatíveis (kg/t, mL/L) são calculadas automaticamente. Nenhum lançamento ocorre sem confirmar.</p>'+
      lines+'</div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.receivingXMLConfirm()">'+icon("check")+' Confirmar lançamentos</button></div></div></div>';
  }
  Object.assign(App,{
    async receivingXMLPendingLoad(){
      const cid=this.s.detail?.control?.id;
      const root=document.getElementById("receivingPendingList");
      if(!root||!cid)return;
      try{
        const result=await this.api("/api/controls/"+cid+"/receiving/xml/pending");
        this.s.receivingXMLPending=result.items;
        if(!result.items.length){root.innerHTML='<p class="receiving-no-receipts">Nenhum item aguardando pedido.</p>';return;}
        root.innerHTML='<div class="table-wrap"><table class="receiving-grid receiving-invoices"><thead><tr><th>NF-e</th><th>Fornecedor</th><th>Produto</th><th>Quantidade</th><th>Ação</th></tr></thead><tbody>'+
          result.items.map(p=>'<tr data-receiving-search="'+escapeHTML([p.invoice_number,p.supplier,p.product,p.access_key].join(" ").toLowerCase())+'"><td>'+escapeHTML(p.invoice_number)+'</td><td>'+escapeHTML(p.supplier)+'</td><td>'+escapeHTML(p.product)+'</td><td>'+escapeHTML(p.quantity+' '+p.unit)+'</td><td><button class="btn btn-sm" onclick="App.receivingXMLPendingAssign('+p.id+')">Vincular pedido</button></td></tr>').join("")+'</tbody></table></div>';
      }catch(err){root.textContent=err.message;}
    },
    receivingXMLPendingAssign(id){
      const pending=this.s.receivingXMLPending?.find(p=>p.id===id);
      if(!pending)return;
      const orders=this.s.receivingData?.items.filter(p=>!p.closed&&Number(p.remaining_qty)>0)||[];
      const options=orders.map(x=>'<option value="'+x.id+'">'+escapeHTML(x.supplier+' · '+x.order_number+' · '+x.product+' ('+x.remaining_qty+' '+x.unit+' disponíveis)')+'</option>').join("");
      this.s.modal="receiving-xml-assign";
      this.s.modalContext={pendingId:id};
      document.getElementById("modalRoot").innerHTML=
        '<div class="modal-backdrop"><div class="modal receiving-manage" role="dialog" aria-modal="true">'+
        '<div class="modal-header"><h2>Vincular pedido</h2><button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
        '<div class="modal-body"><strong>'+escapeHTML(pending.product)+'</strong><p>NF '+escapeHTML(pending.invoice_number)+' · '+escapeHTML(pending.quantity+' '+pending.unit)+'</p>'+
        '<label>Pedido cadastrado</label><select id="receivingXMLPendingOrder"><option value="">Selecione o pedido</option>'+options+'</select>'+
        '<p class="receiving-xml-warning">Confira produto, fornecedor, unidade e saldo antes de confirmar.</p></div>'+
        '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button><button class="btn btn-primary" onclick="App.receivingXMLPendingSave()">Vincular e registrar</button></div></div></div>';
    },
    async receivingXMLPendingSave(){
      const id=this.s.modalContext?.pendingId;
      const iid=Number(document.getElementById("receivingXMLPendingOrder")?.value);
      if(!id||!iid)return this.toast("Selecione um pedido.",true);
      if(!window.confirm("Registrar este produto no pedido selecionado?"))return;
      try{
        await this.api("/api/controls/"+this.s.detail.control.id+"/receiving/xml/pending/"+id+"/assign","POST",{item_id:iid});
        this.closeModal();
        await this.renderReceiving();
        this.toast("Recebimento vinculado ao pedido.");
      }catch(err){this.toast(err.message,true);}
    },
    receivingXMLChoose(){document.getElementById("receivingXMLFile")?.click();},
    async receivingXMLLoad(files){await loadXML(files?.[0]);const input=document.getElementById("receivingXMLFile");if(input)input.value="";},
    async receivingXMLConfirm(){
      const ctx=this.s.receivingXML;
      if(!ctx||this.s.receivingXMLBusy)return;
      const selections=[...document.querySelectorAll(".receiving-xml-choice")].map(el=>el.value==="pending"?"pending":el.value?Number(el.value):null);
      if(selections.some(x=>x===null)){this.toast("Selecione o pedido de todos os produtos antes de confirmar.",true);return;}
      if(!window.confirm("Confirmar "+selections.length+" item(ns) da NF-e "+ctx.report.invoice_number+"? Verifique as quantidades e os pedidos selecionados."))return;
      this.s.receivingXMLBusy=true;
      try{
        const result=await this.api("/api/controls/"+ctx.cid+"/receiving/xml/confirm","POST",
          {xml:ctx.xml,selections});
        this.closeModal();
        this.s.receivingXML=null;
        await this.renderReceiving();
        this.toast(result.inserted+" lançado(s), "+result.pending+" em Sem pedido.");
      }catch(err){this.toast(err.message,true);}
      finally{this.s.receivingXMLBusy=false;}
    }
  });
  // Captura antecipada: o navegador nunca deve navegar para um XML solto.
  // Nao depende de dataTransfer.types (que varia entre Chrome, Edge e Windows).
  const hasFiles=event=>!!(event.dataTransfer?.files?.length||
    Array.from(event.dataTransfer?.types||[]).includes("Files"));
  window.addEventListener("dragenter",event=>{
    if(!hasFiles(event))return;
    event.preventDefault();
    if(isReceiving())document.body.classList.add("receiving-xml-drag");
  },true);
  window.addEventListener("dragover",event=>{
    if(!hasFiles(event))return;
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect="copy";
    document.body.classList.toggle("receiving-xml-drag",isReceiving());
  },true);
  window.addEventListener("dragleave",event=>{
    if(!event.relatedTarget)document.body.classList.remove("receiving-xml-drag");
  },true);
  window.addEventListener("drop",event=>{
    if(!hasFiles(event))return;
    event.preventDefault();
    event.stopPropagation();
    document.body.classList.remove("receiving-xml-drag");
    if(!isReceiving())return;
    const files=Array.from(event.dataTransfer?.files||[]);
    if(files.length!==1){App.toast("Solte um arquivo XML por vez.",true);return;}
    void loadXML(files[0]);
  },true);
})();
