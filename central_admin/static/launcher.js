"use strict";
/*
 * Menu Iniciar da Central Novo Horizonte.
 * Único popover flutuante; não importa/copia a home, não monta outra página,
 * não usa iframe, não navega ao abrir/fechar e não altera a UI de negócios.
 */
(function () {
  const currentModule = (location.pathname.match(/^\/central\/modules\/([a-z-]+)/) || [])[1] || "";
  const MODULES = [
    {id:"contas",name:"Contas a pagar",detail:"Pagamentos e vencimentos",icon:"wallet"},
    {id:"recebimentos",name:"Recebimentos",detail:"Pedidos e notas fiscais",icon:"package"},
    {id:"controles",name:"Meus Controles",detail:"Controles personalizados",icon:"sliders"},
    {id:"transportadoras",name:"Transportadoras",detail:"Fretes e comissões",icon:"truck"},
    {id:"funcionarios",name:"Funcionários",detail:"Holerites e chaves Pix",icon:"users"},
    {id:"documentos",name:"Documentos",detail:"Boletos e comprovantes",icon:"file"},
    {id:"vinculos",name:"Conferir vínculos",detail:"Notas e contas relacionadas",icon:"link"},
    {id:"relatorios",name:"Relatórios",detail:"Consultas e exportações",icon:"chart"}
  ];
  const ICON_PATHS = {
    wallet:[["rect",{x:3,y:5,width:18,height:15,rx:3}],["path",{d:"M3 9h18M16 14h2"}]],
    package:[["path",{d:"m3 7 9-4 9 4-9 4-9-4ZM3 7v10l9 4 9-4V7M12 11v10M7.5 5l9 4"}]],
    sliders:[["path",{d:"M4 7h16M4 17h16"}],["circle",{cx:9,cy:7,r:2}],["circle",{cx:16,cy:17,r:2}]],
    truck:[["path",{d:"M3 6h12v11H3zM15 10h4l3 3v4h-7"}],["circle",{cx:7,cy:18,r:2}],["circle",{cx:18,cy:18,r:2}]],
    users:[["circle",{cx:9,cy:8,r:3}],["path",{d:"M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1"}]],
    file:[["path",{d:"M6 3h8l5 5v13H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v6h5M8 14h8M8 18h6"}]],
    link:[["path",{d:"M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2"}]],
    chart:[["path",{d:"M4 20V4M4 20h17M8 15l4-4 3 2 5-7M17 6h3v3"}]],
    grid:[["rect",{x:3,y:3,width:7,height:7,rx:1.6}],["rect",{x:14,y:3,width:7,height:7,rx:1.6}],["rect",{x:3,y:14,width:7,height:7,rx:1.6}],["rect",{x:14,y:14,width:7,height:7,rx:1.6}]],
    expand:[["path",{d:"M8 3H3v5M3 3l7 7M16 3h5v5M21 3l-7 7M3 16v5h5M3 21l7-7M21 16v5h-5M21 21l-7-7"}]]
  };
  const NAMESPACE = "http://www.w3.org/2000/svg";
  let fab, menu, search, tiles, emptyText;
  let open = false;
  let expanding = false;
  // Geometria por navegador: todos os módulos compartilham a mesma posição.
  const SETTINGS_KEY = "nh-central-launcher-geometry-v1";
  const SIZES = [58,70,82,94];
  let sizeIndex = 0;
  let position = null;
  let pointer = null;
  let suppressDragClick = false;
  let dragFrame = 0;
  const EDGE = 9;

  function icon(type) {
    const svg = document.createElementNS(NAMESPACE,"svg");
    svg.setAttribute("viewBox","0 0 24 24");
    svg.setAttribute("aria-hidden","true");
    svg.setAttribute("focusable","false");
    svg.classList.add("nh-start-icon");
    for (const [tag,attributes] of ICON_PATHS[type]) {
      const shape = document.createElementNS(NAMESPACE,tag);
      for (const [name,value] of Object.entries(attributes)) shape.setAttribute(name,String(value));
      svg.appendChild(shape);
    }
    return svg;
  }
  function node(tag,cls,content) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (content != null) el.textContent = content;
    return el;
  }
  function normal(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .toLocaleLowerCase("pt-BR").trim();
  }
  function urlOf(item) {
    return item.id === "vinculos" ? "/central/#vinculos" :
      "/central/modules/"+item.id+"/";
  }
  function createTile(item) {
    const a = node("a","nh-start-tile");
    a.href = urlOf(item);
    a.dataset.module = item.id;
    if (item.id === currentModule) a.setAttribute("aria-current","page");
    const symbol = node("span","nh-start-tile-icon");
    symbol.appendChild(icon(item.icon));
    const title = node("strong","nh-start-tile-name",item.name);
    const detail = node("small","nh-start-tile-subtitle",item.detail);
    a.append(symbol,title,detail);
    a.addEventListener("click",event => {
      // Trocar para o módulo atual deve apenas fechar o menu. Modificações
      // não salvas, posição de scroll e componentes permanecem intactos.
      if (item.id === currentModule &&
          !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        closeMenu();
      }
    });
    return a;
  }
  function showFiltered() {
    const q = normal(search.value);
    let visible = 0;
    for (const tile of tiles.children) {
      const item = MODULES.find(entry => entry.id === tile.dataset.module);
      const match = !q || normal(item.name+" "+item.detail).includes(q);
      tile.hidden = !match;
      if (match) visible++;
    }
    emptyText.hidden = visible !== 0;
  }

  function openMenu() {
    if (open) return;
    open = true;
    search.value = "";
    showFiltered();
    placeMenu();
    menu.classList.add("nh-start-open");
    menu.setAttribute("aria-hidden","false");
    fab.setAttribute("aria-expanded","true");
    search.focus({preventScroll:true});
  }
  function closeMenu(restoreFocus=true) {
    if (!open || expanding) return;
    open = false;
    menu.classList.remove("nh-start-open");
    menu.setAttribute("aria-hidden","true");
    fab.setAttribute("aria-expanded","false");
    if (restoreFocus) fab.focus({preventScroll:true});
  }
  function expandToHome(targetUrl) {
    if (expanding) return;
    expanding = true;
    // O nome permite que Edge/Chrome animem as duas páginas REAIS através
    // da navegação. Não cresce largura/altura do DOM da aplicação antiga.
    menu.classList.add("nh-start-expanding");
    // Marcador da navegação, nunca dados privados. A home usa-o para
    // exibir apenas o fundo de vidro durante a expansão e revelar os
    // cards DEPOIS da animação. Expira imediatamente se a navegação falhar.
    try {
      window.sessionStorage.setItem("nh-central-expand-entry", String(Date.now()));
    } catch (_) {}
    const navigate = () => window.location.assign(targetUrl);
    const reduceMotion = typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) { navigate(); return; }

    // Chrome/Edge modernos: cross-document View Transition nativa.
    // O navegador só muda para /central/ quando a nova página está pronta,
    // preservando a continuidade visual sem timers de navegação.
    if (typeof document.startViewTransition === "function" &&
        typeof CSS !== "undefined" &&
        typeof CSS.supports === "function" &&
        CSS.supports("view-transition-name: nh-central-expand")) {
      // Garante que o elemento nomeado seja capturado no documento de saída
      // antes de iniciar a navegação entre documentos.
      if (typeof menu.getBoundingClientRect === "function")
        menu.getBoundingClientRect();
      navigate();
      return;
    }

    // Fallback: uma ÚNICA superfície decorativa, animada apenas com
    // transform e opacity no compositor. Sem iframe, fetch ou reflow da UI.
    if (typeof menu.getBoundingClientRect !== "function") { navigate(); return; }
    const rect = menu.getBoundingClientRect();
    const width = Math.max(window.innerWidth || 1, 1);
    const height = Math.max(window.innerHeight || 1, 1);
    const layer = node("div", "nh-expand-surface");
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    if (typeof layer.animate !== "function") { navigate(); return; }
    const start = "translate3d(" + rect.left + "px," + rect.top + "px,0) scale(" +
      (rect.width / width) + "," + (rect.height / height) + ")";
    try {
      const animation = layer.animate([
        {transform:start, opacity:0.96},
        {transform:"translate3d(0,0,0) scale(1,1)", opacity:1}
      ], {duration:360, easing:"cubic-bezier(.22,.85,.24,1)",
          fill:"forwards"});
      animation.finished.then(navigate, navigate);
    } catch (_) {
      navigate();
    }
  }

  function viewport() {
    return {width:Math.max(1,window.innerWidth || document.documentElement.clientWidth || 1280),
            height:Math.max(1,window.innerHeight || document.documentElement.clientHeight || 800)};
  }
  function limit(value,min,max) {
    return Math.max(min,Math.min(max,value));
  }
  function clampPosition(x,y) {
    const {width,height}=viewport(),size=SIZES[sizeIndex];
    return {
      x:limit(Number.isFinite(x)?x:width-size-22,EDGE,Math.max(EDGE,width-size-EDGE)),
      y:limit(Number.isFinite(y)?y:height-size-20,EDGE,Math.max(EDGE,height-size-EDGE))
    };
  }
  function rememberPosition() {
    try {
      window.localStorage.setItem(SETTINGS_KEY,JSON.stringify({
        x:Math.round(position.x),y:Math.round(position.y),sizeIndex
      }));
    } catch (_) { /* Safari privado/armazenamento bloqueado: sessão continua. */ }
  }
  function restorePosition() {
    try {
      const saved=JSON.parse(window.localStorage.getItem(SETTINGS_KEY)||"null");
      if (saved && SIZES[saved.sizeIndex] &&
          Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        sizeIndex=saved.sizeIndex;
        position=clampPosition(saved.x,saved.y);
      }
    } catch (_) { /* Primeira visita ou dado antigo: usar posição padrão. */ }
    if (!position) {
      const {width,height}=viewport();
      const mobile=typeof window.matchMedia==="function" &&
        window.matchMedia("(max-width:700px)").matches;
      const size=SIZES[sizeIndex];
      position=clampPosition(width-size-(mobile?14:22),height-size-(mobile?14:20));
    }
    paintPosition();
  }
  function paintPosition() {
    if (!fab || !position) return;
    fab.style.setProperty("--nh-fab-x",position.x+"px");
    fab.style.setProperty("--nh-fab-y",position.y+"px");
    fab.style.setProperty("--nh-fab-size",SIZES[sizeIndex]+"px");
    fab.classList.add("nh-fab-positioned");
  }
  function placeMenu() {
    if (!fab || !menu) return;
    const bounds=fab.getBoundingClientRect();
    const {width,height}=viewport(),gap=12,margin=10;
    const above=Math.max(0,bounds.top-gap-margin);
    const below=Math.max(0,height-bounds.bottom-gap-margin);
    const putAbove=above>=below;
    const room=Math.max(100,putAbove?above:below);
    menu.style.setProperty("--nh-menu-limit",Math.min(620,room)+"px");
    const dimensions=menu.getBoundingClientRect();
    const left=limit(bounds.left+bounds.width/2-dimensions.width/2,
                     margin,Math.max(margin,width-dimensions.width-margin));
    const idealTop=putAbove?bounds.top-gap-dimensions.height:bounds.bottom+gap;
    const top=limit(idealTop,margin,Math.max(margin,height-dimensions.height-margin));
    menu.style.setProperty("--nh-menu-x",left+"px");
    menu.style.setProperty("--nh-menu-y",top+"px");
    menu.style.setProperty("--nh-menu-origin-x",
      limit(bounds.left+bounds.width/2-left,0,dimensions.width)+"px");
    menu.style.setProperty("--nh-menu-origin-y",
      (putAbove?dimensions.height+gap:-gap)+"px");
  }
  function resizeFab() {
    const size=SIZES[sizeIndex],nextIndex=(sizeIndex+1)%SIZES.length;
    const nextSize=SIZES[nextIndex];
    // Manter o centro no mesmo lugar enquanto muda de tamanho.
    position=clampPosition(position.x+(size-nextSize)/2,
                           position.y+(size-nextSize)/2);
    sizeIndex=nextIndex;
    position=clampPosition(position.x,position.y);
    paintPosition();
    rememberPosition();
    if (open) placeMenu();
  }
  function dragStart(event) {
    if (event.button!==0 || event.isPrimary===false) return;
    if (pointer) return;
    const rect=fab.getBoundingClientRect();
    pointer={id:event.pointerId,startX:event.clientX,startY:event.clientY,
             x:rect.left,y:rect.top,dragging:false,dx:0,dy:0};
    if (typeof fab.setPointerCapture==="function" && event.pointerId!=null)
      fab.setPointerCapture(event.pointerId);
  }
  function drawDrag() {
    dragFrame=0;
    if (!pointer || !pointer.dragging) return;
    // translate é uma camada própria no compositor; não reposiciona o DOM
    // nem recalcula o efeito Liquid Glass quadro a quadro.
    fab.style.translate=pointer.dx+"px "+pointer.dy+"px";
  }
  function dragMove(event) {
    if (!pointer || event.pointerId!==pointer.id) return;
    const dx=event.clientX-pointer.startX,dy=event.clientY-pointer.startY;
    if (!pointer.dragging && Math.hypot(dx,dy)<6) return;
    if (!pointer.dragging) {
      pointer.dragging=true;
      fab.classList.add("nh-fab-dragging");
      if (open) closeMenu(false);
    }
    const bounds=clampPosition(pointer.x+dx,pointer.y+dy);
    pointer.dx=bounds.x-pointer.x;
    pointer.dy=bounds.y-pointer.y;
    if (!dragFrame) dragFrame=window.requestAnimationFrame(drawDrag);
  }
  function dragEnd(event) {
    if (!pointer || event.pointerId!==pointer.id) return;
    if (dragFrame) {window.cancelAnimationFrame(dragFrame);dragFrame=0;}
    const moved=pointer.dragging;
    if (moved) {
      const final=clampPosition(pointer.x+pointer.dx,pointer.y+pointer.dy);
      position=final;
      paintPosition();
      suppressDragClick=true;
      // A sequência pointerup -> click é síncrona. Não engolir o próximo
      // clique legítimo caso o navegador decida não emitir click após drag.
      window.setTimeout(()=>{suppressDragClick=false},0);
      rememberPosition();
    }
    fab.style.translate="";
    fab.classList.remove("nh-fab-dragging");
    if (typeof fab.hasPointerCapture==="function" &&
        event.pointerId!=null && fab.hasPointerCapture(event.pointerId))
      fab.releasePointerCapture(event.pointerId);
    pointer=null;
    if (open) placeMenu();
  }
  function viewportChanged() {
    if (!position) return;
    position=clampPosition(position.x,position.y);
    paintPosition();
    if (open) placeMenu();
  }

  function build() {
    // Não iniciar duas vezes se o motor original reexecutar o JS.
    if (document.getElementById("nh-dashboard-launcher")) return;
    fab = node("button","nh-hub-fab");
    fab.type = "button";
    fab.id = "nh-dashboard-launcher";
    fab.title = "Abrir menu de módulos";
    fab.setAttribute("aria-label","Abrir menu Iniciar da Central");
    fab.setAttribute("aria-haspopup","dialog");
    fab.setAttribute("aria-controls","nh-start-menu");
    fab.setAttribute("aria-expanded","false");
    fab.appendChild(icon("grid"));
    fab.addEventListener("click",event => {
      if (suppressDragClick && event.detail!==0) {
        event.preventDefault();
        suppressDragClick=false;
        return;
      }
      if (expanding) return;
      open ? closeMenu() : openMenu();
    });
    fab.addEventListener("pointerdown",dragStart);
    fab.addEventListener("pointermove",dragMove);
    fab.addEventListener("pointerup",dragEnd);
    fab.addEventListener("pointercancel",dragEnd);
    fab.addEventListener("lostpointercapture",event => {
      if (pointer && event.pointerId===pointer.id) dragEnd(event);
    });
    fab.addEventListener("contextmenu",event => {
      event.preventDefault();
      if (!pointer?.dragging) resizeFab();
    });
    fab.title="Clique: abrir · Segure e arraste: mover · Botão direito: tamanho";
    fab.setAttribute("aria-description",
      "Arraste para mover. Clique com botão direito para aumentar. Após o maior tamanho, volta ao inicial.");

    menu = node("section","nh-start-menu");
    menu.id = "nh-start-menu";
    menu.setAttribute("role","dialog");
    menu.setAttribute("aria-modal","false");
    menu.setAttribute("aria-hidden","true");
    menu.setAttribute("aria-label","Menu Iniciar da Central Novo Horizonte");

    const top = node("div","nh-start-top");
    // Expansão REAL: anima a superfície do menu antes de navegar à
    // página inicial independente; nunca monta um app dentro de outro.
    const expand = node("a","nh-start-expand");
    expand.id = "nh-start-expand";
    expand.href = "/central/";
    expand.title = "Expandir para a tela inicial";
    expand.setAttribute("aria-label","Expandir menu para tela inicial da Central");
    expand.appendChild(icon("expand"));
    expand.addEventListener("click", event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      expandToHome(expand.href);
    });
    const close = node("button","nh-start-close","×");
    close.type = "button";
    close.setAttribute("aria-label","Fechar menu Iniciar");
    close.addEventListener("click",() => closeMenu());
    top.append(expand,close);

    const searchBox = node("div","nh-start-search");
    searchBox.appendChild(icon("grid"));
    search = node("input","nh-start-search-input");
    search.type = "search";
    search.autocomplete = "off";
    search.placeholder = "Pesquisar módulos...";
    search.setAttribute("aria-label","Pesquisar módulos da Central");
    search.addEventListener("input",showFiltered);
    searchBox.appendChild(search);

    const head = node("div","nh-start-section-title");
    head.append(node("strong","", "Aplicativos"),node("small","", "8 módulos"));

    const scroll = node("div","nh-start-scroll");
    tiles = node("div","nh-start-grid");
    MODULES.forEach(item => tiles.appendChild(createTile(item)));
    emptyText = node("p","nh-start-empty","Nenhum módulo encontrado.");
    emptyText.hidden = true;
    scroll.append(head,tiles,emptyText);

    menu.append(top,searchBox,scroll);

    restorePosition();
    document.body.append(menu,fab);
    window.addEventListener("resize",viewportChanged,{passive:true});
    document.addEventListener("pointerdown",event => {
      if (open && !fab.contains(event.target) && !menu.contains(event.target)) closeMenu(false);
    },true);
    document.addEventListener("keydown",event => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
      // Navegação por teclado continua dentro do menu enquanto aberto.
      if (event.key === "Tab") {
        const focus = Array.from(menu.querySelectorAll("a:not([hidden]),button,input"))
          .filter(item => !item.hidden && !item.disabled &&
                          !item.closest("[hidden]"));
        if (!focus.length) return;
        const first = focus[0],last = focus[focus.length-1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },true);
  }

  function init() {
    if (!location.pathname.startsWith("/central/modules/")) return;
    build();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();