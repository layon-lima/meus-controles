"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const dir=path.join(__dirname,"..","static");
const app=fs.readFileSync(path.join(dir,"app.js"),"utf8")
  .replace(/App\.initNavigation\(\);\s*App\.load\(\);\s*$/,
      "/* startup suppressed for isolated UI test */");
const pair=fs.readFileSync(path.join(dir,"pair.js"),"utf8");
const nodes={};
function node(id){
  return nodes[id]??(nodes[id]={
    id,innerHTML:"",value:"",textContent:"",style:{},
    classList:{toggle(){}},setAttribute(){},addEventListener(){},
    reportValidity(){return true},remove(){},focus(){}
  });
}
const document={
  getElementById:node,
  querySelectorAll(){return []},
  querySelector(){return null},
  createElement(){return {className:"",textContent:"",remove(){}}},
  addEventListener(){}
};
class FormDataMock{
  constructor(form){this.fields=form.mockFields||{}}
  get(name){return this.fields[name]??""}
}
const browser={
  location:{hash:"",pathname:"/",search:"",href:""},
  history:{state:{index:0,centralNav:1,maxIndex:0},
    replaceState(){},pushState(){},back(){},forward(){}},
  addEventListener(){}
};
const context={document,window:browser,FormData:FormDataMock,
  setTimeout(){},console};
vm.runInNewContext(app+"\n"+pair+"\nglobalThis.__app=App;",context);
const App=context.__app;
const ctl={id:25,name:"FULANO X SICRANO",mode:"acerto_ab"};
const names={party_a:"Fulano",party_b:"Sicrano"};
let data={
  control_id:25,settings:names,
  totals:{balance:"-500.00",a_to_b:"1000.00",b_to_a:"200.00",
    payments_a_to_b:"300.00",payments_b_to_a:"0.00",
    payment_count:1,debt_count:2,opening_balance:"0.00",
    settlement:{debtor:"Fulano",creditor:"Sicrano",amount:"500.00"}},
  entries:[
    {id:1,entry_date:"2026-10-01",debtor:"A",amount:"1000.00",description:"A pegou produtos",notes:""},
    {id:2,entry_date:"2026-10-02",debtor:"B",amount:"200.00",description:"B pegou peças",notes:"",entry_kind:"debt"},
    {id:3,entry_date:"2026-10-03",debtor:"A",amount:"300.00",description:"A pagou PIX",notes:"",entry_kind:"payment"}
  ],closures:[],current_from:null
};
data.history=data.entries;
App.s.detail={control:ctl};
App.s.state={boards:[{id:1,name:"PASTA"}],controls:[ctl]};
App.s.route="control";App.s.id=25;
App.canOpenForm=()=>true;
App.closeModal=()=>{App.s.modal=null;App.s.modalContext=null;node("modalRoot").innerHTML=""};
App.load=async()=>{};
App.toast=()=>{};
const calls=[];
App.api=async(url,method="GET",body)=>{
  calls.push({url,method,body});
  if(url==="/api/controls/25/pair" && method==="GET")return data;
  if((url==="/api/controls/25/pair/entries" && method==="POST")||
      (url.startsWith("/api/pair-entries/")&&method==="PUT"))return {id:7};
  throw Error("Unexpected API "+method+" "+url);
};

async function run(){
  await App.renderPair();
  const html=node("main").innerHTML;
  assert.doesNotMatch(html,/Pagamentos reais:/);
  assert.doesNotMatch(html,/Saldo trazido do último fechamento/);
  assert.match(html,/Resumos detalhados/);
  assert.match(html,/500,00/);
  assert.match(html,/Dívida \/ compensação/);
  assert.match(html,/Pagamento real/);
  assert.match(html,/A pagou PIX/);
  assert.match(html,/Fulano/);
  assert.match(html,/Registrar pagamento/);
  assert.match(html,/Nova dívida/);

  App.pairSelectTab("details");
  const details=node("main").innerHTML;
  assert.match(details,/Resumos detalhados do acerto/);
  assert.match(details,/Dívidas: Fulano → Sicrano/);
  assert.match(details,/Pagamentos reais: Fulano → Sicrano/);
  assert.match(details,/Pagamentos reais: Sicrano → Fulano/);
  assert.match(details,/Saldo trazido do último fechamento/);
  assert.match(details,/300,00/);
  assert.doesNotMatch(details,/A pagou PIX/);
  App.pairSelectTab("closures");
  assert.doesNotMatch(node("main").innerHTML,/class="ab-stats"/);
  App.pairSelectTab("entries");
  assert.match(node("main").innerHTML,/A pagou PIX/);
  assert.doesNotMatch(node("main").innerHTML,/class="ab-stats"/);

  App.pairEntryForm(null,"payment");
  const form=node("modalRoot").innerHTML;
  assert.match(form,/value="payment" selected/);
  assert.match(form,/Quem pagou para quem\?/);
  assert.match(form,/Fulano pagou a Sicrano/);
  assert.match(form,/name="kind"/);
  assert.doesNotMatch(form,/pagamento real.*quitado/i);
  node("abEntryForm").mockFields={
    date:"2026-10-10",kind:"payment",debtor:"A",
    amount:"300",description:"PIX enviado",notes:"Comprovante"
  };
  await App.pairSaveEntry();
  assert.equal(calls.at(-2).url,"/api/controls/25/pair/entries");
  assert.equal(calls.at(-2).body.kind,"payment");
  assert.equal(calls.at(-2).body.payer,"A");
  assert.equal(calls.at(-2).body.debtor,undefined);

  App.pairEntryForm(3);
  assert.match(node("modalRoot").innerHTML,/Editar lançamento/);
  assert.match(node("modalRoot").innerHTML,/value="payment" selected/);
  node("abEntryForm").mockFields={
    date:"2026-10-04",kind:"payment",debtor:"B",
    amount:"75",description:"PIX corrigido",notes:""
  };
  await App.pairSaveEntry();
  assert.ok(calls.some(x=>x.url==="/api/pair-entries/3"&&x.body.payer==="B"));

  App.pairEntryForm(null,"debt");
  assert.match(node("modalRoot").innerHTML,/Quem deve para quem\?/);
  assert.match(node("modalRoot").innerHTML,/value="debt" selected/);
  node("abKind").value="payment";
  node("abParty").options=[{textContent:""},{textContent:""}];
  App.pairKindChanged();
  assert.equal(node("abPartyLabel").textContent,"Quem pagou para quem?");
  assert.equal(node("abParty").options[0].textContent,"Fulano pagou a Sicrano");
  assert.equal(node("abParty").options[1].textContent,"Sicrano pagou a Fulano");
  console.log("OK: dívidas e pagamentos reais separados, direção dinâmica, edição e envio");
}
run().catch(error=>{console.error(error);process.exitCode=1});
