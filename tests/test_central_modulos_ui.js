"use strict";
/* Testa separação das telas com DOM simulado e motor original fictício.
   Não precisa de VPS, navegador real nem dados financeiros. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("central_admin/static/operations.js", "utf8");

class Element {
  constructor(tag = "div") {
    this.tagName=tag;this.children=[];this.listeners={};this.attributes={};
    this.value="";this.textContent="";this.innerHTML="";this.className="";
    const styles=new Set();
    this.classList={
      add:(...values)=>values.forEach(v=>styles.add(v)),
      remove:(...values)=>values.forEach(v=>styles.delete(v)),
      contains:(value)=>styles.has(value),
      toggle:(value,force)=>{if(force===undefined)force=!styles.has(value);force?styles.add(value):styles.delete(value);return force}
    };
  }
  append(...nodes){this.children.push(...nodes)}
  insertBefore(node){this.children.unshift(node)}
  replaceChildren(...nodes){this.children=[...nodes];this.innerHTML=""}
  addEventListener(type,fn){this.listeners[type]=fn}
  setAttribute(k,v){this.attributes[k]=v}
  getAttribute(k){return this.attributes[k]}
  before(node){this.beforeNodes=(this.beforeNodes||[]).concat([node])}
  click(){this.listeners.click?.()}
}
function boot(module, controls){
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
  const body=new Element("body");
  const document={
    body,
    listeners:{},
    createElement:tag=>new Element(tag),
    getElementById:element,
    addEventListener(type,fn){this.listeners[type]=fn}
  };
  const state={
    boards:[{id:4,name:"Operações"},{id:5,name:"Insumos"}],
    controls:controls.map((c,i)=>({id:i+1,board_id:4,summary:{count:0},...c}))
  };
  const app={
    s:{state,route:"home",id:null,detail:null,modal:null,draft:null,editing:null},
    render(){this.renderMain()},
    renderMain(){element("main").innerHTML="TELA INTEIRA LEGADA"},
    toggleMenu(open){if(open)element("sidebar").classList.add("open")},
    newControl(){this.s.modal="builder";this.s.draft={mode:"caminhao",name:"Novo controle"};return true},
    mode(mode){this.s.draft.mode=mode},
    newBoard(){this.boardRequested=true},
    toast(){},
    navigate(route,id,options){this.s.route=route;this.s.id=id;if(route==="home")this.s.detail=null;this.render()},
    reportExcelOpen(){this.reportOpened=true}
  };
  const location={pathname:"/central/modules/"+module+"/"};
  const win={location};
  const context={document,location,window:win,App:app,
    accounts:[{id:1,fornecedor:"Agrex",documento:"NF 2402",has_pdf:true,has_receipt:true}],
    setModule:()=>{},select:()=>{},showPDF:()=>Promise.resolve(),openMenu:()=>{},
    controlCard:c=>"<article data-mode='"+c.mode+"'>"+c.name+"</article>"};
  vm.runInNewContext(source,context);
  document.listeners.DOMContentLoaded();
  return {elements,app,body};
}
const testControls=[
  {name:"Pedido de Fertilizantes",mode:"recebimento"},
  {name:"Frete da Soja",mode:"caminhao"},
  {name:"Dívida",mode:"divida"},
  {name:"Acerto",mode:"acerto_ab"}
];
for(const [module,allowed,forbidden,newMode] of [
  ["recebimentos",["Pedido de Fertilizantes"],["Frete da Soja","Dívida","Acerto"],"recebimento"],
  ["transportadoras",["Frete da Soja"],["Pedido de Fertilizantes","Dívida","Acerto"],"caminhao"],
  ["controles",["Dívida","Acerto"],["Pedido de Fertilizantes","Frete da Soja"],"financeiro"]
]){
  const {elements,app,body}=boot(module,testControls);
  const results=elements.get("main").children.find(x=>x.className==="control-grid nh-filtered-results");
  assert.ok(results,"Lista do módulo deve estar presente: "+module);
  for(const name of allowed)assert.ok(results.innerHTML.includes(name),module+" deveria mostrar "+name);
  for(const name of forbidden)assert.ok(!results.innerHTML.includes(name),module+" não deve mostrar "+name);
  assert.ok(body.classList.contains("nh-module-list"),"A lista deve esconder o topbar antigo");
  elements.get("sidebar").classList.add("open");
  app.toggleMenu(true);
  assert.equal(elements.get("sidebar").classList.contains("open"),false,
    "A navegação nunca deve reabrir o menu lateral");
  const add=elements.get("main").children.find(x=>x.className==="nh-module-head").children[1];
  add.click();
  assert.equal(app.s.modal,"builder");
  if(newMode)assert.equal(app.s.draft.mode,newMode,"O botão novo deve abrir o modelo da área");
  console.log("OK:",module,"lista isolada e menu lateral fechado");
}
const docs=boot("documentos",testControls);
const before=docs.elements.get("contasView").beforeNodes||[];
assert.equal(before.length,1,"Documentos deve ter uma tela dedicada");
assert.equal(before[0].id,"nh-documents-view");
assert.equal(before[0].children.length,3,"Cabeçalho, filtro e lista de documentos");
const records=before[0].children[2];
assert.equal(records.children.length,1,"Documento existente deve aparecer na lista");
console.log("OK: Documentos mostra apenas arquivos e mantém ações nativas");
console.log("OK: módulos testados sem afetar o App legado");
