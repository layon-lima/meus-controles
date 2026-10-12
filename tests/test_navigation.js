"use strict";
/* Teste sem dependências: navegação real do navegador e botões do aplicativo. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const file=path.join(__dirname,"..","static","app.js");
const code=fs.readFileSync(file,"utf8").replace(/App\.load\(\);\s*$/,
  "globalThis.__navigationTestApp = App;");
const example={
  boards:[{id:3,name:"RECEBIMENTOS"},{id:5,name:"TRANSPORTADORA"}],
  controls:[{
    id:6,board_id:3,name:"EXEMPLO",mode:"financeiro",
    fields:[],rules:[],types:[],
    summary:{count:0,balance:"0",plus:"0",minus:"0",by_category:[],by_type:[]}
  }]
};

function createHarness(initialUrl="/",initialState=null){
  const elements={};
  const el=id=>elements[id]??(elements[id]={
    id,innerHTML:"",textContent:"",value:"",disabled:false,hidden:false,style:{},
    classList:{toggle(){}},setAttribute(){},addEventListener(){},focus(){}
  });
  const document={
    getElementById:el,
    createElement(){return {className:"",textContent:"",remove(){}}},
    addEventListener(){},
    querySelectorAll(){return []},
    querySelector(){return null}
  };
  const listeners={};
  const location={pathname:"/",search:"",hash:""};
  let index=0;
  const records=[{url:initialUrl,state:initialState}];
  const setHash=url=>{location.hash=url.includes("#")?url.slice(url.indexOf("#")):""};
  setHash(initialUrl);
  const history={
    get state(){return records[index].state},
    pushState(state,_title,url){
      records.splice(index+1);
      records.push({state,url});
      ++index;setHash(url);
    },
    replaceState(state,_title,url){
      records[index]={state,url};setHash(url);
    },
    back(){
      assert.ok(index>0,"Tentativa de sair do app pela seta interna");
      --index;setHash(records[index].url);
      listeners.popstate?.({state:records[index].state});
    },
    forward(){
      assert.ok(index<records.length-1,"Não existe avanço no histórico");
      ++index;setHash(records[index].url);
      listeners.popstate?.({state:records[index].state});
    }
  };
  const window={location,history,addEventListener(type,callback){listeners[type]=callback}};
  const context={document,window,setTimeout(){},console};
  vm.runInNewContext(code,context,{filename:file});
  const app=context.__navigationTestApp;
  app.api=async url=>url==="/api/state"?example:{
    control:example.controls[0],summary:example.controls[0].summary,entries:[]
  };
  return {app,window,document,el,records,get index(){return index}};
}

async function check(){
  const env=createHarness();
  const a=env.app;
  await a.load();
  assert.equal(a.s.route,"home");
  assert.equal(env.el("navBack").disabled,true);
  assert.equal(env.el("navForward").disabled,true);
  a.navigate("board",3);
  assert.equal(a.s.route,"board");
  assert.equal(a.s.id,3);
  assert.equal(env.el("navBack").disabled,false);
  assert.equal(env.window.location.hash,"#/board/3");
  a.navigate("control",6);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(a.s.route,"control");
  assert.equal(a.s.id,6);
  assert.equal(env.window.location.hash,"#/control/6");
  env.window.history.back();
  assert.equal(a.s.route,"board");
  assert.equal(a.s.id,3);
  assert.equal(env.el("navForward").disabled,false);
  env.window.history.forward();
  assert.equal(a.s.route,"control");
  a.goBack();
  assert.equal(a.s.route,"board");
  a.goBack();
  assert.equal(a.s.route,"home");
  assert.equal(env.el("navBack").disabled,true);
  assert.equal(env.el("navForward").disabled,false);
  assert.equal(env.window.history.state.maxIndex,2);
  a.goForward();
  assert.equal(a.s.route,"board");
  a.navigate("board",5);
  assert.equal(a.s.id,5);
  assert.equal(env.el("navForward").disabled,true);
  const depth=env.records.length;
  a.navigate("board",5);
  assert.equal(env.records.length,depth,"Página atual não deve adicionar histórico");
  a.goBack();
  assert.equal(a.s.id,3);

  // Recarregar depois de voltar deve manter o botão de avanço habilitado.
  const refreshed=createHarness("/#/board/3",{
    centralNav:1,index:1,maxIndex:2
  });
  await refreshed.app.load();
  assert.equal(refreshed.app.s.route,"board");
  assert.equal(refreshed.app.s.id,3);
  assert.equal(refreshed.el("navForward").disabled,false);
  assert.equal(refreshed.el("navBack").disabled,false);

  // Abrir diretamente um controle por seu endereço.
  const direct=createHarness("/#/control/6");
  await direct.app.load();
  assert.equal(direct.app.s.route,"control");
  assert.equal(direct.app.s.id,6);
  assert.equal(direct.el("navBack").disabled,true);

  // O browser voltar a outra tela fecha um formulário aberto, mas não a página.
  a.s.modal="builder";
  a.navigate("board",5);
  a.goBack();
  assert.equal(a.s.modal,null);
  assert.equal(a.s.route,"board");
  console.log("OK: setas do app, histórico do navegador, retorno, avanço, atualização e URL direta");
}
check().catch(e=>{console.error(e);process.exitCode=1});
