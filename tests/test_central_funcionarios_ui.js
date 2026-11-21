"use strict";
/* A tela nativa deve renderizar dados concretos e montar detalhes somente
 * quando o usuário expandir um funcionário, sem executar pagamentos. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const src=fs.readFileSync("central_admin/static/funcionarios.js","utf8");
const html=fs.readFileSync("central_admin/static/funcionarios.html","utf8");
const home=fs.readFileSync("central_admin/static/index.html","utf8");
const homeJs=fs.readFileSync("central_admin/static/app.js","utf8");
const css=fs.readFileSync("central_admin/static/funcionarios.css","utf8");
assert.ok(html.includes('id="staffList"'));
assert.ok(html.includes("/central/funcionarios.js"));
assert.ok(!html.includes("/central/modules/funcionarios/app.js"));
assert.ok(home.includes('id="moduleEmployeeMoney"'));
assert.ok(homeJs.includes("refreshEmployeesHome()"));
assert.ok(css.includes(".nhf-kpis") && css.includes(".nhf-staff"));
assert.ok(src.includes("renderPayroll(") && src.includes("renderVales("));
assert.ok(src.includes("renderDiscounts(") && src.includes("renderOther("));
assert.ok(src.includes("renderAccountFinder("));
assert.ok(src.includes("state.cards.set"),"Um card deve ser construído apenas uma vez");
assert.ok(src.includes('if(details.dataset.loaded==="1")return'),
  "Os detalhes não podem ser renderizados antes de abrir o card");
assert.ok(!src.includes("/api/accounts/")||!src.includes("/pay"),
  "A tela consolidada não deve executar pagamento");
let assigned=0;
class E{
  constructor(tag="div"){
    this.tagName=tag;this.id="";this.textContent="";this.value="";
    this.className="";this.dataset={};this.children=[];this.listeners={};
    this.hidden=false;this.disabled=false;this.attributes={};
    this.classList={
      tokens:new Set(),
      add(...k){k.forEach(v=>this.tokens.add(v))},
      remove(...k){k.forEach(v=>this.tokens.delete(v))},
      contains(v){return this.tokens.has(v)},
      toggle(v,enabled){
        if(enabled===undefined)enabled=!this.tokens.has(v);
        enabled?this.tokens.add(v):this.tokens.delete(v);return enabled;
      }
    };
  }
  append(...children){this.children.push(...children);return this}
  replaceChildren(...children){this.children=[...children]}
  setAttribute(k,v){this.attributes[k]=v}
  addEventListener(name,fn){this.listeners[name]=fn}
  querySelector(){return null}
  click(){this.listeners.click?.()}
}
const nodes=new Map();
for(const id of ["competence","refresh","staffList","search","statusFilter",
  "metricPeople","metricPayroll","metricVales","metricTotal","metricPaid",
  "payrollSubtitle","listSubtitle","unlinkedSection","unlinkedCount","unlinkedList","toast"]){
  const el=new E("div");el.id=id;nodes.set(id,el);
}
const fixtures={
  ok:true,competencia:"2026-11",
  indicadores:{
    funcionarios:2,funcionarios_com_pagamentos:1,holerites_mes:2,
    holerites_pendentes_mes:1,holerites_pagos_mes:1,
    vales_a_descontar:"85.00",vales_ja_reservados:"450.00",
    total_a_pagar:"2550.00"
  },
  funcionarios:[
    {
      id:1,nome:"JOAO DA SILVA",chave_pix:"11999999999",pix_cadastrado:true,
      vales_ids:[10],
      totais:{holerites_pendentes_mes:1,total_a_pagar:"2550.00",
        vales_previstos:"0.00",vales_reservados:"450.00",sugestoes_contas:1},
      holerites:[{id:77,competencia:"2026-11",fornecedor:"JOAO DA SILVA",
        valor:"2550.00",vencimento:"2026-11-30",paga:false}],
      outras_contas:[],
      sugestoes:[{id:91,fornecedor:"JOAO DA SILVA",valor:"99.00",
                  vencimento:"2026-11-22",paga:false}],
      parcelas:[{id:101,vale_id:10,control_id:4,titulo:"Adiantamento",
        parcela:1,competencia:"2026-11",valor:"300.00",
        ja_descontado:"0.00",reservado:"300.00",saldo_a_descontar:"0.00"}],
      descontos:[{conta_id:77,parcela_id:101,competencia:"2026-11",
        original_holerite:"3000.00",valor:"300.00",status:"reserved",erro:""}]
    },
    {id:2,nome:"MARIA PEREIRA",chave_pix:"",pix_cadastrado:false,
      vales_ids:[],holerites:[],outras_contas:[],sugestoes:[],parcelas:[],
      descontos:[],totais:{holerites_pendentes_mes:0,total_a_pagar:"0.00",
        vales_previstos:"0.00",vales_reservados:"0.00",sugestoes_contas:0}}
  ],
  vales_sem_vinculo:[]
};
const requests=[];
const win={setTimeout:()=>1,clearTimeout(){},confirm:()=>true};
const context={
  document:{createElement:tag=>new E(tag),getElementById:id=>nodes.get(id)},
  location:{pathname:"/central/modules/funcionarios/"},
  window:win,navigator:{clipboard:{writeText:async()=>{}}},
  Intl,Date,Number,Map,Set,URLSearchParams,console,
  fetch:async(uri,options)=>{
    requests.push({uri,method:options?.method||"GET"});
    return {ok:true,json:async()=>fixtures};
  }
};
vm.runInNewContext(src,context);
(async()=>{
  for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get("metricPeople").textContent,"1");
  assert.equal(nodes.get("metricPayroll").textContent,"1");
  assert.ok(nodes.get("metricVales").textContent.includes("85,00"));
  assert.ok(nodes.get("metricTotal").textContent.includes("2.550,00"));
  assert.ok(requests[0].uri.includes("/central/api/funcionarios/painel?"));
  assert.equal(requests.filter(x=>x.method==="POST").length,0,"Não pagar ou vincular automaticamente");
  const cards=nodes.get("staffList").children.filter(x=>x.className==="nhf-staff");
  assert.equal(cards.length,2);
  const joao=cards.find(x=>x.dataset.personId==="1");
  assert.ok(joao);
  const detail=joao.children[1];
  assert.equal(detail.hidden,true);
  assert.equal(detail.children.length,0,"Todos os detalhes devem ser lazy");
  joao.children[0].click();
  assert.equal(detail.hidden,false);
  assert.equal(detail.dataset.loaded,"1");
  assert.ok(detail.children.length>0);
  assert.equal(joao.children[0].attributes["aria-expanded"],"true");
  joao.children[0].click();joao.children[0].click();
  assert.equal(detail.children.length,2,"Reabrir não duplica detalhes");
  nodes.get("search").listeners.input({target:{value:"MARIA"}});
  assert.equal(joao.hidden,true,"Filtro funciona sem consultar os bancos novamente");
  assert.equal(cards.find(x=>x.dataset.personId==="2").hidden,false);
  assert.equal(requests.filter(x=>x.method==="POST").length,0);
  console.log("OK: visão nativa de Funcionários, KPIs reais, busca e detalhes sob demanda");
  console.log("OK: valor líquido já ajustado, vales separados, sem pagamento automático");
})().catch(e=>{console.error(e);process.exitCode=1});
