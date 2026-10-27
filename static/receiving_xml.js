"use strict";
/* Importação XML de NF-e: somente prévia e confirmação explícita. */
(function(){
  const escapeHTML=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const isReceiving=()=>App.s.route==="control"&&App.s.detail?.control?.mode==="recebimento";
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
        '<option value="">Selecione o pedido para lançar</option>'+
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
      (report.cnpj?' · '+escapeHTML(report.cnpj):'')+'</p></div>'+
      '<button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><p class="receiving-xml-warning">Confira o pedido de cada produto. Conversões compatíveis (kg/t, mL/L) são calculadas automaticamente. Nenhum lançamento ocorre sem confirmar.</p>'+
      lines+'</div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.receivingXMLConfirm()">'+icon("check")+' Confirmar lançamentos</button></div></div></div>';
  }
  Object.assign(App,{
    receivingXMLChoose(){document.getElementById("receivingXMLFile")?.click();},
    async receivingXMLLoad(files){await loadXML(files?.[0]);const input=document.getElementById("receivingXMLFile");if(input)input.value="";},
    async receivingXMLConfirm(){
      const ctx=this.s.receivingXML;
      if(!ctx||this.s.receivingXMLBusy)return;
      const selections=[...document.querySelectorAll(".receiving-xml-choice")].map(el=>el.value?Number(el.value):null);
      if(selections.some(x=>x===null)){this.toast("Selecione o pedido de todos os produtos antes de confirmar.",true);return;}
      if(!window.confirm("Confirmar "+selections.length+" item(ns) da NF-e "+ctx.report.invoice_number+"? Verifique as quantidades e os pedidos selecionados."))return;
      this.s.receivingXMLBusy=true;
      try{
        const result=await this.api("/api/controls/"+ctx.cid+"/receiving/xml/confirm","POST",
          {xml:ctx.xml,selections});
        this.closeModal();
        this.s.receivingXML=null;
        await this.renderReceiving();
        this.toast(result.inserted+" item(ns) da NF-e lançados.");
      }catch(err){this.toast(err.message,true);}
      finally{this.s.receivingXMLBusy=false;}
    }
  });
  document.addEventListener("dragover",event=>{
    if(!isReceiving()||!event.dataTransfer?.types?.includes("Files"))return;
    event.preventDefault();
    event.dataTransfer.dropEffect="copy";
    document.body.classList.add("receiving-xml-drag");
  });
  document.addEventListener("dragleave",event=>{
    if(!event.relatedTarget)document.body.classList.remove("receiving-xml-drag");
  });
  document.addEventListener("drop",event=>{
    document.body.classList.remove("receiving-xml-drag");
    if(!isReceiving())return;
    if(!event.dataTransfer?.files?.length)return;
    event.preventDefault();
    loadXML(event.dataTransfer.files[0]);
  });
})();
