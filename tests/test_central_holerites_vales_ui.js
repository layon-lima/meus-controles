"use strict";
/* O próprio painel Holerites do CONTAS 4 deve mostrar os vales,
 * sem abrir outro módulo e sem alterar o valor da conta existente. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("central_admin/static/holerites_vales.js","utf8");
const css=fs.readFileSync("central_admin/static/holerites_vales.css","utf8");
const gateway=fs.readFileSync("central_admin/operations_gateway.py","utf8");
const server=fs.readFileSync("central_admin/server.py","utf8");
assert.match(gateway,/\/central\/holerites_vales\.js/);
assert.match(gateway,/\/central\/holerites_vales\.css/);
assert.ok(server.includes('"/holerites_vales.js"'));
assert.ok(server.includes('"/holerites_vales.css"'));
assert.ok(source.includes("MutationObserver"),"Observar renderizações originais sem substituí-las");
assert.ok(source.includes('observer.observe(list,{childList:true})'));
assert.ok(!source.includes('list.innerHTML='),"Nunca substituir a lista de Holerites original");
assert.ok(!source.includes('/api/accounts/') && !source.includes('/api/import/commit'),
  "Nunca fazer pagamento ou salvar holerites através da UI injetada");
assert.ok(css.includes(".nhp-vales-inline"));
assert.ok(source.includes("Reservado — aguarda pagamento"));
assert.ok(source.includes("ainda não descontados"));

const match=(node,selector)=>{
  const s=selector.trim();
  if(s.startsWith("."))return node.className.split(/\s+/).includes(s.slice(1));
  if(s.startsWith("#"))return node.id===s.slice(1);
  if(s.startsWith("[data-")){
    const key=s.slice(6,-1).replace(/-([a-z])/g,(_,v)=>v.toUpperCase());
    return Object.hasOwn(node.dataset,key);
  }
  return false;
};
class E {
  constructor(tag="div"){
    this.tagName=tag;this.className="";this.children=[];this.parentElement=null;
    this.dataset={};this.id="";this.textContent="";this.value="";
    this.disabled=false;this.hidden=false;this.listeners={};
  }
  append(...items){for(const child of items){child.remove();child.parentElement=this;this.children.push(child)}}
  appendChild(child){this.append(child);return child}
  insertBefore(child,before){
    child.remove();const i=this.children.indexOf(before);
    if(i<0)return this.append(child);
    child.parentElement=this;this.children.splice(i,0,child);
  }
  after(child){
    if(!this.parentElement)throw Error("Node without parent");
    const p=this.parentElement,i=p.children.indexOf(this);
    child.remove();child.parentElement=p;p.children.splice(i+1,0,child);
  }
  remove(){if(this.parentElement){
    const a=this.parentElement.children;a.splice(a.indexOf(this),1);
    this.parentElement=null;
  }}
  setAttribute(name,value){this[name]=value}
  addEventListener(name,fn){this.listeners[name]=fn}
  click(){this.listeners.click?.()}
  querySelectorAll(selector){
    const selectors=selector.split(",").map(s=>s.trim());
    const result=[];
    const walk=n=>{
      for(const c of n.children){
        if(selectors.some(s=>match(c,s)))result.push(c);
        walk(c);
      }
    };
    walk(this);return result;
  }
  querySelector(s){return this.querySelectorAll(s)[0]||null}
  closest(selector){
    let curr=this;
    while(curr){if(match(curr,selector))return curr;curr=curr.parentElement}
    return null;
  }
}
function textOf(el){return el.textContent+" "+el.children.map(textOf).join(" ")}
const view=new E("section"),list=new E("div");
list.id="payrollList";view.id="holeritesView";view.hidden=false;
view.append(new E("header"),list);
view.children[0].className="payroll-head";
function person(id,accountId){
  const card=new E("article");card.className="payroll-person";
  const head=new E("div");head.className="payroll-person-head";
  const edit=new E("button");edit.dataset.payrollEdit=String(id);head.append(edit);
  const row=new E("div");row.className="payroll-month";
  const amount=new E("span");amount.className="amount";amount.textContent="R$ 2.550,00";
  const pill=new E("span");pill.className="pill";pill.textContent="Vencida";
  const buttons=new E("div");
  const action=new E("button");action.dataset.payrollAccount=String(accountId);
  buttons.append(action);row.append(amount,pill,buttons);
  card.append(head,row);return {card,head,row,action,amount};
}
const joao=person(1,77),maria=person(2,88);
list.append(joao.card,maria.card);
const originalAction=joao.action;
let observer;
class MutationObserver{
  constructor(cb){observer=cb}
  observe(node,options){assert.equal(node,list);assert.equal(options.subtree,undefined)}
}
let linked=false,posts=0;
const dashboard=()=>({
  ok:true,competencia:"2026-11",
  funcionarios:[
    {id:1,nome:"JOAO DA SILVA",vales_ids:[10],
      totais:{vales_previstos:"0.00",vales_reservados:"450.00",
        vales_atrasados:"25.00",total_a_pagar:"2550.00"},
      parcelas:[
        {id:101,parcela:1,competencia:"2026-11",titulo:"Adiantamento",
          valor:"300.00",ja_descontado:"0",reservado:"300.00",saldo_a_descontar:"0"},
        {id:102,parcela:2,competencia:"2026-11",titulo:"Compra",
          valor:"150.00",ja_descontado:"0",reservado:"150.00",saldo_a_descontar:"0"},
      ],
      descontos:[{conta_id:77,parcela_id:101,competencia:"2026-11",
        original_holerite:"3000.00",valor:"300.00",status:"reserved"},
        {conta_id:77,parcela_id:102,competencia:"2026-11",
        original_holerite:"3000.00",valor:"150.00",status:"reserved"}],
      outras_contas:[],holerites:[{id:77,competencia:"2026-11"}]
    },
    {id:2,nome:"MARIA PEREIRA",vales_ids:linked?[20]:[],
      totais:{vales_previstos:linked?"95.00":"0.00",vales_reservados:"0.00",
        vales_atrasados:"0.00",total_a_pagar:"1200.00"},
      parcelas:linked?[{id:201,parcela:1,competencia:"2026-11",
        titulo:"Vale de Maria",valor:"95.00",ja_descontado:"0",
        reservado:"0",saldo_a_descontar:"95.00"}]:[],
      descontos:[],outras_contas:[],holerites:[{id:88,competencia:"2026-11"}]
    }
  ],
  vales_sem_vinculo:linked?[]:[
    {vale_employee_id:20,nome:"MARIA PEREIRA",vales_previstos:"95.00",
      sugestao_funcionario_id:2}
  ]
});
const visited=[];
const env={
  document:{
    getElementById:id=>id==="payrollList"?list:id==="holeritesView"?view:
      view.querySelector("#"+id),
    createElement:tag=>new E(tag),
    addEventListener(){}
  },
  window:{confirm:()=>true},location:{pathname:"/central/modules/contas/"},
  MutationObserver,Intl,Date,URLSearchParams,Number,Map,console,
  fetch:async(url,config)=>{
    visited.push(url);
    if(config.method==="POST"){
      posts++;
      assert.equal(url,"/central/api/vales-holerites/vincular");
      const payload=JSON.parse(config.body);
      assert.equal(payload.vale_employee_id,20);
      assert.equal(payload.contas_employee_id,2);
      linked=true;
      return {ok:true,json:async()=>({ok:true})};
    }
    return {ok:true,json:async()=>dashboard()};
  }
};
const flush=async()=>{for(let i=0;i<35;i++)await new Promise(resolve=>setImmediate(resolve))};
vm.runInNewContext(source,env);
(async()=>{
  await flush();
  assert.ok(observer,"Observer needed for original app render");
  let vales=joao.card.querySelectorAll(".nhp-vales-inline");
  assert.equal(vales.length,1,"Vales appear directly beneath person's header");
  assert.ok(textOf(vales[0]).includes("450,00"),"Reserved vales visibly summed");
  assert.ok(textOf(vales[0]).includes("Adiantamento")||
    textOf(vales[0]).includes("Ver vales"),"Vales section available in same employee card");
  assert.ok(textOf(joao.amount).includes("3.000,00"),"Original liquid shown below net");
  assert.ok(textOf(joao.amount).includes("450,00"),"Discount shown below net");
  assert.equal(joao.action,originalAction,"Original account action preserved");
  assert.equal(posts,0,"Reading never creates a payment or link");
  await observer();await flush();
  assert.equal(joao.card.querySelectorAll(".nhp-vales-inline").length,1,
    "Rerender does not stack duplicate glass sections");
  const unlinked=maria.card.querySelector(".nhp-link-pending");
  assert.ok(unlinked,"Unlinked vale must be visible on Maria's payroll card");
  assert.ok(textOf(unlinked).includes("95,00"),"Link suggestion reveals the vale amount");
  const button=maria.card.querySelector(".nhp-confirm-link");
  assert.ok(button,"Manual confirmation only");
  button.click();await flush();
  assert.equal(posts,1,"Only explicit click confirms employee mapping");
  assert.ok(textOf(maria.card).includes("95,00"));
  assert.ok(maria.card.querySelector(".nhp-vales-inline") &&
    !maria.card.querySelector(".nhp-link-pending"));
  assert.equal(visited.filter(u=>u.includes("funcionarios/painel")).length>=2,true);
  console.log("OK: vales e descontos aparecem nos próprios cards de Holerites");
  console.log("OK: funcionário sem vínculo recebe sugestão, só confirma após clique");
  console.log("OK: valores originais, ações existentes e consulta sem duplicidade");
})().catch(error=>{console.error(error);process.exitCode=1});
