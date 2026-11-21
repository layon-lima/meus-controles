"use strict";
/* Executa a UI de vales no DOM simulado: o líquido usado pelo CONTAS
 * recebe o desconto escolhido e o PDF original não é alterado. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("central_admin/static/vales_holerites.js","utf8");
const css=fs.readFileSync("central_admin/static/vales_holerites.css","utf8");
assert.ok(css.includes(".nh-vales-payroll"),"Painel visual deve existir");
assert.ok(source.includes('field("nh_vales")'),"A seleção precisa ir junto do cadastro");
assert.ok(source.includes("cotacao?"),"Cálculo deve ser consultado no servidor");
assert.ok(!source.includes("/api/import/commit"),"A UI não pode cadastrar contas por conta própria");
assert.ok(!source.includes("pay-with-receipt"),"A UI não pode confirmar pagamento sem usuário");

const all=new Map();
class E {
  constructor(tag="div"){
    this.tagName=tag;this.children=[];this.parent=null;this.listeners={};
    this.className="";this.id="";this.name="";this.value="";
    this.type="";this.checked=false;this.readOnly=false;this.hidden=false;
    this.isConnected=true;this.textContent="";this.dataset={};
    this._classes=new Set();
    this.classList={
      add:x=>this._classes.add(x),
      remove:x=>this._classes.delete(x),
      contains:x=>this._classes.has(x)
    };
  }
  append(...items){for(const item of items){this.children.push(item);item.parent=this;item.isConnected=true;
    if(item.id)all.set(item.id,item)}}
  appendChild(item){this.append(item);return item}
  replaceChildren(...children){for(const child of this.children)child.isConnected=false;
    this.children=[];this.append(...children)}
  setAttribute(name,v){this[name]=String(v)}
  addEventListener(name,fn){this.listeners[name]=fn}
  querySelector(selector){
    const found=child=>{
      for(const n of child.children){
        if(selector.startsWith(".") && n.className.split(" ").includes(selector.slice(1)))return n;
        const nested=found(n);if(nested)return nested;
      }return null;
    };
    return found(this);
  }
}
const control=(id,value)=>{const e=new E("input");e.id=id;e.value=value;all.set(id,e);return e};
const body=new E("body"),overlay=control("backdrop",""),form=control("accountForm","");
overlay.classList.add("show");
form.tagName="form";
const payrollType=control("isHolerite","sim");
const payrollPick=control("payrollEmployeePick","1");
const payrollMonth=control("payrollCompetence","2026-11");
const dialogTitle=control("dialogTitle","");dialogTitle.textContent="Conferir leitura do PDF";
function input(name,value){
  const e=new E("input");e.name=name;e.value=value;form.append(e);return e;
}
const salary=input("valor","3000.00");
input("fornecedor","JOAO DA SILVA");
input("funcionario_id","1");
input("funcionario_nome","JOAO DA SILVA");
input("competencia","2026-11");
form.elements={namedItem:name=>{
  const walk=el=>{
    if(el.name===name)return el;
    for(const child of el.children){const found=walk(child);if(found)return found}
    return null;
  };
  return walk(form);
}};
const base={
  funcionarios_contas:[{id:1,nome:"JOAO DA SILVA"}],
  funcionarios_vales:[{id:7,name:"JOAO DA SILVA",control_id:4,
    contas_employee_id:1,active:true}]
};
const quotes={
  competencia:"2026-11",original:"3000.00",desconto:"450.00",valor_pagar:"2550.00",
  parcelas:[
    {id:71,amount:"300.00",installment:1,due_month:"2026-11",title:"Adiantamento"},
    {id:72,amount:"150.00",installment:2,due_month:"2026-11",title:"Compras"}
  ],
  atrasadas:[],selecionadas:[71,72]
};
const requests=[];
let callback;
class MutationObserver {
  constructor(fn){callback=fn}
  observe(){}
}
const document={
  body,createElement:tag=>new E(tag),
  getElementById:id=>all.get(id)||null
};
const window={
  setTimeout(){},
  addEventListener(){},
  confirm(){return true}
};
const context={
  document,window,location:{pathname:"/central/modules/contas/"},
  MutationObserver,URLSearchParams,Number,JSON,String,Set,Intl,
  fetch:async(path,options)=>{
    requests.push(path);
    const data=path.includes("funcionarios")?base:
      path.includes("cotacao")?quotes:{ok:true};
    return {ok:true,json:async()=>data};
  },
  console
};
vm.runInNewContext(source,context);
const run=async()=>{
  for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  const section=all.get("nh-vales-payroll");
  assert.ok(section,"O painel aparece dentro do formulário de holerite");
  assert.ok(requests.some(x=>x.includes("/funcionarios")));
  assert.ok(requests.some(x=>x.includes("/cotacao?")));
  assert.equal(salary.value,"2550.00");
  assert.equal(salary.readOnly,true);
  const meta=form.elements.namedItem("nh_vales");
  assert.ok(meta.value,"A seleção precisa ser enviada no mesmo JSON original");
  assert.equal(JSON.parse(meta.value).original,"3000.00");
  assert.deepEqual([...JSON.parse(meta.value).selecionadas],[71,72]);
  assert.ok(section.querySelector(".nh-vales-total").textContent.includes("2.550,00"));
  const rows=section.querySelector(".nh-vales-installments").children;
  assert.equal(rows.length,2);
  rows[0].children[0].checked=false;
  rows[0].children[0].listeners.change();
  assert.equal(salary.value,"2850.00","Desmarcar parcela atualiza líquido");
  assert.deepEqual([...JSON.parse(meta.value).selecionadas],[72]);
  payrollType.value="nao";
  payrollType.listeners.change();
  assert.equal(salary.value,"3000.00","Conta normal mantém valor original");
  assert.equal(meta.value,"");
  assert.equal(section.hidden,true);
  console.log("OK: holerite com vale calcula R$ 3.000,00 - R$ 450,00 = R$ 2.550,00");
  console.log("OK: seleção parcial, líquido original e conta comum sem desconto");
};
run().catch(e=>{console.error(e);process.exitCode=1});
