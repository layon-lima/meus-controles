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
App.canOpenForm=()=>true;
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
 console.log("OK: botão único identifica arquivo financeiro, exibe prévia e exige datas antes de importar");
}
run().catch(e=>{console.error(e);process.exitCode=1});
