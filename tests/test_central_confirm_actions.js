"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("central_admin/static/confirm-actions.js","utf8");
const sent=[],dialogs=[];
let respond;
class Element{
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.isConnected=true;}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  get firstElementChild(){return this.children[0]}
  querySelector(selector){return this.children.find(x=>x.className===selector.slice(1));}
  setAttribute(){}
  addEventListener(name,fn){this.listeners[name]=fn;}
  focus(){}
  showModal(){dialogs.push(this);}
  close(){}
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
}
const document={body:new Element("body"),activeElement:null,createElement:tag=>new Element(tag),getElementById:id=>document.body.children.find(x=>x.id===id)};
const window={location:new URL("https://example.test/central/modules/recebimentos/"),
  fetch:async(input,init)=>{sent.push([input,init]);return respond();}};
vm.runInNewContext(source,{window,document,URL,Promise,Error,Set,setTimeout:()=>1,clearTimeout:()=>{}});
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
const reply=(status,data,type="application/json")=>({
  status,ok:status>=200&&status<300,headers:{get:()=>type},
  clone(){return {json:async()=>data}},json:async()=>data
});
const notices=()=>document.getElementById("nh-operation-notices")?.children||[];
const last=()=>notices().at(-1);
(async()=>{
  respond=()=>Promise.resolve(reply(200,{ok:true}));
  await window.fetch(root+"contas/api/accounts");
  assert.equal(sent.length,1);
  assert.equal(notices().length,0);
  let resolve;
  respond=()=>new Promise(r=>{resolve=r});
  const pending=window.fetch(examples[0][0],post);
  assert.equal(sent.length,2,"A escrita é enviada imediatamente, sem confirmação prévia");
  assert.equal(dialogs.length,0);
  assert.equal(notices().length,0,"Não confirmar antes de resposta");
  const success=reply(201,{ok:true,id:7});
  resolve(success);
  assert.equal(await pending,success,"Preservar a resposta original");
  assert.equal(last().children[1].textContent,"Operação concluída com sucesso.");
  assert.ok(!last().className.includes("is-error"));
  window.NHFeedback.notify("Conta cadastrada.");
  assert.equal(notices().length,1,"Mensagem específica substitui a genérica");
  assert.equal(last().children[1].textContent,"Conta cadastrada.");
  respond=()=>Promise.resolve(reply(200,{ok:false,error:"Saldo insuficiente."}));
  await window.fetch(examples[4][0],post);
  assert.ok(last().className.includes("is-error"));
  assert.equal(last().children[1].textContent,"Saldo insuficiente.");
  respond=()=>Promise.resolve(reply(500,{error:"Erro interno"}));
  await window.fetch(examples[2][0],post);
  assert.ok(last().className.includes("is-error"));
  respond=()=>Promise.resolve(reply(200,null,"text/html"));
  await window.fetch(examples[2][0],post);
  assert.match(last().children[1].textContent,/não foi possível confirmar/);
  respond=()=>Promise.reject(new Error("Sem conexão"));
  await assert.rejects(window.fetch(examples[2][0],post),/Sem conexão/);
  assert.match(last().children[1].textContent,/verificar o resultado/);
  respond=()=>Promise.resolve(reply(200,{ok:true}));
  const before=last();
  await window.fetch(root+"recebimentos/api/controls/7/receiving/xml/preview",post);
  assert.equal(last(),before,"Prévia não gera aviso de gravação");
  await window.fetch(examples[2][0],post);
  assert.equal(last().children[1].textContent,"Exclusão concluída com sucesso.");
  assert.equal(dialogs.length,0);
  console.log("OK: aviso somente após a resposta, sucesso, falha, rede e consultas sem pergunta prévia");
})().catch(e=>{console.error(e);process.exitCode=1});
