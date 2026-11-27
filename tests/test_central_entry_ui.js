"use strict";
/* Garante que a página nova só mostra os cards APÓS expandir o vidro. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const code=fs.readFileSync("central_admin/static/entry-preflight.js","utf8");
const html=fs.readFileSync("central_admin/static/index.html","utf8");
const css=fs.readFileSync("central_admin/static/app.css","utf8");
const menuCss=fs.readFileSync("central_admin/static/launcher.css","utf8");
const launcher=fs.readFileSync("central_admin/static/launcher.js","utf8");

assert.ok(html.indexOf('src="entry-preflight.js')<html.indexOf('href="app.css'),
  "Gating deve funcionar antes da primeira pintura");
assert.ok(html.indexOf('id="nh-entry-surface"')<html.indexOf('class="page"'),
  "Superfície neutra deve estar separada do dashboard real");
assert.match(css,/html\.nh-start-arriving \.page\s*\{opacity:0!important\}/);
assert.match(css,/html\.nh-start-arriving #nh-entry-surface\s*\{\s*view-transition-name:\s*nh-central-expand/);
assert.match(css,/html\.nh-start-revealing \.page[\s\S]*?nh-show-dashboard/);
assert.match(menuCss,/\.nh-start-menu\.nh-start-expanding > \*\s*\{[\s\S]*?opacity:0!important/);
assert.ok(launcher.includes('sessionStorage.setItem("nh-central-expand-entry"'),
  "O marcador deve existir apenas quando o usuário expande");

function simulate(stamp,search=""){
  const classes=new Set();
  const root={classList:{
    add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)
  }};
  const listeners={};
  const timers=[];
  const storage=new Map();
  if(stamp!==null)storage.set("nh-central-expand-entry",String(stamp));
  const win={
    location:{search},
    sessionStorage:{
      getItem:key=>storage.get(key)||null,
      removeItem:key=>storage.delete(key)
    },
    addEventListener:(name,fn)=>listeners[name]=fn,
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length}
  };
  vm.runInNewContext(code,{window:win,document:{documentElement:root},Date:{now:()=>20000},URLSearchParams});
  return {classes,listeners,timers,storage,root};
}
const first=simulate(19800);
assert.equal(first.root.classList.contains("nh-start-arriving"),true,
  "A entrada começa com o dashboard invisível");
assert.equal(first.storage.has("nh-central-expand-entry"),false,
  "Marcador deve ser removido imediatamente");

let done;
first.listeners.pagereveal({viewTransition:{finished:{then:fn=>{done=fn}}}});
first.listeners.pageshow();
const pageshowFallback=first.timers.find(t=>t.ms===110);
assert.ok(pageshowFallback,"Fallback deve estar armado");
pageshowFallback.fn();
assert.equal(first.root.classList.contains("nh-start-arriving"),true,
  "pageshow não pode revelar conteúdo antes de terminar a expansão nativa");
done();
assert.ok(first.timers.some(t=>t.ms===45),"Intervalo final deve ser pequeno");
const afterTransition=first.timers.find(t=>t.ms===45);
afterTransition.fn();
assert.equal(first.root.classList.contains("nh-start-arriving"),false);
assert.equal(first.root.classList.contains("nh-start-revealing"),true,
  "Cards aparecem com fade somente depois que o vidro chegou à tela inteira");
first.timers.find(t=>t.ms===300).fn();
assert.equal(first.root.classList.contains("nh-start-revealing"),false);
first.timers.find(t=>t.ms===1200).fn();
assert.equal(first.root.classList.contains("nh-start-arriving"),false);

const noMarker=simulate(null);
assert.equal(noMarker.classes.size,0,"Acesso normal à home não deve animar");
const toModule=simulate(null,"?abrir=controles");
assert.equal(toModule.root.classList.contains("nh-module-redirect"),true,
  "Navegação para módulo não pode mostrar dashboard da Central como intermediário");
assert.ok(css.includes("html.nh-module-redirect .page"));
assert.ok(fs.readFileSync("central_admin/static/app.js","utf8")
  .includes("if (openRequestedModuleAfterAuth()) return;"));
const expired=simulate(1000);
assert.equal(expired.classes.size,0,"Marcador antigo não pode ocultar a home");
const noVT=simulate(19900);
noVT.listeners.pagereveal({});
assert.equal(noVT.root.classList.contains("nh-start-arriving"),true);
noVT.timers.find(t=>t.ms===100).fn();
assert.equal(noVT.root.classList.contains("nh-start-revealing"),true,
  "Sem View Transition, revelar rapidamente após a navegação");

console.log("OK: fundo expande primeiro; cards aparecem depois, sem flash e sem bloquear home normal");