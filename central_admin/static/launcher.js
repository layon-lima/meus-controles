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
    fab.addEventListener("click",() => open ? closeMenu() : openMenu());

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

    document.body.append(menu,fab);
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