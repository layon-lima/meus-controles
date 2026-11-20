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
  querySelectorAll(){return []},
  addEventListener(name,fn){this.listeners[name]=fn}
};
const requested=[];
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
    id:51,item_id:11,order_number:"1001",product:"KCL",supplier:"Agrex",
    received_date:"2026-11-19",invoice_number:"2402",access_key:"1".repeat(44),
    received_qty:"10",unit:"t",gfarm_status:"NAO_ENVIADO"
  }]
};
async function fetchMock(path){
  requested.push(path);
  let json;
  if(path.endsWith("/api/state"))json=backend;
  else if(path.includes("/receiving/xml/pending"))json={items:[]};
  else if(path.endsWith("/api/controls/7/receiving"))json=orders;
  else throw new Error("A API inesperada "+path);
  return {ok:true,json:async()=>json};
}
const context={
  document,window:{NHReceivingImports:{openPDF(){},openXML(){}}},
  fetch:fetchMock,
  setTimeout:()=>0,
  requestAnimationFrame:callback=>callback(),
  Date,Number,String,Array,Map,Set,Intl,Promise,console,
};
vm.runInNewContext(core,context);
const test=async()=>{
  // Permite que Promise.all() e microtasks terminem sem qualquer DOM legado.
  for(let i=0;i<12;i++)await Promise.resolve();
  const control=get("#rx-control"),results=get("#rx-results");
  assert.ok(requested.some(x=>x.endsWith("/api/state")));
  assert.ok(requested.some(x=>x.endsWith("/api/controls/7/receiving")));
  assert.ok(!requested.some(x=>x.includes("/controls/1/")));
  assert.ok(!requested.some(x=>x.includes("/controls/2/")));
  assert.ok(control.innerHTML.includes("Recebimentos Reais"));
  assert.ok(!control.innerHTML.includes("FRETES"));
  assert.ok(!control.innerHTML.includes("FINANCEIRO"));
  assert.ok(results.innerHTML.includes("Agrex"),"Pedidos nativos renderizados");
  assert.ok(results.innerHTML.includes("KCL"));
  assert.ok(results.innerHTML.includes("Mosaic"));
  assert.ok(!results.innerHTML.includes("FRETES"));
  assert.equal(get("#rx-content").hidden,false);
  assert.equal(get("#rx-status").hidden,true);
  console.log("OK: Recebimentos aparece diretamente, sem renderizar outros modelos antes");
};
test().catch(error=>{console.error(error);process.exitCode=1});
