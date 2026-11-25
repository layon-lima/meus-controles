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
  querySelector:get,
  createElement:()=>new Element(),
  querySelectorAll(){return []},
  addEventListener(name,fn){this.listeners[name]=fn}
};
const dropped=[];
const requested=[];
const posted=[];
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
  document,window:{NHReceivingImports:{openPDF(){},openXML(){},importXML(app,file){dropped.push({id:app.cid(),file});}}},
  fetch:fetchMock,
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
      return {invoice_number:"42",supplier:"Agrex",lines:[{name:"KCL",quantity:10,unit:"t",suggested_id:11}]};
    },
    toast(){},dialog:(title,subtitle,body,submit)=>{dialogBody=body;onSubmit=submit;},
    refresh:async()=>{},esc:x=>String(x??""),items:()=>orders.items,
    dec:x=>x,closeDialog(){}
  };
  await impWin.NHReceivingImports.importXML(app,xmlFile);
  assert.equal(calls.length,1,"Soltar XML só pode abrir a prévia");
  assert.ok(calls[0].path.endsWith("/xml/preview"));
  assert.ok(dialogBody.includes("KCL")&&dialogBody.includes('value="11" selected'));
  assert.equal(busy,false);
  await onSubmit({get:key=>key==="selection_0"?"11":""});
  assert.equal(calls.length,2);
  assert.ok(calls[1].path.endsWith("/xml/confirm"));
  assert.equal(calls[1].payload.selections[0],11);
  console.log("OK: arrastar XML usa a prévia real, com sugestão e confirmação explícita");
  console.log("OK: Recebimentos aparece diretamente, sem renderizar outros modelos antes");
  console.log("OK: envio ao GFARM agrupa os dois itens da mesma nota fiscal");
};
test().catch(error=>{console.error(error);process.exitCode=1});
