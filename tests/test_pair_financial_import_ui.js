"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const dir=path.join(__dirname,"..","static");
const app=fs.readFileSync(path.join(dir,"app.js"),"utf8")
  .replace(/App\.initNavigation\(\);\s*App\.load\(\);\s*$/,"");
const pair=fs.readFileSync(path.join(dir,"pair.js"),"utf8");
const neutral=fs.readFileSync(path.join(dir,"pair_records.js"),"utf8");
const financial=fs.readFileSync(path.join(dir,"pair_financial_import.js"),"utf8");
const nodes={};
function node(id){return nodes[id]??(nodes[id]={id,innerHTML:"",value:"",files:[],checked:false,
  disabled:false,textContent:"",style:{},classList:{toggle(){}},setAttribute(){},
  addEventListener(){},remove(){},focus(){},reportValidity(){return true}})}
const document={getElementById:node,querySelectorAll(){return []},
  createElement(){return {className:"",textContent:"",remove(){}}},addEventListener(){}};
const browser={location:{href:"",hash:"",search:"",pathname:"/"},
  history:{state:{index:0,maxIndex:0,centralNav:1},
    replaceState(){},pushState(){},back(){},forward(){}},addEventListener(){}};
class FakeFormData{constructor(x){this.data=x.fakeData||{}}get(k){return this.data[k]??""}}
const context={document,window:browser,FormData:FakeFormData,confirm(){return true},
  setTimeout(){},console};
vm.runInNewContext(app+"\n"+pair+"\n"+neutral+"\n"+financial+"\nglobalThis.testApp=App;",context);
const App=context.testApp;
const ctl={id:22,name:"JONAS X MARCOS",mode:"acerto_ab",board_id:1};
const sample={
 format:"central-pair-financial-v1",source_name:"TESTE",
 target:{party_a:"JONAS",party_b:"MARCOS"},
 movements:[
  {source_row:1,date:null,kind:"debt",person:"A",amount:"114000.00",
    description:"RECEBEDOR - CRÉDITO",original_type:"ENTRADA",date_raw:""},
  {source_row:55,date:"1900-05-13",kind:"payment",person:"A",amount:"134.90",
    description:"RECEBEDOR - DESPESA",original_type:"SAÍDA",date_raw:"13/05/1900"}
 ]};
let summary={control_id:22,settings:{party_a:"JONAS",party_b:"MARCOS"},
  totals:{balance:"0.00",settlement:{debtor:null,creditor:null,amount:"0.00"},
    a_to_b:"0.00",b_to_a:"0.00",payments_a_to_b:"0.00",
    payments_b_to_a:"0.00",opening_balance:"0.00"},
  entries:[],history:[],records:[],closures:[]};
App.s.state={boards:[{id:1,name:"ACERTOS"}],controls:[ctl]};
App.s.route="control";App.s.id=22;App.s.detail={control:ctl};App.s.pairData=summary;
// Exercita a proteção real de formulários, inclusive na transição de importação.
App.closeModal=()=>{App.s.modal=null;App.s.modalContext=null;node("modalRoot").innerHTML=""};
App.renderPair=async()=>{};
App.load=async()=>{};
const notices=[],calls=[];
App.toast=x=>notices.push(x);
App.api=async (url,method,body)=>{
 calls.push({url,method,body});
 if(url.endsWith("/financial-import/preview"))return{
  source_name:"TESTE",count:2,debt_count:1,payment_count:1,
  debt_total:"114000.00",payment_total:"134.90",
  batch_id:"digest",new_count:2,already_imported:0,
  missing_dates:[{source_row:1,description:"RECEBEDOR - CRÉDITO"}],
  unusual_dates:[{source_row:55,date:"1900-05-13",description:"RECEBEDOR - DESPESA"}]
 };
 if(url.endsWith("/financial-import/confirm"))return{
  inserted:2,skipped:0,balance:"-113865.10",
  settlement:{debtor:"JONAS",creditor:"MARCOS",amount:"113865.10"}
 };
 throw Error("Unexpected endpoint "+url);
};
async function run(){
 App.pairImportRecords();
 assert.match(node("modalRoot").innerHTML,/Importar registros A × B/);
 node("pairImportFile").files=[{size:350,text:async()=>JSON.stringify(sample)}];
 await App.pairPreviewImport();
 assert.equal(App.s.modal,"pair-financial-import");
 assert.equal(notices.filter(x=>x.includes("Já existe um formulário aberto")).length,0);
 assert.match(node("modalRoot").innerHTML,/Importar dívidas e pagamentos/);
 assert.match(node("pairFinancialResult").innerHTML,/Data ausente/);
 assert.match(node("pairFinancialResult").innerHTML,/1900/);
 assert.match(node("pairFinancialResult").innerHTML,/QUEM RECEBEU - DESCRIÇÃO/);
 assert.ok(calls.some(x=>x.url.endsWith("/financial-import/preview")));
 assert.ok(!calls.some(x=>x.url.endsWith("/pair/import/preview")));
 assert.equal(node("pairFinancialConfirmButton").disabled,false);
 await App.pairFinancialConfirm();
 assert.ok(notices.some(x=>x.includes("data ausente")));
 assert.ok(!calls.some(x=>x.url.endsWith("/financial-import/confirm")));
 node("pairFinancialDate1").value="2025-02-24";
 node("pairFinancialDate55").value="2025-05-13";
 await App.pairFinancialConfirm();
 const submit=calls.find(x=>x.url.endsWith("/financial-import/confirm"));
 assert.ok(submit);
 assert.equal(submit.body.batch_id,"digest");
 assert.equal(submit.body.corrected_dates["1"],"2025-02-24");
 assert.equal(submit.body.corrected_dates["55"],"2025-05-13");
 assert.equal(App.s.modal,null);

 // O mesmo botão aceita arquivo misto e apresenta salários sem impacto financeiro.
 const mixed={...sample,format:"central-pair-mixed-v1",
   records:[{source_row:7,date:"2025-02-05",amount:"3000.00",
     from_name:"JONAS",to_name:"FRIGENIO MOEIRA",
     original_type:"SALÁRIO",description:"SALÁRIO"}]};
 const originalApi=App.api;
 App.api=async(url,method,body)=>{
   if(url.endsWith("/mixed-import/preview")){
     calls.push({url,method,body});
     return {source_name:"TESTE",count:3,debt_count:1,payment_count:1,record_count:1,
       debt_total:"114000.00",payment_total:"134.90",neutral_total:"3000.00",
       batch_id:"mixed-digest",new_count:3,already_imported:0,
       missing_dates:[{source_row:1,description:"RECEBEDOR - CRÉDITO"}],
       unusual_dates:[]};
   }
   if(url.endsWith("/mixed-import/confirm")){
     calls.push({url,method,body});
     return {inserted:3,inserted_financial:2,inserted_neutral:1};
   }
   return originalApi(url,method,body);
 };
 App.pairImportRecords();
 node("pairImportFile").files=[{size:550,text:async()=>JSON.stringify(mixed)}];
 await App.pairPreviewImport();
 assert.equal(App.s.modal,"pair-financial-import");
 assert.equal(notices.filter(x=>x.includes("Já existe um formulário aberto")).length,0);
 assert.match(node("pairFinancialResult").innerHTML,/registro\\(s\\) neutro/);
 assert.match(node("pairFinancialResult").innerHTML,/não alteram o saldo/);
 assert.ok(calls.some(x=>x.url.endsWith("/mixed-import/preview")));
 node("pairFinancialDate1").value="2025-02-24";
 await App.pairFinancialConfirm();
 const mixedSubmit=calls.find(x=>x.url.endsWith("/mixed-import/confirm"));
 assert.ok(mixedSubmit);
 assert.equal(mixedSubmit.body.batch_id,"mixed-digest");
 assert.ok(notices.some(x=>x.includes("registros neutros importados")));

 console.log("OK: botão único identifica arquivo financeiro, exibe prévia e exige datas antes de importar");
}
run().catch(e=>{console.error(e);process.exitCode=1});
