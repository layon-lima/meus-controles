"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const dir=path.join(__dirname,"..","static");
const base=fs.readFileSync(path.join(dir,"app.js"),"utf8").replace(
  /App\.initNavigation\(\);\s*App\.load\(\);\s*$/,"");
const pair=fs.readFileSync(path.join(dir,"pair.js"),"utf8");
const records=fs.readFileSync(path.join(dir,"pair_records.js"),"utf8");
const nodes={};
function node(id){
  return nodes[id]??(nodes[id]={id,innerHTML:"",value:"",disabled:false,checked:false,
    textContent:"",files:[],style:{},classList:{toggle(){}},
    setAttribute(){},addEventListener(){},remove(){},reportValidity(){return true}});
}
const document={getElementById:node,querySelectorAll(){return []},querySelector(){return null},
  createElement(){return {className:"",textContent:"",remove(){}}},addEventListener(){}};
class FormDataMock{
  constructor(form){this.fields=form.mockFields||{}}
  get(key){return this.fields[key]??""}
}
const browser={location:{hash:"",pathname:"/",search:"",href:""},
  history:{state:{index:0,maxIndex:0,centralNav:1},
    pushState(){},replaceState(){},back(){},forward(){}},addEventListener(){}};
const context={document,window:browser,FormData:FormDataMock,setTimeout(){},console,confirm(){return true}};
vm.runInNewContext(base+"\n"+pair+"\n"+records+"\nglobalThis.testApp=App;",context);
const App=context.testApp;
const c={id:7,name:"JONAS X MARCOS",mode:"acerto_ab",board_id:1};
const settings={party_a:"JONAS",party_b:"MARCOS"};
let data={control_id:7,settings,totals:{
    balance:"-500.00",a_to_b:"500.00",b_to_a:"0.00",
    payments_a_to_b:"0.00",payments_b_to_a:"0.00",
    settlement:{debtor:"JONAS",creditor:"MARCOS",amount:"500.00"},
    opening_balance:"0.00"},entries:[
      {id:1,entry_date:"2026-02-01",debtor:"A",amount:"500.00",description:"Dívida",notes:""}
    ],history:[],closures:[],current_from:null};
data.history=data.entries;
let neutral=[{id:12,record_date:"2026-02-05",original_date:"05/02/2026",
  amount:"1700.00",from_name:"",to_name:"ANGELA MARIA",
  description:"PENSÃO EDUARDO",notes:"",original_type:"SAÍDA",original_balance:"95.00"}];
App.s.state={boards:[{id:1,name:"ACERTOS"}],controls:[c]};
App.s.route="control";App.s.id=7;App.s.detail={control:c};
App.canOpenForm=()=>true;
const calls=[],toasts=[];
App.toast=x=>toasts.push(x);
App.closeModal=()=>{App.s.modal=null;App.s.modalContext=null;node("modalRoot").innerHTML=""};
App.load=async()=>{};
App.api=async(url,method="GET",body)=>{
  calls.push({url,method,body});
  if(url==="/api/controls/7/pair")return data;
  if(url==="/api/controls/7/pair/records"&&method==="GET")return {records:neutral};
  if(url==="/api/controls/7/pair/records"&&method==="POST")return {id:13};
  if(url==="/api/pair-records/12"&&(method==="PUT"||method==="DELETE"))return {ok:true};
  if(url==="/api/controls/7/pair/import/preview")return {
    count:56,new_count:56,already_imported:0,total_recorded:"259699.89",
    source_name:"PLANILHA JONAS X MARCOS",batch_id:"digest",
    warnings:["Linha 1 sem data","Linha 55 data 1900"]};
  if(url==="/api/controls/7/pair/import/confirm")return {inserted:56,skipped:0};
  throw Error("Unexpected "+method+" "+url);
};
async function run(){
  await App.renderPair();
  assert.match(node("main").innerHTML,/JONAS.*MARCOS/);
  assert.match(node("main").innerHTML,/Registro · não altera saldo/);
  assert.match(node("main").innerHTML,/PENSÃO EDUARDO/);
  assert.match(node("main").innerHTML,/ANGELA MARIA/);
  assert.match(node("main").innerHTML,/500,00/);
  assert.match(node("main").innerHTML,/Novo registro/);
  assert.match(node("main").innerHTML,/Importar lançamentos/);
  App.pairRecordForm();
  assert.match(node("modalRoot").innerHTML,/De quem saiu/);
  assert.match(node("modalRoot").innerHTML,/Quem recebeu/);
  node("pairRecordForm").mockFields={
    date:"2026-02-06",amount:"100.00",from_name:"JONAS",
    to_name:"FUNCIONARIO",description:"SALÁRIO",notes:"Sem efeito no saldo"};
  await App.pairRecordSave();
  assert.ok(calls.some(x=>x.method==="POST"&&x.url.endsWith("/pair/records")&&x.body.description==="SALÁRIO"));
  App.pairImportRecords();
  assert.match(node("modalRoot").innerHTML,/Arquivo de registros/);
  node("pairImportFile").files=[{size:500,text:async()=>JSON.stringify({
    format:"central-pair-records-v1",target:{party_a:"JONAS",party_b:"MARCOS"},
    source_name:"PLANILHA JONAS X MARCOS",records:[]})}];
  await App.pairPreviewImport();
  assert.match(node("pairImportResult").innerHTML,/56/);
  assert.match(node("pairImportResult").innerHTML,/não afetam o saldo/);
  assert.equal(node("pairConfirmImport").disabled,false);
  await App.pairConfirmImport();
  assert.ok(calls.some(x=>x.method==="POST"&&x.url.endsWith("/import/confirm")&&x.body.batch_id==="digest"));
  assert.ok(toasts.some(x=>x.includes("sem alterar o saldo")));
  console.log("OK: registro neutro, saldo intacto, edição, importação com prévia e confirmação");
}
run().catch(e=>{console.error(e);process.exitCode=1});
