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
  function nameScore(a,b,product=false){
    a=(product?productWords:words)(a);b=(product?productWords:words)(b);
    if(!a||!b)return 0;
    if(a===b)return 1;
    const short=a.length<=b.length?a:b,long=a.length<=b.length?b:a;
    if(short.length>=4&&long.startsWith(short+" "))return .96;
    const x=new Set(a.split(" ")),y=new Set(b.split(" "));
    return [...x].filter(v=>y.has(v)).length/Math.max(x.size,y.size);
  }
  const units={
    kg:["mass",1],kgm:["mass",1],t:["mass",1000],to:["mass",1000],ton:["mass",1000],tonelada:["mass",1000],g:["mass",.001],gr:["mass",.001],
    l:["volume",1],lt:["volume",1],litro:["volume",1],ml:["volume",.001],
    un:["count",1],und:["count",1],unid:["count",1]
  };
  function xmlAmount(line,item){
    const n=Number(line.quantity),from=words(line.unit).replace(/ /g,""),to=words(item.unit).replace(/ /g,"");
    if(!from||!to||!Number.isFinite(n)||n<=0)return null;
    if(from===to)return n;
    const a=units[from],b=units[to];
    return a&&b&&a[0]===b[0]?n*a[1]/b[1]:null;
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
        const product=Number.isFinite(Number(server?.product_score))&&server?.product_score!=null
          ?Number(server.product_score):nameScore(line.name||line.product,item.product,true);
        const supplier=Number.isFinite(Number(server?.supplier_score))&&server?.supplier_score!=null
          ?Number(server.supplier_score):nameScore(report.supplier,item.supplier);
        const sufficient=amount!==null&&amount<=available+1e-9;
        return {...item,id,amount,productScore:product,supplierScore:supplier,
          learned:learned.has(id),sufficient,score:.85*product+.15*supplier,
          blocked:amount!==null&&amount>remaining+1e-9};
      }).sort((a,b)=>Number(b.sufficient)-Number(a.sufficient)||
        Number(b.learned)-Number(a.learned)||b.score-a.score||a.id-b.id);
      const valid=options.filter(o=>o.sufficient);
      const known=valid.filter(o=>o.learned);
      // Se houver dois pedidos históricos válidos, não adivinhar qual deles.
      let suggested=known.length===1?known[0]:null;
      if(!known.length){
        const top=valid[0],next=valid[1];
        if(top&&(top.productScore>=.94||(top.productScore>=.83&&top.supplierScore>=.72))&&
          (!next||top.score-next.score>=.065))suggested=top;
      }
      if(suggested)reserved.set(suggested.id,(reserved.get(suggested.id)||0)+suggested.amount);
      return {options,suggested};
    });
  }
  function pickerHTML(choice,query,selected,esc){
    const terms=words(query).split(" ").filter(Boolean);
    const filtered=choice.options.filter(o=>terms.every(t=>words([o.order_number,o.supplier,o.product].join(" ")).includes(t)));
    const visible=filtered.slice(0,terms.length?40:8);
    const current=choice.options.find(o=>String(o.id)===String(selected));
    if(current&&!visible.some(o=>o.id===current.id))visible.unshift(current);
    const option=(value,label,disabled=false)=>'<option value="'+esc(value)+'"'+
      (String(value)===String(selected)?' selected':'')+(disabled?' disabled':'')+'>'+esc(label)+'</option>';
    return option("","Selecione o pedido")+option("pending","Sem pedido — vincular depois")+
      visible.map(o=>option(o.id,(o.learned?"Histórico · ":"")+
        o.order_number+" · "+o.supplier+" · "+o.product+" ("+
        Number(o.remaining_qty).toLocaleString("pt-BR",{maximumFractionDigits:3})+" "+o.unit+" restantes)"+
        (o.blocked?" — saldo insuficiente":o.amount===null?" — informar equivalência":""),o.blocked)).join("");
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
          '<div class="rx-field wide rx-xml-picker"><label for="rx-xml-search-'+index+'">Pesquisar pedido</label>'+
          '<input id="rx-xml-search-'+index+'" type="search" placeholder="Produto, fornecedor ou número do pedido" autocomplete="off">'+
          '<label for="rx-xml-choice-'+index+'">Vincular ao pedido</label>'+
          '<select id="rx-xml-choice-'+index+'" name="selection_'+index+'" required>'+pickerHTML(choice,"",suggested,esc)+'</select>'+
          '<small class="rx-xml-suggestion" id="rx-xml-suggestion-'+index+'">'+
          (choice.suggested?(choice.suggested.learned?"Sugestão pelo histórico de NF-e confirmadas":"Sugestão por produto e saldo disponível"):"Selecione ou pesquise um pedido")+'</small></div>'+
          '<label class="rx-field wide"><span>Quantidade equivalente no pedido (somente se a unidade não converter automaticamente)</span>'+
          '<input inputmode="decimal" name="manual_'+index+'" placeholder="Deixe vazio para conversão automática"></label>'+
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
            if(value==="pending")return "pending";
            return safeInt(value);
          });
          if(selections.some(x=>x===null))throw new Error("Selecione o pedido de todos os itens.");
          const manual_quantities=report.lines.map((_,i)=>{
            const raw=String(form.get("manual_"+i)||"").trim();
            return raw?dec(raw):null;
          });
          if(!confirm("Registrar "+selections.length+" item(ns) da NF-e "+report.invoice_number+"?"))return;
          if(cid()!==control)throw new Error("O controle mudou. Importe novamente o XML.");
          const result=await api(confirmPath,"POST",{xml,selections,manual_quantities});
          closeDialog();await refresh();
          toast("XML processado: "+(result.registered||result.imported||"itens")+" conferidos.");
        },"Confirmar XML");
      choices.forEach((choice,index)=>{
        const search=view.mask.querySelector("#rx-xml-search-"+index),select=view.mask.querySelector("#rx-xml-choice-"+index);
        const hint=view.mask.querySelector("#rx-xml-suggestion-"+index);
        search.addEventListener("input",()=>{
          const selected=select.value;
          select.innerHTML=pickerHTML(choice,search.value,selected,esc);
          select.value=selected;
        });
        select.addEventListener("change",()=>{hint.textContent=select.value==="pending"?"Vincular posteriormente":select.value?"Pedido selecionado":"Selecione ou pesquise um pedido";});
      });
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
            ordered_qty:String(item.ordered_qty||""),unit:item.unit||"un",
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
    const units=["un","kg","t","L","sc","cx","pct","m","m²","m³"];
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
      '<label class="rx-col-span-2"><span>Unidade</span><select name="unit_'+fi+'_'+ri+'">'+
      units.map(u=>'<option value="'+esc(u)+'" '+(u===item.unit?"selected":"")+'>'+esc(u)+'</option>').join("")+
      '</select></label></div>').join("")+'</div>'+
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
              unit:f.get("unit_"+fi+"_"+ri)||"un",
              source_line:item.source_line||""
            };
          }).filter(Boolean)
        })).filter(x=>x.items.length);
        if(!files.length)throw new Error("Selecione pelo menos um produto para importar.");
        if(files.some(file=>file.items.some(item=>!item.order_number||!item.supplier||!item.product)))
          throw new Error("Confira pedido, fornecedor e produto de todas as linhas selecionadas.");
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
        item.unit=String(f.get("unit_"+fi+"_"+ri)||"un");
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
          unit:"un",ordered_qty:"",source_page:0,source_line:""});
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
          ordered_qty:String(item.ordered_qty||""),unit:item.unit||"un",
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
