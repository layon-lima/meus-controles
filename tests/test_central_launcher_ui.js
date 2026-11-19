"use strict";
/* O botão expansível não troca a página nem mexe no motor operacional.
 * Simulação de DOM mínimo, sem depender de navegador, VPS ou dados reais.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const launcher = fs.readFileSync("central_admin/static/launcher.js","utf8");
const operations = fs.readFileSync("central_admin/static/operations.js","utf8");
const initial = fs.readFileSync("central_admin/static/index.html","utf8");
assert.ok(initial.includes('id="homePanel"'),"Painel reutilizado deve existir");
assert.ok(initial.includes('class="module-card"'),"Cards do painel original devem existir");
assert.ok(launcher.includes("querySelector(\"#homePanel\")"),"Lançador deve reutilizar exatamente o painel original");
assert.ok(!operations.includes('className = "central-shell-bar"'),"Menu horizontal antigo não deve ser criado");

class MockElement {
  constructor(tag="div") {
    this.tagName=tag;
    this.children=[];
    this.listeners={};
    this.attributes={};
    this.properties={};
    this.className="";
    this.textContent="";
    this.id="";
    this.isConnected=true;
    const classes=new Set();
    this.classList={
      add:(...names)=>names.forEach(c=>classes.add(c)),
      remove:(...names)=>names.forEach(c=>classes.delete(c)),
      contains:c=>classes.has(c)
    };
    this.style={setProperty:(name,value)=>this.properties[name]=value};
  }
  append(...children){this.children.push(...children)}
  appendChild(child){this.children.push(child);return child}
  setAttribute(k,v){this.attributes[k]=v;if(k==="id")this.id=v}
  getAttribute(k){return this.attributes[k]}
  addEventListener(k,fn){this.listeners[k]=fn}
  removeEventListener(k,fn){if(this.listeners[k]===fn)delete this.listeners[k]}
  getBoundingClientRect(){return {left:24,top:800,width:62,height:62}}
  querySelector(selector) {
    if(selector==="#nh-hub-close")return this.children[0]?.children[1]?.children[1]||null;
    return null;
  }
  focus(){document.activeElement=this}
  remove(){this.isConnected=false;document.body.children=document.body.children.filter(x=>x!==this)}
}
const body=new MockElement("body");
const doc={
  readyState:"complete",body,documentElement:new MockElement("html"),activeElement:body,
  listeners:{},
  createElement:t=>new MockElement(t),
  createElementNS:(ns,t)=>new MockElement(t),
  getElementById(id){
    return body.children.find(el=>el.id===id)||null;
  },
  addEventListener(k,fn){this.listeners[k]=fn}
};
global.document=doc;
const location={
  pathname:"/central/modules/contas/",
  href:"https://controles.fazendanovohorizonte.com/central/modules/contas/",
  origin:"https://controles.fazendanovohorizonte.com"
};
let navigations=0;
const win={
  location:{...location,assign(){navigations++}},
  innerWidth:1200,innerHeight:862,
  setTimeout:()=>0
};
const context={
  document:doc,
  window:win,
  requestAnimationFrame:callback=>callback(),
  fetch:()=>new Promise(()=>{}),
  DOMParser:class {}
};
vm.runInNewContext(launcher,context);
assert.equal(body.children.length,1,"Apenas o ícone flutuante deve ser inserido");
const fab=body.children[0];
assert.equal(fab.id,"nh-dashboard-launcher");
assert.equal(fab.attributes["aria-expanded"],"false");
assert.equal(navigations,0);
fab.listeners.click();
assert.equal(body.children.length,2,"O painel deve surgir acima da página atual");
const popup=body.children[1];
assert.equal(popup.attributes["role"],"dialog");
assert.ok(popup.classList.contains("nh-hub-expanded"),"Painel deve expandir até a tela cheia");
assert.equal(popup.properties["--nh-expand-x"],"24px");
assert.equal(popup.properties["--nh-expand-y"],"800px");
assert.equal(popup.properties["--nh-expand-sx"],String(62/1200));
assert.equal(popup.properties["--nh-expand-sy"],String(62/862));
assert.equal(fab.attributes["aria-expanded"],"true");
assert.equal(navigations,0,"Abrir o painel não deve mudar de página");
const close=popup.querySelector("#nh-hub-close");
close.listeners.click();
assert.ok(!popup.classList.contains("nh-hub-expanded"),"Fechar deve recolher o painel ao ícone");
popup.listeners.transitionend({target:popup,propertyName:"transform"});
assert.equal(body.children.length,1,"Fechamento não pode deixar interface duplicada");
assert.equal(fab.attributes["aria-expanded"],"false");
assert.equal(navigations,0,"Fechar não pode recarregar nem navegar para outra página");
console.log("OK: ícone se expande, recolhe e mantém o módulo aberto sem reload");