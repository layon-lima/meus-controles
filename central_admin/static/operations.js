"use strict";
/* Central Novo Horizonte — adaptação de módulos reais, sem iframe, sem refazer motores.
 * Exclusiva do prefixo /central/modules/; aplicativos originais não são modificados.
 */
(function () {
  const modules = [
    ["Início", "/central/"],
    ["Controles", "/central/modules/controles/"],
    ["Recebimentos", "/central/modules/recebimentos/"],
    ["Transportadoras", "/central/modules/transportadoras/"],
    ["Contas", "/central/modules/contas/"],
    ["Funcionários", "/central/modules/funcionarios/"],
    ["Documentos", "/central/modules/documentos/"],
    ["Relatórios", "/central/modules/relatorios/"]
  ];
  const active = (location.pathname.match(/^\/central\/modules\/([a-z-]+)/) || [])[1] || "";
  const titles = {
    controles:"Meus Controles",recebimentos:"Recebimentos",transportadoras:"Transportadoras",
    contas:"Contas a pagar",funcionarios:"Funcionários e holerites",
    documentos:"Documentos",relatorios:"Relatórios"
  };
  const modeFilters = {
    recebimentos: c => c.mode === "recebimento",
    transportadoras: c => c.mode === "caminhao",
    controles: c => !["recebimento","caminhao"].includes(c.mode)
  };
  const suggestedMode = {controles:"financeiro",recebimentos:"recebimento", transportadoras:"caminhao"};
  let selectedBoard = "all";
  let typedSearch = "";
  function svg() {
    const shape = document.createElement("span");
    shape.className = "nh-chevron";
    shape.textContent = "›";
    return shape;
  }
  function renderShell() {
    // A barra superior compartilhada foi substituída pelo lançador flutuante
    // de painel, montado por launcher.js. Não recarrega nem interfere no App.
    document.body.classList.add("central-operational","nh-scope-"+active);
  }
  function quietOldSidebar() {
    // O antigo App.toggleMenu era chamado por toda navegação. Esta alteração
    // é somente local à página da Central, sem editar o app original.
    const nav = document.getElementById("sidebar");
    const shade = document.getElementById("mobileShade");
    const close = () => {
      if (nav) nav.classList.remove("open");
      if (shade) shade.classList.remove("open");
      document.body.classList.remove("central-drawer-open");
    };
    close();
    return close;
  }
  function nativeApp() {
    // Em scripts clássicos "const App" é binding lexical global, não window.App.
    try { return typeof App === "object" && App ? App : null; }
    catch (_) { return null; }
  }
  function newNativeControl(app) {
    if (!app.s.state || !(app.s.state.boards || []).length) {
      if (typeof app.newBoard === "function") app.newBoard();
      else app.toast("Cadastre uma pasta antes de criar o controle.",true);
      return;
    }
    app.newControl();
  }
  const controlTypes={saldo:"Saldo devedor",financeiro:"Financeiro",calculo:"Calculado",
    caminhao:"Transportadora",divida:"Dívidas",divida_sem_valor:"Pagamentos acumulados",acerto_ab:"Acerto A × B",vale_funcionarios:"Vales de funcionários"};
  const controlEsc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const controlMoney=value=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value||0));
  function controlListRow(c,folder){
    const id=Number(c.id),e=controlEsc,summary=c.summary||{};
    if(!Number.isSafeInteger(id)||id<=0)return "";
    const pair=c.mode==="acerto_ab",vales=c.mode==="vale_funcionarios";
    const balance=pair?(summary.settlement?.debtor?e(summary.settlement.debtor)+" deve "+controlMoney(summary.settlement.amount):controlMoney(0)):controlMoney(summary.balance);
    const label=pair?"Saldo compensado":vales?"Total a descontar":c.mode==="divida"?"Restante da dívida":c.mode==="divida_sem_valor"?"Total acumulado":"Saldo do controle";
    const count=vales?e(summary.count||0)+" vale(s)":e(summary.count||0)+" lançamento(s)";
    const detail=vales?e(summary.employees||0)+" funcionário(s)":c.mode==="divida"||c.mode==="divida_sem_valor"?"Pagamentos com descrição":e(c.fields?.length||0)+" campo(s)";
    const symbol=(String(c.name||"").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("")||"C").toUpperCase();
    return '<tr data-control-id="'+id+'" onclick="App.navigate(\'control\','+id+')">'+
      '<td><button type="button" class="nh-control-open" onclick="event.stopPropagation();App.navigate(\'control\','+id+')" aria-label="Abrir '+e(c.name)+'">'+
      '<span class="nh-control-avatar">'+e(symbol)+'</span><strong>'+e(c.name)+'</strong></button></td>'+
      '<td>'+e(folder||"—")+'</td><td>'+e(controlTypes[c.mode]||c.mode||"—")+'</td>'+
      '<td>'+count+'<small>'+detail+'</small></td><td class="nh-control-balance"><strong>'+balance+'</strong><small>'+label+'</small></td>'+
      '<td class="nh-control-actions"><button type="button" class="control-card-edit" data-nh-table-menu="'+id+'" aria-label="Ações de '+e(c.name)+'" title="Editar e configurar" aria-haspopup="true" aria-expanded="false">'+
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1 12-12-4-4L4 15z"/></svg></button>'+
      '</td></tr>';
  }
  // Popup em document.body: nunca fica recortado pelo overflow da tabela.
  let controlPopup=null,controlPopupAnchor=null;
  function closeTableControlPopup(restoreFocus=false){
    const anchor=controlPopupAnchor;
    controlPopup?.remove();
    controlPopup=null;controlPopupAnchor=null;
    if(anchor){anchor.setAttribute("aria-expanded","false");if(restoreFocus&&anchor.isConnected)anchor.focus();}
  }
  function openTableControlPopup(app,button){
    if(controlPopupAnchor===button){closeTableControlPopup(true);return;}
    closeTableControlPopup();
    const id=Number(button.dataset.nhTableMenu);
    const control=(app.s.state?.controls||[]).find(c=>Number(c.id)===id);
    if(!control||control.closed_at)return;
    const actions=[
      ["rename","Renomear","pencil"],["configure","Configurar / editar","settings"],
      ["type","Alterar tipo de controle","settings"],["move","Mover para pasta","folder"],
      ["duplicate","Duplicar controle","copy"],["close","Encerrar controle","archive"],
      ["delete","Excluir controle","trash"]
    ];
    const popup=document.createElement("div");
    popup.className="nh-control-popup";
    popup.id="nh-control-popup";
    popup.setAttribute("role","group");
    popup.setAttribute("aria-label","Ações de "+control.name);
    for(const [action,label,symbol] of actions){
      const item=document.createElement("button");
      item.type="button";
      if(action==="delete")item.className="danger";
      const glyph=document.createElement("span");glyph.className="nh-control-popup-icon";
      const marks={pencil:"✎",settings:"⚙",folder:"▱",copy:"▣",archive:"✓",trash:"×"};
      glyph.textContent=marks[symbol];glyph.setAttribute("aria-hidden","true");
      item.append(glyph,document.createTextNode(label));
      item.addEventListener("click",event=>{
        event.stopPropagation();
        closeTableControlPopup();
        if(action==="close"&&typeof app.closeControl!=="function"){
          app.toast("Atualize o motor do Meus Controles antes de encerrar.",true);return;
        }
        app.controlMenuAction(event,action,id);
      });
      popup.append(item);
    }
    document.body.append(popup);
    controlPopup=popup;controlPopupAnchor=button;
    button.setAttribute("aria-expanded","true");
    button.setAttribute("aria-controls",popup.id);
    const rect=button.getBoundingClientRect(),size=popup.getBoundingClientRect();
    const top=rect.bottom+6+size.height<=window.innerHeight-8?rect.bottom+6:rect.top-size.height-6;
    popup.style.left=Math.max(8,Math.min(rect.right-size.width,window.innerWidth-size.width-8))+"px";
    popup.style.top=Math.max(8,Math.min(top,window.innerHeight-size.height-8))+"px";
    popup.querySelector("button")?.focus({preventScroll:true});
  }
  document.addEventListener("pointerdown",event=>{
    if(controlPopup&&!controlPopup.contains(event.target)&&!controlPopupAnchor?.contains(event.target))closeTableControlPopup();
  },true);
  document.addEventListener("keydown",event=>{
    if(!controlPopup)return;
    if(event.key==="Escape"){event.preventDefault();closeTableControlPopup(true);return;}
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();
      const items=[...controlPopup.querySelectorAll("button")];
      const index=items.indexOf(document.activeElement);
      items[(index+(event.key==="ArrowDown"?1:items.length-1))%items.length]?.focus();
    }
  });
  window.addEventListener("resize",()=>closeTableControlPopup());
  function buildModuleHome(app) {
    closeTableControlPopup();
    const main = document.getElementById("main");
    const pageTitle = document.getElementById("pageTitle");
    const crumb = document.getElementById("crumb");
    const state = app.s.state;
    if (!main || !state) return;
    const heading = titles[active] || "Controles";
    const compact=active==="controles"||active==="transportadoras";
    const folders=new Map((state.boards||[]).map(b=>[String(b.id),b.name]));
    if (pageTitle) pageTitle.textContent = heading;
    if (crumb) crumb.textContent = "NOVO HORIZONTE / "+heading.toUpperCase();
    const normalize = value => String(value || "").normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
    // Indexa texto uma só vez a cada carga do motor original. A busca não
    // refaz normalização Unicode de centenas de cards a cada tecla.
    const all = (state.controls || [])
      .filter(modeFilters[active] || (() => true))
      .map(control => ({
        control,
        nameSearch: normalize(compact?[control.name,folders.get(String(control.board_id)),controlTypes[control.mode]].join(" "):control.name),
        board: String(control.board_id)
      }));
    main.replaceChildren();
    const head = document.createElement("section");
    head.className = "nh-module-head";
    const intro = document.createElement("div");
    const kicker = document.createElement("small");
    kicker.className = "nh-kicker";
    kicker.textContent = "MÓDULO OPERACIONAL";
    const h2 = document.createElement("h2");
    h2.textContent = heading;
    const note = document.createElement("p");
    note.textContent = {
      controles:"Controles personalizados e lançamentos, organizados sem misturar recebimentos ou transportadoras.",
      recebimentos:"Pedidos, produtos, notas fiscais, conferências, XML, PDF e histórico de entregas.",
      transportadoras:"Fretes, despesas, vales, motoristas e cálculo de comissões."
    }[active] || "";
    intro.append(kicker,h2,note);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn btn-primary nh-add";
    add.textContent = {
      controles:"+ Novo controle",recebimentos:"+ Novo recebimento",
      transportadoras:"+ Nova transportadora"
    }[active] || "+ Novo controle";
    add.addEventListener("click",()=>newNativeControl(app));
    const history=document.createElement("button");
    history.type="button";history.className="btn btn-sm nh-controls-history";
    history.textContent="Histórico";
    history.addEventListener("click",()=>app.navigate("history"));
    if(compact){
      head.className+=" nh-controls-compact-head";
      intro.className="nh-controls-brand";
      intro.replaceChildren();
      const logo=document.createElement("img");logo.src="/central/horizon-logo.svg?v=1";logo.alt="";
      const copy=document.createElement("div");note.textContent=active==="transportadoras"?"Gestão de fretes e comissões":"Gestão de controles e lançamentos";copy.append(h2,note);intro.append(logo,copy);
      const metrics=document.createElement("div");metrics.className="nh-controls-metrics";
      const counts=[[active==="transportadoras"?"Transportadoras":"Controles",all.length,"clipboard"],["Registros",all.reduce((n,x)=>n+Number(x.control.summary?.count||0),0),"list"],["Pastas",new Set(all.map(x=>x.board)).size,"folder"]];
      for(const [label,value,symbol] of counts){
        const metric=document.createElement("div");metric.className="nh-controls-metric";
        const glyph=document.createElement("span");glyph.className="nh-controls-metric-icon";
        const paths={clipboard:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6"/>',list:'<path d="M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1"/>',folder:'<path d="M3 7V5h7l2 3h9v12H3z"/>'};
        glyph.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[symbol]+'</svg>';
        const numbers=document.createElement("div"),caption=document.createElement("small"),strong=document.createElement("strong");
        caption.textContent=label;strong.textContent=String(value);numbers.append(caption,strong);metric.append(glyph,numbers);metrics.append(metric);
      }
      head.append(intro,metrics,add);
    }else head.append(intro,add);
    main.append(head);

    const toolbar = document.createElement("div");
    toolbar.className = "nh-module-toolbar";
    const search = document.createElement("input");
    search.type = "search";
    search.value = typedSearch;
    search.className = "nh-module-search";
    search.placeholder = compact?"Pesquisar controle, pasta ou tipo…":"Pesquisar nesta área…";
    if(compact)search.id="nh-controls-search";
    search.setAttribute("aria-label","Pesquisar somente "+heading);
    const board = document.createElement("select");
    board.className = "nh-board-select";
    board.setAttribute("aria-label","Filtrar por pasta");
    const option = document.createElement("option");
    option.value = "all";option.textContent = "Todas as pastas";board.append(option);
    (state.boards || []).forEach(item => {
      const opt = document.createElement("option");
      opt.value = String(item.id);
      opt.textContent = item.name;
      board.append(opt);
    });
    board.value = selectedBoard;
    if (board.value !== selectedBoard) selectedBoard = "all";
    const counter = document.createElement("span");
    counter.className = "nh-module-count";
    counter.textContent = all.length + (all.length===1 ? " controle" : " controles");
    let workspace=main;
    if(compact){
      workspace=document.createElement("section");workspace.className="nh-controls-workspace";
      const section=document.createElement("div");section.className="nh-controls-section-head";
      const title=document.createElement("h3");title.textContent="Visão geral";
      section.append(title,counter);workspace.append(section);main.append(workspace);
      section.append(history);
      toolbar.append(board,search);
    }else toolbar.append(search,board,counter,history);
    workspace.append(toolbar);

    const results = document.createElement("div");
    results.className = compact?"nh-controls-table-wrap nh-filtered-results":"control-grid nh-filtered-results";
    function renderResults() {
      closeTableControlPopup();
      const query = normalize(typedSearch).trim();
      const visible = all.filter(item =>
        (selectedBoard === "all" || item.board === selectedBoard)
        && item.nameSearch.includes(query)
      ).map(item => item.control);
      counter.textContent = visible.length + (visible.length === 1 ? " controle" : " controles");
      if(compact){
        const empty=all.length?"Nenhum controle corresponde aos filtros.":"Ainda não existem controles nesta categoria.";
        results.innerHTML='<table class="nh-controls-table" aria-label="Controles da área"><colgroup><col style="width:31%"><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:19%"><col style="width:5%"></colgroup><thead><tr>'+
          ["Controle","Pasta","Tipo","Registros","Saldo","Ações"].map(label=>'<th scope="col">'+label+'</th>').join("")+'</tr></thead><tbody>'+
          (visible.length?visible.map(c=>controlListRow(c,folders.get(String(c.board_id)))).join(""):'<tr><td colspan="6" class="nh-controls-empty">'+empty+'</td></tr>')+'</tbody></table>';
        return;
      }
      if (typeof controlCard !== "function") {
        results.textContent = "Componentes do motor de Controles indisponíveis.";
        return;
      }
      results.innerHTML = visible.map(c => controlCard(c)).join("");
      if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "nh-module-empty";
        empty.textContent = all.length ? "Nenhum controle corresponde aos filtros."
          : "Ainda não existem controles nesta categoria. Você pode criar o primeiro.";
        results.replaceChildren(empty);
      }
    }
    let scheduled = false;
    function scheduleResults() {
      if (scheduled) return;
      scheduled = true;
      const nextFrame = typeof requestAnimationFrame === "function"
        ? requestAnimationFrame : callback => callback();
      nextFrame(() => {
        scheduled = false;
        // O motor pode ter navegado para outra tela durante a digitação.
        if (results.isConnected !== false) renderResults();
      });
    }
    search.addEventListener("input",()=>{typedSearch=search.value;scheduleResults();});
    board.addEventListener("change",()=>{selectedBoard=board.value;scheduleResults();});
    if(compact){
      results.addEventListener("click",event=>{
        const button=event.target.closest?.("[data-nh-table-menu]");
        if(!button)return;
        event.preventDefault();event.stopPropagation();
        openTableControlPopup(app,button);
      },true);
      results.addEventListener("scroll",()=>closeTableControlPopup(),{passive:true});
    }
    workspace.append(results);
    renderResults();
  }
  function releaseEntryAfterRealRender(app) {
    // No primeiro carregamento, o HTML antigo existe, mas NÃO é o destino.
    // Só revelar após o motor confirmar estado + rota + detalhe correto.
    const state=app && app.s;
    if (!state || !state.state) return;
    if (state.route==="control" &&
        (!state.detail?.control || Number(state.detail.control.id)!==Number(state.id))) return;
    if (state.route==="board" &&
        !(state.state.boards||[]).some(b=>Number(b.id)===Number(state.id))) return;
    const main=document.getElementById("main");
    if (main) main.setAttribute("aria-busy","false");
    window.NHCentralRoute?.ready?.();
  }
  function paintTargetWhileLoading(app,route,id) {
    // Troca a antiga lista/visão geral IMEDIATAMENTE antes do fetch.
    // O motor continua responsável por estados, URLs, voltar e detalhes.
    if (route!=="control" || !Number.isSafeInteger(Number(id)) || Number(id)<=0 ||
        (app.s.route==="control" && Number(app.s.id)===Number(id) && app.s.detail)) return;
    const main=document.getElementById("main");
    if (!main) return;
    const selected=[...(app.s.state?.controls||[]),...(app.s.state?.archived_controls||[])].find(c=>Number(c.id)===Number(id));
    const heading=document.getElementById("pageTitle");
    if (heading) heading.textContent=selected?.name||"Abrindo controle";
    const crumb=document.getElementById("crumb");
    if (crumb) crumb.textContent="NOVO HORIZONTE / CONTROLE";
    const neutral=document.createElement("div");
    neutral.className="nh-route-loading";
    neutral.setAttribute("role","status");
    neutral.setAttribute("aria-live","polite");
    neutral.textContent="Abrindo "+(selected?.name||"o controle")+"…";
    main.replaceChildren(neutral);
    main.setAttribute("aria-busy","true");
  }
  // Estrutura comum para TODAS as telas internas do motor de Controles.
  // Move os nós existentes em vez de recriar HTML ou eventos do motor.
  const detailLayouts={
    acerto_ab:{root:".ab-view",heading:".ab-top",metrics:".ab-balance",actions:".ab-header-actions"},
    divida:{heading:".debt-heading",metrics:".debt-summary",actions:".debt-heading-actions",extra:".debt-progress-wrap"},
    divida_sem_valor:{heading:".open-debt-heading",metrics:".open-debt-total",actions:".open-debt-header-actions"},
    vale_funcionarios:{root:".vf-page",heading:".vf-heading",actions:".vf-heading-actions"},
    caminhao:{navigation:".truck-nav",actions:".truck-nav-actions",metrics:".truck-fast-summary,.truck-workflow-metrics"},
    saldo:{heading:".intro",metrics:".stat-grid",actions:".actions-end"},
    financeiro:{heading:".intro",metrics:".stat-grid",actions:".actions-end"},
    calculo:{heading:".intro",metrics:".stat-grid",actions:".actions-end"}
  };
  function mountDetailLayout(app){
    if(app.s.route!=="control"||!app.s.detail?.control)return;
    const main=document.getElementById("main");
    if(!main?.querySelector)return;
    const mode=app.s.detail.control.mode,cfg=detailLayouts[mode];
    if(!cfg)return;
    const root=cfg.root?main.querySelector(cfg.root):main;
    if(!root||root.querySelector(".nh-detail-header"))return;
    const heading=cfg.heading?root.querySelector(cfg.heading):null;
    const navigation=cfg.navigation?root.querySelector(cfg.navigation):null;
    // Não montar sobre o estado de carregamento ou sobre uma mensagem de erro.
    if(!heading&&!navigation)return;
    const metrics=cfg.metrics?root.querySelector(cfg.metrics):null;
    const actions=cfg.actions?(heading||navigation)?.querySelector(cfg.actions):null;
    const extra=cfg.extra?root.querySelector(cfg.extra):null;
    const header=document.createElement("section");
    header.className="nh-detail-header nh-detail-"+mode;
    header.setAttribute("aria-label","Resumo do controle");
    if(heading){
      heading.classList.add("nh-detail-heading");
      header.append(heading);
    }else if(navigation){
      const title=document.createElement("div");title.className="nh-detail-heading";
      const name=document.createElement("h2");name.textContent="Operações do controle";title.append(name);header.append(title);
    }
    if(metrics){
      metrics.classList.add("nh-detail-metrics");
      header.append(metrics);
    }
    if(actions){
      actions.classList.add("nh-detail-actions");
      header.append(actions);
    }
    if(extra){
      extra.classList.add("nh-detail-extra");
      header.append(extra);
    }
    const workspace=document.createElement("section");
    workspace.className="nh-detail-workspace";
    workspace.setAttribute("aria-label","Dados do controle");
    while(root.firstChild)workspace.append(root.firstChild);
    root.append(header,workspace);
    root.classList.add("nh-detail-layout");
  }
  function installDetailLayout(app){
    const main=document.getElementById("main");
    if(!main?.querySelector)return;
    const top=document.querySelector(".workspace > .topbar .top-left");
    if(top&&!top.querySelector(".nh-detail-logo")){
      const logo=document.createElement("img");
      logo.className="nh-detail-logo";logo.src="/central/horizon-logo.svg?v=1";logo.alt="";
      top.prepend(logo);
    }
    // O motor renderiza tanto de forma síncrona quanto depois das consultas.
    // Observar apenas a área principal cobre trocas de aba, busca e reabertura.
    if(typeof MutationObserver==="function"){
      const observer=new MutationObserver(()=>mountDetailLayout(app));
      observer.observe(main,{childList:true,subtree:true});
    }
    mountDetailLayout(app);
  }

  function configureOriginalControls() {
    const app = nativeApp();
    if (!app) return;
    installDetailLayout(app);
    const close = quietOldSidebar();
    app.toggleMenu = function () { close(); };
    const originalNavigate=app.navigate;
    app.navigate=function (route,id,options) {
      if((this.s.route!==route||Number(this.s.id||0)!==Number(id||0))&&window.NHDrafts?.blockNavigation())return;
      closeTableControlPopup();
      // Vale também para Voltar/Avançar, que usam navigate(fromHistory).
      paintTargetWhileLoading(this,route,id);
      return originalNavigate.apply(this,arguments);
    };
    if (!["controles","recebimentos","transportadoras"].includes(active)) {
      if (active === "relatorios") {
        const originalRender = app.renderMain;
        app.renderMain = function () {
          if (this.s.route !== "home" || !this.s.state)
            return originalRender.apply(this,arguments);
          const main = document.getElementById("main");
          if (!main) return;
          document.body.classList.toggle("nh-module-list",true);
          document.getElementById("pageTitle").textContent = "Relatórios";
          document.getElementById("crumb").textContent = "NOVO HORIZONTE / RELATÓRIOS";
          main.innerHTML = '<section class="nh-module-head nh-controls-compact-head nh-report-head"><div class="nh-controls-brand"><img src="/central/horizon-logo.svg?v=1" alt=""><div><h2>Relatórios</h2><p>Consultas e exportações</p></div></div></section><section class="nh-report-actions"><button class="btn btn-primary" type="button" id="nh-export-report">Gerar relatório Excel de controles</button></section>';
          document.getElementById("nh-export-report").addEventListener("click",
            () => this.reportExcelOpen());
        };
        const renderReport=app.render;
        app.render=function () {
          const result=renderReport.apply(this,arguments);
          releaseEntryAfterRealRender(this);
          return result;
        };
        app.render();
      } else {
        const renderOther=app.render;
        app.render=function () {
          const result=renderOther.apply(this,arguments);
          releaseEntryAfterRealRender(this);
          return result;
        };
        if(app.s.state)app.render();
      }
      return;
    }
    app.archiveModeFilter=modeFilters[active] || (()=>true);
    const originalRenderMain = app.renderMain;
    app.renderMain = function () {
      if (this.s.route === "home" && this.s.state) {
        buildModuleHome(this);
      } else {
        originalRenderMain.apply(this,arguments);
      }
    };
    const originalNew = app.newControl;
    app.newControl = function () {
      const out = originalNew.apply(this,arguments);
      if (suggestedMode[active] && this.s.modal === "builder"
          && this.s.draft && !this.s.editing && this.s.draft.mode!==suggestedMode[active]) {
        this.mode(suggestedMode[active]);
      }
      return out;
    };
    const originalRender = app.render;
    app.render = function () {
      document.body.classList.toggle("nh-module-list",this.s.route === "home");
      const detail = this.s.detail && this.s.detail.control;
      if (this.s.route === "control" && detail && !modeFilters[active](detail)) {
        this.navigate("home",null,{replace:true});
        return;
      }
      const rendered=originalRender.apply(this,arguments);
      mountDetailLayout(this);
      close();
      releaseEntryAfterRealRender(this);
      return rendered;
    };
    if (app.s.state) app.render();
  }
  function configureDocuments() {
    const original = document.getElementById("contasView");
    if (!original || document.getElementById("nh-documents-view")) return;
    const view = document.createElement("section");
    view.id = "nh-documents-view";
    view.className = "nh-documents";
    const heading = document.createElement("header");
    heading.className = "nh-module-head nh-controls-compact-head nh-document-head";
    const text = document.createElement("div");
    const kicker = document.createElement("small");
    kicker.className = "nh-kicker";
    kicker.textContent = "ARQUIVO DIGITAL";
    const title = document.createElement("h2");
    title.textContent = "Documentos e comprovantes";
    const desc = document.createElement("p");
    desc.textContent = "Localize documentos, abra PDFs e comprovantes ou anexe e substitua arquivos usando o motor do CONTAS 4.";
    const logo=document.createElement("img");logo.src="/central/horizon-logo.svg?v=1";logo.alt="";
    text.className="nh-controls-brand";const copy=document.createElement("div");
    title.textContent="Documentos";desc.textContent="PDFs e comprovantes";copy.append(title,desc);text.append(logo,copy);
    const importPDF = document.createElement("button");
    importPDF.type="button";importPDF.className="primary nh-add";
    importPDF.textContent="+ Importar PDF";
    importPDF.addEventListener("click",()=>document.getElementById("pdfImport")?.click());
    heading.append(text,importPDF);

    const bar = document.createElement("div");
    bar.className="nh-module-toolbar";
    const search = document.createElement("input");
    search.type="search";search.className="nh-module-search";
    search.placeholder="Fornecedor, documento ou observação…";
    search.setAttribute("aria-label","Pesquisar documentos");
    const status = document.createElement("select");
    status.className="nh-board-select";status.setAttribute("aria-label","Filtrar documentos");
    [["pdf","Com PDF"],["all","Todas as contas"],["missing","Sem PDF"],["receipt","Com comprovante"]]
      .forEach(([value,label])=>{
        const option=document.createElement("option");
        option.value=value;option.textContent=label;status.append(option);
      });
    status.value="pdf";
    const count=document.createElement("span");
    count.className="nh-module-count";count.textContent="Carregando...";
    bar.append(search,status,count);

    const list=document.createElement("div");
    list.className="nh-documents-list nh-documents-table-wrap";
    view.append(heading,bar,list);
    original.before(view);

    function data() {
      try { return typeof accounts !== "undefined" && Array.isArray(accounts) ? accounts : []; }
      catch (_) { return []; }
    }
    function action(text,label,fn,disabled=false){
      const button=document.createElement("button");
      button.type="button";button.textContent=text;
      button.className="nh-document-action";
      button.setAttribute("aria-label",label);
      button.disabled=disabled;
      button.addEventListener("click",fn);
      return button;
    }
    function renderDocuments(){
      const all=data();
      const normalized=value=>String(value||"").normalize("NFD")
        .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
      const term=normalized(search.value.trim());
      const filtered=all.filter(a=>{
        if(status.value==="pdf"&&!a.has_pdf)return false;
        if(status.value==="missing"&&a.has_pdf)return false;
        if(status.value==="receipt"&&!a.has_receipt)return false;
        return normalized([a.fornecedor,a.documento,a.observacoes,a.referencia]
          .join(" ")).includes(term);
      });
      count.textContent=filtered.length+(filtered.length===1?" documento":" documentos");
      list.replaceChildren();
      if(!filtered.length){
        const empty=document.createElement("p");
        empty.className="nh-module-empty";
        empty.textContent=all.length?"Nenhum documento encontrado neste filtro."
          :"Nenhum documento cadastrado ainda.";
        list.append(empty);return;
      }
      const table=document.createElement("table");table.className="nh-documents-table";table.setAttribute("aria-label","Documentos e comprovantes");
      const thead=document.createElement("thead"),header=document.createElement("tr"),tbody=document.createElement("tbody");
      for(const label of ["Fornecedor","Documento / vencimento","Arquivos","Ações"]){const th=document.createElement("th");th.textContent=label;th.setAttribute("scope","col");header.append(th);}
      thead.append(header);table.append(thead,tbody);list.append(table);
      filtered.forEach(a=>{
        const card=document.createElement("tr");card.className="nh-document-row";
        const info=document.createElement("td");info.className="nh-document-info";
        const name=document.createElement("strong");name.textContent=a.fornecedor||"Fornecedor não informado";
        const details=document.createElement("td");
        details.textContent=[a.documento||"Documento",a.vencimento||"",a.status||""]
          .filter(Boolean).join(" · ");
        const badges=document.createElement("td");badges.className="nh-document-badges";
        badges.textContent=(a.has_pdf?"PDF disponível":"Sem PDF")+
          (a.has_receipt?" · Comprovante disponível":"");
        info.append(name);
        const actions=document.createElement("div");actions.className="nh-document-actions";const actionCell=document.createElement("td");actionCell.append(actions);
        const selectAccount=()=>{
          if(typeof select==="function")select(a.id);
        };
        actions.append(
          action("PDF","Abrir documento de "+a.fornecedor,()=>{
            selectAccount();
            if(typeof showPDF==="function")Promise.resolve(showPDF(false))
              .catch(error=>{if(typeof notice==="function")notice(error.message,true);});
          },!a.has_pdf),
          action("Comprovante","Abrir comprovante de "+a.fornecedor,()=>{
            selectAccount();
            if(typeof showPDF==="function")Promise.resolve(showPDF(true))
              .catch(error=>{if(typeof notice==="function")notice(error.message,true);});
          },!a.has_receipt)
        );
        const menu=action("Ações","Editar, anexar ou substituir documento de "+a.fornecedor,()=>{});
        menu.addEventListener("click",()=>{
          selectAccount();
          if(typeof openMenu==="function")openMenu(a.id,{currentTarget:menu});
        });
        actions.append(menu);
        card.append(info,details,badges,actionCell);
        tbody.append(card);
      });
    }
    // Atualizações de filtros, tabela e carregamento de dados são agrupadas
    // num único frame, evitando recriar dezenas de cards várias vezes.
    let pending = false;
    function scheduleDocuments() {
      if (pending) return;
      pending = true;
      const nextFrame = typeof requestAnimationFrame === "function"
        ? requestAnimationFrame : callback => callback();
      nextFrame(() => {
        pending = false;
        if (view.isConnected !== false) renderDocuments();
      });
    }
    search.addEventListener("input",scheduleDocuments);
    status.addEventListener("change",scheduleDocuments);
    const tableRows=document.getElementById("rows");
    if(tableRows && typeof MutationObserver === "function"){
      const observer=new MutationObserver(scheduleDocuments);
      observer.observe(tableRows,{childList:true});
    }
    renderDocuments();
  }
  function configureContas() {
    const needsPayroll=active==="funcionarios";
    if(typeof setModule==="function"){
      setModule(needsPayroll?"holerites":"contas");
    }else if(needsPayroll){
      document.getElementById("tabHolerites")?.click();
    }
    if(active==="documentos")configureDocuments();
  }
  document.addEventListener("DOMContentLoaded", () => {
    renderShell();
    if (["controles","recebimentos","transportadoras","relatorios"].includes(active))
      configureOriginalControls();
    else {
      configureContas();
      // CONTAS / Documentos não usam App do Meus Controles; a montagem da
      // aba correta acontece em configureContas, não durante a primeira pintura.
      window.NHCentralRoute?.ready?.();
    }
  });
})();
