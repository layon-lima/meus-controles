"use strict";
/* Importação PDF/OCR e XML NF-e — UI NATIVA da Central.
 * Apenas API de negócio do motor existente. Zero telas/JS do app antigo.
 */
window.NHReceivingImports=(()=>{
  const readFile=async file=>{
    const bytes=new Uint8Array(await file.arrayBuffer());
    let text="";
    for(let i=0;i<bytes.length;i+=16384)
      text+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return btoa(text);
  };
  const safeInt=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
  const normalize=value=>String(value??"").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();

  // Histórico real: só recebimentos gravados no mesmo controle ensinam um vínculo.
  // Não usar fornecedor do pedido como se fosse o emitente da NF-e.
  const words=value=>normalize(value).replace(/[^a-z0-9]+/g," ").trim();
  const productWords=value=>words(value).replace(/\bkcl\b/g,"cloreto potassio")
    .replace(/\b(?:de|da|do)\b/g," ").replace(/\s+/g," ").trim();
  const docNumber=value=>String(value??"").replace(/\D/g,"");
  const compactName=value=>String(value).replace(/[^a-z0-9]/g,"");
  const digits=value=>String(value).match(/\d+/g)?.map(v=>String(Number(v))).join("|")||"";
  function editSimilarity(a,b){
    let prev=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      const next=[i];
      for(let j=1;j<=b.length;j++)next[j]=Math.min(prev[j]+1,next[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      prev=next;
    }
    return 1-prev[b.length]/Math.max(a.length,b.length);
  }
  function nameScore(a,b,product=false){
    a=(product?productWords:words)(a);b=(product?productWords:words)(b);
    if(!a||!b)return 0;
    if(a===b)return 1;
    const ca=compactName(a),cb=compactName(b);
    if(ca===cb)return 1;
    const short=a.length<=b.length?a:b,long=a.length<=b.length?b:a;
    const x=new Set(a.split(" ")),y=new Set(b.split(" "));
    const overlap=[...x].filter(v=>y.has(v)).length/Math.max(x.size,y.size);
    let score=short.length>=4&&long.startsWith(short+" ")?.96:overlap;
    if(product&&Math.min(ca.length,cb.length)>=5&&ca.slice(0,3)===cb.slice(0,3)){
      score=Math.max(score,editSimilarity(ca,cb));
    }
    return score;
  }
  function productScore(a,b,serverScore){
    const local=nameScore(a,b,true);
    const da=digits(productWords(a)),db=digits(productWords(b));
    // Não confundir formulações/apresentações numéricas diferentes por mera proximidade.
    if(da&&db&&da!==db)return Math.min(.72,local);
    return Math.max(local,Number.isFinite(Number(serverScore))?Number(serverScore):0);
  }
  const units={
    kg:["mass",1],kgm:["mass",1],t:["mass",1000],to:["mass",1000],ton:["mass",1000],tonelada:["mass",1000],g:["mass",.001],gr:["mass",.001],
    l:["volume",1],lt:["volume",1],litro:["volume",1],ml:["volume",.001],
    un:["count",1],und:["count",1],unid:["count",1]
  };
  // Espelhar as conversões do motor, e reconhecer grafias usuais adicionais.
  const unitKey=value=>words(value).replace(/ /g,"");
  const aliases={litros:"l",ltrs:"l",ltr:"l",lts:"l",lit:"l",
    quilo:"kg",quilos:"kg",quilograma:"kg",quilogramas:"kg",kgs:"kg",
    toneladas:"t",tons:"t",toneladasmetricas:"t",grama:"g",gramas:"g",
    mililitro:"ml",mililitros:"ml",unidade:"un",unidades:"un",unds:"un",unids:"un"};
  function conversionFactor(from,to,extended=false){
    const x=unitKey(from),y=unitKey(to);
    if(!x||!y)return null;
    if(words(from)===words(to))return 1;
    const a=units[extended?(aliases[x]||x):x],b=units[extended?(aliases[y]||y):y];
    return Array.isArray(a)&&Array.isArray(b)&&a[0]===b[0]?a[1]/b[1]:null;
  }
  function xmlAmount(line,item){
    const n=Number(line.quantity),factor=conversionFactor(line.unit,item.unit,true);
    return Number.isFinite(n)&&n>0&&factor!==null?n*factor:null;
  }
  // O motor recebe o TOTAL convertido, não o fator. Multiplicar decimais
  // exatamente, sem arredondar silenciosamente a quantidade de estoque.
  function convertedTotal(quantity,factor){
    function decimal(raw){
      const v=String(raw??"").trim().replace(",",".");
      if(!/^\d+(?:\.\d{1,12})?$/.test(v)||v.length>32)throw new Error("Informe uma equivalência positiva, sem separador de milhar (até 12 casas decimais).");
      const [whole,fraction=""]=v.split(".");
      return {value:BigInt(whole+fraction),scale:fraction.length};
    }
    const q=decimal(quantity),f=decimal(factor);
    let n=q.value*f.value,scale=q.scale+f.scale;
    if(n<=0n)throw new Error("Informe uma equivalência positiva.");
    while(scale>0&&n%10n===0n){n/=10n;scale--;}
    if(scale>3)throw new Error("O total convertido deve ter até três casas decimais. Confira a equivalência.");
    const v=String(n).padStart(scale+1,"0");
    return scale?v.slice(0,-scale)+"."+v.slice(-scale):v;
  }
  function historyMatch(report,line,receipt){
    let fiscal=receipt.fiscal_json||receipt.fiscal||{};
    if(typeof fiscal==="string"){try{fiscal=JSON.parse(fiscal)}catch{return false}}
    if(!fiscal||typeof fiscal!=="object")return false;
    const doc=docNumber(report.cnpj),previous=docNumber(receipt.invoice_issuer_document||fiscal.documento_fornecedor);
    const issuer=receipt.invoice_issuer||fiscal.fornecedor||receipt.supplier;
    const sameIssuer=doc&&previous?doc===previous:!!words(report.supplier)&&words(report.supplier)===words(issuer);
    if(!sameIssuer)return false;
    const code=normalize(line.code),oldCode=normalize(fiscal.codigo_produto||receipt.product_code);
    if(code&&oldCode)return code===oldCode;
    const description=productWords(line.name||line.product),oldDescription=productWords(fiscal.descricao_xml);
    return !!description&&description===oldDescription;
  }
  function buildXMLChoices(report,orders,history){
    const active=orders.filter(p=>!p.closed&&Number(p.remaining_qty)>0);
    const reserved=new Map();
    return report.lines.map(line=>{
      const learned=new Set(history.filter(r=>historyMatch(report,line,r)).map(r=>Number(r.item_id)));
      const ranked=new Map((line.options||[]).map(o=>[Number(o.id),o]));
      const options=active.map(item=>{
        const id=Number(item.id),server=ranked.get(id),amount=xmlAmount(line,item);
        const remaining=Number(item.remaining_qty),available=remaining-(reserved.get(id)||0);
        const product=productScore(line.name||line.product,item.product,server?.product_score);
        const supplier=Number.isFinite(Number(server?.supplier_score))&&server?.supplier_score!=null
          ?Number(server.supplier_score):nameScore(report.supplier,item.supplier);
        const sufficient=amount!==null&&amount<=available+1e-9;
        const learnedMatch=learned.has(id);
        const recognizable=learnedMatch||product>=.88||(product>=.80&&supplier>=.72);
        const compatible=sufficient&&recognizable;
        const needsEquivalence=amount===null&&available>0&&(learnedMatch||product>=.96);
        return {...item,id,amount,productScore:product,supplierScore:supplier,
          learned:learnedMatch,sufficient,compatible,needsEquivalence,score:.85*product+.15*supplier,
          blocked:amount!==null&&amount>remaining+1e-9};
      }).sort((a,b)=>Number(b.compatible||b.needsEquivalence)-Number(a.compatible||a.needsEquivalence)||
        Number(b.learned)-Number(a.learned)||Number(b.sufficient)-Number(a.sufficient)||b.score-a.score||a.id-b.id);
      const valid=options.filter(o=>o.compatible||o.needsEquivalence);
      const known=valid.filter(o=>o.learned);
      // Histórico único tem prioridade. Em caso de empate, pedir seleção manual.
      let suggested=known.length===1?known[0]:null;
      if(!known.length){
        const top=valid[0],next=valid[1];
        if(top&&(!next||top.score-next.score>=.05))suggested=top;
      }
      if(suggested&&suggested.amount!==null)reserved.set(suggested.id,(reserved.get(suggested.id)||0)+suggested.amount);
      return {options,suggested,hasCompatible:valid.length>0};
    });
  }
  const orderLabel=o=>o.order_number+" · "+o.supplier+" · "+o.product;
  function filterOrders(choice,query){
    const terms=words(query).split(" ").filter(Boolean);
    return choice.options.filter(o=>terms.every(t=>words(orderLabel(o)).includes(t)||compactName(words(orderLabel(o))).includes(compactName(t))));
  }
  function pickerHTML(choice,query,selected,esc,index=0,highlight=-1){
    const visible=filterOrders(choice,query);
    const entries=visible.map(o=>({value:String(o.id),label:orderLabel(o),
      info:(o.learned?"Histórico · ":"")+Number(o.remaining_qty).toLocaleString("pt-BR",{maximumFractionDigits:3})+
        " "+o.unit+" restantes"+(o.blocked?" · saldo insuficiente":o.amount===null?" · informar equivalência":""),
      disabled:o.blocked}));
    return (visible.length?"":'<div class="rx-xml-empty">Nenhum pedido encontrado</div>')+
      entries.map((o,i)=>'<button type="button" role="option" id="rx-xml-opt-'+index+'-'+i+
        '" data-xml-order="'+esc(o.value)+'" tabindex="-1" aria-selected="'+(String(selected)===o.value)+
        '" class="rx-xml-option'+(i===highlight?" is-highlighted":"")+'"'+(o.disabled?' disabled':'')+
        '><strong>'+esc(o.label)+'</strong>'+(o.info?'<small>'+esc(o.info)+'</small>':"")+'</button>').join("");
  }
  function bindXMLPicker(view,choice,index,esc,line){
    const search=view.mask.querySelector("#rx-xml-search-"+index),
      value=view.mask.querySelector("#rx-xml-choice-"+index),
      list=view.mask.querySelector("#rx-xml-list-"+index),
      hint=view.mask.querySelector("#rx-xml-suggestion-"+index),
      noOrder=view.mask.querySelector("#rx-xml-no-order-"+index),
      noOrderLabel=view.mask.querySelector("#rx-xml-no-order-label-"+index),
      picker=view.mask.querySelector("#rx-xml-picker-"+index),
      manualField=view.mask.querySelector("#rx-xml-manual-field-"+index),
      manual=view.mask.querySelector("#rx-xml-manual-"+index),
      question=view.mask.querySelector("#rx-xml-conversion-question-"+index),
      total=view.mask.querySelector("#rx-xml-conversion-total-"+index);
    let previous=null;
    let query="",highlight=-1;
    const initial=choice.suggested;
    value.value=initial?String(initial.id):"";
    search.value=initial?orderLabel(initial):"";
    function updateNoOrder(){noOrderLabel.hidden=choice.hasCompatible||!!(value.value&&value.value!=="pending");noOrder.disabled=noOrderLabel.hidden;}
    let conversionItem=null;
    function previewTotal(){
      total.textContent="";
      manual.setCustomValidity("");
      if(!conversionItem||!manual.value.trim())return;
      try{
        const converted=convertedTotal(line.quantity,manual.value);
        const format=x=>Number(x).toLocaleString("pt-BR",{maximumFractionDigits:3});
        total.textContent=format(line.quantity)+" "+line.unit+" = "+format(converted)+" "+conversionItem.unit;
        if(Number(converted)>Number(conversionItem.remaining_qty))throw new Error("Quantidade convertida superior ao saldo do pedido.");
      }catch(error){manual.setCustomValidity(error.message);total.textContent=error.message;}
    }
    function updateManual(item){
      const next=item&&item.amount===null&&!noOrder.checked?item:null;
      if(conversionItem?.id!==next?.id)manual.value="";
      conversionItem=next;
      manualField.hidden=!next;manual.disabled=!next;manual.required=!!next;
      question.textContent=next?"Quanto 1 "+line.unit+" equivale em "+next.unit+" do pedido?":"";
      manual.placeholder=next?"Quantidade em "+next.unit:"";
      previewTotal();
    }
    manual.addEventListener("input",previewTotal);
    noOrder.checked=false;
    updateNoOrder();updateManual(initial);
    function draw(){
      list.innerHTML=pickerHTML(choice,query,value.value,esc,index,highlight);
      if(highlight>=0)search.setAttribute("aria-activedescendant","rx-xml-opt-"+index+"-"+highlight);
      else search.removeAttribute("aria-activedescendant");
    }
    function open(){
      if(noOrder.checked||!list.hidden)return;
      query=value.value?"":search.value;
      highlight=-1;list.hidden=false;search.setAttribute("aria-expanded","true");draw();
    }
    function close(){
      list.hidden=true;highlight=-1;search.setAttribute("aria-expanded","false");
      search.removeAttribute("aria-activedescendant");
    }
    function choose(id){
      const item=choice.options.find(o=>String(o.id)===id&&!o.blocked);
      if(!item||noOrder.checked)return;
      value.value=id;
      search.value=orderLabel(item);
      search.setCustomValidity("");
      hint.textContent=item.amount===null?"Pedido selecionado · Informe a quantidade equivalente na unidade "+item.unit:"Pedido selecionado";
      updateNoOrder();updateManual(item);
      close();
    }
    noOrder.addEventListener("change",()=>{
      close();
      if(noOrder.checked){
        if(choice.hasCompatible||noOrder.disabled){noOrder.checked=false;return;}
        previous={value:value.value,text:search.value,hint:hint.textContent};
        value.value="pending";
        search.setCustomValidity("");
        search.required=false;search.disabled=true;
        picker.hidden=true;updateManual(null);
      }else{
        value.value=previous?.value||"";
        search.value=previous?.text||"";
        hint.textContent=previous?.hint||"";
        picker.hidden=false;
        search.disabled=false;search.required=true;
        search.setCustomValidity(value.value?"":"Selecione um pedido da lista.");
        updateNoOrder();updateManual(choice.options.find(o=>String(o.id)===value.value));
      }
    });
    search.addEventListener("focus",()=>{open();if(value.value)search.select();});
    search.addEventListener("click",open);
    search.addEventListener("input",()=>{
      value.value="";query=search.value;highlight=-1;
      updateNoOrder();updateManual(null);
      search.setCustomValidity(choice.hasCompatible?"Selecione um pedido da lista.":"Selecione um pedido da lista ou marque Sem pedido.");
      hint.textContent="";list.hidden=false;search.setAttribute("aria-expanded","true");draw();
    });
    search.addEventListener("blur",close);
    // Manter o foco no campo enquanto o usuário escolhe com mouse/toque.
    list.addEventListener("mousedown",e=>{if(e.target.closest("[data-xml-order]"))e.preventDefault();});
    list.addEventListener("click",e=>{
      const option=e.target.closest("[data-xml-order]");
      if(option&&!option.disabled)choose(option.dataset.xmlOrder);
    });
    search.addEventListener("keydown",e=>{
      if(e.key==="Escape"&&!list.hidden){e.preventDefault();e.stopPropagation();close();return;}
      if(e.key==="ArrowDown"||e.key==="ArrowUp"){
        e.preventDefault();open();
        const visible=filterOrders(choice,query);
        const allowed=visible.map((o,i)=>o.blocked?-1:i).filter(i=>i>=0);
        if(!allowed.length)return;
        let n=allowed.indexOf(highlight);
        n=n<0?(e.key==="ArrowDown"?0:allowed.length-1):(n+(e.key==="ArrowDown"?1:-1)+allowed.length)%allowed.length;
        highlight=allowed[n];draw();
        list.querySelector("#rx-xml-opt-"+index+"-"+highlight)?.scrollIntoView({block:"nearest"});
      }else if(e.key==="Enter"&&!list.hidden){
        e.preventDefault();
        const visible=filterOrders(choice,query);
        if(highlight>=0&&visible[highlight])choose(String(visible[highlight].id));
      }
    });
    close();
  }

  function selectFiles(accept,multiple,onFiles){
    const input=document.createElement("input");
    input.type="file";input.accept=accept;input.multiple=multiple;
    input.hidden=true;document.body.append(input);
    input.addEventListener("change",async()=>{
      const files=[...input.files];input.remove();
      if(files.length){
        try{await onFiles(files)}
        catch(e){console.error("Falha de importação",e);alert(e.message)}
      }
    },{once:true});
    input.click();
  }

  function openXML(app){
    if(!app.cid()){app.toast("Selecione um controle de recebimentos.",true);return}
    selectFiles(".xml,text/xml,application/xml",false,files=>importXML(app,files[0]));
  }

  // Arrastar e selecionar passam pela mesma conferência. Nunca gravar no drop.
  async function importXML(app,file){
    const {api,cid,dialog,toast,refresh,esc,items,route,dec,closeDialog}=app;
    if(!file||(!/\.xml$/i.test(file.name||"")&&!/xml/i.test(file.type||"")))
      return toast("Selecione um arquivo XML de NF-e.",true);
    if(file.size>2_000_000||file.size<10)
      return toast("O XML precisa ter até 2 MB e não pode estar vazio.",true);
    if(!cid()||!app.canImportXML())return toast("Aguarde os recebimentos ou feche a janela aberta.",true);
    const control=cid(), previewPath=route("/xml/preview"), confirmPath=route("/xml/confirm");
    app.setBusy(true);
    try{
      toast("Conferindo o XML e os saldos dos pedidos…");
      const xml=await readFile(file);
      const report=await api(previewPath,"POST",{xml});
      if(cid()!==control)throw new Error("O controle mudou. Importe novamente o XML.");
      if(!report.lines?.length){toast("XML sem itens para conferir.",true);return}
      // Reconsultar o saldo e o histórico após a prévia. O motor original continua
      // responsável pela duplicidade, conversões e validação final da gravação.
      const current=await api(route(""),"GET");
      if(cid()!==control)throw new Error("O controle mudou. Importe novamente o XML.");
      const choices=buildXMLChoices(report,current.items||[],current.receipts||[]);
      const rows=report.lines.map((line,index)=>{
        const choice=choices[index],suggested=choice.suggested?.id||"";
        return '<article class="rx-preview-item rx-xml-item">'+
          '<strong>'+esc(line.name||line.product||"Produto "+(index+1))+'</strong>'+
          '<small>'+esc(line.quantity)+" "+esc(line.unit)+" · "+esc(line.code||"")+'</small>'+
          '<div class="rx-form-grid">'+
          '<label id="rx-xml-no-order-label-'+index+'" class="rx-xml-no-order wide"'+(choice.hasCompatible?' hidden':'')+'><input type="checkbox" id="rx-xml-no-order-'+index+'"'+(choice.hasCompatible?' disabled':'')+'><span>Sem pedido</span></label>'+
          '<div id="rx-xml-picker-'+index+'" class="rx-field wide rx-xml-picker"><label for="rx-xml-search-'+index+'">Vincular ao pedido</label>'+
          '<div class="rx-xml-combo"><input id="rx-xml-search-'+index+'" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rx-xml-list-'+index+'" placeholder="Pesquisar fornecedor, produto ou número do pedido" autocomplete="off" required value="'+esc(choice.suggested?orderLabel(choice.suggested):"")+'">'+
                    '<div id="rx-xml-list-'+index+'" class="rx-xml-list" role="listbox" hidden></div></div>'+
          '<small class="rx-xml-suggestion" id="rx-xml-suggestion-'+index+'">'+
          (choice.suggested?(choice.suggested.learned?"Sugestão pelo histórico de NF-e confirmadas":choice.suggested.needsEquivalence?"Produto identificado pelo nome · Informe a equivalência de unidade":"Sugestão por produto e saldo disponível"):(choice.hasCompatible?"Pedidos compatíveis encontrados. Selecione o correto.":""))+'</small></div>'+
          '<input type="hidden" id="rx-xml-choice-'+index+'" name="selection_'+index+'" value="'+esc(suggested)+'">'+
          '<div id="rx-xml-manual-field-'+index+'" class="rx-field wide rx-xml-conversion" hidden>'+
          '<label id="rx-xml-conversion-question-'+index+'" for="rx-xml-manual-'+index+'"></label>'+
          '<input id="rx-xml-manual-'+index+'" inputmode="decimal" name="manual_'+index+'" disabled autocomplete="off">'+
          '<small id="rx-xml-conversion-total-'+index+'" aria-live="polite"></small></div>'+
          '</div></article>';
      });
      const summary='<div class="rx-preview">'+
        '<div class="rx-preview-item"><strong>NF-e '+esc(report.invoice_number||"")+'</strong>'+
        '<small>'+esc(report.supplier||"")+" · "+esc(report.cnpj||"")+
        ' · Chave: '+esc(report.access_key||"não encontrada")+'</small></div>'+
        rows.join("")+'</div>';
      const view=dialog("Conferência de NF-e (XML)",
        "Revise cada item e o pedido de destino antes de gravar. Nada é lançado automaticamente.",
        summary,async form=>{
          const selections=report.lines.map((_,i)=>{
            const value=form.get("selection_"+i);
            if(value==="pending"){
              if(choices[i].hasCompatible)throw new Error("Existe pedido compatível para este produto.");
              return "pending";
            }
            return safeInt(value);
          });
          if(selections.some(x=>x===null))throw new Error("Selecione um pedido ou marque Sem pedido em todos os itens.");
          const manual_quantities=report.lines.map((line,i)=>{
            if(selections[i]==="pending")return null;
            const item=choices[i].options.find(o=>o.id===selections[i]&&!o.blocked);
            if(!item)throw new Error("Selecione um pedido válido.");
            if(conversionFactor(line.unit,item.unit)!==null)return null;
            // Uma grafia adicional conhecida pode ser resolvida sem perguntar ao usuário.
            const factor=conversionFactor(line.unit,item.unit,true);
            const total=convertedTotal(line.quantity,factor===null?form.get("manual_"+i):factor.toFixed(12).replace(/0+$/,"").replace(/\.$/,""));
            if(Number(total)>Number(item.remaining_qty))throw new Error("Quantidade convertida superior ao saldo do pedido: "+item.product);
            return dec(total);
          });
          if(cid()!==control)throw new Error("O controle mudou. Importe novamente o XML.");
          const result=await api(confirmPath,"POST",{xml,selections,manual_quantities});
          closeDialog();await refresh();
          const pending=Number(result.pending||0),inserted=Number(result.inserted||result.registered||result.imported||0);
          toast(pending?"XML registrado: "+pending+" item(ns) sem pedido"+(inserted?" e "+inserted+" recebimento(s) vinculado(s)":"")+".":"XML registrado com sucesso.");
        },"Confirmar XML");
      choices.forEach((choice,index)=>bindXMLPicker(view,choice,index,esc,report.lines[index]));
    }catch(e){toast(e.message||"Falha ao conferir o XML.",true);}
    finally{app.setBusy(false);}
  }

  function openPDF(app){
    if(!app.cid()){app.toast("Selecione um controle de recebimentos.",true);return}
    selectFiles(".pdf,application/pdf",true,files=>importPDF(app,files));
  }

  // O mesmo importador atende ao seletor e ao arraste de pedidos PDF.
  async function importPDF(app,files){
    const {api,route,toast,cid}=app;
    files=Array.from(files||[]);
    if(!files.length)return;
    if(!cid()||!app.canImportXML())return toast("Aguarde os recebimentos ou feche a janela aberta.",true);
    if(files.length>20)return toast("Selecione no máximo 20 PDFs por lote.",true);
    const invalid=files.find(f=>!/\.pdf$/i.test(f.name||"")||
      f.size>7*1024*1024||f.size<5);
    if(invalid)return toast("PDF inválido ou acima de 7 MB: "+invalid.name,true);
    const control=cid(),basePath=route("");
    const previewPath=route("/pdf/preview");
    app.setBusy(true);
    try{
      const docs=[],errors=[],fingerprints=new Set();
      for(let i=0;i<files.length;i++){
        const file=files[i];
        toast("Lendo pedido "+(i+1)+"/"+files.length+": "+file.name);
        try{
          const base64=await readFile(file);
          const report=await api(previewPath,"POST",{filename:file.name,base64});
          if(report.already_imported||(report.fingerprint&&fingerprints.has(report.fingerprint))){
            errors.push(file.name+": já importado.");
            continue;
          }
          if(report.fingerprint)fingerprints.add(report.fingerprint);
          docs.push({...report,base64,items:(report.items||[]).map((item,index)=>({
            index,enabled:true,order_number:item.order_number||report.order_number||"",
            supplier:item.supplier||report.supplier||"",product:item.product||"",
            ordered_qty:String(item.ordered_qty||""),unit:item.unit||"",
            source_page:Number.isInteger(item.source_page)?item.source_page:0,
            source_line:item.source_line||""
          }))});
        }catch(e){errors.push(file.name+": "+e.message)}
      }
      if(errors.length)toast(errors.join(" | "),true);
      if(cid()!==control)throw new Error("O controle mudou. Importe novamente os PDFs.");
      if(docs.length)renderPDFReview({...app,route:part=>basePath+part},docs,control);

    }catch(e){toast(e.message||"Falha ao conferir PDFs.",true);}
    finally{app.setBusy(false);}
  }

  function renderPDFReview(app,docs,control=app.cid()){
    const {api,route,dialog,toast,refresh,esc,closeDialog,dec}=app;
    const grids=docs.map((doc,fi)=>'<section class="rx-preview-item">'+
      '<div class="rx-overlay-actions"><div><strong>'+esc(doc.filename)+'</strong>'+
      '<small>'+doc.items.length+' produto(s) encontrados'+
      (doc.ocr_pages?" · OCR em "+doc.ocr_pages+" página(s)":"")+'</small></div>'+
      '<button type="button" class="rx-button rx-button-small" data-pdf-region="'+fi+
      '">Corrigir leitura pela área</button></div>'+
      '<div class="rx-preview">'+doc.items.map((item,ri)=>'<div class="rx-grid-row" data-pdf-row="'+fi+'-'+ri+'">'+
      '<label><span>Importar</span><input type="checkbox" name="enabled_'+fi+'_'+ri+'" '+(item.enabled?"checked":"")+'></label>'+
      '<label class="rx-col-span-2"><span>Pedido</span><input name="order_'+fi+'_'+ri+'" value="'+esc(item.order_number)+'"></label>'+
      '<label class="rx-col-span-3"><span>Fornecedor</span><input name="supplier_'+fi+'_'+ri+'" value="'+esc(item.supplier)+'"></label>'+
      '<label class="rx-col-span-3"><span>Produto</span><input name="product_'+fi+'_'+ri+'" value="'+esc(item.product)+'"></label>'+
      '<label><span>Quantidade</span><input name="qty_'+fi+'_'+ri+'" value="'+esc(item.ordered_qty)+'" inputmode="decimal"></label>'+
      '<label class="rx-col-span-2"><span>Unidade</span><input name="unit_'+fi+'_'+ri+'" maxlength="12" value="'+esc(item.unit||"")+'" placeholder="Ex.: L, kg, DOS"></label></div>').join("")+'</div>'+
      '<button type="button" class="rx-button rx-button-small" data-pdf-add="'+fi+'">+ Inserir linha</button>'+
      '</section>').join("");
    const instance=dialog("Importação de pedidos (PDF)",
      "Conferência obrigatória: corrija pedidos, fornecedores, produtos e quantidades antes de salvar.",
      '<div class="rx-preview">'+grids+'</div>',
      async f=>{
        const files=docs.map((doc,fi)=>({
          fingerprint:doc.fingerprint,
          items:doc.items.map((item,ri)=>{
            if(!f.has("enabled_"+fi+"_"+ri))return null;
            return {
              index:ri,order_number:String(f.get("order_"+fi+"_"+ri)||"").trim(),
              supplier:String(f.get("supplier_"+fi+"_"+ri)||"").trim(),
              product:String(f.get("product_"+fi+"_"+ri)||"").trim(),
              ordered_qty:dec(f.get("qty_"+fi+"_"+ri)),
              unit:String(f.get("unit_"+fi+"_"+ri)||"").trim(),
              source_line:item.source_line||""
            };
          }).filter(Boolean)
        })).filter(x=>x.items.length);
        if(!files.length)throw new Error("Selecione pelo menos um produto para importar.");
        if(files.some(file=>file.items.some(item=>!item.order_number||!item.supplier||!item.product||!item.unit)))
          throw new Error("Confira pedido, fornecedor, produto e unidade de todas as linhas selecionadas.");
        if(app.cid()!==control)throw new Error("O controle mudou. Importe novamente os PDFs.");
        const result=await api(route("/pdf/confirm"),"POST",{files});
        closeDialog();await refresh();
        toast((result.imported||0)+" produto(s) importado(s) de "+files.length+" PDF(s).");
      },"Importar produtos");
    const updateFromForm=()=>{
      const f=new FormData(instance.form);
      docs.forEach((doc,fi)=>doc.items.forEach((item,ri)=>{
        item.enabled=f.has("enabled_"+fi+"_"+ri);
        item.order_number=String(f.get("order_"+fi+"_"+ri)||"");
        item.supplier=String(f.get("supplier_"+fi+"_"+ri)||"");
        item.product=String(f.get("product_"+fi+"_"+ri)||"");
        item.ordered_qty=String(f.get("qty_"+fi+"_"+ri)||"");
        item.unit=String(f.get("unit_"+fi+"_"+ri)||"");
      }));
    };
    instance.form.addEventListener("click",e=>{
      const region=e.target.closest("[data-pdf-region]");
      if(region){updateFromForm();showPDFRegion(app,docs,Number(region.dataset.pdfRegion));return}
      const add=e.target.closest("[data-pdf-add]");
      if(add){
        updateFromForm();
        const index=Number(add.dataset.pdfAdd),doc=docs[index];
        if(doc.items.length>=150)return toast("Máximo de 150 itens por PDF.",true);
        const first=doc.items[0]||{};
        doc.items.push({index:doc.items.length,enabled:true,
          order_number:first.order_number||doc.order_number||"",
          supplier:first.supplier||doc.supplier||"",product:"",
          unit:"",ordered_qty:"",source_page:0,source_line:""});
        renderPDFReview(app,docs);
      }
    });
  }

  async function showPDFRegion(app,docs,fileIndex){
    const {api,route,dialog,toast,esc}=app,doc=docs[fileIndex];
    if(!doc)return;
    let page=0,rect=null,selection=null,down=null;
    const open=async()=>{
      const view=dialog("Selecionar área dos produtos",
        "Marque a região completa da tabela na página. A nova leitura substitui todos os itens anteriores DESTA página.",
        '<div class="rx-document-preview">'+
        '<div><div class="rx-pdf-page" id="rx-pdf-page"><span class="rx-loading">Abrindo página do PDF…</span>'+
        '<div id="rx-pdf-box" class="rx-pdf-selection" hidden></div></div></div>'+
        '<aside><div class="rx-overlay-actions">'+
        '<button type="button" class="rx-button rx-button-small" id="rx-page-prev">Anterior</button>'+
        '<span id="rx-page-num">Página '+(page+1)+' de '+doc.pages+'</span>'+
        '<button type="button" class="rx-button rx-button-small" id="rx-page-next">Próxima</button>'+
        '</div><p class="rx-help">Arraste sobre todos os produtos da página, incluindo quantidade e unidade. O OCR relê as linhas do zero.</p>'+
        '<button type="button" class="rx-button rx-button-primary" id="rx-page-read" disabled>Ler área marcada</button>'+
        '<div id="rx-region-result" class="rx-preview"></div>'+
        '<button type="button" class="rx-button rx-button-primary" id="rx-page-replace" hidden>Substituir itens desta página</button>'+
        '</aside></div>',
        null
      );
      const pageEl=view.mask.querySelector("#rx-pdf-page"),box=view.mask.querySelector("#rx-pdf-box");
      view.mask.querySelector("#rx-page-prev").disabled=page===0;
      view.mask.querySelector("#rx-page-next").disabled=page>=doc.pages-1;
      const imgData=await api(route("/pdf/page"),"POST",{
        base64:doc.base64,fingerprint:doc.fingerprint,page
      });
      if(!pageEl.isConnected)return;
      const img=document.createElement("img");
      img.src=imgData.image;img.alt="Página "+(page+1)+" do pedido";
      pageEl.querySelector(".rx-loading")?.remove();
      pageEl.prepend(img);
      const coord=e=>{
        const bounds=pageEl.getBoundingClientRect();
        return {
          x:Math.max(0,Math.min(1,(e.clientX-bounds.left)/bounds.width)),
          y:Math.max(0,Math.min(1,(e.clientY-bounds.top)/bounds.height))
        };
      };
      const draw=()=>{
        if(!rect)return;
        box.hidden=false;
        Object.assign(box.style,{
          left:(rect.x0*100)+"%",top:(rect.y0*100)+"%",
          width:((rect.x1-rect.x0)*100)+"%",height:((rect.y1-rect.y0)*100)+"%"
        });
      };
      pageEl.addEventListener("pointerdown",e=>{
        if(e.button!==0)return;
        e.preventDefault();down=coord(e);rect=null;selection=null;
        pageEl.setPointerCapture(e.pointerId);
      });
      pageEl.addEventListener("pointermove",e=>{
        if(!down)return;
        const next=coord(e);
        rect={x0:Math.min(down.x,next.x),y0:Math.min(down.y,next.y),
          x1:Math.max(down.x,next.x),y1:Math.max(down.y,next.y)};
        draw();
      });
      pageEl.addEventListener("pointerup",e=>{
        if(!down)return;
        const next=coord(e);
        rect={x0:Math.min(down.x,next.x),y0:Math.min(down.y,next.y),
          x1:Math.max(down.x,next.x),y1:Math.max(down.y,next.y)};
        down=null;draw();
        view.mask.querySelector("#rx-page-read").disabled=
          rect.x1-rect.x0<.025||rect.y1-rect.y0<.02;
      });
      pageEl.addEventListener("pointercancel",()=>{down=null});
      view.mask.querySelector("#rx-page-prev").addEventListener("click",()=>{page--;open().catch(e=>toast(e.message,true))});
      view.mask.querySelector("#rx-page-next").addEventListener("click",()=>{page++;open().catch(e=>toast(e.message,true))});
      view.mask.querySelector("#rx-page-read").addEventListener("click",async()=>{
        try{
          const res=await api(route("/pdf/region"),"POST",{
            base64:doc.base64,fingerprint:doc.fingerprint,page,rect
          });
          selection=res;
          const resultEl=view.mask.querySelector("#rx-region-result");
          resultEl.innerHTML=(res.items||[]).length?
            res.items.map(it=>'<div class="rx-preview-item"><strong>'+esc(it.product)+'</strong>'+
              '<small>'+esc(it.ordered_qty)+" "+esc(it.unit)+'</small></div>').join(""):
            '<p class="rx-help">Nenhum item reconhecido. Ajuste a marcação e tente novamente.</p>';
          view.mask.querySelector("#rx-page-replace").hidden=!(res.items||[]).length;
        }catch(e){toast(e.message,true)}
      });
      view.mask.querySelector("#rx-page-replace").addEventListener("click",()=>{
        if(!selection?.items?.length)return;
        const kept=doc.items.filter(item=>(item.source_page||0)!==page);
        const fresh=selection.items.map(item=>({
          enabled:true,order_number:item.order_number||doc.order_number||"",
          supplier:item.supplier||doc.supplier||"",product:item.product||"",
          ordered_qty:String(item.ordered_qty||""),unit:item.unit||"",
          source_page:page,source_line:item.source_line||""
        }));
        if(kept.length+fresh.length>150)return toast("O arquivo excede 150 itens.",true);
        doc.items=[...kept,...fresh].map((item,index)=>({...item,index}));
        renderPDFReview(app,docs);
        toast("Prévia refeita: todos os itens antigos desta página foram substituídos.");
      });
    };
    try{await open()}catch(e){toast(e.message,true);renderPDFReview(app,docs)}
  }

  async function readFiscalPDF(app,file) {
    if(!file||!file.name.toLowerCase().endsWith(".pdf")||file.size>7*1024*1024)
      throw new Error("Selecione um PDF DANFE com até 7 MB.");
    return app.api(app.route("/fiscal/pdf/preview"),"POST",{pdf:await readFile(file)});
  }

  async function restoreIssuer(app) {
    const {api,route,toast,refresh}=app;
    selectFiles(".xml,text/xml",true,async files=>{
      if(files.length>20)return toast("Selecione no máximo 20 XMLs por vez.",true);
      let updated=0,failed=0;
      for(const file of files){
        if(file.size>2_000_000||!file.name.toLowerCase().endsWith(".xml")){
          failed++;continue;
        }
        try{
          const result=await api(route("/xml/issuer"),"POST",{xml:await readFile(file)});
          updated+=Number(result.updated||0);
        }catch(e){failed++;toast(file.name+": "+e.message,true)}
      }
      await refresh();
      toast(updated+" registro(s) de emitente recuperado(s)"+
        (failed?". Arquivos sem correspondência: "+failed+".":"."));
    });
  }

  async function openJSON(app) {
    const {api,route,dialog,toast,refresh,esc,closeDialog}=app;
    selectFiles(".json,application/json",false,async files=>{
      const file=files[0];
      if(file.size>512*1024||!file.name.toLowerCase().endsWith(".json"))
        return toast("Selecione um JSON de pedidos com até 512 KB.",true);
      let documentData;
      try{documentData=JSON.parse(await file.text())}
      catch{throw new Error("Arquivo JSON inválido.")}
      const report=await api(route("/import/preview"),"POST",{document:documentData});
      const examples=(report.preview_items||[]).map(item=>
        '<div class="rx-preview-item"><strong>'+esc(item.product)+'</strong>'+
        '<small>Pedido '+esc(item.order_number)+' · '+esc(item.supplier||"Sem fornecedor")+
        ' · '+esc(item.ordered_qty)+' '+esc(item.unit)+'</small></div>').join("");
      const count=Number(report.already_imported?report.repeat_count:report.new_count)||0;
      const warnings=[];
      if(report.already_imported)warnings.push("O lote já foi importado anteriormente.");
      if(report.matched)warnings.push(report.matched+" produto(s) coincidem com registros existentes.");
      if(report.unknown_suppliers)warnings.push(report.unknown_suppliers+" linha(s) sem fornecedor.");
      const html='<div class="rx-preview">'+
        '<div class="rx-preview-item"><strong>'+esc(report.source||file.name)+'</strong>'+
        '<small>'+esc(report.count||0)+' linhas · '+count+' possíveis produtos novos</small></div>'+
        (warnings.length?'<p class="rx-help">'+esc(warnings.join(" "))+'</p>':"")+
        (report.requires_duplicate_consent?
          '<label class="rx-field"><span><input type="checkbox" name="confirm_duplicates"> Confirmo que este é um novo lote, mesmo com produtos repetidos.</span></label>':"")+
        examples+'</div>';
      dialog("Importar pedidos JSON","A prévia não cria recebimentos nem notas fiscais.",
        html,async f=>{
          if(report.requires_duplicate_consent&&!f.has("confirm_duplicates"))
            throw new Error("Confirme o novo lote antes de cadastrar produtos repetidos.");
          const result=await api(route("/import/confirm"),"POST",{
            document:documentData,fingerprint:report.fingerprint,
            allow_duplicates:f.has("confirm_duplicates"),
            repeat_batch:!!report.already_imported,
            confirmation_token:report.confirmation_token
          });
          closeDialog();await refresh();
          toast(result.already_imported?
            "Este lote já estava importado; nenhum registro foi duplicado.":
            result.imported+" produto(s) cadastrados.");
        },"Confirmar importação");
    });
  }

  return {openXML,importXML,openPDF,importPDF,openJSON,restoreIssuer,readFiscalPDF,buildXMLChoices,pickerHTML};
})();
