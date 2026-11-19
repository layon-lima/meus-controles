"use strict";
/* Teste do Menu Iniciar independente: não duplica página nem altera formulário. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("central_admin/static/launcher.js","utf8");
const operations = fs.readFileSync("central_admin/static/operations.js","utf8");
const css = fs.readFileSync("central_admin/static/launcher.css","utf8");

assert.ok(!source.includes("DOMParser"),"Não pode copiar a página da Central");
assert.ok(!source.includes("fetch("),"O menu Iniciar não precisa consultar a rede para abrir");
assert.ok(!source.includes("iframe"),"A navegação não pode usar iframe");
assert.ok(!operations.includes('className = "central-shell-bar"'),
  "As abas superiores antigas não podem voltar");
assert.ok(!css.includes("width:100vw!important;height:100dvh"),
  "O menu não pode ser uma tela cheia");
assert.ok(css.includes("width:min(600px"),"O painel flutuante deve ter largura compacta");

let doc;
class MockElement {
  constructor(tag="div") {
    this.tagName=tag;
    this.children=[];
    this.listeners={};
    this.attributes={};
    this.className="";
    this.id="";
    this.hidden=false;
    this.disabled=false;
    this.value="";
    this.dataset={};
    this.textContent="";
    this.isConnected=true;
    const classes=new Set();
    this.classList={
      add:(...names)=>names.forEach(name=>classes.add(name)),
      remove:(...names)=>names.forEach(name=>classes.delete(name)),
      contains:name=>classes.has(name)
    };
  }
  append(...elements){this.children.push(...elements)}
  appendChild(element){this.children.push(element);return element}
  setAttribute(name,value){this.attributes[name]=String(value)}
  getAttribute(name){return this.attributes[name]}
  addEventListener(name,fn){this.listeners[name]=fn}
  focus(){doc.activeElement=this}
  contains(element){
    return this===element||this.children.some(child=>child.contains?.(element));
  }
  click(){this.listeners.click?.({preventDefault(){this.prevented=true}})}
}
const body=new MockElement("body");
doc={
  readyState:"complete",body,
  activeElement:body,
  listeners:{},
  createElement:tag=>new MockElement(tag),
  createElementNS:(_ns,tag)=>new MockElement(tag),
  getElementById(id){
    const find=root=>{
      if(root.id===id)return root;
      for(const child of root.children){const match=find(child);if(match)return match;}
      return null;
    };
    return find(body);
  },
  addEventListener(name,fn){this.listeners[name]=fn}
};
const findClass=(root,name)=>{
  if(root.className.split(" ").includes(name))return root;
  for(const child of root.children){const match=findClass(child,name);if(match)return match;}
  return null;
};
const getAllClass=(root,name)=>{
  const result=[];
  if(root.className.split(" ").includes(name))result.push(root);
  for(const child of root.children)result.push(...getAllClass(child,name));
  return result;
};
const location={pathname:"/central/modules/contas/",href:"https://controles.fazendanovohorizonte.com/central/modules/contas/"};
const context={document:doc,location,window:{location}};
vm.runInNewContext(source,context);
assert.equal(body.children.length,2,"Apenas menu pequeno e ícone flutuante são montados");
const menu=doc.getElementById("nh-start-menu");
const fab=doc.getElementById("nh-dashboard-launcher");
assert.ok(menu&&fab,"Menu e ícone devem existir");
assert.equal(menu.getAttribute("aria-modal"),"false");
assert.equal(menu.getAttribute("aria-hidden"),"true");
assert.equal(fab.getAttribute("aria-expanded"),"false");
assert.equal(menu.classList.contains("nh-start-open"),false);

const tileList=getAllClass(menu,"nh-start-tile");
assert.equal(tileList.length,8,"Exatamente oito módulos");
assert.equal(tileList.find(tile=>tile.dataset.module==="contas").href,
  "/central/modules/contas/");
assert.equal(tileList.find(tile=>tile.dataset.module==="recebimentos").href,
  "/central/modules/recebimentos/");
const previousForm={note:"Não perder a digitação",amount:200};
fab.click();
assert.equal(menu.classList.contains("nh-start-open"),true,"Ícone abre menu Iniciar");
assert.equal(menu.getAttribute("aria-hidden"),"false");
assert.equal(fab.getAttribute("aria-expanded"),"true");
assert.equal(doc.activeElement.className,"nh-start-search-input","Foco vai à busca");
assert.deepEqual(previousForm,{note:"Não perder a digitação",amount:200});

const search=findClass(menu,"nh-start-search-input");
search.value="hOleRÍTe";
search.listeners.input();
const visible=tileList.filter(tile=>!tile.hidden);
assert.equal(visible.length,1,"Busca restringe módulos, sem abrir páginas");
assert.equal(visible[0].dataset.module,"funcionarios");
search.value="";
search.listeners.input();
assert.equal(tileList.filter(tile=>!tile.hidden).length,8);

doc.listeners.keydown({key:"Escape",preventDefault(){}});
assert.equal(menu.classList.contains("nh-start-open"),false,"Esc fecha o menu");
assert.equal(fab.getAttribute("aria-expanded"),"false");
fab.click();
assert.equal(menu.classList.contains("nh-start-open"),true);
const otherTarget=new MockElement("input");
doc.listeners.pointerdown({target:otherTarget});
assert.equal(menu.classList.contains("nh-start-open"),false,"Clique fora fecha menu");

fab.click();
const own=tileList.find(tile=>tile.dataset.module==="contas");
const click={prevented:false,preventDefault(){this.prevented=true}};
own.listeners.click(click);
assert.equal(click.prevented,true,"Módulo atual não deve recarregar");
assert.equal(menu.classList.contains("nh-start-open"),false);
assert.deepEqual(previousForm,{note:"Não perder a digitação",amount:200});

console.log("OK: menu Iniciar flutuante, 8 módulos, busca, Esc, clique fora e nenhum reload");
