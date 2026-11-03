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
      App.s.receivingXML={xml,report,cid,selections:Array(report.lines.length).fill(null)};
      render();
    }catch(err){App.toast(err.message,true);}
  }
  const normalized=value=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\bkcl\b/g,"cloreto potassio")
    .replace(/\b(?:de|do|da)\b/g," ").replace(/\s+/g," ").trim();
  const unitFamily=unit=>{
    const code=normalized(unit).replace(/\s+/g,"").toUpperCase();
    if(["KG","KGM","T","TO","TON","TONELADA","G","GR"].includes(code))return "mass";
    if(["L","LT","LITRO","ML"].includes(code))return "volume";
    if(["UN","UND","UNID"].includes(code))return "count";
    return code?"other:"+code:"";
  };
  const needsManualConversion=(index,item)=>{
    const line=App.s.receivingXML?.report?.lines?.[index];
    if(!line||!item)return false;
    if(item.reason==="Unidade incompatível")return true;
    const a=unitFamily(line.unit),b=unitFamily(item.unit);
    return !a||!b||a!==b;
  };
  const typedQuantity=value=>{
    const raw=String(value??"").trim();
    if(!/^\d+(?:[.,]\d{1,3})?$/.test(raw))return null;
    const number=Number(raw.replace(",","."));
    return Number.isFinite(number)&&number>0?number:null;
  };
  const orderNumber=item=>String(item.order_number??item.order??"Pedido sem número");
  const optionLabel=item=>orderNumber(item)+" · "+item.supplier+" · "+item.product;
  function pickerOptions(index){
    const ctx=App.s.receivingXML, line=ctx.report.lines[index];
    const map=new Map();
    for(const x of line.options||[]){
      map.set(Number(x.id),{...x,order_number:orderNumber(x),remaining_qty:x.remaining,
        product_score:Number(x.product_score||0),supplier_score:Number(x.supplier_score||0),
        fromPreview:true});
    }
    for(const x of App.s.receivingData?.items||[]){
      if(x.closed||Number(x.remaining_qty)<=0||map.has(Number(x.id)))continue;
      map.set(Number(x.id),{...x,order_number:orderNumber(x),product_score:0,
        supplier_score:0,fromPreview:false});
    }
    return [...map.values()].sort((a,b)=>
      b.product_score-a.product_score||b.supplier_score-a.supplier_score||
      optionLabel(a).localeCompare(optionLabel(b),"pt-BR"));
  }
  function updatePicker(index){
    const ctx=App.s.receivingXML;
    const input=document.getElementById("receivingXMLSearch-"+index);
    const list=document.getElementById("receivingXMLResults-"+index);
    if(!ctx||!input||!list)return;
    const selected=ctx.selections[index];
    if(selected!==null&&selected!==undefined){
      list.hidden=true;input.setAttribute("aria-expanded","false");return;
    }
    const words=normalized(input.value).split(" ").filter(Boolean);
    const all=pickerOptions(index);
    let filtered;
    if(words.length){
      filtered=all.filter(x=>{
        const hay=normalized(optionLabel(x));
        return words.every(word=>hay.includes(word));
      }).slice(0,12);
    }else{
      // Não inundar o usuário com 100 pedidos irrelevantes: só sugerir
      // produtos com alguma semelhança até que ele comece a digitar.
      filtered=all.filter(x=>x.product_score>=.48).slice(0,7);
    }
    const line=ctx.report.lines[index];
    const optionHTML=filtered.map(x=>{
      const id=Number(x.id);
      const score=Number(x.product_score||0);
      const description=x.fromPreview
        ? (score>=.7?"Produto semelhante":"Possível pedido")
        : "Pedido aberto";
      const supplierWarning=x.fromPreview&&Number(x.supplier_score)<.72
        ? " · Fornecedor diferente: conferir" : "";
      const remain=String(x.remaining_qty??x.remaining??"")+" "+String(x.unit??"");
      const manual=needsManualConversion(index,x);
      const blocked=x.selectable===false&&!manual;
      const status=manual?"Informar equivalência manual":
        blocked?(x.reason||"Pedido indisponível"):description+supplierWarning;
      return '<button type="button" class="receiving-xml-result" role="option"'+
        (blocked?' disabled aria-disabled="true"':' data-xml-pick="'+id+
          '" onclick="App.receivingXMLPick('+index+','+id+')"')+'>'+
        '<span><strong>'+escapeHTML(x.product)+'</strong><small>'+escapeHTML(
          orderNumber(x)+' · '+x.supplier)+'</small></span>'+
        '<span class="receiving-xml-result-side"><small>'+escapeHTML(status)+
        '</small><small>Disponível: '+escapeHTML(remain)+'</small></span></button>';
    }).join("");
    const empty=!filtered.length?'<p class="receiving-xml-empty">'+
      (words.length?"Nenhum pedido encontrado. Experimente outro nome, fornecedor ou número.":
      "Nenhuma correspondência forte. Digite para pesquisar todos os pedidos abertos.")+
      '</p>':"";
    list.innerHTML=optionHTML+empty+
      '<button type="button" class="receiving-xml-result receiving-xml-pending" role="option" '+
      'data-xml-pick="pending" onclick="App.receivingXMLPick('+index+',&quot;pending&quot;)">'+
      '<strong>Sem pedido — guardar para vincular depois</strong></button>';
    list.hidden=false;input.setAttribute("aria-expanded","true");
    list.dataset.active="-1";
  }
  function renderManualConversion(index,item){
    const ctx=App.s.receivingXML;
    const box=document.getElementById("receivingXMLManual-"+index);
    if(!ctx||!box)return;
    const manual=item&&needsManualConversion(index,item);
    ctx.manualRequired[index]=!!manual;
    if(!manual){
      ctx.manualQuantities[index]=null;
      box.innerHTML="";box.hidden=true;return;
    }
    const line=ctx.report.lines[index];
    ctx.manualQuantities[index]=null;
    box.hidden=false;
    box.innerHTML='<strong>Informar equivalência das unidades</strong>'+
      '<p>Na NF-e: <b>'+escapeHTML(line.quantity+" "+line.unit)+'</b> · '+
      'No pedido: <b>'+escapeHTML(item.unit)+'</b> · '+
      'Saldo disponível: <b>'+escapeHTML((item.remaining_qty??item.remaining)+" "+item.unit)+'</b></p>'+
      '<label for="receivingXMLManualQty-'+index+'">A quantidade da nota equivale a quantos '+escapeHTML(item.unit)+'?</label>'+
      '<input type="text" inputmode="decimal" autocomplete="off" id="receivingXMLManualQty-'+index+'" '+
      'placeholder="Quantidade equivalente em '+escapeHTML(item.unit)+'" '+
      'oninput="App.receivingXMLManualInput('+index+',this.value)">'+
      '<small id="receivingXMLManualHint-'+index+'">Informe o total na unidade do pedido, sem separador de milhar (até 3 casas decimais).</small>';
    document.getElementById("receivingXMLManualQty-"+index)?.focus();
  }
  function render(){
    const ctx=App.s.receivingXML;
    if(!ctx)return;
    const report=ctx.report;
    if(!Array.isArray(ctx.selections)||ctx.selections.length!==report.lines.length)
      ctx.selections=Array(report.lines.length).fill(null);
    ctx.manualQuantities=Array(report.lines.length).fill(null);
    ctx.manualRequired=Array(report.lines.length).fill(false);
    App.s.modal="receiving-xml";
    const lines=report.lines.map((line,index)=>
      '<div class="receiving-xml-line"><strong>'+escapeHTML(line.name)+'</strong>'+
      '<small>NF-e: '+escapeHTML(line.quantity+' '+line.unit)+
      (line.code?' · Código '+escapeHTML(line.code):'')+'</small>'+
      '<label for="receivingXMLSearch-'+index+'">Pesquisar produto, fornecedor ou nº do pedido</label>'+
      '<input id="receivingXMLSearch-'+index+'" class="receiving-xml-search" type="search" '+
      'autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="true" '+
      'aria-controls="receivingXMLResults-'+index+'" placeholder="Digite para buscar entre os pedidos..." '+
      'onfocus="App.receivingXMLFocus('+index+')" '+
      'oninput="App.receivingXMLSearch('+index+',this.value)" '+
      'onkeydown="App.receivingXMLKeydown(event,'+index+')">'+
      '<div id="receivingXMLResults-'+index+'" class="receiving-xml-results" role="listbox"></div>'+
      '<small id="receivingXMLStatus-'+index+'" class="receiving-xml-hint">'+
      'Escolha uma sugestão ou pesquise manualmente. Nenhum pedido será vinculado sem sua seleção.'+
      '</small><div id="receivingXMLManual-'+index+'" class="receiving-xml-manual" hidden></div></div>').join("");
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal receiving-xml-modal" role="dialog" aria-modal="true">'+
      '<div class="modal-header"><div><h2>Conferir NF-e XML</h2>'+
      '<p>NF '+escapeHTML(report.invoice_number)+' · '+escapeHTML(report.supplier)+
      (report.cnpj?' · '+escapeHTML(report.cnpj):'')+'</p>'+
      '<p class="receiving-xml-key">Chave de acesso: <strong>'+escapeHTML(report.access_key||'Não encontrada')+'</strong></p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><p class="receiving-xml-warning">Pesquise o pedido pelo produto, fornecedor ou número. As sugestões são aproximadas; confira as informações e o saldo. Nenhum lançamento ocorre sem confirmar.</p>'+
      lines+'</div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.receivingXMLConfirm()">'+icon("check")+' Confirmar lançamentos</button></div></div></div>';
    report.lines.forEach((_,index)=>updatePicker(index));
  }
  Object.assign(App,{
    receivingXMLFocus(index){updatePicker(index);},
    receivingXMLSearch(index){
      const ctx=this.s.receivingXML;
      if(!ctx)return;
      ctx.selections[index]=null;
      ctx.manualRequired[index]=false;
      ctx.manualQuantities[index]=null;
      const box=document.getElementById("receivingXMLManual-"+index);
      if(box){box.hidden=true;box.innerHTML="";}
      const status=document.getElementById("receivingXMLStatus-"+index);
      if(status)status.textContent="Selecione um resultado da busca antes de confirmar.";
      updatePicker(index);
    },
    receivingXMLManualInput(index,value){
      const ctx=this.s.receivingXML;
      if(!ctx||!ctx.manualRequired[index])return;
      ctx.manualQuantities[index]=String(value).trim();
      const hint=document.getElementById("receivingXMLManualHint-"+index);
      if(!hint)return;
      const amount=typedQuantity(value);
      const item=pickerOptions(index).find(x=>Number(x.id)===ctx.selections[index]);
      const remaining=Number(item?.remaining_qty??item?.remaining);
      hint.textContent=amount===null?
        "Informe quantidade positiva, sem separador de milhar, com até 3 casas decimais.":
        amount>remaining?
          "Quantidade superior ao saldo disponível no pedido.":
          "Equivalência: "+ctx.report.lines[index].quantity+" "+ctx.report.lines[index].unit+
          " = "+value+" "+item.unit+". Confira antes de confirmar.";
    },
    receivingXMLPick(index,value){
      const ctx=this.s.receivingXML;
      if(!ctx)return;
      const input=document.getElementById("receivingXMLSearch-"+index);
      const status=document.getElementById("receivingXMLStatus-"+index);
      if(value==="pending"){
        ctx.selections[index]="pending";
        renderManualConversion(index,null);
        if(input)input.value="Sem pedido — guardar para vincular depois";
        if(status)status.textContent="Item ficará na aba Sem pedido para vinculação posterior.";
      }else{
        const item=pickerOptions(index).find(x=>Number(x.id)===Number(value));
        if(!item)return this.toast("Pedido não encontrado. Pesquise novamente.",true);
        if(item.selectable===false&&!needsManualConversion(index,item))
          return this.toast(item.reason||"Pedido indisponível.",true);
        ctx.selections[index]=Number(item.id);
        if(input)input.value=optionLabel(item);
        if(status)status.textContent=needsManualConversion(index,item)?
          "Informe a equivalência da quantidade da NF-e na unidade do pedido.":
          "Pedido selecionado. Confira o produto, a unidade e o saldo antes de confirmar.";
        renderManualConversion(index,item);
      }
      updatePicker(index);
    },
    receivingXMLKeydown(event,index){
      const list=document.getElementById("receivingXMLResults-"+index);
      if(!list)return;
      const buttons=[...list.querySelectorAll("[data-xml-pick]")];
      if(event.key==="Escape"){
        list.hidden=true;event.currentTarget.setAttribute("aria-expanded","false");return;
      }
      if(!buttons.length)return;
      if(event.key==="ArrowDown"||event.key==="ArrowUp"){
        event.preventDefault();
        const current=Number(list.dataset.active??-1);
        const next=event.key==="ArrowDown"
          ? (current+1)%buttons.length
          : (current<=0?buttons.length-1:current-1);
        list.dataset.active=String(next);
        buttons.forEach((btn,i)=>btn.classList.toggle("active",i===next));
        buttons[next].scrollIntoView({block:"nearest"});
      }else if(event.key==="Enter"&&!list.hidden){
        event.preventDefault();
        const current=Math.max(0,Number(list.dataset.active??-1));
        const value=buttons[current].dataset.xmlPick;
        this.receivingXMLPick(index,value==="pending"?"pending":Number(value));
      }
    },
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
      const selections=[...ctx.selections];
      if(selections.some(x=>x===null)){this.toast("Selecione o pedido de todos os produtos antes de confirmar.",true);return;}
      for(let index=0;index<selections.length;index++){
        if(!ctx.manualRequired[index])continue;
        const amount=typedQuantity(ctx.manualQuantities[index]);
        const item=pickerOptions(index).find(x=>Number(x.id)===selections[index]);
        if(amount===null||!item||amount>Number(item.remaining_qty??item.remaining)){
          this.toast("Informe uma equivalência válida, dentro do saldo do pedido, para "+ctx.report.lines[index].name+".",true);
          document.getElementById("receivingXMLManualQty-"+index)?.focus();
          return;
        }
      }
      if(!window.confirm("Confirmar "+selections.length+" item(ns) da NF-e "+ctx.report.invoice_number+"? Verifique as quantidades e os pedidos selecionados."))return;
      this.s.receivingXMLBusy=true;
      try{
        const result=await this.api("/api/controls/"+ctx.cid+"/receiving/xml/confirm","POST",
          {xml:ctx.xml,selections,manual_quantities:[...ctx.manualQuantities]});
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
