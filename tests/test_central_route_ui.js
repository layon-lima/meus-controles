"use strict";
/* Regressão da navegação sem flash: hash direto, clique, voltar, erro e
 * entrada em todos os módulos legados da Central, sem dados da VPS. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const preflight=fs.readFileSync("central_admin/static/route-preflight.js","utf8");
const ops=fs.readFileSync("central_admin/static/operations.js","utf8");
const css=fs.readFileSync("central_admin/static/operations.css","utf8");

assert.ok(css.includes("html.nh-route-boot body :is(.app-shell,.app)"));
assert.ok(css.includes(".nh-route-loading"));
assert.ok(!preflight.includes("fetch("));
assert.ok(!preflight.includes("sessionStorage"));

// A barreira inicial não troca a URL nem revela o dashboard enquanto carrega.
function bootGate(path){
  const tokens=new Set();
  let backup;
  let cancelled=false;
  const win={
    location:{pathname:path},
    setTimeout(fn,ms){assert.equal(ms,15000);backup=fn;return 42},
    clearTimeout(id){assert.equal(id,42);cancelled=true}
  };
  const doc={documentElement:{classList:{
    add:x=>tokens.add(x),remove:x=>tokens.delete(x),contains:x=>tokens.has(x)
  }}};
  vm.runInNewContext(preflight,{window:win,document:doc});
  return {win,tokens,backup:()=>backup,cancelled:()=>cancelled};
}
for(const name of ["controles","transportadoras","relatorios","contas","documentos"]){
  const gate=bootGate("/central/modules/"+name+"/");
  assert.ok(gate.tokens.has("nh-route-boot"),name+" deve começar sem render antigo");
  assert.equal(gate.win.NHCentralRoute.pending,true);
  gate.win.NHCentralRoute.ready();
  assert.equal(gate.win.NHCentralRoute.pending,false);
  assert.ok(!gate.tokens.has("nh-route-boot"));
  assert.equal(gate.cancelled(),true);
}
const native=bootGate("/central/modules/recebimentos/");
assert.ok(!native.tokens.has("nh-route-boot"),
  "Recebimentos nativo não precisa do bloqueio legado");
const failed=bootGate("/central/modules/controles/#/control/8");
failed.backup()();
assert.equal(failed.win.NHCentralRoute.pending,false,
  "A falha de inicialização não pode bloquear indefinidamente a tela");

class Element{
  constructor(tag="div"){
    this.tagName=tag;this.children=[];this.listeners={};this.className="";
    this.innerHTML="";this.textContent="";this.attributes={};
    this.value="";this.classList={add(){},remove(){},toggle(){}};
  }
  append(...items){this.children.push(...items)}
  replaceChildren(...items){this.children=[...items];this.innerHTML=""}
  addEventListener(name,fn){this.listeners[name]=fn}
  setAttribute(name,val){this.attributes[name]=val}
  getAttribute(name){return this.attributes[name]}
}
function bootApp({module="controles",route="home",id=null,detail=null}={}){
  const all=new Map(),node=name=>{
    if(!all.has(name))all.set(name,new Element());
    return all.get(name);
  };
  const body=new Element("body");
  const doc={body,
    createElement:tag=>new Element(tag),
    getElementById:name=>node(name),
    addEventListener(name,fn){this.listeners[name]=fn},
    listeners:{}
  };
  const state={boards:[{id:3,name:"Fazenda"}],controls:[
    {id:7,name:"VALES DE FUNCIONÁRIOS",mode:"vale_funcionarios",board_id:3},
    {id:8,name:"ACERTO DE TRANSPORTADORA",mode:"caminhao",board_id:3}
  ]};
  let releases=0;
  const app={s:{state,route,id,detail,modal:null,draft:null,editing:null},
    toggleMenu(){},
    render(){this.renderMain()},
    renderMain(){
      // Simula a falha visual do motor antes da correção: desenha HOME
      // quando o detalhe ainda não chegou da API.
      node("main").innerHTML=this.s.route==="control"&&this.s.detail?
        "CONTROLE CORRETO "+this.s.detail.control.name:
        "PÁGINA INICIAL ANTIGA";
    },
    navigate(route,id,opts={}){
      this.s.route=route;this.s.id=id;
      this.s.detail=route==="control"?null:this.s.detail;
      // O controle só recebe App.render depois da resposta de /api/controls/id.
      if(route!=="control")this.render();
    },
    newControl(){},newBoard(){},toast(){},mode(){},reportExcelOpen(){}
  };
  const win={location:{pathname:"/central/modules/"+module+"/"},
    NHCentralRoute:{ready(){releases++}}};
  vm.runInNewContext(ops,{document:doc,location:win.location,window:win,App:app,
    controlCard:c=>"<article>"+c.name+"</article>"});
  doc.listeners.DOMContentLoaded();
  return {app,node,doc,win,get releases(){return releases}};
}

// Link direto vindo de outra aba: não revelar a HOME antes dos dados.
const deep=bootApp({route:"control",id:7,detail:null});
assert.equal(deep.releases,0,"Não liberar durante fetch do detalhe");
deep.app.s.detail={control:{id:7,name:"VALES DE FUNCIONÁRIOS",mode:"vale_funcionarios"}};
deep.app.render();
assert.equal(deep.releases,1,"Liberar só depois de construir o controle");

// Clique em controle: a tela antiga desaparece sincronamente, sem salto.
const clicked=bootApp();
assert.ok(clicked.releases>0,"Lista da área já foi montada");
clicked.node("main").innerHTML="PÁGINA INICIAL ANTIGA";
clicked.app.navigate("control",7);
assert.equal(clicked.node("main").innerHTML,"",
  "Não manter a página anterior durante o fetch");
assert.equal(clicked.node("main").children[0].className,"nh-route-loading");
assert.match(clicked.node("main").children[0].textContent,/VALES DE FUNCIONÁRIOS/);
assert.equal(clicked.node("main").attributes["aria-busy"],"true");
clicked.app.s.detail={control:{id:7,name:"VALES DE FUNCIONÁRIOS",mode:"vale_funcionarios"}};
clicked.app.render();
assert.equal(clicked.node("main").attributes["aria-busy"],"false");
assert.match(clicked.node("main").innerHTML,/CONTROLE CORRETO/);

// Voltar/avançar usam a mesma rota e não mostram a HOME antiga.
clicked.app.navigate("home",null,{fromHistory:true});
clicked.node("main").innerHTML="PÁGINA INICIAL ANTIGA";
clicked.app.navigate("control",7,{fromHistory:true});
assert.equal(clicked.node("main").children[0].className,"nh-route-loading");

// Ao entrar em outro tipo de controle, a área correta é respeitada.
const transport=bootApp({module:"transportadoras",route:"control",id:8,
  detail:{control:{id:8,name:"ACERTO DE TRANSPORTADORA",mode:"caminhao"}}});
assert.ok(transport.releases>0);
assert.ok(!transport.node("main").innerHTML.includes("PÁGINA INICIAL ANTIGA"));
console.log("OK: entrada direta, clique, voltar e troca de módulos não exibem a home antiga");
console.log("OK: contingência de falha, módulo nativo preservado e nenhum acesso financeiro");
