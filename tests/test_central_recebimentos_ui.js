"use strict";
/* Regressão: abrir Recebimentos NUNCA pode renderizar Controles ou Transportadoras.
 * Usa o contrato /api/state real, só com dados simulados; nenhum banco tocado.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const html=fs.readFileSync("central_admin/static/recebimentos.html","utf8");
const core=fs.readFileSync("central_admin/static/recebimentos.js","utf8");
const imports=fs.readFileSync("central_admin/static/recebimentos_imports.js","utf8");
assert.ok(html.indexOf('id="rx-metrics"')<html.indexOf("</header>"));
assert.ok(html.includes('class="rx-workspace"'));
assert.ok(html.includes('class="rx-filterbar"'));
assert.ok(html.includes("<h1>Recebimentos</h1>"),"Tela nasce no módulo correto");
assert.ok(html.includes("/central/recebimentos_imports.js"),"Importadores próprios");
assert.ok(html.includes("/central/recebimentos.js"),"Frontend nativo presente");
assert.ok(!html.includes("/static/app.js"),"Jamais carregar JS de Controles");
assert.ok(!html.includes("/central/operations.js"),"Jamais recortar a UI antiga");
assert.ok(!html.includes("<iframe"),"Sem iframe");
assert.ok(!core.includes("window.App"),"Sem objeto do app legado");
assert.ok(!core.includes("renderReceivingView"),"Sem renderizador legado");
assert.ok(core.includes('c.mode==="recebimento"'),"Filtro obrigatório por modelo");
assert.ok(core.includes("NHReceivingImports.openPDF"),"Fluxo PDF nasce no módulo próprio");
assert.ok(core.includes("NHReceivingImports.openXML"),"Fluxo XML nasce no módulo próprio");
assert.ok(imports.includes('route("/pdf/region")'),"Correção por região de PDF preservada");
assert.ok(imports.includes('route("/xml/confirm")'),"Confirmação XML preservada");

class Element{
  constructor(){
    this.innerHTML="";this.hidden=false;this.value="";this.disabled=false;this.textContent="";
    this.listeners={};this.items=new Set();this.isConnected=true;
    this.classList={
      add:k=>this.items.add(k),remove:k=>this.items.delete(k),
      toggle:(k,value)=>value===undefined?this.items.has(k)?this.items.delete(k):this.items.add(k):
        value?this.items.add(k):this.items.delete(k)
    };
  }
  addEventListener(name,fn){this.listeners[name]=fn}
  append(){}
  remove(){}
  replaceChildren(){this.innerHTML=""}
  querySelector(selector){return get(selector)}
  focus(){}
  click(){}
  removeAttribute(){}
  setAttribute(){}
}
const elements=new Map();
const get=selector=>{
  if(!elements.has(selector))elements.set(selector,new Element());
  return elements.get(selector);
};
const document={
  listeners:{},
  body:new Element(),
  querySelector:get,
  createElement:()=>new Element(),
  querySelectorAll(){return []},
  addEventListener(name,fn){this.listeners[name]=fn}
};
const dropped=[];
const droppedPDF=[];
const requested=[];
const posted=[];
const exported=[];
const backend={
  boards:[{id:1,name:"FINANCEIRO"},{id:2,name:"RECEBIMENTOS"}],
  controls:[
    {id:1,mode:"caminhao",name:"CONTROLE DE FRETES ERRADO"},
    {id:2,mode:"financeiro",name:"CONTROLE FINANCEIRO ERRADO"},
    {id:7,mode:"recebimento",name:"Recebimentos Reais",board_id:2}
  ]
};
const orders={
  control_id:7,
  totals:{items:2,complete:0,partial:1,pending:1,receipts:1},
  items:[
    {id:11,order_number:"1001",supplier:"Agrex",product:"KCL",unit:"t",
      ordered_qty:"40",received_qty:"10",remaining_qty:"30",status:"partial",closed:false},
    {id:12,order_number:"1002",supplier:"Mosaic",product:"S9",unit:"t",
      ordered_qty:"29",received_qty:"0",remaining_qty:"29",status:"pending",closed:false}
  ],
  receipts:[{
    gfarm_note_key:"NF-2402",id:51,item_id:11,order_number:"1001",product:"KCL",supplier:"Agrex",
    received_date:"2026-11-19",invoice_number:"2402",access_key:"1".repeat(44),
    received_qty:"10",unit:"t",gfarm_status:"NAO_ENVIADO"
  },{
    gfarm_note_key:"NF-2402",id:52,item_id:12,order_number:"1002",product:"S9",supplier:"Agrex",
    received_date:"2026-11-19",invoice_number:"2402",access_key:"1".repeat(44),
    received_qty:"5",unit:"t",gfarm_status:"NAO_ENVIADO"
  }]
};
async function fetchMock(path,options={}){
  requested.push(path);
  if(path==='/central/api/recebimentos/resumo.xlsx'){
    exported.push(JSON.parse(options.body));
    return {ok:true,blob:async()=>({})};
  }
  if(path.endsWith("/receiving/gfarm/send")){
    posted.push(JSON.parse(options.body));
    return {ok:true,json:async()=>({ok:true})};
  }
  let json;
  if(path.endsWith("/api/state"))json=backend;
  else if(path.includes("/receiving/xml/pending"))json={items:[]};
  else if(path.endsWith("/api/controls/7/receiving"))json=orders;
  else throw new Error("A API inesperada "+path);
  return {ok:true,json:async()=>json};
}
const context={
  document,window:{NHReceivingImports:{openPDF(){},openXML(){},importXML(app,file){dropped.push({id:app.cid(),file});},importPDF(app,files){droppedPDF.push({id:app.cid(),files});}}},
  fetch:fetchMock,
  URL:{createObjectURL:()=>"blob:test",revokeObjectURL(){}},
  setTimeout:()=>0,
  requestAnimationFrame:callback=>callback(),
  Date,Number,String,Array,Map,Set,Intl,Promise,console,confirm:()=>true,
};
vm.runInNewContext(core,context);
const test=async()=>{
  // Aguarda a conclusão do fetch assíncrono e de Promise.all, não um
  // número arbitrário de microtasks que pode variar conforme o Node.
  for(let i=0;i<20;i++){
    await new Promise(resolve=>setImmediate(resolve));
    if(get("#rx-results").innerHTML.includes("KCL"))break;
  }
  const control=get("#rx-control"),results=get("#rx-results");
  assert.ok(requested.some(x=>x.endsWith("/api/state")));
  assert.ok(requested.some(x=>x.endsWith("/api/controls/7/receiving")));
  assert.ok(!requested.some(x=>x.includes("/controls/1/")));
  assert.ok(!requested.some(x=>x.includes("/controls/2/")));
  assert.ok(control.innerHTML.includes("Recebimentos Reais"));
  assert.ok(!control.innerHTML.includes("FRETES"));
  assert.ok(!control.innerHTML.includes("FINANCEIRO"));
  assert.ok(results.innerHTML.includes("Agrex"),"Pedidos nativos renderizados: "+results.innerHTML.slice(0,200));
  assert.ok(results.innerHTML.includes("KCL"));
  assert.ok(results.innerHTML.includes("Mosaic"));
  assert.ok(!results.innerHTML.includes("FRETES"));
  assert.equal((results.innerHTML.match(/<table class="rx-table">/g)||[]).length,2,"Cada fornecedor tem a própria tabela");
  assert.equal((results.innerHTML.match(/<thead>/g)||[]).length,2);
  assert.equal((results.innerHTML.match(/class="rx-group rx-supplier-card /g)||[]).length,2);
  assert.ok(get("#rx-metrics").innerHTML.includes("rx-metric-complete"));
  assert.ok(get("#rx-metrics").innerHTML.includes("<svg"));
  const group={dataset:{group:"agrex"}};
  document.listeners.click({target:{closest:selector=>selector==="[data-group]"?group:null}});
  assert.ok(!results.innerHTML.includes(">KCL<"),"Fornecedor recolhido");
  assert.equal((results.innerHTML.match(/class="rx-group rx-supplier-card /g)||[]).length,2,"Cards continuam visíveis");
  assert.equal((results.innerHTML.match(/<table class="rx-table">/g)||[]).length,1,"Somente o card aberto tem tabela");
  assert.ok(results.innerHTML.includes("Mosaic"));
  document.listeners.click({target:{closest:selector=>selector==="[data-group]"?group:null}});
  assert.ok(results.innerHTML.includes(">KCL<"),"Fornecedor expandido");
  assert.equal(get("#rx-content").hidden,false);
  assert.equal(get("#rx-status").hidden,true);
  const file={name:"nota.xml",size:100};
  const event={dataTransfer:{types:["Files"],files:[file]},preventDefault(){this.prevented=true}};
  document.listeners.dragenter(event);
  assert.equal(get("#rx-xml-drop").hidden,false);
  document.listeners.dragover(event);
  assert.equal(event.dataTransfer.dropEffect,"copy");
  document.listeners.drop(event);
  assert.equal(event.prevented,true);
  assert.equal(get("#rx-xml-drop").hidden,true);
  assert.equal(dropped.length,1);
  assert.equal(dropped[0].id,7);
  assert.equal(dropped[0].file,file);
  document.listeners.drop({dataTransfer:{types:["Files"],files:[file,file]},preventDefault(){}});
  assert.equal(dropped.length,1,"Um XML por conferência");
  const pdf={name:"pedido.PDF",size:100},pdf2={name:"pedido2.pdf",size:100};
  document.listeners.drop({dataTransfer:{types:["Files"],files:[pdf,pdf2]},preventDefault(){}});
  assert.equal(droppedPDF.length,1);
  assert.equal(droppedPDF[0].id,7);
  assert.equal(droppedPDF[0].files.length,2);
  assert.equal(droppedPDF[0].files[0],pdf);
  document.listeners.drop({dataTransfer:{types:["Files"],files:[pdf,file]},preventDefault(){}});
  document.listeners.drop({dataTransfer:{types:["Files"],files:[{name:"teste.txt"}]},preventDefault(){}});
  assert.equal(droppedPDF.length,1,"Lotes mistos e formatos inválidos não importam");
  assert.equal(dropped.length,1);
  // Mesmo com vários produtos na NF-e, apenas uma solicitação agrupada
  // deve ser enviada, utilizando as regras do motor de estoque.
  const clicked={
    dataset:{action:"gfarm",id:"51"}
  };
  document.listeners.click({target:{closest:selector=>
    selector==="[data-action]"?clicked:null}});
  for(let i=0;i<20;i++){
    await new Promise(resolve=>setImmediate(resolve));
    if(posted.length)break;
  }
  assert.equal(posted.length,1,"GFARM deve receber uma única solicitação por nota");
  assert.deepEqual(posted[0].receipt_ids,[51,52],
    "Todos os itens da mesma NF-e precisam ir ao GFARM");
  // Abrir o resumo pela ação real; não usar a tabela larga da tela principal.
  const summaryClick={dataset:{action:"quick-summary"}};
  document.listeners.click({target:{closest:selector=>selector==="[data-action]"?summaryClick:null}});
  const summary=get("#rx-dialog-layer").innerHTML;
  assert.ok(summary.includes('class="rx-dialog rx-dialog-summary"'));
  assert.ok(summary.includes('class="rx-summary-table"'));
  assert.ok(summary.includes("KCL")&&summary.includes("40 t")&&summary.includes("10 t")&&summary.includes("30 t"));
  assert.ok(!summary.includes(">S9<"),"Resumo contém somente produtos com entrega registrada");
  assert.ok(!summary.includes('class="rx-table"'),"Não herdar largura mínima da tabela principal");
  assert.ok(summary.includes(">Fechar</button>"));
  const style=fs.readFileSync("central_admin/static/recebimentos.css","utf8");
  assert.match(style,/\.rx-summary-table\{\s*width:100%;min-width:0;max-width:100%;table-layout:fixed/);
  assert.match(style,/\.rx-dialog>\.rx-form\{[^}]*min-height:0/);
  assert.ok(summary.includes('id="rx-summary-search"')&&summary.includes('id="rx-summary-export"'));
  const summarySearch=get("#rx-summary-search"), summaryExport=get("#rx-summary-export"), summaryResults=get("#rx-summary-results");
  summarySearch.value="mosaic";summarySearch.listeners.input();
  assert.ok(summaryResults.innerHTML.includes("Nenhum produto encontrado"));
  assert.equal(summaryExport.disabled,true);
  await summaryExport.listeners.click();
  assert.equal(exported.length,0);
  summarySearch.value="ÁGREX KCL";summarySearch.listeners.input();
  assert.ok(summaryResults.innerHTML.includes("KCL"));
  assert.equal(summaryExport.disabled,false);
  await summaryExport.listeners.click();
  assert.equal(exported.length,1);
  assert.deepEqual(exported[0].rows,[["Agrex","1001","KCL","t",40,10,30]]);
  summarySearch.value="1001";summarySearch.listeners.input();
  assert.ok(summaryResults.innerHTML.includes("KCL"));
  console.log("OK: pesquisa do resumo e Excel usam exatamente o mesmo recorte");
  // Testar o importador real: largar o arquivo abre a prévia, não o POST de confirmação.
  const impWin={};
  const calls=[];
  let onSubmit,dialogBody,busy=false;
  vm.runInNewContext(imports,{window:impWin,Uint8Array,btoa:x=>Buffer.from(x,"binary").toString("base64"),
    console,confirm:()=>true});
  const xmlFile={name:"nfe.xml",size:30,arrayBuffer:async()=>Uint8Array.from(Buffer.from("<nfe>teste de importação</nfe>")).buffer};
  const app={
    cid:()=>7,canImportXML:()=>!busy,setBusy:v=>{busy=v;},
    route:p=>"/api/controls/7/receiving"+p,
    api:async(path,method,payload)=>{
      calls.push({path,method,payload});
      if(method==="GET")return orders;
      return {invoice_number:"42",supplier:"Agrex",lines:[{name:"KCL",quantity:10,unit:"t",suggested_id:11}]};
    },
    toast(){},dialog:(title,subtitle,body,submit)=>{dialogBody=body;onSubmit=submit;return {mask:{querySelector:get}};},
    refresh:async()=>{},esc:x=>String(x??""),items:()=>orders.items,
    dec:x=>x,closeDialog(){}
  };
  await impWin.NHReceivingImports.importXML(app,xmlFile);
  assert.equal(calls.length,2,"Soltar XML só abre a prévia e consulta o saldo/histórico");
  assert.equal(calls[1].method,"GET");
  assert.ok(calls[0].path.endsWith("/xml/preview"));
  assert.ok(dialogBody.includes("KCL")&&dialogBody.includes('value="11" selected'));
  assert.equal(busy,false);
  await onSubmit({get:key=>key==="selection_0"?"11":""});
  assert.equal(calls.length,3);
  assert.ok(calls[2].path.endsWith("/xml/confirm"));
  assert.equal(calls[2].payload.selections[0],11);
  // Histórico de XML confirmado prevalece sobre fornecedor/título divergentes.
  const match=impWin.NHReceivingImports.buildXMLChoices;
  const picker=impWin.NHReceivingImports.pickerHTML;
  const invoice={cnpj:"12.345.678/0001-99",supplier:"Distribuidora XYZ",
    lines:[{name:"FERTILIZANTE CLASSE A",code:"A-1",quantity:"1000",unit:"kg"}]};
  const candidates=[
    {id:21,order_number:"PED-21",supplier:"Cooperativa",product:"KCL",unit:"t",remaining_qty:"2",closed:false},
    {id:22,order_number:"PED-22",supplier:"Distribuidora XYZ",product:"FERTILIZANTE CLASSE A",unit:"kg",remaining_qty:"2000",closed:false}
  ];
  const history=[{item_id:21,invoice_issuer_document:"12345678000199",invoice_issuer:"Distribuidora XYZ",
    fiscal_json:JSON.stringify({codigo_produto:"A-1",descricao_xml:"FERTILIZANTE CLASSE A"})}];
  let choices=match(invoice,candidates,history);
  assert.equal(choices[0].suggested.id,21);
  assert.equal(choices[0].suggested.learned,true);
  assert.equal(choices[0].suggested.amount,1);
  assert.equal(match(invoice,candidates,[])[0].suggested.id,22,"Título identifica sem histórico");
  assert.equal(match({...invoice,cnpj:"99999999000199"},candidates,history)[0].suggested.id,22,"CNPJ diferente não aprende vínculo");
  const insufficient=candidates.map(p=>p.id===21?{...p,remaining_qty:".5"}:p);
  assert.equal(match(invoice,insufficient,history)[0].suggested.id,22,"Histórico sem saldo não prevalece");
  assert.equal(match(invoice,[{...candidates[0],closed:true}],history)[0].suggested,null);
  const repeat={...invoice,lines:[invoice.lines[0],invoice.lines[0],invoice.lines[0]]};
  assert.equal(match(repeat,candidates,history)[2].suggested.id,22,"Sugestões reservam saldo na mesma nota");
  const ambiguous=[...candidates,{...candidates[1],id:23}];
  assert.equal(match(invoice,ambiguous,[])[0].suggested,null,"Empate não escolhe pedido arbitrariamente");
  assert.equal(match({supplier:"OUTRO EMITENTE",lines:[{name:"KCL",quantity:1,unit:"t"}]},[candidates[0]],[])[0].suggested.id,21,"Fornecedor divergente não bloqueia título claro");
  assert.ok(picker(choices[0],"ped-22","",x=>String(x)).includes('value="22"'));
  assert.ok(!picker(choices[0],"ped-22","",x=>String(x)).includes('value="21"'));
  assert.ok(dialogBody.includes('id="rx-xml-search-0"'));
  const pdfCalls=[];
  const pdfFile={name:"pedido.pdf",size:30,arrayBuffer:async()=>Uint8Array.from(Buffer.from("%PDF-1.4 teste")).buffer};
  const pdfApp={...app,
    api:async(path,method,payload)=>{
      pdfCalls.push({path,method,payload});
      return {filename:payload.filename,fingerprint:"hash-pedido",order_number:"1001",supplier:"Agrex",
        items:[{product:"KCL",ordered_qty:"40",unit:"t"}]};
    },
    dialog:(title,subtitle,body,submit)=>{
      dialogBody=body;onSubmit=submit;return {form:{addEventListener(){}}};
    }
  };
  await impWin.NHReceivingImports.importPDF(pdfApp,[pdfFile,pdfFile]);
  assert.equal(pdfCalls.length,2,"Dois arquivos conferidos sem gravar");
  assert.ok(pdfCalls.every(c=>c.path.endsWith("/pdf/preview")));
  assert.equal((dialogBody.match(/name="enabled_/g)||[]).length,1,"Mesmo fingerprint não duplica o pedido");
  assert.ok(dialogBody.includes("KCL"));
  assert.equal(busy,false);
  await onSubmit({has:key=>key==="enabled_0_0",get:key=>({"order_0_0":"1001","supplier_0_0":"Agrex","product_0_0":"KCL","qty_0_0":"40","unit_0_0":"t"})[key]});
  assert.equal(pdfCalls.length,3);
  assert.ok(pdfCalls[2].path.endsWith("/pdf/confirm"));
  assert.equal(pdfCalls[2].payload.files.length,1);
  assert.equal(pdfCalls[2].payload.files[0].items[0].product,"KCL");
  console.log("OK: arrastar PDF usa OCR/prévia e confirmação, sem duplicar arquivo");
  console.log("OK: arrastar XML usa a prévia real, com sugestão e confirmação explícita");
  console.log("OK: Recebimentos aparece diretamente, sem renderizar outros modelos antes");
  console.log("OK: envio ao GFARM agrupa os dois itens da mesma nota fiscal");
};
test().catch(error=>{console.error(error);process.exitCode=1});
