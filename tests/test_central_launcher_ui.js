"use strict";
/* Regressão do ÚNICO elemento FAB→Janela. Sem overlay/scroll/corte, arrastável. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("central_admin/static/launcher.js","utf8");
const css=fs.readFileSync("central_admin/static/launcher.css","utf8");
const homeCss=fs.readFileSync("central_admin/static/app.css","utf8");
assert.ok(!source.includes("DOMParser")&&!source.includes("fetch("),"Não incorporar aplicativo");
assert.ok(!source.includes('createElement("iframe")'),"Nenhum iframe");
assert.ok(css.includes("@view-transition")&&homeCss.includes("view-transition-name: nh-central-expand"));
assert.ok(css.includes("overflow:hidden!important"),"Sem rolagem interna no popup");
assert.ok(source.includes("animateMorph("),"Morfologia GPU sem segundo popup");
assert.ok(!source.includes('document.body.append(menu,fab)'),"Nunca mais montar FAB separado");
assert.ok(source.includes("DESKTOP={w:600,h:455}"),"Janela desktop com tamanho fixo");
assert.ok(source.includes("MOBILE={w:360,h:510}"),"Janela mobile com tamanho próprio");
assert.ok(source.includes("fitPanel("),"Popup deve caber inteiramente");

class Element {
  constructor(tag="div"){
    this.tagName=tag.toLowerCase();this.children=[];this.attrs={};this.listeners={};
    this.className="";this.id="";this.value="";this.hidden=false;this.disabled=false;
    this.isConnected=true;this.dataset={};this.inert=false;this.capture=null;
    const set=new Set();this.classes=set;
    this.classList={
      add:(...names)=>names.forEach(n=>set.add(n)),
      remove:(...names)=>names.forEach(n=>set.delete(n)),
      contains:n=>set.has(n)
    };
    const props={};
    this.style={left:"",top:"",width:"",height:"",translate:"",
      setProperty:(k,v)=>{props[k]=v},getPropertyValue:k=>props[k]||""};
  }
  append(...nodes){this.children.push(...nodes);nodes.forEach(n=>n.parent=this)}
  appendChild(child){this.append(child);return child}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==="id")this.id=v}
  getAttribute(k){return this.attrs[k]}
  addEventListener(k,cb){this.listeners[k]=cb}
  removeAttribute(k){delete this.attrs[k]}
  closest(selector){return null}
  focus(){doc.activeElement=this}
  contains(other){return this===other||this.children.some(c=>c.contains(other))}
  setPointerCapture(id){this.capture=id}
  hasPointerCapture(id){return this.capture===id}
  releasePointerCapture(id){this.capture=null}
  querySelectorAll(){
    const found=[];
    const visit=e=>{for(const c of e.children){
      if(["a","button","input"].includes(c.tagName))found.push(c);
      visit(c);
    }};
    visit(this);
    return found;
  }
  animate(frames,opts){
    this.lastAnimation={frames,opts};
    return {finished:Promise.resolve()};
  }
  getBoundingClientRect(){
    const x=Number.parseFloat(this.style.left||"0");
    const y=Number.parseFloat(this.style.top||"0");
    const w=Number.parseFloat(this.style.width||"0");
    const h=Number.parseFloat(this.style.height||"0");
    const scale=Number.parseFloat(this.style.getPropertyValue("--nh-surface-scale")||"1");
    return {left:x,top:y,right:x+w*scale,bottom:y+h*scale,
            width:w*scale,height:h*scale};
  }
}
let doc;
const storage=new Map(),timers=[],raf=[],windowListeners={};
const location={pathname:"/central/modules/recebimentos/",assign:url=>navs.push(url)};
const navs=[];
const win={innerWidth:1440,innerHeight:900,location,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  sessionStorage:{setItem:(k,v)=>storage.set(k,v)},
  matchMedia:()=>({matches:false}),
  addEventListener:(k,cb)=>windowListeners[k]=cb,
  setTimeout:cb=>{timers.push(cb);return timers.length},
  requestAnimationFrame:cb=>{raf.push(cb);return raf.length},
  cancelAnimationFrame:()=>{}
};
const flushRaf=()=>{while(raf.length)raf.shift()()};
const flushTimers=()=>{while(timers.length)timers.shift()()};
const tick=async()=>{for(let i=0;i<3;i++)await Promise.resolve()};
function boot(path="/central/modules/recebimentos/"){
  location.pathname=path;
  const body=new Element("body");doc={
    readyState:"complete",body,activeElement:body,listeners:{},
    createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag),
    getElementById(id){
      const visit=el=>{
        if(el.id===id)return el;
        for(const c of el.children){const found=visit(c);if(found)return found}
        return null;
      };
      return visit(body);
    },
    addEventListener:(k,cb)=>doc.listeners[k]=cb,
    documentElement:{clientWidth:1440,clientHeight:900}
  };
  vm.runInNewContext(source,{document:doc,window:win,location,Date,console});
  return {body,root:doc.getElementById("nh-start-menu"),
    fab:doc.getElementById("nh-dashboard-launcher"),
    panel:doc.getElementById("nh-start-panel")};
}
const evt=(id,x,y,button=0)=>({pointerId:id,clientX:x,clientY:y,button,isPrimary:true,
  target:null,preventDefault(){this.prevented=true;}});
function fits(root){
  const b=root.getBoundingClientRect();
  assert.ok(b.left>=0 && b.top>=0 && b.right<=win.innerWidth+.1 &&
    b.bottom<=win.innerHeight+.1,
    "Janela não pode sair da tela: "+JSON.stringify(b));
}
async function run(){
  let {body,root,fab,panel}=boot();
  assert.equal(body.children.length,1,"FAB e janela são o MESMO componente raiz");
  assert.equal(root.children.length,2,"Ícone e conteúdo pertencem à mesma superfície");
  assert.equal(root.style.width,"58px");
  assert.equal(panel.inert,true,"Conteúdo fechado não deve receber foco");
  assert.equal(root.classList.contains("nh-start-open"),false);
  const tileLinks=panel.querySelectorAll().filter(e=>e.tagName==="a"&&e.dataset.module);
  assert.equal(tileLinks.length,8);
  assert.ok(tileLinks.find(t=>t.dataset.module==="recebimentos"));
  assert.equal(tileLinks.find(t=>t.dataset.module==="recebimentos").getAttribute("aria-current"),"page");

  fab.listeners.click({detail:1,preventDefault(){}});
  await tick();
  assert.equal(root.classList.contains("nh-start-open"),true);
  assert.equal(root.classList.contains("nh-start-ready"),true);
  assert.equal(root.style.width,"600px");
  assert.equal(root.style.height,"455px");
  assert.ok(root.lastAnimation.frames[0].transform.includes("scale("));
  fits(root);
  const search=panel.querySelectorAll().find(e=>e.tagName==="input");
  assert.equal(doc.activeElement,search);
  search.value="hOlerÍTe";
  search.listeners.input();
  assert.equal(tileLinks.filter(t=>!t.hidden).length,1);
  assert.equal(tileLinks.find(t=>!t.hidden).dataset.module,"funcionarios");
  // Drag do topo deve mover a própria janela. Nenhum FAB separado aparece.
  const header=panel.children[0],before=root.getBoundingClientRect();
  header.listeners.pointerdown(evt(3,before.left+200,before.top+20));
  header.listeners.pointermove(evt(3,before.left-1000,before.top-1000));
  flushRaf();
  assert.ok(root.classList.contains("nh-start-moving"));
  header.listeners.pointerup(evt(3,before.left-1000,before.top-1000));
  fits(root);
  assert.equal(root.style.width,"600px","Arrastar não modifica tamanho da janela");
  assert.equal(body.children.length,1);
  const afterDrag=root.getBoundingClientRect();
  assert.ok(afterDrag.left<before.left,"Janela deve se mover com o dedo/mouse");
  assert.equal(root.classList.contains("nh-start-ready"),true);
  flushTimers();
  doc.listeners.keydown({key:"Escape",preventDefault(){}});
  await tick();
  assert.equal(root.classList.contains("nh-start-open"),false);
  assert.equal(root.style.width,"58px");
  assert.equal(panel.inert,true);
  assert.equal(body.children.length,1);

  // Um ícone na posição extrema NÃO pode produzir janela cortada.
  for(const [x,y] of [[0,0],[1439,0],[0,899],[1439,899],[710,425]]){
    let c=root.getBoundingClientRect();
    fab.listeners.pointerdown(evt(10,c.left+20,c.top+20));
    fab.listeners.pointermove(evt(10,x,y));
    flushRaf();fab.listeners.pointerup(evt(10,x,y));
    flushTimers();
    fits(root);
    const beforeClick=root.getBoundingClientRect();
    fab.listeners.click({detail:1,preventDefault(){this.prevented=true;}});
    await tick();fits(root);
    assert.equal(root.style.width,"600px");
    assert.equal(root.style.height,"455px");
    assert.equal(root.classList.contains("nh-start-ready"),true);
    assert.equal(body.children.length,1);
    panel.children[0].children[1].listeners.click();
    await tick();fits(root);
    assert.equal(root.style.width,"58px");
  }

  // Clique direito alterna tamanhos sem formulário.
  for(const expected of [70,82,94,58]){
    const e={preventDefault(){this.prevented=true;}};
    fab.listeners.contextmenu(e);
    assert.equal(e.prevented,true);
    assert.equal(root.style.width,expected+"px");
  }
  assert.equal(JSON.parse(storage.get("nh-central-launcher-geometry-v1")).sizeIndex,0);
  assert.equal(body.children.length,1);

  // Janela 600x455 é fixa; em viewport pequena escala para caber.
  win.innerWidth=390;win.innerHeight=360;
  windowListeners.resize();fits(root);
  fab.listeners.click({detail:1,preventDefault(){}});
  await tick();
  assert.equal(root.style.width,"360px");
  assert.equal(root.style.height,"510px");
  assert.ok(Number.parseFloat(root.style.getPropertyValue("--nh-surface-scale"))<1);
  fits(root);
  assert.ok(!css.includes("overflow-y:auto"),"Popup sem scroll interno");
  panel.children[0].children[1].listeners.click();
  await tick();
  win.innerWidth=1440;win.innerHeight=900;windowListeners.resize();

  // Reabrir em outro módulo restaura posição/tamanho, sem outros elementos.
  const old=JSON.parse(storage.get("nh-central-launcher-geometry-v1"));
  ({body,root,fab,panel}=boot("/central/modules/contas/"));
  assert.equal(body.children.length,1);
  assert.equal(root.style.left,old.x+"px");
  assert.equal(root.style.top,old.y+"px");
  assert.equal(root.style.width,"58px");
  const current=panel.querySelectorAll().find(e=>e.dataset.module==="contas");
  fab.listeners.click({detail:1,preventDefault(){}});
  await tick();
  const own={preventDefault(){this.prevented=true;}};
  current.listeners.click(own);
  await tick();
  assert.equal(own.prevented,true);
  assert.equal(navs.length,0);
  console.log("OK: mesma superfície vira janela, fixa, arrastável e sempre dentro da tela");
  console.log("OK: 4 tamanhos, sem scroll, sem flashes, restaura posição e mantém módulo");
}
run().catch(e=>{console.error(e);process.exitCode=1});
