"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","static","app.js"),"utf8")
  .replace(/App\.initNavigation\(\);\s*App\.load\(\);\s*$/,
    "globalThis.testApp=App; globalThis.testTemplate=template;");
const nodes={};
const makeNode=id=>nodes[id]??(nodes[id]={
  id,innerHTML:"",value:"",textContent:"",hidden:false,disabled:false,style:{},
  classList:{toggle(){}},setAttribute(){},addEventListener(){},focus(){},
  reportValidity(){return true}
});
const document={
  getElementById:makeNode,
  querySelectorAll(){return []},
  createElement(){return {className:"",textContent:"",remove(){}}},
  addEventListener(){}
};
class FormDataMock{
  constructor(form){this.entries=form.mockData||{}}
  get(field){return this.entries[field]??""}
}
const browser={
  location:{pathname:"/",search:"",hash:"",href:""},
  history:{state:{centralNav:1,index:0,maxIndex:0},pushState(){},replaceState(){},back(){},forward(){}},
  addEventListener(){}
};
const context={document,window:browser,FormData:FormDataMock,
  setTimeout(){},console};
vm.runInNewContext(source,context,{filename:"static/app.js"});
const App=context.testApp;
const folder1={id:7,name:"TRANSPORTADORA"};
const folder2={id:8,name:"ADMINISTRATIVO"};
const control={...context.testTemplate("acerto_ab"),
  id:34,board_id:7,name:"FULANO X SICRANO",
  summary:{count:2,balance:"100.00",
    settlement:{debtor:"Sicrano",creditor:"Fulano",amount:"100.00"}}};
App.s.state={boards:[folder1,folder2],controls:[control]};
App.s.id=7;App.s.route="board";
App.canOpenForm=()=>true;
const requests=[],notices=[];
App.toast=message=>notices.push(message);
App.api=async(url,method,body)=>{
  requests.push({url,method,body});
  if(url.endsWith("/move")){
    control.board_id=body.board_id;
    return {id:control.id,board_id:body.board_id,ok:true};
  }
  throw Error("Unexpected API request");
};
App.load=async()=>App.render();
App.closeModal=()=>{App.s.modal=null;App.s.modalContext=null;makeNode("modalRoot").innerHTML=""};

async function run(){
  App.render();
  assert.match(makeNode("main").innerHTML,/Mover para pasta/);
  assert.match(makeNode("main").innerHTML,/Renomear pasta/);
  assert.equal(App.s.state.controls[0].id,34);
  assert.equal(context.testApp.s.state.boards.length,2);

  const fakeEvent={preventDefault(){},stopPropagation(){}};
  App.controlMenuAction(fakeEvent,"move",34);
  assert.match(makeNode("modalRoot").innerHTML,/Mover controle para outra pasta/);
  assert.match(makeNode("modalRoot").innerHTML,/ADMINISTRATIVO/);
  assert.doesNotMatch(makeNode("modalRoot").innerHTML,/<option[^>]*value="7"/);

  makeNode("moveControlForm").mockData={board_id:"8"};
  await App.saveControlMove();
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,"/api/controls/34/move");
  assert.equal(requests[0].method,"PATCH");
  assert.equal(requests[0].body.board_id,8);
  assert.equal(Object.keys(requests[0].body).length,1);
  assert.equal(control.board_id,8);
  assert.doesNotMatch(makeNode("main").innerHTML,/FULANO X SICRANO/);

  App.s.id=8;App.render();
  assert.match(makeNode("main").innerHTML,/FULANO X SICRANO/);
  assert.ok(notices.some(n=>n.includes("ADMINISTRATIVO")));

  App.moveControlForm(34);
  makeNode("moveControlForm").mockData={board_id:"7"};
  await App.saveControlMove();
  assert.equal(control.board_id,7);
  assert.equal(requests.length,2);
  console.log("OK: pastas, menu de mover, preservação do ID, ida e volta");
}
run().catch(err=>{console.error(err);process.exitCode=1});
