"use strict";
/* Funcionários: somente saldo a pagar e vales pendentes, sem histórico pago,
 * links para contas, busca de vínculos ou baixa automática. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const src=fs.readFileSync("central_admin/static/funcionarios.js","utf8");
const html=fs.readFileSync("central_admin/static/funcionarios.html","utf8");
const css=fs.readFileSync("central_admin/static/funcionarios.css","utf8");
const home=fs.readFileSync("central_admin/static/index.html","utf8");
assert.ok(html.includes('id="staffList"'));
assert.ok(html.includes("/central/funcionarios.js"));
assert.ok(home.includes('id="moduleEmployeeMoney"'));
assert.ok(css.includes(".nhf-kpis")&&css.includes(".nhf-open-table"));
assert.ok(src.includes("openAmounts(person)")&&src.includes("makeTable(person)"));
for(const removed of ["Abrir no Contas","Buscar contas","Confirmar vínculo",
  "renderAccountFinder(","renderSuggested(","Holerites pagos","Ver histórico de"]){
  assert.ok(!src.includes(removed),"Não apresentar ação/histórico antigo: "+removed);
}
assert.ok(!html.includes('id="unlinkedSection"'));
assert.ok(!html.includes('id="competence"'));
assert.ok(!html.includes('id="metricPaid"'));
assert.ok(!html.includes('class="nhf-explanation"'));
assert.ok(!html.includes('class="nhf-subtitle"'));
assert.ok(!html.includes('class="nhf-footer"'));
assert.ok(!html.includes("Somente lançamentos não pagos"));
assert.ok(!src.includes('balance.pagar,"primary"'));
assert.ok(src.includes('balance.pagar,"payable"'));
assert.ok(css.includes(".nhf-staff-summary .nhf-stat{background:transparent!important"));

class E{
  constructor(tag="div"){
    this.tagName=tag;this.id="";this.textContent="";this.value="";
    this.className="";this.dataset={};this.children=[];this.listeners={};
    this.hidden=false;this.disabled=false;this.attributes={};
    this.classList={
      tokens:new Set(),
      add(...keys){keys.forEach(v=>this.tokens.add(v))},
      remove(...keys){keys.forEach(v=>this.tokens.delete(v))},
      contains(v){return this.tokens.has(v)},
      toggle(v,enabled){
        if(enabled===undefined)enabled=!this.tokens.has(v);
        enabled?this.tokens.add(v):this.tokens.delete(v);return enabled;
      }
    };
  }
  append(...items){this.children.push(...items);return this}
  replaceChildren(...items){this.children=[...items]}
  setAttribute(key,val){this.attributes[key]=val}
  addEventListener(name,fn){this.listeners[name]=fn}
  click(){this.listeners.click?.()}
}
const nodes=new Map();
for(const id of ["refresh","staffList","search","statusFilter","metricPeople",
    "metricTotal","metricVales","listSubtitle","toast","managePix","closePix","pixPanel","pixList"]){
  const el=new E();el.id=id;nodes.set(id,el);
}
const find=(el,id)=>{
  if(el.id===id)return el;
  for(const child of el.children){const hit=find(child,id);if(hit)return hit}
  return null;
};
const text=el=>[el.textContent,...el.children.map(text)].join(" ");
const person1={
  id:1,nome:"REGINALDO VIANA DE SOUZA",origem_cadastro:"contas",chave_pix:"teste@example.com",
  holerites:[
    {id:1,competencia:"2026-10",valor:"4009.00",vencimento:"2026-10-01",paga:true},
    {id:2,competencia:"2026-11",valor:"2215.50",vencimento:"2026-11-18",paga:false},
    {id:3,competencia:"2026-09",valor:"101.00",vencimento:"2026-09-18",paga:false}
  ],
  outras_contas:[],
  parcelas:[
    {id:12,titulo:"Vale em dezembro",parcela:1,competencia:"2026-12",
      valor:"200.00",ja_descontado:"0.00",reservado:"0.00",saldo_a_descontar:"200.00"},
    {id:13,titulo:"Vale já pago",parcela:1,competencia:"2026-11",
      valor:"500.00",ja_descontado:"500.00",reservado:"0.00",saldo_a_descontar:"0.00"},
    {id:14,titulo:"Vale reservado",parcela:1,competencia:"2026-11",
      valor:"80.00",ja_descontado:"0.00",reservado:"80.00",saldo_a_descontar:"0.00"}
  ]
};
const person2={
  id:2,nome:"JOAO SEM PENDENCIAS",holerites:[
    {id:4,competencia:"2026-11",valor:"1111.00",paga:true}
  ],outras_contas:[],parcelas:[]
};
const person3={
  id:-3,nome:"RAFAEL",origem_cadastro:"vales",holerites:[],outras_contas:[],
  parcelas:[{id:21,titulo:"Vale com Jonas",parcela:1,competencia:"2026-12",
    saldo_a_descontar:"500.00"}]
};
const fixtures={ok:true,competencia:"2026-11",
  funcionarios:[person1,person2,person3]};
const requests=[];
const context={
  document:{
    createElement:tag=>new E(tag),
    getElementById:id=>nodes.get(id)||find(nodes.get("staffList"),id)
  },
  location:{pathname:"/central/modules/funcionarios/"},
  window:{confirm:()=>true},
  Intl,Number,Map,Set,URLSearchParams,console,
  fetch:async(uri,options)=>{
    requests.push({uri,method:options?.method||"GET"});
    return {ok:true,json:async()=>fixtures};
  }
};
vm.runInNewContext(src,context);
(async()=>{
  for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get("metricPeople").textContent,"2");
  assert.match(nodes.get("metricTotal").textContent,/2\.316,50/);
  assert.match(nodes.get("metricVales").textContent,/700,00/);
  assert.ok(requests[0].uri.endsWith("/funcionarios/painel"));
  const cards=nodes.get("staffList").children.filter(e=>e.className==="nhf-staff");
  assert.equal(cards.length,3);
  const reg=cards.find(x=>x.dataset.personId==="1");
  assert.ok(reg);
  assert.ok(!reg.hidden);
  assert.match(text(reg.children[0]),/2\.316,50/);
  assert.match(text(reg.children[0]),/200,00/);
  assert.ok(!text(reg.children[0]).includes("valor(es) a pagar"));
  const paid=cards.find(x=>x.dataset.personId==="2");
  assert.equal(paid.hidden,true,"Funcionário só com pagamentos quitados não aparece no filtro padrão");
  const pureVale=cards.find(x=>x.dataset.personId==="-3");
  assert.equal(pureVale.hidden,false,"Funcionário exclusivo de Vales aparece se tem saldo");

  const detail=reg.children[1];
  assert.equal(detail.hidden,true,"Detalhes começam recolhidos");
  assert.equal(detail.children.length,0,"Sem renderização desnecessária");
  reg.children[0].click();
  assert.equal(detail.hidden,false);
  assert.equal(detail.children.length,1);
  assert.match(text(detail),/Vale em dezembro/);
  assert.match(text(detail),/Holerite/);
  assert.ok(!text(detail).includes("Vale já pago"));
  assert.ok(!text(detail).includes("Vale reservado"));
  assert.ok(!text(detail).includes("4.009,00"));
  const tbody=detail.children[0].children.find(x=>x.tagName==="table")
    .children.find(x=>x.tagName==="tbody");
  assert.equal(tbody.children.length,3,"Duas contas não pagas e um vale disponível");
  reg.children[0].click();reg.children[0].click();
  assert.equal(detail.children.length,1,"Reabrir não duplica linhas");

  nodes.get("search").listeners.input({target:{value:"RAFAEL"}});
  assert.equal(reg.hidden,true);
  assert.equal(pureVale.hidden,false);
  nodes.get("search").listeners.input({target:{value:""}});
  nodes.get("statusFilter").listeners.change({target:{value:"all"}});
  assert.equal(paid.hidden,false,"Todos pode mostrar cadastro sem saldo, mas não histórico pago");
  paid.children[0].click();
  assert.equal(text(paid.children[1]).includes("1.111,00"),false);
  assert.equal(requests.filter(x=>x.method==="POST").length,0,
    "Consultar nunca deve criar vínculo, baixa nem pagamento");
  assert.ok(html.includes('href="#pixPanel"'));
  assert.ok(!/<section id="pixPanel"[^>]*\bhidden\b/.test(html));
  assert.equal(nodes.get("pixPanel").hidden,false);
  assert.equal(nodes.get("pixList").children.length,2,"Gerenciar todos os cadastrados, inclusive sem pendências");
  const pixRow=nodes.get("pixList").children.find(x=>x.children[0].textContent===person1.nome);
  assert.equal(pixRow.children[1].type,"password");
  pixRow.children[2].children[0].click();
  assert.equal(pixRow.children[1].type,"text");
  assert.equal(nodes.get("pixList").children.length,2,"Painel permanente independe do filtro e do clique");
  assert.ok(html.includes('href="#staffTop"'));
  console.log("OK: saldos globais em aberto, vales futuros e vencidos, nenhum pagamento antigo");
  console.log("OK: só leitura, sem busca/vínculo/abrir Contas, fichas sob demanda");
})().catch(e=>{console.error(e);process.exitCode=1});
