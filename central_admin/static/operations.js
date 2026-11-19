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
    document.body.classList.add("central-operational","nh-scope-"+active);
    const top = document.createElement("header");
    top.className = "central-shell-bar";
    top.setAttribute("aria-label","Navegação da Central Novo Horizonte");
    const inner = document.createElement("div");
    inner.className = "central-shell-inner";
    const logo = document.createElement("a");
    logo.href = "/central/";
    logo.className = "central-home";
    const mark = document.createElement("span");
    mark.className = "central-mark";
    mark.textContent = "NH";
    const company = document.createElement("span");
    company.className = "central-brandline";
    const name = document.createElement("strong");
    name.textContent = "Novo Horizonte";
    const detail = document.createElement("small");
    detail.textContent = "Central Administrativa";
    company.append(name,detail);
    logo.append(mark,company);
    const links = document.createElement("nav");
    links.className = "central-tabs";
    links.setAttribute("aria-label","Áreas de trabalho");
    modules.forEach(([label,href]) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      if (href === "/central/modules/"+active+"/") link.setAttribute("aria-current","page");
      links.append(link);
    });
    inner.append(logo,links);
    top.append(inner);
    document.body.insertBefore(top, document.body.firstChild);
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
  function buildModuleHome(app) {
    const main = document.getElementById("main");
    const pageTitle = document.getElementById("pageTitle");
    const crumb = document.getElementById("crumb");
    const state = app.s.state;
    if (!main || !state) return;
    const heading = titles[active] || "Controles";
    if (pageTitle) pageTitle.textContent = heading;
    if (crumb) crumb.textContent = "NOVO HORIZONTE / "+heading.toUpperCase();
    const all = (state.controls || []).filter(modeFilters[active] || (() => true));
    const matched = all.filter(control => {
      const inBoard = selectedBoard === "all" || String(control.board_id) === selectedBoard;
      const comparable = String(control.name || "").normalize("NFD")
        .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
      const q = typedSearch.normalize("NFD")
        .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").trim();
      return inBoard && comparable.includes(q);
    });
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
    head.append(intro,add);
    main.append(head);

    const toolbar = document.createElement("div");
    toolbar.className = "nh-module-toolbar";
    const search = document.createElement("input");
    search.type = "search";
    search.value = typedSearch;
    search.className = "nh-module-search";
    search.placeholder = "Pesquisar nesta área…";
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
    counter.textContent = matched.length + (matched.length===1 ? " controle" : " controles");
    toolbar.append(search,board,counter);
    main.append(toolbar);

    const results = document.createElement("div");
    results.className = "control-grid nh-filtered-results";
    function renderResults() {
      const query = typedSearch.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
        .toLocaleLowerCase("pt-BR").trim();
      const visible = all.filter(c => (selectedBoard==="all" || String(c.board_id)===selectedBoard)
        && String(c.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
          .toLocaleLowerCase("pt-BR").includes(query));
      counter.textContent = visible.length + (visible.length === 1 ? " controle" : " controles");
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
    search.addEventListener("input",()=>{typedSearch=search.value;renderResults();});
    board.addEventListener("change",()=>{selectedBoard=board.value;renderResults();});
    main.append(results);
    renderResults();
  }
  function configureOriginalControls() {
    const app = nativeApp();
    if (!app) return;
    const close = quietOldSidebar();
    app.toggleMenu = function () { close(); };
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
          main.innerHTML = '<section class="nh-module-head"><div><small class="nh-kicker">ARQUIVOS E CONSULTAS</small><h2>Relatórios</h2><p>Exportações e consultas executadas pelo motor original, sem recadastrar dados.</p></div></section><section class="nh-report-actions"><button class="btn btn-primary" type="button" id="nh-export-report">Gerar relatório Excel de controles</button></section>';
          document.getElementById("nh-export-report").addEventListener("click",
            () => this.reportExcelOpen());
        };
        app.render();
      }
      return;
    }
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
      originalRender.apply(this,arguments);
      close();
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
    heading.className = "nh-module-head";
    const text = document.createElement("div");
    const kicker = document.createElement("small");
    kicker.className = "nh-kicker";
    kicker.textContent = "ARQUIVO DIGITAL";
    const title = document.createElement("h2");
    title.textContent = "Documentos e comprovantes";
    const desc = document.createElement("p");
    desc.textContent = "Localize documentos, abra PDFs e comprovantes ou anexe e substitua arquivos usando o motor do CONTAS 4.";
    text.append(kicker,title,desc);
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
    list.className="nh-documents-list";
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
      filtered.forEach(a=>{
        const card=document.createElement("article");card.className="nh-document-card";
        const info=document.createElement("div");info.className="nh-document-info";
        const name=document.createElement("strong");name.textContent=a.fornecedor||"Fornecedor não informado";
        const details=document.createElement("small");
        details.textContent=[a.documento||"Documento",a.vencimento||"",a.status||""]
          .filter(Boolean).join(" · ");
        const badges=document.createElement("span");badges.className="nh-document-badges";
        badges.textContent=(a.has_pdf?"PDF disponível":"Sem PDF")+
          (a.has_receipt?" · Comprovante disponível":"");
        info.append(name,details,badges);
        const actions=document.createElement("div");actions.className="nh-document-actions";
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
        card.append(info,actions);
        list.append(card);
      });
    }
    search.addEventListener("input",renderDocuments);
    status.addEventListener("change",renderDocuments);
    const tableRows=document.getElementById("rows");
    if(tableRows && typeof MutationObserver === "function"){
      const observer=new MutationObserver(()=>renderDocuments());
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
    else
      configureContas();
  });
})();
