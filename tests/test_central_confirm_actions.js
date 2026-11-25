"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("central_admin/static/confirm-actions.js","utf8");
const sent=[],dialogs=[];
class Element{
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.isConnected=true;}
  append(...children){this.children.push(...children);}
  setAttribute(){}
  addEventListener(name,fn){this.listeners[name]=fn;}
  focus(){}
  showModal(){dialogs.push(this);}
  close(){}
  remove(){this.isConnected=false;}
}
const document={body:new Element("body"),activeElement:null,createElement:tag=>new Element(tag)};
const window={location:new URL("https://example.test/central/modules/recebimentos/"),
  fetch:async(input,init)=>{sent.push([input,init]);return {ok:true};}};
vm.runInNewContext(source,{window,document,URL,Promise,Error,Set});
const classify=window.NHConfirm.operation;
const post={method:"POST"};
const root="/central/modules/";
const examples=[
 [root+"contas/api/accounts",post],[root+"contas/api/accounts/7/pay",post],
 [root+"contas/api/accounts/7/delete",post],[root+"documentos/api/accounts/8/upload-pdf",post],
 [root+"recebimentos/api/controls/7/receiving/xml/confirm",post],
 [root+"recebimentos/api/controls/7/receiving/pdf/confirm",post],
 [root+"controles/api/controls/1/entries",post],[root+"controles/api/entries/9",{method:"PUT"}],
 [root+"transportadoras/api/truck-entries/9",{method:"DELETE"}],
 [root+"controles/api/vales-installments/4/payments",post],
 ["/central/api/funcionarios/pix",post],["/central/api/vales-holerites/vincular",post]
];
for(const [path,init] of examples)assert.ok(classify(path,init),path);
for(const path of [root+"contas/api/import/preview",root+"contas/api/export/excel",
 root+"recebimentos/api/controls/7/receiving/xml/preview",
 root+"recebimentos/api/controls/7/receiving/pdf/region",
 "/central/api/recebimentos/resumo.xlsx","/central/api/pair"])assert.equal(classify(path,post),null,path);
assert.equal(classify(root+"contas/api/accounts"),null);
assert.equal(classify("https://other.test/central/api/funcionarios/pix",post),null);
(async()=>{
  await window.fetch(root+"contas/api/accounts");
  assert.equal(sent.length,1);
  const pending=window.fetch(examples[0][0],post);
  await Promise.resolve();await Promise.resolve();
  assert.equal(sent.length,1,"Não enviar antes da confirmação");
  assert.equal(dialogs.length,1);
  dialogs[0].children[2].children[1].listeners.click();
  await pending;assert.equal(sent.length,2);
  const cancelled=window.fetch(examples[2][0],post);
  const rejection=assert.rejects(cancelled,{name:"NHOperationCancelled"});
  await new Promise(resolve=>setImmediate(resolve));
  dialogs[1].children[2].children[0].listeners.click();
  await rejection;assert.equal(sent.length,2,"Cancelar nunca envia escrita");
  console.log("OK: confirmar, cancelar e isentar consultas/prévias/exportações em todos os módulos");
})().catch(e=>{console.error(e);process.exitCode=1});
