"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const code=fs.readFileSync(path.join(__dirname,"..","static","app.js"),"utf8")
  .replace(/App\.initNavigation\(\);\s*App\.load\(\);\s*$/,"globalThis.testApp=App;");
const nodes={},clicks=[];
function node(id){
  return nodes[id]??(nodes[id]={
    id,innerHTML:"",textContent:"",value:"",disabled:false,hidden:false,
    classList:{toggle(){}},style:{},setAttribute(){},focus(){}
  });
}
const document={
  getElementById:node,addEventListener(){},querySelectorAll(){return []},
  createElement(tag){
    if(tag!=="a")return {remove(){},className:"",textContent:""};
    return {href:"",download:"",click(){clicks.push({href:this.href,download:this.download})},remove(){}};
  },
  body:{appendChild(){}}
};
const requested=[];
const context={
  document,window:{location:{pathname:"/",search:"",hash:""},addEventListener(){}},
  setTimeout(){},console,
  URL:{createObjectURL(){return "blob:central-relatorio"},revokeObjectURL(){}},
  fetch:async(url,options)=>{
    requested.push({url,options});
    return {ok:true,blob:async()=>({size:100})};
  }
};
vm.runInNewContext(code,context,{filename:"app.js"});
const App=context.testApp;
if(!App)throw new Error("App não carregado");
App.toast=()=>{};
App.closeModal=()=>{App.s.modal=null};
const rows=[
 {id:10,board_id:1,name:"JOÃO PEDRO",mode:"acerto_ab",fields:[],summary:{count:1}},
 {id:11,board_id:2,name:"RECEBIMENTOS",mode:"recebimento",fields:[],summary:{count:2}}
];
App.s.state={boards:[{id:1,name:"FUNCIONÁRIOS"},{id:2,name:"PEDIDOS"}],controls:rows};
App.s.route="board";App.s.id=1;
App.renderMain();
assert.match(node("main").innerHTML,/Relatório Excel/);
App.reportExcelOpen();
assert.match(node("modalRoot").innerHTML,/JOÃO PEDRO/);
assert.match(node("modalRoot").innerHTML,/RECEBIMENTOS/);
assert.match(node("modalRoot").innerHTML,/Marcar visíveis/);
assert.equal(node("reportExcelDownload").disabled,true);
App.reportExcelToggle(10,true);
App.reportExcelToggle(11,true);
assert.equal(node("reportExcelDownload").disabled,false);
assert.equal(App.s.reportExcelIds.size,2);
(async()=>{
  await App.reportExcelDownload();
  assert.equal(requested.length,1);
  assert.equal(requested[0].url,"/api/reports/controls.xlsx");
  assert.equal(requested[0].options.method,"POST");
  assert.equal(JSON.stringify(JSON.parse(requested[0].options.body).control_ids.sort()),"[10,11]");
  assert.equal(clicks.length,1);
  assert.equal(clicks[0].download,"relatorio_controles.xlsx");
  assert.equal(App.s.modal,null);
  console.log("OK: seleção múltipla de pastas e download Excel");
})().catch(error=>{console.error(error);process.exitCode=1});
