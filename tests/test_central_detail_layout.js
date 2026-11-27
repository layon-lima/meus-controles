"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("central_admin/static/operations.js","utf8");
const start=source.indexOf("  const detailLayouts="),end=source.indexOf("  function installDetailLayout",start);
assert.ok(start>=0&&end>start);
class Node{
  constructor(cls=""){this.className=cls;this.children=[];this.parent=null;this.attrs={};
    this.classList={add:name=>{if(!this.className.split(" ").includes(name))this.className+=" "+name}};
  }
  get firstChild(){return this.children[0]||null}
  append(...nodes){for(const node of nodes){if(node.parent)node.parent.children=node.parent.children.filter(x=>x!==node);node.parent=this;this.children.push(node)}}
  setAttribute(k,v){this.attrs[k]=v}
  querySelector(sel){
    const names=sel.split(",").map(x=>x.trim().slice(1));
    for(const child of this.children){if(names.some(n=>child.className.split(" ").includes(n)))return child;const result=child.querySelector(sel);if(result)return result}
    return null;
  }
}
const modes=[
 ["acerto_ab","ab-view","ab-top","ab-balance","ab-header-actions","ab-tabs"],
 ["divida","","debt-heading","debt-summary","debt-heading-actions","debt-ledger"],
 ["divida_sem_valor","","open-debt-heading","open-debt-total","open-debt-header-actions","open-debt-ledger"],
 ["vale_funcionarios","vf-page","vf-heading","","vf-heading-actions","vf-tabs"],
 ["caminhao","","truck-nav","truck-fast-summary","truck-nav-actions","truck-view"],
 ["saldo","","intro","stat-grid","actions-end","details-layout"],
 ["financeiro","","intro","stat-grid","actions-end","details-layout"],
 ["calculo","","intro","stat-grid","actions-end","details-layout"]
];
for(const [mode,rootClass,headingClass,metricsClass,actionsClass,bodyClass] of modes){
  const main=new Node("main"),root=rootClass?new Node(rootClass):main;
  if(root!==main)main.append(root);
  const heading=new Node(headingClass),actions=new Node(actionsClass),body=new Node(bodyClass),metrics=metricsClass?new Node(metricsClass):null;
  let invoked=0;actions.onclick=()=>invoked++;
  const input=new Node("input");input.value="preenchido";body.append(input);
  heading.append(actions);root.append(heading,body);
  if(metrics)(mode==="caminhao"?body:root).append(metrics);
  const document={getElementById:()=>main,createElement:()=>new Node()};
  const app={s:{route:"control",detail:{control:{mode}}}};
  const ctx={app,document};vm.createContext(ctx);
  vm.runInContext(source.slice(start,end)+"\nmountDetailLayout(app);",ctx);
  assert.equal(root.children.length,2,mode);
  const [header,workspace]=root.children;
  assert.ok(header.className.includes("nh-detail-header"),mode);
  assert.equal(workspace.className,"nh-detail-workspace",mode);
  assert.equal(actions.parent,header,mode+" preserva a ação original");
  assert.equal(body.parent,workspace,mode+" mantém os dados na área comum");
  if(metrics)assert.equal(metrics.parent,header,mode+" indicadores no cabeçalho");
  assert.equal(input.value,"preenchido");actions.onclick();assert.equal(invoked,1);
  vm.runInContext("mountDetailLayout(app);",ctx);
  assert.equal(root.children[0],header,"Não duplicar a estrutura");
  // Re-renderização de aba recria o conteúdo original; a moldura é remontada.
  const next=new Node(headingClass);next.append(new Node(actionsClass));
  root.children=[];root.append(next,new Node(bodyClass));
  vm.runInContext("mountDetailLayout(app);",ctx);
  assert.ok(root.children[0].className.includes("nh-detail-header"));
}
const theme=fs.readFileSync("central_admin/static/horizon-theme.css","utf8");
assert.ok(theme.includes(".app-shell #main .nh-detail-header"));
assert.ok(theme.includes(".app-shell #main .nh-detail-workspace"));
assert.match(theme,/\.app-shell #main :is\(\.ab-balance,\.open-debt-total\)\{\s*background:#fff!important;border:1px solid var\(--hz-line\)!important/);
assert.ok(theme.includes(".ab-tabs .ab-tab,.vf-tabs button,.truck-tablist .truck-tab"));
console.log("OK: oito tipos de controle com a mesma estrutura, ações originais e remontagem após troca de aba");
