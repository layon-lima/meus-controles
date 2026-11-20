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

  async function openXML(app){
    const {api,cid,dialog,toast,refresh,esc,items,route,dec,closeDialog}=app;
    if(!cid()){toast("Selecione um controle de recebimentos.",true);return}
    selectFiles(".xml,text/xml",false,async files=>{
      const file=files[0];
      if(file.size>2_000_000||file.size<10)
        return toast("O XML precisa ter até 2 MB.",true);
      toast("Conferindo o XML e os saldos dos pedidos…");
      const xml=await readFile(file);
      const report=await api(route("/xml/preview"),"POST",{xml});
      if(!report.lines?.length){toast("XML sem itens para conferir.",true);return}
      const active=items().filter(x=>!x.closed&&Number(x.remaining_qty)>0);
      const rows=report.lines.map((line,index)=>{
        const suggested=line.suggested_id||"";
        const options=[["","Selecione o pedido"],["pending","Sem pedido — vincular depois"],
          ...active.map(p=>[p.id,p.order_number+" · "+p.supplier+" · "+p.product+
            " ("+p.remaining_qty+" "+p.unit+" restantes)"])];
        const optionsHTML=options.map(([value,label])=>
          '<option value="'+esc(value)+'" '+(String(value)===String(suggested)?"selected":"")+'>'+
          esc(label)+'</option>').join("");
        return '<article class="rx-preview-item">'+
          '<strong>'+esc(line.name||line.product||"Produto "+(index+1))+'</strong>'+
          '<small>'+esc(line.quantity)+" "+esc(line.unit)+" · "+esc(line.code||"")+'</small>'+
          '<div class="rx-form-grid">'+
          '<label class="rx-field wide"><span>Vincular ao pedido</span>'+
          '<select name="selection_'+index+'" required>'+optionsHTML+'</select></label>'+
          '<label class="rx-field wide"><span>Quantidade equivalente no pedido (somente se a unidade não converter automaticamente)</span>'+
          '<input inputmode="decimal" name="manual_'+index+'" placeholder="Deixe vazio para conversão automática"></label>'+
          '</div></article>';
      });
      const summary='<div class="rx-preview">'+
        '<div class="rx-preview-item"><strong>NF-e '+esc(report.invoice_number||"")+'</strong>'+
        '<small>'+esc(report.supplier||"")+" · "+esc(report.cnpj||"")+
        ' · Chave: '+esc(report.access_key||"não encontrada")+'</small></div>'+
        rows.join("")+'</div>';
      dialog("Conferência de NF-e (XML)",
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
          const result=await api(route("/xml/confirm"),"POST",{xml,selections,manual_quantities});
          closeDialog();await refresh();
          toast("XML processado: "+(result.registered||result.imported||"itens")+" conferidos.");
        },"Confirmar XML");
    });
  }

  async function openPDF(app){
    const {api,route,toast,cid}=app;
    if(!cid()){toast("Selecione um controle de recebimentos.",true);return}
    selectFiles(".pdf,application/pdf",true,async files=>{
      if(files.length>20)return toast("Selecione no máximo 20 PDFs por lote.",true);
      const invalid=files.find(f=>!f.name.toLowerCase().endsWith(".pdf")||
        f.size>7*1024*1024||f.size<5);
      if(invalid)return toast("PDF inválido ou acima de 7 MB: "+invalid.name,true);
      const docs=[],errors=[];
      for(let i=0;i<files.length;i++){
        const file=files[i];
        toast("Lendo pedido "+(i+1)+"/"+files.length+": "+file.name);
        try{
          const base64=await readFile(file);
          const report=await api(route("/pdf/preview"),"POST",{filename:file.name,base64});
          if(report.already_imported){
            errors.push(file.name+": já importado.");
            continue;
          }
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
      if(docs.length)renderPDFReview(app,docs);
    });
  }

  function renderPDFReview(app,docs){
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
      '<label class="rx-col-span-3"><span>Fornecedor</span><input name="supplier_'+fi+'_'+ri+'" value="'+esc(item.supplier)+'" required></label>'+
      '<label class="rx-col-span-3"><span>Produto</span><input name="product_'+fi+'_'+ri+'" value="'+esc(item.product)+'" required></label>'+
      '<label><span>Quantidade</span><input name="qty_'+fi+'_'+ri+'" value="'+esc(item.ordered_qty)+'" inputmode="decimal" required></label>'+
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

  return {openXML,openPDF};
})();
