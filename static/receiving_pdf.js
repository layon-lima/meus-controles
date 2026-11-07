"use strict";
/* Importação de pedidos em PDF: leitura no servidor, revisão obrigatória no navegador. */
const rpdfUnits=["kg","t","L","DOS","un","cx","sc","pct","m","m²","m³"];
const rpdfNormalize=t=>String(t??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLocaleLowerCase("pt-BR").replace(/[.,;:]/g," ").replace(/\s+/g," ").trim();
const rpdfValid=row=>Boolean(String(row.order_number||"").trim()&&String(row.supplier||"").trim()&&
  String(row.product||"").trim()&&String(row.unit||"").trim()&&
  Number.isFinite(Number(String(row.ordered_qty||"").replace(/\./g,"").replace(",",".")))&&
  Number(String(row.ordered_qty||"").replace(/\./g,"").replace(",","."))>0);
const rpdfBase64=async file=>{
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary="";
  for(let i=0;i<bytes.length;i+=8192)
    binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
};
// Aproximacao conservadora para conciliar produtos OCR e GPT; codigos numericos diferentes nunca se fundem.
const rpdfSimilarity=(a,b)=>{
  a=rpdfNormalize(a);b=rpdfNormalize(b);
  if(a===b)return 1;
  const nums=x=>x.match(/\d+/g)||[];
  if(nums(a).join("|")!==nums(b).join("|"))return 0;
  if(!a||!b)return 0;
  const dp=Array.from({length:b.length+1},(_,j)=>j);
  for(let i=1;i<=a.length;i++){
    let prev=dp[0];dp[0]=i;
    for(let j=1;j<=b.length;j++){
      const old=dp[j];
      dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=old;
    }
  }
  return 1-dp[b.length]/Math.max(a.length,b.length);
};

Object.assign(App,{
  receivingPdfChoose(){
    if(!this.canOpenForm())return;
    const control=this.s.detail?.control;
    if(!control||control.mode!=="recebimento")return;
    const input=document.getElementById("receivingPdfFile");
    if(!input){this.toast("Abra primeiro o controle de recebimentos.",true);return}
    input.value="";
    input.click();
  },
  async receivingPdfLoad(files){
    const list=Array.from(files||[]);
    if(!list.length)return;
    const control=this.s.detail?.control;
    if(!control||control.mode!=="recebimento")return;
    if(list.length>20){
      this.toast("Selecione no máximo 20 PDFs por vez.",true);return;
    }
    const wrong=list.find(file=>!file.name.toLowerCase().endsWith(".pdf")||
      file.size>7*1024*1024||file.size<5);
    if(wrong){
      this.toast("Arquivo inválido ou maior que 7 MB: "+wrong.name,true);return;
    }
    this.s.receivingPdf={controlId:control.id,docs:[],errors:[],working:true,gptKey:"",
      progress:"Preparando leitura dos PDFs..."};
    this.s.modal="receiving-pdf";
    this.receivingPdfRender();
    const known=this.s.receivingData?.items||[];
    const vendors=[...new Set(known.map(p=>p.supplier).filter(Boolean))];
    for(let i=0;i<list.length;i++){
      if(this.s.modal!=="receiving-pdf")return;
      const file=list[i];
      this.s.receivingPdf.progress="Lendo "+(i+1)+"/"+list.length+": "+file.name;
      this.receivingPdfRender();
      try{
        const base64=await rpdfBase64(file);
        const result=await this.api("/api/controls/"+control.id+"/receiving/pdf/preview",
          "POST",{filename:file.name,base64});
        if(this.s.modal!=="receiving-pdf")return;
        if(result.already_imported){
          this.s.receivingPdf.errors.push(file.name+": este PDF já foi importado anteriormente.");
          continue;
        }
        const existingSupplier=vendors.find(name=>rpdfNormalize(name)===rpdfNormalize(result.supplier));
        const supplier=existingSupplier||result.supplier||"";
        this.s.receivingPdf.docs.push({...result,pdfBase64:base64,items:result.items.map((item,index)=>({
          index,enabled:true,order_number:item.order_number||result.order_number||"",
          supplier:item.supplier||supplier,product:item.product||"",unit:item.unit||"un",
          ordered_qty:item.ordered_qty||""
        }))});
      }catch(err){
        if(this.s.modal!=="receiving-pdf")return;
        this.s.receivingPdf.errors.push(file.name+": "+err.message);
      }
    }
    if(this.s.modal!=="receiving-pdf")return;
    this.s.receivingPdf.working=false;
    this.s.receivingPdf.progress="";
    this.receivingPdfRender();
  },
  receivingPdfRender(){
    const ctx=this.s.receivingPdf;
    if(!ctx||this.s.modal!=="receiving-pdf")return;
    const vendors=[...new Map((this.s.receivingData?.items||[]).map(p=>
      [rpdfNormalize(p.supplier),p.supplier]).filter(x=>x[0])).values()];
    const datalist='<datalist id="receivingPdfSuppliers">'+vendors.map(name=>
      '<option value="'+E(name)+'"></option>').join("")+'</datalist>';
    const summaries=ctx.docs.map((doc,fi)=>{
      const rows=doc.items.map((item,ri)=>{
        const options=(rpdfUnits.includes(item.unit)?rpdfUnits:[...rpdfUnits,item.unit]).map(u=>
          '<option value="'+E(u)+'"'+(u===item.unit?' selected':'')+'>'+E(u)+'</option>').join("");
        return '<tr class="'+(!item.enabled?'rpdf-disabled':'')+
          (doc.gptChanged?.includes(item.index)?' rpdf-gpt-changed':'')+
          '" data-rpdf-row="'+fi+'-'+ri+'">'+
          '<td><input type="checkbox" '+(item.enabled?'checked':'')+
          ' aria-label="Importar produto '+(ri+1)+'" onchange="App.receivingPdfEdit('+fi+','+ri+
          ',&quot;enabled&quot;,this.checked)"></td>'+
          '<td><input aria-label="Número do pedido" value="'+E(item.order_number)+'"'+
          ' oninput="App.receivingPdfEdit('+fi+','+ri+',&quot;order_number&quot;,this.value)" placeholder="Nº pedido"></td>'+
          '<td><input aria-label="Fornecedor" list="receivingPdfSuppliers" value="'+E(item.supplier)+'" '+
          'oninput="App.receivingPdfEdit('+fi+','+ri+',&quot;supplier&quot;,this.value)" placeholder="Fornecedor"></td>'+
          '<td><input aria-label="Produto" value="'+E(item.product)+'" '+
          'oninput="App.receivingPdfEdit('+fi+','+ri+',&quot;product&quot;,this.value)" placeholder="Nome do produto"></td>'+
          '<td><input aria-label="Quantidade" inputmode="decimal" value="'+E(item.ordered_qty)+'" '+
          'oninput="App.receivingPdfEdit('+fi+','+ri+',&quot;ordered_qty&quot;,this.value)" placeholder="Quantidade"></td>'+
          '<td><select aria-label="Unidade de medida" onchange="App.receivingPdfEdit('+fi+','+ri+
          ',&quot;unit&quot;,this.value)">'+options+'</select></td></tr>';
      }).join("");
      const suggestion=doc.gptResult;
      const suggested=suggestion?'<div class="rpdf-gpt-suggestion">'+
        '<div class="rpdf-gpt-suggestion-title"><strong>Conferência GPT · '+suggestion.items.length+
        ' produto(s) identificados</strong>'+
        '<button type="button" class="btn btn-sm btn-primary" onclick="App.receivingPdfApplyGPT('+fi+')">'+
        icon("check")+' Aplicar sugestões</button></div>'+
        '<p>Compare os resultados. Nada é alterado até clicar em Aplicar sugestões.</p>'+
        '<div class="rpdf-gpt-items">'+suggestion.items.map(item=>
          '<span>'+E(item.product)+' · '+E(item.ordered_qty)+' '+E(item.unit)+
          ' · '+E(item.supplier||suggestion.supplier||"Fornecedor não identificado")+
          ' · '+E(item.order_number||suggestion.order_number||"Pedido não identificado")+'</span>').join("")+'</div>'+
        (suggestion.warnings||[]).map(w=>'<p class="rpdf-gpt-alert">'+E(w)+'</p>').join("")+
        '</div>':'';
      return '<section class="rpdf-document">'+
        '<div class="rpdf-doc-title"><strong>'+E(doc.filename)+'</strong>'+
        '<span>'+doc.items.length+' produto(s) · '+doc.pages+' página(s) · '+
        (doc.ocr_pages?'OCR em '+doc.ocr_pages+' página(s)':'texto selecionável')+'</span>'+
        '<button type="button" class="btn btn-sm" onclick="App.receivingPdfAddRow('+fi+')">'+
        icon("plus")+' Adicionar produto</button>'+
        '<button type="button" class="btn btn-sm rpdf-gpt-button" onclick="App.receivingPdfCheckGPT('+fi+')" '+
        (ctx.working?'disabled':'')+'>'+icon("sparkles")+' Corrigir com GPT</button></div>'+
        (doc.warnings||[]).map(w=>'<p class="rpdf-warning">'+E(w)+'</p>').join("")+
        (doc.gptApplied?'<p class="rpdf-gpt-applied">Sugestões aplicadas à prévia. Revise e clique em Importar quando estiver certo.</p>':'')+
        suggested+
        (doc.needs_manual_review?'<p class="rpdf-warning">Alguns campos não foram reconhecidos com segurança. Revise e complete as informações.</p>':'')+
        '<div class="rpdf-table-wrap"><table class="rpdf-table"><thead><tr><th>Usar</th><th>Nº pedido</th>'+
        '<th>Fornecedor</th><th>Produto</th><th>Quantidade</th><th>Unidade</th></tr></thead>'+
        '<tbody>'+rows+'</tbody></table></div></section>';
    }).join("");
    const count=ctx.docs.reduce((n,d)=>n+d.items.filter(i=>i.enabled).length,0);
    const invalid=ctx.docs.reduce((n,d)=>n+d.items.filter(i=>i.enabled&&!rpdfValid(i)).length,0);
    const errors=ctx.errors.length?'<div class="rpdf-errors">'+ctx.errors.map(e=>
      '<p>'+E(e)+'</p>').join("")+'</div>':"";
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal rpdf-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Importar pedidos por PDF (OCR)</h2>'+
      '<p>Confira cada produto antes de lançar no controle. Um pedido pode ter várias linhas.</p></div>'+
      '<button class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
      '<div class="modal-body">'+
      '<div class="rpdf-gpt-connect"><div><strong>Assistente GPT para conferir o PDF</strong>'+
      '<p>Opcional e manual. A chave de API OpenAI não é salva nem substitui a sua conferência.</p></div>'+
      '<input type="password" autocomplete="off" spellcheck="false" aria-label="Chave de API OpenAI" '+
      'placeholder="'+(ctx.gptKey?'Chave conectada nesta sessão':'Cole sua chave API OpenAI (sk-...)')+
      '" oninput="App.receivingPdfSetGPTKey(this.value)"></div>'+
      (ctx.working?'<p class="rpdf-progress">'+icon("loader-circle")+' '+E(ctx.progress)+'</p>':'')+
      errors+datalist+summaries+
      (ctx.docs.length?'<p class="rpdf-hint">Pedidos existentes recebem novas linhas. Fornecedores com o mesmo nome serão agrupados. O PDF original não é salvo no servidor.</p>':'')+
      '<div id="receivingPdfValidation" class="rpdf-validation">'+
      (invalid?invalid+' produto(s) precisam de correção antes de importar.':count+
      ' produto(s) selecionado(s) para importar.')+'</div></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" id="receivingPdfConfirm" onclick="App.receivingPdfConfirm()" '+
      ((ctx.working||!count||invalid)?'disabled':'')+'>'+
      icon("check")+' Importar '+count+' produto(s)</button></div></div></div>';
  },
  receivingPdfSetGPTKey(value){
    const ctx=this.s.receivingPdf;
    if(ctx)ctx.gptKey=String(value||"").trim();
  },
  async receivingPdfCheckGPT(fileIndex){
    const ctx=this.s.receivingPdf,doc=ctx?.docs[fileIndex];
    if(!ctx||!doc||ctx.working)return;
    if(!ctx.gptKey?.startsWith("sk-")){
      this.toast("Para usar o GPT, informe uma chave de API OpenAI no campo acima.",true);return;
    }
    ctx.working=true;ctx.progress="Conferindo todos os itens do PDF com GPT...";
    this.receivingPdfRender();
    try{
      const result=await this.api("/api/controls/"+ctx.controlId+"/receiving/pdf/gpt",
        "POST",{filename:doc.filename,fingerprint:doc.fingerprint,base64:doc.pdfBase64,api_key:ctx.gptKey});
      if(this.s.modal!=="receiving-pdf")return;
      doc.gptResult=result;
      if(!result.items?.length)this.toast("GPT não encontrou itens seguros. Revise manualmente.",true);
    }catch(err){
      this.toast("Não foi possível conferir com GPT: "+err.message,true);
    }finally{
      if(this.s.modal==="receiving-pdf"){
        ctx.working=false;ctx.progress="";this.receivingPdfRender();
      }
    }
  },
  receivingPdfApplyGPT(fileIndex){
    const ctx=this.s.receivingPdf,doc=ctx?.docs[fileIndex],suggestion=doc?.gptResult;
    if(!ctx||!doc||!suggestion||ctx.working)return;
    const used=new Set(),changed=new Set();
    for(const proposed of suggestion.items){
      let found=-1,score=0;
      for(let i=0;i<doc.items.length;i++){
        if(used.has(i))continue;
        const row=doc.items[i];
        // Para evitar juntar itens diferentes, a unidade precisa ser a mesma.
        if(row.unit!==proposed.unit)continue;
        const similarity=rpdfSimilarity(row.product,proposed.product);
        if(similarity>score){found=i;score=similarity;}
      }
      const values={
        order_number:proposed.order_number||suggestion.order_number||doc.order_number||"",
        supplier:proposed.supplier||suggestion.supplier||doc.supplier||"",
        product:proposed.product||"",unit:proposed.unit||"un",
        ordered_qty:proposed.ordered_qty||""
      };
      if(found>=0&&score>=.88){
        used.add(found);
        const row=doc.items[found];
        const before=JSON.stringify(Object.fromEntries(Object.keys(values).map(k=>[k,row[k]])));
        Object.assign(row,values);
        if(before!==JSON.stringify(values))changed.add(row.index);
      }else if(doc.items.length<150){
        const index=doc.items.length;
        doc.items.push({index,enabled:true,...values});
        changed.add(index);
      }
    }
    doc.gptChanged=[...changed];
    doc.gptApplied=true;
    doc.gptResult=null;
    this.receivingPdfRender();
    this.toast("Sugestões colocadas na prévia. Confira antes de importar.");
  },
  receivingPdfAddRow(fileIndex){
    const ctx=this.s.receivingPdf,doc=ctx?.docs[fileIndex];
    if(!doc||ctx.working||doc.items.length>=150){
      this.toast("Limite de 150 produtos por PDF.",true);return;
    }
    const first=doc.items[0]||{};
    doc.items.push({index:doc.items.length,enabled:true,
      order_number:first.order_number||doc.order_number||"",
      supplier:first.supplier||doc.supplier||"",
      product:"",unit:"un",ordered_qty:""});
    this.receivingPdfRender();
  },
  receivingPdfEdit(fileIndex,rowIndex,key,value){
    const ctx=this.s.receivingPdf,doc=ctx?.docs[fileIndex],row=doc?.items[rowIndex];
    if(!row||!["enabled","order_number","supplier","product","ordered_qty","unit"].includes(key))return;
    row[key]=key==="enabled"?!!value:String(value);
    const count=ctx.docs.reduce((n,d)=>n+d.items.filter(i=>i.enabled).length,0);
    const invalid=ctx.docs.reduce((n,d)=>n+d.items.filter(i=>i.enabled&&!rpdfValid(i)).length,0);
    const btn=document.getElementById("receivingPdfConfirm");
    const status=document.getElementById("receivingPdfValidation");
    if(btn){btn.disabled=!!(ctx.working||!count||invalid);
      btn.textContent="Importar "+count+" produto(s)";}
    if(status)status.textContent=invalid?
      invalid+" produto(s) precisam de correção antes de importar.":
      count+" produto(s) selecionado(s) para importar.";
    const tr=document.querySelector('[data-rpdf-row="'+fileIndex+'-'+rowIndex+'"]');
    if(tr)tr.classList.toggle("rpdf-disabled",!row.enabled);
  },
  async receivingPdfConfirm(){
    const ctx=this.s.receivingPdf;
    if(!ctx||ctx.working||ctx.controlId!==this.s.detail?.control?.id)return;
    const files=ctx.docs.map(doc=>({fingerprint:doc.fingerprint,
      items:doc.items.filter(item=>item.enabled).map(({index,order_number,supplier,product,unit,ordered_qty})=>
        ({index,order_number,supplier,product,unit,ordered_qty}))})).filter(f=>f.items.length);
    if(!files.length||files.some(f=>f.items.some(item=>!rpdfValid(item)))){
      this.toast("Confira os pedidos, fornecedores, produtos e quantidades.",true);return;
    }
    ctx.working=true;
    const btn=document.getElementById("receivingPdfConfirm");
    if(btn)btn.disabled=true;
    try{
      const res=await this.api("/api/controls/"+ctx.controlId+"/receiving/pdf/confirm","POST",{files});
      this.closeModal();
      await this.load();
      this.toast(res.imported+" produto(s) importado(s) de "+res.files+
        " PDF(s), sem criar notas fiscais.");
    }catch(err){
      ctx.working=false;
      if(btn)btn.disabled=false;
      this.toast("Importação não concluída: "+err.message,true);
    }
  }
});
