"use strict";
/* Revisão de Contas fullscreen: regressão de PDF do arquivo arrastado e
 * do histórico, sem salvar, sem duplicar upload e sem interferir no motor. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const js=fs.readFileSync("central_admin/static/contas_pdf_review.js","utf8");
const css=fs.readFileSync("central_admin/static/contas_pdf_review.css","utf8");
const gateway=fs.readFileSync("central_admin/operations_gateway.py","utf8");
assert.match(css, /grid-template-columns:minmax\(370px,39%\) minmax\(0,61%\)/);
assert.match(css, /width:100%!important;max-width:none!important/);
assert.match(css, /height:calc\(100dvh - 20px\)!important/);
assert.match(css, /#backdrop\.nh-pdf-review-split #dialogBody/);
assert.match(css, /overflow-y:auto!important/);
assert.match(css, /#backdrop\.nh-pdf-review-split \.dialog-actions/);
assert.match(gateway, /frame-src 'self' blob:/);
assert.ok(!js.includes("/api/import/commit"),"Viewer must never save an account");
assert.ok(!js.includes("postPDF("),"Viewer must not upload or re-OCR a PDF");
assert.ok(js.includes('URL.revokeObjectURL('),"Revoke the temporary PDF on close");
assert.ok(js.includes("source.kind === \"file\""),"Show original dragged File");
assert.ok(js.includes("MutationObserver(syncReview)"),"Follow existing form");

class Element {
  constructor(tag="div",id=""){
    this.tagName=tag;this.id=id;this.children=[];this.parent=null;
    this.attrs={};this.isConnected=true;this.textContent="";
    this.className="";this.hidden=false;this.href="";this.src="";
    this.classes=new Set();
    this.classList={
      add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),
      contains:k=>this.classes.has(k)
    };
  }
  setAttribute(k,v){this.attrs[k]=String(v)}
  append(...nodes){this.children.push(...nodes);for(const n of nodes){n.parent=this;n.isConnected=true}}
  appendChild(node){this.append(node);return node}
  replaceChildren(...nodes){for(const c of this.children)c.isConnected=false;
    this.children=[];this.append(...nodes)}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(x=>x!==this)}
    this.parent=null;this.isConnected=false}
  querySelector(selector){if(selector===".dialog")return this.children.find(c=>c.className==="dialog");return null}
}
let callback;
class Observer {
  constructor(fn){callback=fn}
  observe(){}
  disconnect(){}
}
const document={
  body:new Element("body"),entries:new Map(),createElement:tag=>new Element(tag),
  getElementById(id){
    if(id==="accountForm")return this.entries.get("accountForm")||null;
    if(id==="backdrop")return backdrop;
    const find=n=>n.id===id?n:(n.children.map(find).find(Boolean)||null);
    return find(backdrop)||find(this.body);
  }
};
const backdrop=new Element("div","backdrop");
const dialog=new Element("section");dialog.className="dialog";
backdrop.append(dialog);
const revoked=[],created=[],fetched=[];
const fakeFile=(name)=>({name,size:12345,type:"application/pdf"});
const env={
  document,location:{pathname:"/central/modules/contas/"},
  MutationObserver:Observer,
  URL:{
    createObjectURL:b=>{created.push(b);return "blob:https://local.test/"+created.length;},
    revokeObjectURL:u=>revoked.push(u)
  },
  Blob,console,
  pendingImportPDF:null,selected:null,accounts:[],token:"session",
  fetch:async(url,options)=>{
    fetched.push({url,options});
    return {ok:true,blob:async()=>new Blob(["%PDF-a"],{type:"application/pdf"})};
  }
};
vm.runInNewContext(js,env);
assert.ok(callback,"Viewer must observe modal lifecycle");
function show(file){
  env.pendingImportPDF={ticket:"t",file};
  document.entries.set("accountForm",new Element("form"));
  backdrop.classList.add("show");
  callback();
}
const one=fakeFile("NF 2402.pdf");
show(one);
const viewer=()=>document.getElementById("nh-account-pdf-review");
assert.ok(viewer(),"Viewer appears with account form and PDF");
assert.ok(backdrop.classList.contains("nh-pdf-review-split"));
assert.equal(dialog.children.length,1,"Existing form/modal DOM is not recreated");
assert.equal(created[0],one,"Original dragged PDF shown without network request");
assert.equal(fetched.length,0,"No extra upload or download during new import");
const iframe=viewer().children[1].children[0];
assert.equal(iframe.tagName,"iframe");
assert.ok(iframe.src.startsWith("blob:"));
assert.ok(iframe.src.includes("toolbar=1"),"Browser PDF toolbar enables zoom and page controls");
assert.equal(viewer().children[0].children[0].children[1].textContent,"NF 2402.pdf");
// Same form, changes to fields must not cause extra viewer/upload.
callback();
assert.equal(created.length,1);
backdrop.classList.remove("show");callback();
assert.equal(viewer(),null);
assert.equal(revoked.length,1,"Release PDF after cancel/save");
assert.equal(env.pendingImportPDF.file,one,"Viewer does not modify original import state");
const second=fakeFile("holerite.pdf");
show(second);
assert.equal(created[1],second,"Sequential batch must show next PDF");
assert.equal(viewer().children[0].children[0].children[1].textContent,"holerite.pdf");
backdrop.classList.remove("show");callback();
assert.equal(revoked.length,2);
// New manual account has no PDF: existing small modal must remain unchanged.
env.pendingImportPDF=null;env.selected=null;
document.entries.set("accountForm",new Element("form"));
backdrop.classList.add("show");callback();
assert.equal(viewer(),null,"Manual account without a PDF is not forced into split view");
assert.equal(backdrop.classList.contains("nh-pdf-review-split"),false);
// Existing account should load its current PDF through the authenticated origin.
env.accounts=[{id:123,has_pdf:true,observacoes:"BOLETO PAGO"}];env.selected=123;
callback();
const sleep=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  for(let i=0;i<10;i++)await sleep();
  assert.equal(fetched.length,1);
  assert.equal(fetched[0].url,"/central/modules/contas/api/accounts/123/pdf");
  assert.equal(fetched[0].options.headers["X-Local-Token"],"session");
  assert.ok(viewer(),"Viewer must also show existing account PDF");
  assert.equal(created.length,3);
  backdrop.classList.remove("show");callback();
  assert.equal(revoked.length,3,"Viewer revokes downloaded PDF object URL");
  console.log("OK: edição fullscreen com PDF à direita, campos e botões intactos");
  console.log("OK: PDF da memória, fila, arquivo existente, fechar e liberar URL");
})().catch(err=>{console.error(err);process.exitCode=1});
