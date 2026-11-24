"use strict";
/*
 * Um único componente: FECHADO = ícone; ABERTO = janela.
 * Sem popover separado, iframe, montagem de segunda página ou scroll interno.
 * Transição FLIP apenas com transform/opacity no compositor.
 */
(() => {
  if (!location.pathname.startsWith("/central/modules/")) return;
  const currentModule = (location.pathname.match(/^\/central\/modules\/([a-z-]+)/)||[])[1]||"";
  const MODULES=[
    {id:"contas",name:"Contas a pagar",detail:"Pagamentos e vencimentos",icon:"wallet"},
    {id:"recebimentos",name:"Recebimentos",detail:"Pedidos e notas fiscais",icon:"package"},
    {id:"controles",name:"Meus Controles",detail:"Controles personalizados",icon:"sliders"},
    {id:"transportadoras",name:"Transportadoras",detail:"Fretes e comissões",icon:"truck"},
    {id:"funcionarios",name:"Funcionários",detail:"Holerites e chaves Pix",icon:"users"},
    {id:"documentos",name:"Documentos",detail:"Boletos e comprovantes",icon:"file"},
    {id:"vinculos",name:"Conferir vínculos",detail:"Notas e contas relacionadas",icon:"link"},
    {id:"relatorios",name:"Relatórios",detail:"Consultas e exportações",icon:"chart"}
  ];
  const ICONS={
    grid:[["rect",{x:3,y:3,width:7,height:7,rx:1.6}],["rect",{x:14,y:3,width:7,height:7,rx:1.6}],["rect",{x:3,y:14,width:7,height:7,rx:1.6}],["rect",{x:14,y:14,width:7,height:7,rx:1.6}]],
    expand:[["path",{d:"M8 3H3v5M3 3l7 7M16 3h5v5M21 3l-7 7M3 16v5h5M3 21l7-7M21 16v5h-5M21 21l-7-7"}]],
    wallet:[["rect",{x:3,y:5,width:18,height:15,rx:3}],["path",{d:"M3 9h18M16 14h2"}]],
    package:[["path",{d:"m3 7 9-4 9 4-9 4-9-4ZM3 7v10l9 4 9-4V7M12 11v10M7.5 5l9 4"}]],
    sliders:[["path",{d:"M4 7h16M4 17h16"}],["circle",{cx:9,cy:7,r:2}],["circle",{cx:16,cy:17,r:2}]],
    truck:[["path",{d:"M3 6h12v11H3zM15 10h4l3 3v4h-7"}],["circle",{cx:7,cy:18,r:2}],["circle",{cx:18,cy:18,r:2}]],
    users:[["circle",{cx:9,cy:8,r:3}],["path",{d:"M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1"}]],
    file:[["path",{d:"M6 3h8l5 5v13H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v6h5M8 14h8M8 18h6"}]],
    link:[["path",{d:"M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 2"}]],
    chart:[["path",{d:"M4 20V4M4 20h17M8 15l4-4 3 2 5-7M17 6h3v3"}]]
  };
  const KEY="nh-central-launcher-geometry-v1";
  const SIZES=[58,70,82,94];
  const BORDER=8;
  const DESKTOP={w:600,h:455};
  const MOBILE={w:360,h:510};
  let root,trigger,panel,header,search,tiles,empty,expand;
  let mode="closed",busy=false,expanding=false,sizeIndex=0;
  let iconPosition=null,panelPosition=null,panelSize=null;
  let drag=null,frame=0,blockClick=false;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const viewport=()=>({w:Math.max(1,window.innerWidth||document.documentElement.clientWidth),
                        h:Math.max(1,window.innerHeight||document.documentElement.clientHeight)});
  const size=()=>SIZES[sizeIndex];
  const normalize=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").trim();
  const reduced=()=>typeof window.matchMedia==="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function html(tag,cls,content) {
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(content!=null)el.textContent=content;
    return el;
  }
  function icon(name) {
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.classList.add("nh-start-icon");svg.setAttribute("viewBox","0 0 24 24");
    svg.setAttribute("aria-hidden","true");
    for(const [tag,props] of ICONS[name]){
      const shape=document.createElementNS("http://www.w3.org/2000/svg",tag);
      Object.entries(props).forEach(([key,value])=>shape.setAttribute(key,String(value)));
      svg.appendChild(shape);
    }
    return svg;
  }
  function clampIcon(x,y) {
    const {w,h}=viewport(),d=size();
    return {x:clamp(x,BORDER,Math.max(BORDER,w-d-BORDER)),
            y:clamp(y,BORDER,Math.max(BORDER,h-d-BORDER))};
  }
  function save(){
    if(!iconPosition)return;
    try{window.localStorage.setItem(KEY,JSON.stringify({
      x:Math.round(iconPosition.x),y:Math.round(iconPosition.y),sizeIndex
    }))}catch(_){}
  }
  function restore(){
    try {
      const value=JSON.parse(window.localStorage.getItem(KEY)||"null");
      if(value && Number.isInteger(value.sizeIndex) && SIZES[value.sizeIndex] &&
         Number.isFinite(value.x) && Number.isFinite(value.y)){
        sizeIndex=value.sizeIndex;
        iconPosition=clampIcon(value.x,value.y);
      }
    }catch(_){}
    if(!iconPosition){
      const {w,h}=viewport(),m=w<=700?14:22;
      iconPosition=clampIcon(w-size()-m,h-size()-m);
    }
  }
  function dims(){
    const {w,h}=viewport(),logical=w<=700?MOBILE:DESKTOP;
    const scale=Math.min(1,(w-BORDER*2)/logical.w,(h-BORDER*2)/logical.h);
    return {...logical,scale:Math.max(.01,scale),
      vw:logical.w*scale,vh:logical.h*scale};
  }
  function fitPanel(x,y,d) {
    const {w,h}=viewport();
    return {x:clamp(x,BORDER,Math.max(BORDER,w-d.vw-BORDER)),
            y:clamp(y,BORDER,Math.max(BORDER,h-d.vh-BORDER))};
  }
  function initialPanel(d){
    const c=iconPosition,s=size(),{h}=viewport(),gap=12;
    const preferAbove=c.y>=d.vh+gap+BORDER;
    const preferBelow=h-(c.y+s)>=d.vh+gap+BORDER;
    const y=preferAbove?c.y-d.vh-gap:
      preferBelow?c.y+s+gap:c.y+s/2-d.vh/2;
    return fitPanel(c.x+s/2-d.vw/2,y,d);
  }
  function geometry(x,y,w,h,scale){
    root.style.left=x+"px";root.style.top=y+"px";
    root.style.width=w+"px";root.style.height=h+"px";
    root.style.setProperty("--nh-surface-scale",String(scale));
  }
  function setClosed(){
    root.classList.remove("nh-start-open","nh-start-ready","nh-start-expanding","nh-start-moving");
    mode="closed";
    panel.setAttribute("aria-hidden","true");
    panel.inert=true;
    trigger.setAttribute("aria-expanded","false");
    trigger.disabled=false;
    const c=clampIcon(iconPosition.x,iconPosition.y);
    iconPosition=c;
    geometry(c.x,c.y,size(),size(),1);
  }
  function setExpanded(p,d){
    panelPosition=p;panelSize=d;
    geometry(p.x,p.y,d.w,d.h,d.scale);
    root.classList.add("nh-start-open");
    mode="open";
    panel.inert=false;
    panel.setAttribute("aria-hidden","false");
    trigger.setAttribute("aria-expanded","true");
  }
  function animateMorph(from,to){
    const duration=reduced()?0:310;
    if(duration===0||typeof root.animate!=="function")return Promise.resolve();
    const animation=root.animate([
      {transform:from,offset:0},
      {transform:to,offset:1}
    ],{duration,easing:"cubic-bezier(.22,.85,.2,1)",fill:"none"});
    return animation.finished.catch(()=>{});
  }
  function openMenu(){
    if(busy||mode!=="closed")return;
    busy=true;blockClick=false;
    const before={...iconPosition},d=dims(),p=initialPanel(d);
    setExpanded(p,d);
    // A mesma superfície passa de quadradinho a janela — apenas transform,
    // sem esticar os cards: estes surgem ao final da transição.
    const start="translate3d("+(before.x-p.x)+"px,"+(before.y-p.y)+"px,0) scale("+
      (size()/d.w)+","+(size()/d.h)+")";
    animateMorph(start,"scale("+d.scale+")").then(()=>{
      if(mode!=="open")return;
      root.classList.add("nh-start-ready");
      search.value="";filter();
      // Não focar automaticamente: o foco programático acionava um anel
      // azul do tema global ao abrir o menu e dava aparência de duas bordas.
      busy=false;
    });
  }
  function closeMenu(restoreFocus=true){
    if(busy||mode!=="open"||expanding)return;
    busy=true;root.classList.remove("nh-start-ready");
    const d=panelSize,p=panelPosition,c=clampIcon(iconPosition.x,iconPosition.y);
    animateMorph("scale("+d.scale+")",
      "translate3d("+(c.x-p.x)+"px,"+(c.y-p.y)+"px,0) scale("+
      (size()/d.w)+","+(size()/d.h)+")").then(()=>{
      iconPosition=c;
      setClosed();
      busy=false;
      if(restoreFocus)trigger.focus({preventScroll:true});
    });
  }
  function nextSize(){
    if(busy||mode!=="closed")return;
    const old=size(),next=(sizeIndex+1)%SIZES.length;
    sizeIndex=next;
    iconPosition=clampIcon(iconPosition.x+(old-size())/2,
                           iconPosition.y+(old-size())/2);
    setClosed();save();
  }
  function startDrag(event,kind){
    if(event.button!==0||event.isPrimary===false||busy||drag)return;
    const point=kind==="closed"?iconPosition:panelPosition;
    if(!point)return;
    drag={pointerId:event.pointerId,kind,startX:event.clientX,startY:event.clientY,
          x:point.x,y:point.y,dx:0,dy:0,moved:false};
    const receiver=kind==="closed"?trigger:header;
    if(event.pointerId!=null&&typeof receiver.setPointerCapture==="function"){
      try{receiver.setPointerCapture(event.pointerId)}catch(_){}
    }
  }
  function updateDrag(){
    frame=0;
    if(drag?.moved)root.style.translate=drag.dx+"px "+drag.dy+"px";
  }
  function moveDrag(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    let dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
    if(!drag.moved && Math.hypot(dx,dy)<6)return;
    drag.moved=true;
    root.classList.add("nh-start-moving");
    const p=drag.kind==="closed"?
      clampIcon(drag.x+dx,drag.y+dy):
      fitPanel(drag.x+dx,drag.y+dy,panelSize);
    drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;
    if(!frame)frame=window.requestAnimationFrame(updateDrag);
  }
  function endDrag(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(frame){window.cancelAnimationFrame(frame);frame=0}
    const gesture=drag;
    if(gesture.moved){
      if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){
        const p=gesture.kind==="closed"?
          clampIcon(gesture.x+event.clientX-gesture.startX,
                    gesture.y+event.clientY-gesture.startY):
          fitPanel(gesture.x+event.clientX-gesture.startX,
                   gesture.y+event.clientY-gesture.startY,panelSize);
        gesture.dx=p.x-gesture.x;gesture.dy=p.y-gesture.y;
      }
      if(gesture.kind==="closed"){
        iconPosition=clampIcon(gesture.x+gesture.dx,gesture.y+gesture.dy);
        setClosed();
      }else{
        const moved=fitPanel(gesture.x+gesture.dx,gesture.y+gesture.dy,panelSize);
        // O ícone acompanha a janela quando ela se recolher.
        iconPosition=clampIcon(iconPosition.x+moved.x-gesture.x,
                               iconPosition.y+moved.y-gesture.y);
        setExpanded(moved,panelSize);
        root.classList.add("nh-start-ready");
      }
      save();
      blockClick=true;
      window.setTimeout(()=>{blockClick=false},0);
    }
    root.style.translate="";
    root.classList.remove("nh-start-moving");
    drag=null;
    const receiver=gesture.kind==="closed"?trigger:header;
    if(event.pointerId!=null&&typeof receiver.hasPointerCapture==="function"&&
       receiver.hasPointerCapture(event.pointerId)){
      try{receiver.releasePointerCapture(event.pointerId)}catch(_){}
    }
  }
  function pointerEvents(target,kind){
    target.addEventListener("pointerdown",event=>{
      if(kind==="open"&&event.target.closest("a,button,input,select,textarea"))return;
      startDrag(event,kind);
    });
    target.addEventListener("pointermove",moveDrag);
    target.addEventListener("pointerup",endDrag);
    target.addEventListener("pointercancel",endDrag);
    target.addEventListener("lostpointercapture",endDrag);
  }
  function filter(){
    const q=normalize(search.value);let count=0;
    for(const item of tiles.children){
      const entry=MODULES.find(e=>e.id===item.dataset.module);
      const show=!q||normalize(entry.name+" "+entry.detail).includes(q);
      item.hidden=!show;
      if(show)count++;
    }
    empty.hidden=count!==0;
  }
  function navigateHome(event){
    if(event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
    event.preventDefault();
    if(expanding)return;
    expanding=true;root.classList.add("nh-start-expanding");
    try{window.sessionStorage.setItem("nh-central-expand-entry",String(Date.now()))}catch(_){}
    window.location.assign("/central/");
  }
  function init(){
    if(document.getElementById("nh-start-menu"))return;
    root=html("section","nh-start-menu");
    root.id="nh-start-menu";
    root.setAttribute("aria-label","Menu Iniciar da Central");
    root.setAttribute("role","group");
    trigger=html("button","nh-start-trigger");
    trigger.id="nh-dashboard-launcher";trigger.type="button";
    trigger.title="Clique: abrir · Segure e arraste: mover · Botão direito: tamanho";
    trigger.setAttribute("aria-label","Abrir menu Iniciar da Central");
    trigger.setAttribute("aria-controls","nh-start-panel");
    trigger.setAttribute("aria-expanded","false");
    trigger.appendChild(icon("grid"));
    trigger.addEventListener("click",event=>{
      if(blockClick&&event.detail!==0){
        event.preventDefault();blockClick=false;return;
      }
      openMenu();
    });
    trigger.addEventListener("contextmenu",event=>{
      event.preventDefault();
      if(event.pointerType!=="touch")nextSize();
    });
    pointerEvents(trigger,"closed");

    panel=html("div","nh-start-panel");
    panel.id="nh-start-panel";
    panel.setAttribute("role","dialog");
    panel.setAttribute("aria-modal","false");
    panel.setAttribute("aria-hidden","true");
    panel.inert=true;
    header=html("div","nh-start-top");
    header.title="Segure e arraste para mover a janela";
    header.setAttribute("aria-label","Arraste esta barra para mover o menu");
    pointerEvents(header,"open");
    expand=html("a","nh-start-expand");
    expand.id="nh-start-expand";expand.href="/central/";
    expand.title="Expandir para a tela inicial";
    expand.setAttribute("aria-label","Expandir para a tela inicial da Central");
    expand.appendChild(icon("expand"));
    expand.addEventListener("click",navigateHome);
    const close=html("button","nh-start-close","×");
    close.type="button";close.setAttribute("aria-label","Fechar menu");
    close.addEventListener("click",()=>closeMenu());
    header.append(expand,close);

    const inputWrap=html("div","nh-start-search");inputWrap.appendChild(icon("grid"));
    search=html("input","nh-start-search-input");
    search.type="search";search.autocomplete="off";
    search.placeholder="Pesquisar módulos…";
    search.setAttribute("aria-label","Pesquisar módulos");
    search.addEventListener("input",filter);
    inputWrap.appendChild(search);
    const title=html("div","nh-start-section-title");
    title.append(html("strong","", "Aplicativos"),html("small","", "8 módulos"));
    tiles=html("div","nh-start-grid");
    for(const mod of MODULES){
      const anchor=html("a","nh-start-tile");
      anchor.href=mod.id==="vinculos"?"/central/#vinculos":"/central/modules/"+mod.id+"/";
      anchor.dataset.module=mod.id;
      if(mod.id===currentModule)anchor.setAttribute("aria-current","page");
      const badge=html("span","nh-start-tile-icon");
      badge.appendChild(icon(mod.icon));
      anchor.append(badge,html("strong","nh-start-tile-name",mod.name),
        html("small","nh-start-tile-subtitle",mod.detail));
      anchor.addEventListener("click",event=>{
        if(mod.id===currentModule&&!event.ctrlKey&&!event.metaKey&&
           !event.shiftKey&&!event.altKey){
          event.preventDefault();closeMenu();
        }
      });
      tiles.appendChild(anchor);
    }
    empty=html("p","nh-start-empty","Nenhum módulo encontrado.");
    empty.hidden=true;
    const scroller=html("div","nh-start-scroll");
    scroller.append(title,tiles,empty);
    panel.append(header,inputWrap,scroller);
    root.append(trigger,panel);
    restore();
    document.body.appendChild(root);
    setClosed();

    document.addEventListener("pointerdown",event=>{
      if(mode==="open"&&!busy&&!root.contains(event.target))closeMenu(false);
    },true);
    document.addEventListener("keydown",event=>{
      if(mode!=="open"||busy)return;
      if(event.key==="Escape"){event.preventDefault();closeMenu();return}
      if(event.key!=="Tab")return;
      const focusable=Array.from(panel.querySelectorAll("a:not([hidden]),button,input"))
        .filter(x=>!x.hidden&&!x.disabled&&!x.closest("[hidden]"));
      if(!focusable.length)return;
      const a=focusable[0],z=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===a){event.preventDefault();z.focus()}
      else if(!event.shiftKey&&document.activeElement===z){event.preventDefault();a.focus()}
    },true);
    window.addEventListener("resize",()=>{
      if(busy||drag)return;
      iconPosition=clampIcon(iconPosition.x,iconPosition.y);
      if(mode==="open"){
        const d=dims();
        const p=fitPanel(panelPosition.x,panelPosition.y,d);
        setExpanded(p,d);root.classList.add("nh-start-ready");
      }else setClosed();
    },{passive:true});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
})();