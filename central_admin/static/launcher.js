"use strict";
/*
 * Lançador Liquid Glass Novo Horizonte.
 * O botão flutuante vira o painel real da Central por uma transição FLIP,
 * sem recarregar as páginas operacionais nem apagar formulários em edição.
 *
 * O conteúdo é reaproveitado diretamente do #homePanel em /central/.
 * Não há iframe, duplicação de motores ou troca de banco de dados.
 */
(function () {
  const HOME = "/central/";
  const ANIMATION_MS = 540;
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  let fab = null;
  let panel = null;
  let panelState = "closed";
  let sourcePromise = null;
  let previousFocus = null;
  let navigationAfterClose = null;

  function iconGrid() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "23");
    svg.setAttribute("height", "23");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linejoin", "round");
    for (const [x,y] of [[3,3],[14,3],[3,14],[14,14]]) {
      const rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
      rect.setAttribute("x",x); rect.setAttribute("y",y);
      rect.setAttribute("width","7");rect.setAttribute("height","7");
      rect.setAttribute("rx","2");
      svg.appendChild(rect);
    }
    return svg;
  }

  function addFloatingButton() {
    // Não criar duas entradas se um script da aplicação antiga recarregar a UI.
    if (document.getElementById("nh-dashboard-launcher")) return;
    fab = document.createElement("button");
    fab.id = "nh-dashboard-launcher";
    fab.className = "nh-hub-fab";
    fab.type = "button";
    fab.setAttribute("aria-label", "Abrir painel da Central Novo Horizonte");
    fab.setAttribute("aria-haspopup", "dialog");
    fab.setAttribute("aria-controls", "nh-hub-dialog");
    fab.setAttribute("aria-expanded", "false");
    fab.title = "Central de gestão";
    fab.appendChild(iconGrid());
    fab.addEventListener("click", () => {
      if (panelState === "closed") openPanel();
      else if (panelState === "open") closePanel();
    });
    document.body.appendChild(fab);
  }

  function createWindow() {
    const dialog = document.createElement("div");
    dialog.id = "nh-hub-dialog";
    dialog.className = "nh-hub-window";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "nh-hub-heading");
    dialog.setAttribute("tabindex", "-1");

    const header = document.createElement("header");
    header.className = "nh-hub-header";
    const brand = document.createElement("div");
    brand.className = "nh-hub-brand";
    const mark = document.createElement("span");
    mark.className = "nh-hub-brand-mark";
    mark.textContent = "NH";
    const words = document.createElement("span");
    words.className = "nh-hub-brand-words";
    const name = document.createElement("strong");
    name.textContent = "Novo Horizonte";
    const sub = document.createElement("small");
    sub.textContent = "Central Administrativa";
    words.append(name,sub);
    brand.append(mark,words);

    const controls = document.createElement("div");
    controls.className = "nh-hub-header-controls";
    const heading = document.createElement("span");
    heading.id = "nh-hub-heading";
    heading.textContent = "Painel de gestão";
    const close = document.createElement("button");
    close.id = "nh-hub-close";
    close.className = "nh-hub-close";
    close.type = "button";
    close.setAttribute("aria-label","Fechar painel e voltar à tela atual");
    close.textContent = "×";
    close.addEventListener("click", () => closePanel());
    controls.append(heading,close);
    header.append(brand,controls);

    const scroller = document.createElement("div");
    scroller.className = "nh-hub-scroller";
    const content = document.createElement("main");
    content.className = "nh-hub-dashboard";
    content.id = "nh-hub-dashboard";
    const loading = document.createElement("p");
    loading.className = "nh-hub-loading";
    loading.textContent = "Abrindo seu painel…";
    content.appendChild(loading);
    scroller.appendChild(content);

    dialog.append(header,scroller);
    return dialog;
  }

  function transitionFromButton(dialog) {
    const rect = fab.getBoundingClientRect();
    const vw = Math.max(window.innerWidth,1);
    const vh = Math.max(window.innerHeight,1);
    dialog.style.setProperty("--nh-expand-x", rect.left + "px");
    dialog.style.setProperty("--nh-expand-y", rect.top + "px");
    dialog.style.setProperty("--nh-expand-sx", String(rect.width / vw));
    dialog.style.setProperty("--nh-expand-sy", String(rect.height / vh));
  }

  function openPanel() {
    if (panelState !== "closed" || !fab) return;
    panelState = "opening";
    previousFocus = document.activeElement;
    navigationAfterClose = null;
    panel = createWindow();
    transitionFromButton(panel);
    document.body.appendChild(panel);
    document.documentElement.classList.add("nh-hub-lock");
    document.body.classList.add("nh-hub-active");
    fab.setAttribute("aria-expanded","true");
    const opened = panel;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (opened !== panel || panelState === "closing") return;
      opened.classList.add("nh-hub-expanded");
      panelState = "open";
      opened.querySelector("#nh-hub-close")?.focus({preventScroll:true});
    }));
    fillPanel(opened);
  }

  function closePanel(navigateTo) {
    if (!panel || panelState === "closed" || panelState === "closing") return;
    if (navigateTo) navigationAfterClose = navigateTo;
    panelState = "closing";
    const closing = panel;
    const cleanup = () => {
      if (panel !== closing) return;
      closing.remove();
      panel = null;
      panelState = "closed";
      document.documentElement.classList.remove("nh-hub-lock");
      document.body.classList.remove("nh-hub-active");
      fab.setAttribute("aria-expanded","false");
      if (navigationAfterClose) {
        const url = navigationAfterClose;
        navigationAfterClose = null;
        window.location.assign(url);
      } else {
        (previousFocus && previousFocus.isConnected ? previousFocus : fab)
          .focus({preventScroll:true});
      }
    };
    closing.classList.remove("nh-hub-expanded");
    const onEnd = event => {
      if (event.target === closing && event.propertyName === "transform") {
        closing.removeEventListener("transitionend",onEnd);
        cleanup();
      }
    };
    closing.addEventListener("transitionend",onEnd);
    // Fallback para navegadores que reduzem ou não emitem transitionend.
    window.setTimeout(cleanup, ANIMATION_MS + 100);
  }

  function contentSource() {
    if (!sourcePromise) {
      sourcePromise = fetch(HOME,{credentials:"same-origin",cache:"no-store"})
        .then(response => {
          if (!response.ok) throw new Error("Não foi possível abrir o painel.");
          return response.text();
        })
        .then(html => {
          const page = new DOMParser().parseFromString(html,"text/html");
          const section = page.querySelector("#homePanel");
          const icons = page.querySelector("svg.svg-sprite");
          if (!section || !icons) throw new Error("Painel inicial não encontrado.");
          return {section,icons};
        })
        .catch(error => {sourcePromise = null;throw error;});
    }
    return sourcePromise;
  }

  function updateCounter(root,id,value) {
    const element = root.querySelector("#"+id);
    if (element) element.textContent = String(value);
  }

  function brl(value) {
    const n = Number(value);
    return Number.isFinite(n)
      ? n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"}) : "—";
  }

  async function hydrateStats(root) {
    try {
      const response = await fetch("/central/api/resumo",{
        credentials:"same-origin",cache:"no-store",headers:{Accept:"application/json"}
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!root.isConnected) return;
      const contas = data.contas, recebimentos = data.controles;
      updateCounter(root,"kpiOpen",contas ? contas.em_aberto : "—");
      updateCounter(root,"kpiOverdue",contas ? contas.vencidas : "—");
      updateCounter(root,"kpiInvoices",recebimentos ? recebimentos.notas : "—");
      updateCounter(root,"kpiLinks",contas && recebimentos ? (data.sugestoes||[]).length : "—");
      updateCounter(root,"subOpen",contas ? brl(contas.valor_em_aberto)+" pendentes" : "Indisponível");
      updateCounter(root,"subOverdue",contas ? "Não pagas, vencidas" : "Indisponível");
      updateCounter(root,"subInvoices",recebimentos ? recebimentos.itens_pedido+" itens em pedidos" : "Indisponível");
      updateCounter(root,"subLinks",contas && recebimentos ? "Para conferir" : "Indisponível");
      updateCounter(root,"moduleAccounts",contas ? contas.em_aberto+" em aberto" : "Consultar contas");
      updateCounter(root,"moduleInvoices",recebimentos ? recebimentos.notas+" notas" : "Consultar notas");
      updateCounter(root,"moduleLinks",contas && recebimentos ? (data.sugestoes||[]).length+" sugestões" : "Conferir vínculos");
    } catch (_) {
      // O painel continua navegável mesmo se as estatísticas estão indisponíveis.
    }
  }

  function installDashboard(dialog,{section,icons}) {
    if (dialog !== panel || panelState === "closing") return;
    const target = dialog.querySelector("#nh-hub-dashboard");
    if (!target) return;
    const fragment = document.createDocumentFragment();
    const clonedIcons = document.importNode(icons,true);
    clonedIcons.classList.add("nh-hub-icons");
    clonedIcons.setAttribute("aria-hidden","true");
    const clonedSection = document.importNode(section,true);
    clonedSection.id = "nh-hub-home";
    fragment.append(clonedIcons,clonedSection);
    target.replaceChildren(fragment);
    hydrateStats(target);
  }

  async function fillPanel(dialog) {
    try {
      const template = await contentSource();
      installDashboard(dialog,template);
    } catch (_) {
      if (dialog !== panel || panelState === "closing") return;
      const target = dialog.querySelector("#nh-hub-dashboard");
      if (!target) return;
      target.replaceChildren();
      const title = document.createElement("h2");
      title.textContent = "Áreas da Central";
      const help = document.createElement("p");
      help.textContent = "Os indicadores estão indisponíveis, mas você pode abrir os módulos.";
      const cards = document.createElement("div");
      cards.className = "modules";
      for (const [label,path] of [
        ["Contas a pagar","contas"],["Recebimentos","recebimentos"],
        ["Meus Controles","controles"],["Transportadoras","transportadoras"],
        ["Funcionários","funcionarios"],["Documentos","documentos"],["Relatórios","relatorios"]
      ]) {
        const a = document.createElement("a");
        a.className = "module-card";
        a.href = "/central/modules/"+path+"/";
        a.textContent = label;
        cards.appendChild(a);
      }
      target.append(title,help,cards);
    }
  }

  function navigationWithinPanel(event) {
    if (!panel || panelState === "closing") return;
    const button = event.target.closest("button[data-section='vinculos']");
    if (button && panel.contains(button)) {
      event.preventDefault();
      closePanel("/central/#vinculos");
      return;
    }
    const link = event.target.closest("a.module-card[href]");
    if (!link || !panel.contains(link)) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey ||
        event.shiftKey || (event.button !== undefined && event.button !== 0)) return;
    const url = new URL(link.href,window.location.href);
    if (url.origin !== window.location.origin ||
        !url.pathname.startsWith("/central/modules/")) return;
    event.preventDefault();
    if (url.pathname === window.location.pathname) closePanel();
    else closePanel(url.href);
  }

  function onKeyboard(event) {
    if (!panel || panelState === "closing") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(panel.querySelectorAll(FOCUSABLE))
      .filter(el => !el.hidden && !el.disabled);
    if (!focusable.length) { event.preventDefault();panel.focus();return; }
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey && document.activeElement===first) {
      event.preventDefault();last.focus();
    } else if (!event.shiftKey && document.activeElement===last) {
      event.preventDefault();first.focus();
    }
  }

  function init() {
    // Somente telas internas. O painel inicial continua sendo uma página normal.
    if (!window.location.pathname.startsWith("/central/modules/")) return;
    addFloatingButton();
    document.addEventListener("click",navigationWithinPanel);
    document.addEventListener("keydown",onKeyboard,true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();