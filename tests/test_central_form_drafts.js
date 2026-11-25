"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("central_admin/static/form-drafts.js","utf8");
function fixture(kind){
  const events={},messages=[],location={href:"https://example.test/central/modules/"+kind+"/"},state={pending:false,approve:false,closed:0};
  let doc,win,observer;
  class E{
    constructor(tag="div",id="",cls=""){this.tagName=tag;this.id=id;this.children=[];this.attrs={};this.listeners={};this.parent=null;this.value="";this.files=[];this.textContent="";this.disabled=false;this.classList={tokens:new Set(cls.split(" ").filter(Boolean)),add:k=>this.classList.tokens.add(k),remove:k=>this.classList.tokens.delete(k),contains:k=>this.classList.tokens.has(k)};}
    get className(){return [...this.classList.tokens].join(" ")}
    set className(v){this.classList.tokens=new Set(v.split(" ").filter(Boolean))}
    get isConnected(){return doc.body.contains(this)}
    append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n)}}
    after(n){const p=this.parent;n.parent=p;p.children.splice(p.children.indexOf(this)+1,0,n)}
    remove(){if(this.parent){this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null}}
    setAttribute(k,v){this.attrs[k]=v}
    removeAttribute(k){delete this.attrs[k]}
    getAttribute(k){return this.attrs[k]??null}
    contains(n){return !!n&&(n===this||this.children.some(c=>c.contains(n)))}
    addEventListener(k,fn){this.listeners[k]=fn}
    focus(){doc.activeElement=this}
    matches(s){
      s=s.trim();if(!s)return false;
      if(s.includes(" ")){const i=s.lastIndexOf(" ");return this.matches(s.slice(i+1))&&!!this.parent?.closest(s.slice(0,i))}
      const attr=s.match(/\[([^\]=*]+)(\*?=)?(?:['"]?([^'"\]]*)['"]?)?\]/);
      if(attr){const v=this.attrs[attr[1]],ok=attr[2]==="*="?String(v||"").includes(attr[3]):attr[2]==="="?v===attr[3]:v!==undefined;if(!ok)return false;s=s.replace(attr[0],"")}
      if(s.includes(":disabled")){if(!this.disabled)return false;s=s.replace(":disabled","")}
      s=s.replace(":not([type=hidden])","");
      if(s.startsWith("#")){const [id,...classes]=s.slice(1).split(".");return this.id===id&&classes.every(c=>this.classList.contains(c))}
      if(s.startsWith("."))return s.slice(1).split(".").every(c=>this.classList.contains(c));
      return !s||this.tagName===s;
    }
    closest(sel){return sel.split(",").some(s=>this.matches(s))?this:this.parent?.closest(sel)||null}
    querySelector(sel){for(const c of this.children){if(sel.split(",").some(s=>c.matches(s)))return c;const hit=c.querySelector(sel);if(hit)return hit}return null}
    click(){const e=fire("click",this);if(!e.stopped)this.listeners.click?.(e)}
  }
  const body=new E("body");
  doc={body,readyState:"complete",activeElement:body,createElement:t=>new E(t),querySelector:s=>body.querySelector(s)};
  function fire(name,target=body,extra={}){const e={target,stopped:false,prevented:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...extra};events[name]?.(e);return e}
  win={location,history:{state:{index:1},pushState(){}},NHFeedback:{notify:m=>messages.push(m),isWriting:()=>state.pending},NHConfirm:{ask:async()=>state.approve},addEventListener:(k,fn)=>events[k]=fn};
  const root=new E("div",kind==="rx"?"rx-mask":kind==="contas"?"backdrop":"",kind==="contas"?"show":kind==="legacy"?"modal-backdrop":"");
  const panel=kind==="pix"?root:new E("section","",kind==="rx"?"rx-dialog":kind==="contas"?"dialog":"modal");
  const head=new E("header","",kind==="rx"?"rx-dialog-head":kind==="pix"?"nhf-pix-actions":"modal-header");
  const heading=new E("h2",kind==="contas"?"dialogTitle":"");heading.textContent="Conferência de documento";head.append(heading);
  const form=new E("form",kind==="contas"?"dialogBody":"");const field=new E("input"),file=new E("input");field.value="Produto já preenchido";file.files=[{name:"nota.xml"}];form.append(field,file);
  const save=new E("button",kind==="rx"?"rx-submit":kind==="contas"?"save":"");
  const cancel=new E("button",kind==="contas"?"cancel":"");
  if(kind==="rx")cancel.setAttribute("data-close","");
  if(kind==="legacy")cancel.setAttribute("onclick","App.closeModal()");
  if(kind==="pix"){root.setAttribute("data-nh-draft","pix");cancel.setAttribute("data-nh-draft-cancel","");save.setAttribute("data-nh-draft-save","")}
  cancel.addEventListener("click",()=>{state.closed++;if(kind==="contas")root.classList.remove("show");else if(kind==="pix")root.removeAttribute("data-nh-draft");else root.remove()});
  panel.append(head,form,save,cancel);if(root!==panel)root.append(panel);
  if(kind==="legacy"){const host=new E("div","modalRoot");host.append(root);body.append(host)}else body.append(root);
  const outside=new E("button");body.append(outside);
  vm.runInNewContext(source,{window:win,document:doc,location,MutationObserver:class{constructor(fn){observer=fn}observe(){}},Promise,Number});
  return {win,doc,root,field,file,save,cancel,outside,state,fire,observer,messages};
}
(async()=>{
  for(const kind of ["rx","contas","legacy","pix"]){
    const x=fixture(kind),{win,root,field,file,save,cancel,outside,state,fire}=x;
    assert.equal(win.NHDrafts.hasDraft(),true,kind);
    assert.equal(fire("click",outside).stopped,true,"Clique fora é protegido");
    assert.equal(state.closed,0);
    state.pending=true;assert.equal(win.NHDrafts.minimize(),false);state.pending=false;
    const oldFile=file.files[0];field.focus();cancel.click();
    assert.equal(root.classList.contains("nh-draft-minimized"),true);
    assert.equal(root.isConnected,true,"O nó original continua vivo");
    assert.equal(state.closed,0,"Minimizar nunca encerra o ticket nem o formulário");
    if(kind==="contas")assert.equal(root.classList.contains("show"),true,"Fila de PDF continua em conferência");
    assert.ok(x.doc.querySelector("#nh-draft-dock"));
    assert.equal(fire("click",outside).stopped,true,"Não substituir formulário pendente");
    assert.equal(fire("beforeunload").prevented,true);
    x.doc.querySelector(".nh-draft-reopen").click();
    assert.equal(root.classList.contains("nh-draft-minimized"),false);
    assert.equal(field.value,"Produto já preenchido");
    assert.equal(file.files[0],oldFile);
    assert.equal(x.doc.querySelector("#nh-draft-dock"),null);
    win.NHDrafts.minimize();await win.NHDrafts.discard();
    assert.equal(state.closed,0,"Cancelar descarte mantém dados");
    state.approve=true;await win.NHDrafts.discard();
    assert.equal(state.closed,1,"Descartar explicitamente chama fechamento original");
    assert.equal(win.NHDrafts.hasDraft(),false);
    assert.equal(x.doc.querySelector("#nh-draft-dock"),null);
  }
  const x=fixture("rx");x.win.NHDrafts.minimize();x.root.remove();x.observer();
  assert.equal(x.doc.querySelector("#nh-draft-dock"),null,"Salvar/fechar de fato elimina a aba");
  console.log("OK: proteção externa, minimizar/restaurar DOM e arquivo, fila preservada, descarte explícito e limpeza em quatro interfaces");
})().catch(e=>{console.error(e);process.exitCode=1});
