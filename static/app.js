"use strict";
const E = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icon = id => '<svg class="ui-icon" aria-hidden="true"><use href="/static/icons.svg#'+id+'"></use></svg>';
const currency = n => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(n||0));
const number = n => new Intl.NumberFormat("pt-BR",{maximumFractionDigits:2}).format(Number(n||0));
const deep = x => JSON.parse(JSON.stringify(x));
function normalizeSearch(value){
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
}
function parseSearchQuery(raw){
  const value=String(raw??"").trim();
  const isBoard=/^[pq](?:\s|:|$)/i.test(value);
  return {
    kind:isBoard?"board":"control",
    term:normalizeSearch(isBoard?value.replace(/^[pq](?::|\s+)?/i,"").trim():value),
    active:value.length>0
  };
}

const slug = value => String(value||"campo").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").replace(/^[^a-z]+/,"") || "campo";
const fieldTypes = [["text","Texto"],["date","Data"],["number","Número"],["currency","Dinheiro (R$)"],["percent","Porcentagem (%)"]];
const ops = [["multiply","Multiplicar"],["percent","Calcular porcentagem"],["subtract","Subtrair"],["add","Somar"]];
const directions = [[1,"Soma (+)"],[-1,"Subtrai (−)"],[0,"Não altera saldo"]];
const fSelect=(items,value)=>items.map(([k,label])=>'<option value="'+E(k)+'" '+(String(k)===String(value)?"selected":"")+'>'+E(label)+'</option>').join("");
function template(mode="caminhao"){
  const fields = mode==="calculo" ? [
    {key:"data",label:"Data",type:"date",required:true},
    {key:"motorista",label:"Motorista",type:"text",required:true},
    {key:"peso",label:"Peso carregado (kg)",type:"number",required:true},
    {key:"valor_kg",label:"Valor por kg (R$)",type:"currency",required:true},
    {key:"comissao",label:"Comissão (%)",type:"percent",required:true,default:"10"}
  ] : [
    {key:"data",label:"Data",type:"date",required:true},
    {key:"descricao",label:"Descrição",type:"text",required:true}
  ];
  return {name:mode==="caminhao"?"Controle de Caminhão":mode==="divida"?"Controle de Dívidas":mode==="divida_sem_valor"?"Dívidas sem valor fixo":mode==="recebimento"?"Recebimento de Produtos":mode==="acerto_ab"?"Acerto A × B":mode==="vale_funcionarios"?"Vales de Funcionários":mode==="calculo"?"Controle de Fretes":"Novo controle",mode,board_id:App.s.state?.boards?.[0]?.id||0,
    fields,
    truck_settings:mode==="caminhao"?{commission_pct:"13",driver_name:"",opening_commission:"0",opening_cash:"0"}:undefined,
    debt_settings:mode==="divida"?{opening_amount:"0"}:undefined,
    pair_settings:mode==="acerto_ab"?{party_a:"Pessoa A",party_b:"Pessoa B"}:undefined,
    rules:mode==="calculo" ? [
      {key:"valor_frete",label:"Valor do frete",op:"multiply",a:"peso",b:"valor_kg"},
      {key:"comissao_valor",label:"Comissão do motorista",op:"percent",a:"valor_frete",b:"comissao"},
      {key:"resultado",label:"Resultado após comissão",op:"subtract",a:"valor_frete",b:"comissao_valor"}
    ]:[],
    types:mode==="calculo" ? [
      {key:"frete",label:"Frete realizado",direction:1,source:"valor_frete"},
      {key:"abatimento",label:"Abatimento",direction:-1,source:"manual"},
      {key:"informacao",label:"Somente informação",direction:0,source:"manual"}
    ]:mode==="saldo" ? [
      {key:"divida",label:"Novo valor devido",direction:1,source:"manual"},
      {key:"recebimento",label:"Pagamento recebido",direction:-1,source:"manual"}
    ]:[
      {key:"entrada",label:"Entrada",direction:1,source:"manual"},
      {key:"saida",label:"Saída",direction:-1,source:"manual"}
    ]
  };
}
const App = {
  s:{state:null,detail:null,route:"home",id:null,query:"",modal:null,draft:null,step:0,editing:null,modalContext:null},
  async api(path,method="GET",data){
    const resp=await fetch(path,{method,headers:data===undefined?{}:{"Content-Type":"application/json"},body:data===undefined?undefined:JSON.stringify(data)});
    const raw=await resp.text();
    let obj;try{obj=JSON.parse(raw)}catch{obj={error:"Resposta inválida do servidor."}}
    if(!resp.ok) throw new Error(obj.error||"Falha ao comunicar com o servidor.");
    return obj;
  },
  toast(message,error=false){
    const r=document.getElementById("toastRoot");
    const el=document.createElement("div");
    el.className="toast"+(error?" error":"");el.textContent=message;r.appendChild(el);
    setTimeout(()=>el.remove(),4200);
  },
  // Cada pasta e controle possui URL própria; o navegador registra Voltar/Avançar.
  navRouteFromUrl(){
    const hash=window.location.hash||"";
    const m=hash.match(/^#\/(board|control)\/([1-9]\d*)$/);
    if(!m)return {route:"home",id:null};
    const id=Number(m[2]);
    return Number.isSafeInteger(id)?{route:m[1],id}:{route:"home",id:null};
  },
  navUrl(route,id){
    const base=window.location.pathname+window.location.search;
    return base+(route==="home"?"":"#/"+route+"/"+id);
  },
  initNavigation(){
    const state=window.history.state;
    const index=state?.centralNav===1&&Number.isSafeInteger(state.index)&&state.index>=0?
      state.index:0;
    this.s.navIndex=index;
    this.s.navMax=Math.max(index,Number.isSafeInteger(state?.maxIndex)?state.maxIndex:index);
    const locationRoute=this.navRouteFromUrl();
    this.s.route=locationRoute.route;this.s.id=locationRoute.id;
    // Vincular a entrada inicial ao app, sem recarregar nem sair para o navegador.
    window.history.replaceState({centralNav:1,index,maxIndex:this.s.navMax},"",this.navUrl(this.s.route,this.s.id));
    window.addEventListener("popstate",event=>{
      const target=this.navRouteFromUrl();
      const pos=event.state?.centralNav===1&&Number.isSafeInteger(event.state.index)?
        event.state.index:this.s.navIndex;
      this.s.navIndex=pos;
      this.s.navMax=Math.max(this.s.navMax,pos);
      // Guardar limite de avanço na entrada atual para continuar após recarregar.
      window.history.replaceState({centralNav:1,index:pos,maxIndex:this.s.navMax},"",this.navUrl(target.route,target.id));
      this.navigate(target.route,target.id,{fromHistory:true});
    });
  },
  updateNavigationButtons(){
    const back=document.getElementById("navBack");
    const forward=document.getElementById("navForward");
    if(back)back.disabled=!(this.s.navIndex>0);
    if(forward)forward.disabled=!(this.s.navIndex<this.s.navMax);
  },
  goBack(){
    if(this.s.navIndex>0)window.history.back();
  },
  goForward(){
    if(this.s.navIndex<this.s.navMax)window.history.forward();
  },
  async load(){
    const request=(this.s.loadRevision||0)+1;
    this.s.loadRevision=request;
    try{
      const state=await this.api("/api/state");
      if(this.s.loadRevision!==request)return;
      this.s.state=state;
      if(this.s.route==="control" && this.s.id){
        const controlId=this.s.id;
        try{
          const detail=await this.api("/api/controls/"+controlId);
          if(this.s.loadRevision!==request||this.s.route!=="control"||this.s.id!==controlId)return;
          this.s.detail=detail;
        }catch{
          if(this.s.loadRevision!==request||this.s.route!=="control"||this.s.id!==controlId)return;
          this.s.route="home";this.s.id=null;this.s.detail=null;
          window.history.replaceState({centralNav:1,index:this.s.navIndex,maxIndex:this.s.navMax},"",this.navUrl("home"));
        }
      }
      if(this.s.loadRevision!==request)return;
      this.render();
    }catch(e){
      if(this.s.loadRevision!==request)return;
      this.toast(e.message,true);
      document.getElementById("main").innerHTML='<div class="empty-state"><strong>Servidor indisponível</strong>Verifique o painel de controle e tente novamente.</div>';
    }
  },
  navigate(route,id,options={}){
    const valid=["home","board","control"].includes(route);
    let nextRoute=valid?route:"home";
    let nextId=nextRoute==="home"?null:Number(id);
    if(nextRoute!=="home"&&(!Number.isSafeInteger(nextId)||nextId<=0)){
      nextRoute="home";nextId=null;
    }
    const changed=this.s.route!==nextRoute||this.s.id!==nextId;
    if(!options.fromHistory){
      if(changed&&!options.replace){
        const nextIndex=this.s.navIndex+1;
        window.history.pushState({centralNav:1,index:nextIndex,maxIndex:nextIndex},"",this.navUrl(nextRoute,nextId));
        this.s.navIndex=nextIndex;this.s.navMax=nextIndex;
      }else if(options.replace){
        window.history.replaceState({centralNav:1,index:this.s.navIndex,maxIndex:this.s.navMax},"",this.navUrl(nextRoute,nextId));
      }
    }
    // Uma navegação real encerra formulários/menus da tela anterior.
    if(changed&&this.s.modal)this.closeModal();
    if(changed)this.s.loadRevision=(this.s.loadRevision||0)+1;
    this.s.route=nextRoute;this.s.id=nextId;this.s.query="";
    const search=document.getElementById("search");
    if(search)search.value="";
    this.closeSearch();
    this.toggleMenu(false);
    this.closeControlMenus();
    this.updateNavigationButtons();
    if(nextRoute==="control"){
      if(changed||!this.s.detail||this.s.detail.control.id!==nextId){
        this.s.detail=null;
        this.load();
      }else this.render();
    }else{
      this.s.detail=null;
      this.render();
    }
  },
  search(q){
    this.s.query=String(q||"");
    this.renderSearchResults();
  },
  renderSearchResults(){
    const panel=document.getElementById("searchResults");
    const input=document.getElementById("search");
    if(!panel||!input)return;
    const parsed=parseSearchQuery(this.s.query);
    const data=this.s.state;
    if(!parsed.active||!data){panel.hidden=true;panel.innerHTML="";input.setAttribute("aria-expanded","false");return}
    const items=parsed.kind==="board"
      ?data.boards.filter(b=>normalizeSearch(b.name).includes(parsed.term))
      :data.controls.filter(c=>normalizeSearch(c.name).includes(parsed.term));
    const label=parsed.kind==="board"?"Pastas":"Controles";
    const hint=parsed.kind==="board"?"Buscando somente pastas":"Buscando controles em todas as pastas";
    panel.innerHTML='<div class="search-results-header"><strong>'+label+'</strong><span>'+items.length+' encontrado(s)</span></div>'+
      (items.length?'<div class="search-results-list">'+items.map(item=>{
        const isBoard=parsed.kind==="board";
        const boardName=isBoard?"Abrir pasta":data.boards.find(b=>b.id===item.board_id)?.name||"Pasta";
        const action=isBoard?"board":"control";
        const iconName=isBoard?"folder":["calculo","caminhao"].includes(item.mode)?"truck":item.mode==="financeiro"?"wallet":"clipboard";
        return '<button type="button" class="search-result" onclick="App.navigate(\''+action+'\','+item.id+')">'+
          '<span class="search-result-icon">'+icon(iconName)+'</span><span class="search-result-info"><strong>'+E(item.name)+'</strong><small>'+E(boardName)+'</small></span>'+
          icon("arrow-right")+'</button>';
      }).join("")+'</div>':
      '<div class="search-no-results">'+(parsed.kind==="board"?"Nenhuma pasta encontrada.":"Nenhum controle encontrado.")+'</div>')+
      '<div class="search-results-footer">'+E(hint)+' · '+(parsed.kind==="board"?"Retire P para buscar controles.":"Digite P e o nome para buscar pastas.")+'</div>';
    panel.hidden=false;
    input.setAttribute("aria-expanded","true");
  },
  closeSearch(){
    const results=document.getElementById("searchResults");
    const input=document.getElementById("search");
    if(results)results.hidden=true;
    if(input)input.setAttribute("aria-expanded","false");
  },
  searchKeydown(event){
    if(event.key==="Escape"){this.closeSearch();event.target.blur();return}
    if(event.key==="Enter"||event.key==="ArrowDown"){
      const first=document.querySelector("#searchResults .search-result");
      if(first){event.preventDefault();if(event.key==="Enter")first.click();else first.focus()}
    }
  },
  searchResultKeydown(event){
    if(event.key==="Escape"){this.closeSearch();document.getElementById("search").focus();return}
    if(event.key!=="ArrowDown"&&event.key!=="ArrowUp")return;
    const buttons=[...document.querySelectorAll("#searchResults .search-result")];
    const idx=buttons.indexOf(document.activeElement);
    if(idx<0)return;
    event.preventDefault();
    if(event.key==="ArrowUp"&&idx===0)document.getElementById("search").focus();
    else buttons[(idx+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length].focus();
  },
  toggleMenu(open){
    document.getElementById("sidebar").classList.toggle("open",open);
    document.getElementById("mobileShade").classList.toggle("open",open);
  },
  render(){
    const boards=this.s.state?.boards||[];
    const controls=this.s.state?.controls||[];
    document.getElementById("homeLink").classList.toggle("active",this.s.route==="home");
    document.getElementById("sideBoards").innerHTML=boards.map(b=>
      '<button class="board-link '+(this.s.route==="board"&&this.s.id===b.id?"active":"")+'" onclick="App.navigate(\'board\','+b.id+')">'+icon("folder")+'<span>'+E(b.name)+'</span><span class="count">'+controls.filter(c=>c.board_id===b.id).length+'</span></button>').join("");
    const moveBtn=document.getElementById("moveCurrentControl");
    if(moveBtn)moveBtn.hidden=this.s.route!=="control";
    const typeBtn=document.getElementById("changeCurrentControlType");
    if(typeBtn)typeBtn.hidden=this.s.route!=="control";
    this.renderMain();
    this.renderSearchResults();
    this.updateNavigationButtons();
  },
  renderMain(){
    const st=this.s.state;if(!st)return;
    const {boards,controls}=st;
    let title="Visão geral",crumb="CENTRAL / VISÃO GERAL";
    if(this.s.route==="board"){
      const b=boards.find(x=>x.id===this.s.id);if(!b)return this.navigate("home",null,{replace:true});
      title=b.name;crumb="CENTRAL / PASTAS";
    }
    if(this.s.route==="control"){
      const c=this.s.detail?.control;
      if(!c)return;
      title=c.name;crumb="CENTRAL / "+(boards.find(b=>b.id===c.board_id)?.name||"CONTROLE");
    }
    document.getElementById("pageTitle").textContent=title;
    document.getElementById("crumb").textContent=crumb;
    const main=document.getElementById("main");
    if(this.s.route==="home"){
      main.innerHTML='<div class="section-heading boards-home-heading"><h2>Suas pastas</h2>'+
        '<div class="boards-home-actions"><span class="secondary-text">'+boards.length+' pasta(s)</span>'+
        '<button type="button" class="btn btn-primary btn-sm" onclick="App.newBoard()">'+icon("plus")+' Nova pasta</button></div></div>'+
      (boards.length?'<div class="board-grid">'+boards.map(b=>boardCard(b,controls.filter(c=>c.board_id===b.id).length)).join("")+'</div>':empty("Nenhuma pasta","Crie uma pasta para organizar seus controles.","App.newBoard()","Criar pasta"));
    } else if(this.s.route==="board"){
      const b=boards.find(x=>x.id===this.s.id);
      const found=controls.filter(c=>c.board_id===b.id);
      main.innerHTML='<div class="section-heading board-controls-heading"><h2>Controles</h2>'+
       '<div class="board-controls-actions"><span class="secondary-text">'+found.length+' controle(s)</span>'+
       '<button type="button" class="btn btn-quiet btn-sm" onclick="App.renameBoard('+b.id+')">'+icon("edit")+' Renomear pasta</button>'+
       '<button type="button" class="btn btn-quiet btn-sm" onclick="App.deleteBoard('+b.id+')">'+icon("trash")+' Excluir pasta</button></div></div>'+
       (found.length?'<div class="control-grid">'+found.map(controlCard).join("")+'</div>':
       empty("Pasta vazia","Adicione um controle para começar.","App.newControl("+b.id+")","Criar controle"));
    } else if(this.s.route==="control")this.renderControl();
  },
  renderControl(){
    const d=this.s.detail,c=d.control,sum=d.summary;
    if(c.mode==="caminhao")return this.renderTruck();
    if(c.mode==="divida")return this.renderDebt();
    if(c.mode==="divida_sem_valor")return this.renderOpenDebt();
    if(c.mode==="recebimento")return this.renderReceiving();
    if(c.mode==="acerto_ab")return this.renderPair();
    if(c.mode==="vale_funcionarios")return this.renderVales();
    const mode={"saldo":"Saldo devedor","financeiro":"Entradas e saídas","calculo":"Controle calculado","caminhao":"Controle de Caminhão"}[c.mode];
    const entries=d.entries;
    const datefield=c.fields.find(f=>f.type==="date");
    const subjectfield=c.fields.find(f=>f.type==="text");
    const cSummary=(rows,key)=>rows.length?rows.map(x=>'<div class="info-row"><span>'+E(x.name)+'</span><strong class="'+(Number(x.total)<0?"negative":"")+'">'+currency(x.total)+'</strong></div>').join(""):'<p class="secondary-text">Sem dados para exibir.</p>';
    document.getElementById("main").innerHTML='<section class="intro"><div><div class="eyebrow">'+E(mode)+'</div><h2>'+E(c.name)+'</h2><p class="subtext">Formulário próprio, cálculos automáticos e registro de cada movimentação.</p></div><div class="actions-end"><button class="btn btn-primary" onclick="App.newEntry()">'+icon("plus")+' Novo lançamento</button></div></section>'+
      '<section class="stat-grid">'+stat("＋","Total somado",currency(sum.plus),"Valores que aumentam")+stat("−","Total subtraído",currency(sum.minus),"Valores que diminuem")+stat("◉","Saldo do controle",currency(sum.balance),"Conforme os tipos definidos")+stat("≡","Lançamentos",sum.count,"Registros salvos")+'</section>'+
      '<div class="details-layout"><div class="stack"><section class="panel"><div class="panel-header"><h3>Histórico de lançamentos</h3><div class="actions-end"><button class="btn btn-sm" onclick="App.exportCsv('+c.id+')">'+icon("download")+' Exportar CSV</button></div></div>'+
      (entries.length?'<div class="table-wrap"><table><thead><tr><th>Data</th><th>Referência</th><th>Tipo</th><th>Categoria</th><th style="text-align:right">Valor</th><th style="text-align:right">Ações</th></tr></thead><tbody>'+
      entries.map(e=>{const showdate=datefield?e.data[datefield.key]:"";
        const dateText=showdate&&/^\d{4}-\d\d-\d\d$/.test(showdate)?showdate.slice(8)+"/"+showdate.slice(5,7)+"/"+showdate.slice(0,4):"—";
        const subject=subjectfield?e.data[subjectfield.key]:"Lançamento #"+e.id;
        return '<tr><td>'+E(dateText)+'</td><td><b>'+E(subject)+'</b>'+(e.notes?'<div class="secondary-text">'+E(e.notes.slice(0,65))+'</div>':"")+'</td><td>'+E(e.type_label)+'</td><td><span class="chip">'+E(e.category)+'</span></td><td class="numeric '+(e.direction<0?"negative":e.direction===0?"neutral":"positive")+'">'+(e.direction>0?"+":e.direction<0?"−":"") +currency(e.amount)+'</td><td><div class="table-actions"><button class="mini-action" onclick="App.editEntry('+e.id+')">'+icon("edit")+' Editar</button><button class="mini-action" onclick="App.deleteEntry('+e.id+')">'+icon("trash")+' Excluir</button></div></td></tr>'}).join("")+
      '</tbody></table></div>':'<div class="empty-state"><strong>Sem lançamentos</strong><p>Utilize o botão Novo lançamento no topo para começar.</p></div>')+'</section></div>'+
      '<aside class="stack"><section class="panel"><div class="panel-header"><h3>Resumo por categoria</h3></div><div class="panel-body">'+cSummary(sum.by_category)+'</div></section>'+
      '<section class="panel"><div class="panel-header"><h3>Resumo por tipo</h3></div><div class="panel-body">'+cSummary(sum.by_type)+'</div></section>'+
      '</aside></div>';
  },
  async renameBoard(id){
    const b=this.s.state.boards.find(x=>x.id===id),name=prompt("Nome da pasta:",b.name);
    if(name===null)return;
    try{await this.api("/api/boards/"+id,"PATCH",{name});this.toast("Pasta atualizada.");await this.load()}catch(e){this.toast(e.message,true)}
  },
  newBoard(){
    if(!this.canOpenForm())return;
    this.s.modal="new-board";
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal board-create-modal" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Nova pasta</h2>'+
      '<p>Crie uma pasta para organizar seus controles.</p></div>'+
      '<button type="button" class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="newBoardForm" onsubmit="event.preventDefault();App.saveNewBoard()">'+
      '<div class="field"><label for="newBoardName">Nome da pasta</label>'+
      '<input id="newBoardName" name="name" type="text" maxlength="150" placeholder="Ex.: TRANSPORTADORA, FAZENDA, FINANCEIRO" autocomplete="off" oninput="this.setCustomValidity(String())" required></div>'+
      '</form></div><div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button id="saveNewBoard" type="submit" form="newBoardForm" class="btn btn-primary">'+icon("plus")+' Criar pasta</button>'+
      '</div></div></div>';
    document.getElementById("newBoardName")?.focus();
  },
  async saveNewBoard(){
    if(this.s.modal!=="new-board")return;
    const form=document.getElementById("newBoardForm");
    const field=document.getElementById("newBoardName");
    if(!form||!field||!form.reportValidity())return;
    const name=field.value.trim();
    if(!name){
      field.setCustomValidity("Informe o nome da pasta.");
      field.reportValidity();
      return;
    }
    if(this.s.state?.boards?.some(b=>normalizeSearch(b.name)===normalizeSearch(name))){
      this.toast("Já existe uma pasta com esse nome.",true);
      field.focus();return;
    }
    const save=document.getElementById("saveNewBoard");
    if(save?.disabled)return;
    if(save)save.disabled=true;
    try{
      const created=await this.api("/api/boards","POST",{name});
      this.closeModal();
      await this.load();
      this.navigate("board",created.id);
      this.toast("Pasta criada com sucesso.");
    }catch(e){
      if(save)save.disabled=false;
      this.toast(e.message,true);
    }
  },
  async deleteBoard(id){
    if(!confirm("Excluir esta pasta? Antes, mova os controles para outra pasta. Seus lançamentos serão preservados."))return;
    try{await this.api("/api/boards/"+id,"DELETE");await this.load();this.navigate("home");this.toast("Pasta excluída.")}catch(e){this.toast(e.message,true)}
  },
  moveControlForm(id){
    if(!this.canOpenForm())return;
    const control=this.s.state?.controls?.find(c=>c.id===id);
    const folders=this.s.state?.boards||[];
    if(!control)return this.toast("Controle não encontrado.",true);
    const targets=folders.filter(b=>b.id!==control.board_id);
    if(!targets.length)return this.toast("Crie outra pasta antes de mover este controle.",true);
    const current=folders.find(b=>b.id===control.board_id);
    this.s.modal="move-control";
    this.s.modalContext={controlId:id,sourceBoardId:control.board_id};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal move-control-modal" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Mover controle para outra pasta</h2>'+
      '<p>'+E(control.name)+'</p></div><button type="button" class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><p class="move-control-note">Pasta atual: <strong>'+E(current?.name||"Desconhecida")+'</strong></p>'+
      '<form id="moveControlForm" onsubmit="event.preventDefault();App.saveControlMove()">'+
      '<div class="field"><label for="destinationFolder">Pasta de destino</label>'+
      '<select id="destinationFolder" name="board_id" required>'+fSelect(targets.map(b=>[b.id,b.name]),targets[0].id)+'</select></div></form>'+
      '<p class="move-control-note">Todos os lançamentos, saldos e fechamentos serão preservados.</p></div>'+
      '<div class="modal-footer"><button type="button" class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button id="confirmMoveControl" type="submit" form="moveControlForm" class="btn btn-primary">'+icon("folder")+' Mover controle</button></div></div></div>';
  },
  async saveControlMove(){
    if(this.s.modal!=="move-control")return;
    const form=document.getElementById("moveControlForm"),ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    const destination=Number(new FormData(form).get("board_id"));
    if(!Number.isSafeInteger(destination)||destination<=0||destination===ctx.sourceBoardId)
      return this.toast("Escolha outra pasta válida.",true);
    const button=document.getElementById("confirmMoveControl");
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{
      await this.api("/api/controls/"+ctx.controlId+"/move","PATCH",{board_id:destination});
      this.closeModal();
      await this.load();
      const name=this.s.state.boards.find(b=>b.id===destination)?.name||"a pasta selecionada";
      this.toast("Controle movido para "+name+".");
    }catch(e){
      if(button)button.disabled=false;
      this.toast(e.message,true);
    }
  },
  async duplicateControl(id){
    try{await this.api("/api/controls/"+id+"/duplicate","POST",{});await this.load();this.toast("Cópia criada na mesma pasta, sem copiar lançamentos.")}catch(e){this.toast(e.message,true)}
  },
  async deleteControl(id){
    if(!confirm("Excluir o controle e TODOS os lançamentos dele? Esta ação não pode ser desfeita."))return;
    const boardOrigin=this.s.route==="board"?this.s.id:null;
    try{
      await this.api("/api/controls/"+id,"DELETE");
      await this.load();
      this.navigate(boardOrigin?"board":"home",boardOrigin||undefined);
      this.toast("Controle excluído.");
    }catch(e){this.toast(e.message,true)}
  },
  exportCsv(id){window.location.href="/api/controls/"+id+"/export.csv"},
  canOpenForm(){
    if(!this.s.modal)return true;
    this.toast("Já existe um formulário aberto. Salve ou cancele antes de abrir outro.");
    document.getElementById("modalTitle")?.focus();
    return false;
  },
  newControl(boardId){
    if(!this.canOpenForm())return;
    this.s.modal="builder";this.s.editing=null;this.s.modalContext=null;this.s.step=0;this.s.draft=template();
    const destination=boardId||(this.s.route==="board"?this.s.id:null);
    if(destination)this.s.draft.board_id=destination;
    this.renderModal();
  },
  editControl(id){
    if(!this.canOpenForm())return;
    const source=this.s.state?.controls?.find(c=>c.id===id);
    if(!source){this.toast("Controle não encontrado.",true);return}
    if(source.mode==="caminhao")return this.truckSettings(id);
    if(source.mode==="divida")return this.debtSettings(id);
    if(source.mode==="divida_sem_valor")return this.openDebtSettings(id);
    if(source.mode==="recebimento")return this.receivingSettings(id);
    if(source.mode==="acerto_ab")return this.pairSettings(id);
    if(source.mode==="vale_funcionarios")return this.valesEmployeeForm();
    this.s.modal="builder";this.s.editing=id;this.s.modalContext=null;this.s.step=0;this.s.draft=deep(source);
    this.renderModal();
  },
  closeControlMenus(){
    document.querySelectorAll(".card-action-menu").forEach(el=>el.hidden=true);
    document.querySelectorAll(".control-card-edit").forEach(el=>el.setAttribute("aria-expanded","false"));
  },
  toggleControlMenu(event,id){
    event.stopPropagation();
    const menu=document.getElementById("controlMenu-"+id);
    if(!menu)return;
    const opening=menu.hidden;
    this.closeControlMenus();
    if(opening){
      menu.hidden=false;
      event.currentTarget.setAttribute("aria-expanded","true");
    }
  },
  controlMenuAction(event,action,id){
    event.preventDefault();
    event.stopPropagation();
    this.closeControlMenus();
    if(action==="configure")return this.editControl(id);
    if(action==="type")return this.changeControlTypeForm(id);
    if(action==="move")return this.moveControlForm(id);
    if(action==="duplicate")return this.duplicateControl(id);
    if(action==="delete")return this.deleteControl(id);
  },
  updateDraft(prop,value){this.s.draft[prop]=value},
  mode(mode){
    if(this.s.editing)return;
    const old=this.s.draft;
    this.s.draft=template(mode);
    this.s.draft.name=["Novo controle","Controle de Fretes","Controle de Caminhão","Controle de Dívidas","Dívidas sem valor fixo","Recebimento de Produtos","Acerto A × B","Vales de Funcionários"].includes(old.name)?
       this.s.draft.name:old.name;
    this.s.draft.board_id=old.board_id;
    this.renderModal();
  },
  setItem(collection,i,prop,value){
    const item=this.s.draft[collection][i];if(!item)return;
    item[prop]=prop==="direction"?Number(value):prop==="required"?Boolean(value):value;
    if(prop==="type"||prop==="op")this.renderModal();
  },
  addField(){
    const label=prompt("Nome do campo:");
    if(!label?.trim())return;
    let key=slug(label).slice(0,40);let seq=2;
    while([...this.s.draft.fields,...this.s.draft.rules].some(x=>x.key===key))key=slug(label).slice(0,35)+"_"+seq++;
    this.s.draft.fields.push({key,label:label.trim(),type:"text",required:false});
    this.renderModal();
  },
  removeField(i){
    const d=this.s.draft,k=d.fields[i].key;d.fields.splice(i,1);
    const removed=new Set([k]);let again=true;
    while(again){again=false;for(const r of d.rules){if(removed.has(r.a)||removed.has(r.b)){removed.add(r.key);again=true}}d.rules=d.rules.filter(r=>!removed.has(r.key))}
    for(const t of d.types){if(removed.has(t.source))t.source="manual"}
    this.renderModal();
  },
  addRule(){
    const d=this.s.draft;
    const numeric=d.fields.filter(f=>["number","currency","percent"].includes(f.type));
    if(!numeric.length&&!d.rules.length)return this.toast("Primeiro adicione um campo numérico.",true);
    const label=prompt("Nome do cálculo (ex.: Valor total):");
    if(!label?.trim())return;
    let key=slug(label).slice(0,39),seq=2;
    while([...d.fields,...d.rules].some(x=>x.key===key))key=slug(label).slice(0,34)+"_"+seq++;
    const a=numeric[0]?.key || d.rules[0].key;
    d.rules.push({key,label:label.trim(),op:"multiply",a,b:a});
    this.renderModal();
  },
  removeRule(i){
    const d=this.s.draft,removed=new Set([d.rules[i].key]);
    let again=true;while(again){again=false;for(const r of d.rules){if(removed.has(r.a)||removed.has(r.b)){if(!removed.has(r.key)){removed.add(r.key);again=true}}}}
    d.rules=d.rules.filter(r=>!removed.has(r.key));
    for(const t of d.types)if(removed.has(t.source))t.source="manual";
    this.renderModal();
  },
  addType(){
    const label=prompt("Nome do tipo de lançamento:");
    if(!label?.trim())return;
    let key=slug(label).slice(0,39),seq=2;
    while(this.s.draft.types.some(t=>t.key===key))key=slug(label).slice(0,34)+"_"+seq++;
    this.s.draft.types.push({key,label:label.trim(),direction:1,source:"manual"});
    this.renderModal();
  },
  async saveControl(){
    try{
      const d=this.s.draft;
      const r=this.s.editing?await this.api("/api/controls/"+this.s.editing,"PATCH",d):await this.api("/api/controls","POST",d);
      const id=this.s.editing||r.id;
      const boardOrigin=this.s.editing&&this.s.route==="board"?this.s.id:null;
      this.closeModal();await this.load();
      if(boardOrigin)this.navigate("board",boardOrigin);
      else this.navigate("control",id);
      this.toast("Controle salvo com sucesso.");
    }catch(e){this.toast(e.message,true)}
  },
  builderNext(delta){this.s.step=Math.max(0,Math.min(3,this.s.step+delta));this.renderModal()},
  newEntry(){
    if(!this.canOpenForm()||!this.s.detail)return;
    this.s.modalContext={controlId:this.s.detail.control.id,
      control:deep(this.s.detail.control),entry:null};
    this.s.modal="entry";this.s.editing=null;this.renderModal();
  },
  editEntry(id){
    if(!this.canOpenForm()||!this.s.detail)return;
    const entry=this.s.detail.entries.find(e=>e.id===id);
    if(!entry){this.toast("Lançamento não encontrado.",true);return}
    this.s.modalContext={controlId:this.s.detail.control.id,
      control:deep(this.s.detail.control),entry:deep(entry)};
    this.s.modal="entry";this.s.editing=id;this.renderModal();
  },
  async deleteEntry(id){
    if(!confirm("Excluir este lançamento?"))return;
    try{await this.api("/api/entries/"+id,"DELETE");await this.load();this.toast("Lançamento excluído.")}catch(e){this.toast(e.message,true)}
  },
  async saveEntry(){
    const form=document.getElementById("entryForm");if(!form)return;
    if(!form.reportValidity())return;
    const fd=new FormData(form),p={data:{},type_key:fd.get("type_key"),category:fd.get("category"),
      notes:fd.get("notes"),manual_amount:fd.get("manual_amount")};
    const ctx=this.s.modalContext;
    if(!ctx){this.toast("Formulário não encontrado.",true);return}
    for(const f of ctx.control.fields)p.data[f.key]=fd.get(f.key)||"";
    try{
      const id=ctx.entry?.id||null;
      await this.api(id?"/api/entries/"+id:"/api/controls/"+ctx.controlId+"/entries",id?"PUT":"POST",p);
      this.closeModal();await this.load();this.toast(id?"Lançamento atualizado.":"Lançamento salvo.");
    }catch(e){this.toast(e.message,true)}
  },
  closeModal(){
    this.s.modal=null;this.s.draft=null;this.s.editing=null;this.s.modalContext=null;
    document.getElementById("modalRoot").innerHTML="";
  },
  renderModal(){
    const root=document.getElementById("modalRoot");
    if(!this.s.modal)return root.innerHTML="";
    root.innerHTML='<div class="modal-backdrop"><div class="modal '+(this.s.modal==="builder"?"large":"")+'" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      (this.s.modal==="builder"?this.builderHTML():this.entryHTML())+'</div></div>';
    // Formulário não modal: nenhum clique externo encerra ou bloqueia a página.
    // O foco pode sair do formulário; fechar exige ação explícita (X ou Cancelar).
    if(this.s.modal==="entry")this.preview();
  },
  builderHTML(){
    const d=this.s.draft,step=this.s.step;
    const heads=["1. Dê um nome ao controle","2. Monte seu formulário","3. Configure os cálculos","4. Defina os lançamentos"];
    const sub=["Comece com um modelo pronto. Você pode alterar tudo depois.","Escolha as informações que serão preenchidas em cada lançamento.","Os resultados aparecem automaticamente, sem digitar fórmulas.","Defina quais lançamentos somam, diminuem ou apenas informam."];
    let body='';
    if(step===0){
      body='<div class="form-grid"><div class="field full"><label>Nome do controle</label><input maxlength="150" value="'+E(d.name)+'" oninput="App.updateDraft(\'name\',this.value)"></div>'+
        '<div class="field full"><label>Em qual pasta?</label><select onchange="App.updateDraft(\'board_id\',Number(this.value))">'+
        fSelect(this.s.state.boards.map(b=>[b.id,b.name]),d.board_id)+'</select></div></div>'+
        '<div class="field" style="margin-top:19px"><label>Modelo do controle</label>'+
        '<div class="wizard-choice truck-model-featured"><button class="choice '+(d.mode==="caminhao"?"selected":"")+'" onclick="App.mode(\'caminhao\')" type="button">'+icon("truck")+' <strong>Controle de Caminhão</strong><small>Pronto para fretes, despesas, comissão de 13% e vales.</small></button><button type="button" class="choice '+(d.mode==="divida"?"selected":"")+'" onclick="App.mode(&quot;divida&quot;)">'+icon("wallet")+' <strong>Controle de Dívidas</strong><small>Saldo inicial e pagamentos descritos.</small></button>'+
         '<button type="button" class="choice '+(d.mode==="divida_sem_valor"?"selected":"")+'" onclick="App.mode(&quot;divida_sem_valor&quot;)">'+icon("wallet")+
         ' <strong>Dívidas sem valor fixo</strong><small>Pagamentos que apenas se acumulam, sem valor final.</small></button>'+
         '<button type="button" class="choice '+(d.mode==="recebimento"?"selected":"")+'" onclick="App.mode(&quot;recebimento&quot;)">'+icon("clipboard")+
         ' <strong>Recebimento de Produtos</strong><small>Pedidos, fornecedores, produtos e notas fiscais.</small></button>'+
         '<button type="button" class="choice '+(d.mode==="acerto_ab"?"selected":"")+'" onclick="App.mode(&quot;acerto_ab&quot;)">'+icon("wallet")+
         ' <strong>Acerto A × B</strong><small>Quem deve a quem, saldo compensado e fechamentos.</small></button>'+
          '<button type="button" class="choice '+(d.mode==="vale_funcionarios"?"selected":"")+'" onclick="App.mode(&quot;vale_funcionarios&quot;)">'+icon("users")+
          ' <strong>Vales de Funcionários</strong><small>Funcionários, empréstimos, parcelas por mês e descontos.</small></button></div>'+
        '<details class="model-advanced" '+(!["caminhao","divida","divida_sem_valor","recebimento","acerto_ab","vale_funcionarios"].includes(d.mode)?"open":"")+'><summary>Outros modelos (configuração avançada)</summary><div class="wizard-choice">'+
        [["saldo","Saldo devedor","Acompanhar quanto falta receber."],["financeiro","Entradas e saídas","Registrar entradas, despesas e saldo."],["calculo","Cálculos personalizados","Crie seus campos e cálculos."]].map(([m,title,desc])=>
          '<button type="button" class="choice '+(d.mode===m?"selected":"")+'" onclick="App.mode(\''+m+'\')"><strong>'+title+'</strong><small>'+desc+'</small></button>').join("")+'</div></details></div>'+
        (d.mode==="acerto_ab"?'<div class="pair-setup"><p class="hint">Informe as duas pessoas. Você poderá lançar dívidas nos dois sentidos e fechar períodos.</p>'+
           '<div class="form-grid">'+
           '<div class="field"><label>Pessoa A</label><input maxlength="160" value="'+E(d.pair_settings.party_a)+'" oninput="App.s.draft.pair_settings.party_a=this.value"></div>'+
           '<div class="field"><label>Pessoa B</label><input maxlength="160" value="'+E(d.pair_settings.party_b)+'" oninput="App.s.draft.pair_settings.party_b=this.value"></div></div></div>':
        d.mode==="vale_funcionarios"?'<div class="hint" style="margin-top:15px">Cadastre funcionários, lance vales à vista ou parcelados e acompanhe os descontos mensais. Você poderá ajustar o calendário antes de salvar.</div>':
        d.mode==="divida_sem_valor"?'<div class="hint" style="margin-top:15px">Registre pagamentos com data, valor e descrição. Cada valor aumenta o total acumulado, sem meta, dívida inicial ou limite.</div>':
        d.mode==="recebimento"?'<div class="hint" style="margin-top:15px">Cadastre pedidos e produtos dentro do controle. Cada entrega terá quantidade e número da nota fiscal. Sem fórmulas.</div>':
        d.mode==="divida"?'<div class="debt-setup"><p class="hint">Informe a dívida inicial. Depois registre pagamentos com data, descrição e valor.</p>'+
          '<div class="field"><label>Valor inicial da dívida (R$)</label><input inputmode="decimal" placeholder="Ex.: 90000,00" value="'+E(d.debt_settings.opening_amount)+'" oninput="App.s.draft.debt_settings.opening_amount=this.value"></div></div>':
        d.mode==="caminhao"?'<div class="truck-ready-settings"><div class="hint">Modelo pronto: frete normal/morto, despesas e vale do motorista. Sem fórmulas.</div>'+
          '<div class="form-grid"><div class="field"><label>Comissão padrão (%)</label><input inputmode="decimal" value="'+E(d.truck_settings.commission_pct)+'" oninput="App.s.draft.truck_settings.commission_pct=this.value"></div>'+
          '<div class="field"><label>Motorista (opcional)</label><input maxlength="100" value="'+E(d.truck_settings.driver_name)+'" oninput="App.s.draft.truck_settings.driver_name=this.value"></div>'+
          '<div class="field"><label>Comissão anterior a pagar (R$)</label><input inputmode="decimal" value="'+E(d.truck_settings.opening_commission)+'" oninput="App.s.draft.truck_settings.opening_commission=this.value"></div>'+
          '<div class="field"><label>Saldo inicial do caixa (R$)</label><input inputmode="decimal" value="'+E(d.truck_settings.opening_cash)+'" oninput="App.s.draft.truck_settings.opening_cash=this.value"></div></div></div>':
         this.s.editing?'<div class="hint" style="margin-top:15px">É possível editar seus campos e regras nas próximas etapas.</div>':'');
    }else if(step===1){
      body='<div class="hint">Os campos abaixo formam a tela de lançamento. Para criar outro, clique em <b>Adicionar campo</b>.</div>'+
      d.fields.map((f,i)=>'<div class="form-row-card"><div class="field"><label>Nome do campo</label><input value="'+E(f.label)+'" maxlength="150" oninput="App.setItem(\'fields\','+i+',\'label\',this.value)"></div>'+
       '<div class="field"><label>Formato</label><select onchange="App.setItem(\'fields\','+i+',\'type\',this.value)">'+fSelect(fieldTypes,f.type)+'</select></div>'+
       '<button class="btn btn-sm" title="Remover campo" onclick="App.removeField('+i+')">'+icon("x")+'</button>'+
       (f.type==="percent"?'<div class="field"><label>Valor padrão (%)</label><input value="'+E(f.default||"")+'" oninput="App.setItem(\'fields\','+i+',\'default\',this.value)"></div>':'')+
       '<label class="secondary-text" style="align-self:end"><input type="checkbox" '+(f.required?"checked":"")+' onchange="App.setItem(\'fields\','+i+',\'required\',this.checked)"> Obrigatório</label>'+
       '</div>').join("")+
      '<button class="btn btn-sm" onclick="App.addField()">'+icon("plus")+' Adicionar campo</button>';
    }else if(step===2){
      body='<div class="hint">Exemplo: <b>Peso carregado × Valor por kg = Valor do frete</b>. Escolha os campos e a operação, sem escrever fórmulas.</div>'+
      (d.rules.length?d.rules.map((r,i)=>{
        const prev=[...d.fields.filter(f=>["number","currency","percent"].includes(f.type)),...d.rules.slice(0,i)].map(f=>[f.key,f.label]);
        return '<div class="config-rule"><div class="field"><label>Nome do resultado</label><input maxlength="150" value="'+E(r.label)+'" oninput="App.setItem(\'rules\','+i+',\'label\',this.value)"></div>'+
         '<div class="field"><label>Operação</label><select onchange="App.setItem(\'rules\','+i+',\'op\',this.value)">'+fSelect(ops,r.op)+'</select></div>'+
         '<div class="field"><label>Primeiro valor</label><select onchange="App.setItem(\'rules\','+i+',\'a\',this.value)">'+fSelect(prev,r.a)+'</select></div>'+
         '<div class="field"><label>Segundo valor</label><select onchange="App.setItem(\'rules\','+i+',\'b\',this.value)">'+fSelect(prev,r.b)+'</select></div>'+
         '<button class="btn btn-sm" onclick="App.removeRule('+i+')">'+icon("x")+'</button></div>';
      }).join(""):'<p class="secondary-text">Este controle ainda não possui cálculos automáticos.</p>')+
      '<button class="btn btn-sm" style="margin-top:10px" onclick="App.addRule()">'+icon("plus")+' Adicionar cálculo</button>';
    }else{
      const available=[["manual","Valor digitado"],...d.fields.filter(f=>["number","currency","percent"].includes(f.type)).map(f=>[f.key,f.label]),...d.rules.map(r=>[r.key,r.label])];
      body='<div class="hint">Cada lançamento terá um comportamento. Exemplo: <b>Pagamento recebido</b> diminui o saldo; <b>Nova cobrança</b> aumenta.</div>'+
       d.types.map((t,i)=>'<div class="config-type"><div class="field"><label>Nome do lançamento</label><input maxlength="150" value="'+E(t.label)+'" oninput="App.setItem(\'types\','+i+',\'label\',this.value)"></div>'+
       '<div class="field"><label>Comportamento</label><select onchange="App.setItem(\'types\','+i+',\'direction\',this.value)">'+fSelect(directions,t.direction)+'</select></div>'+
       '<div class="field"><label>De onde vem o valor?</label><select onchange="App.setItem(\'types\','+i+',\'source\',this.value)">'+fSelect(available,t.source)+'</select></div>'+
       '<button class="btn btn-sm" onclick="App.s.draft.types.splice('+i+',1);App.renderModal()">'+icon("x")+'</button></div>').join("")+
       '<button class="btn btn-sm" style="margin-top:10px" onclick="App.addType()">'+icon("plus")+' Novo tipo de lançamento</button>'+
       '<p class="secondary-text" style="margin-top:14px">Registros antigos permanecem guardados com seus valores e cálculos originais quando você muda as regras.</p>';
    }
    return '<div class="modal-header"><div><h2 id="modalTitle">'+(this.s.editing?"Configurar controle":"Criar controle")+'</h2><p>'+(["caminhao","divida","divida_sem_valor","recebimento","acerto_ab","vale_funcionarios"].includes(d.mode)?"Modelo pronto":E(heads[step]))+'</p></div><button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body">'+(["caminhao","divida","divida_sem_valor","recebimento","acerto_ab","vale_funcionarios"].includes(d.mode)?"":'<div class="step-dots">'+[0,1,2,3].map(i=>'<div class="step-dot '+(i<=step?"done":"")+'"></div>').join("")+'</div>')+
      '<h3 style="margin-bottom:13px">'+(d.mode==="caminhao"?"Escolha um nome e a comissão. Os lançamentos já vêm prontos.":d.mode==="divida"?"Informe o nome e o valor inicial da dívida.":d.mode==="divida_sem_valor"?"Informe o nome. Os pagamentos serão somados sem limite e sem valor final.":d.mode==="recebimento"?"Informe o nome do controle. Depois você poderá cadastrar quantos pedidos e produtos precisar.":d.mode==="acerto_ab"?"Informe os nomes de A e B. O saldo compensado é automático.":d.mode==="vale_funcionarios"?"Informe o nome do controle. Depois cadastre funcionários e seus vales.":E(sub[step]))+'</h3>'+body+'</div>'+
      '<div class="modal-footer"><button class="btn" onclick="'+(step===0?"App.closeModal()":"App.builderNext(-1)")+'">'+(step===0?"Cancelar":"Voltar")+'</button>'+
      '<div class="tagline"><span class="secondary-text">'+(["caminhao","divida","divida_sem_valor","recebimento","acerto_ab","vale_funcionarios"].includes(d.mode)?"Modelo pronto, sem fórmulas":"Etapa "+(step+1)+" de 4")+'</span><button class="btn btn-primary" onclick="'+(["caminhao","divida","divida_sem_valor","recebimento","acerto_ab","vale_funcionarios"].includes(d.mode)||step===3?"App.saveControl()":"App.builderNext(1)")+'">'+(["caminhao","divida","divida_sem_valor","recebimento","acerto_ab","vale_funcionarios"].includes(d.mode)?"Criar controle":step===3?"Salvar controle":"Continuar →")+'</button></div></div>';
  },
  entryHTML(){
    const c=this.s.modalContext.control;
    const old=this.s.modalContext.entry;
    const now=new Date(),today=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
    const fields=c.fields.map(f=>{
      const val=old?.data?.[f.key]??(f.type==="date"?today:(f.default||""));
      let type=f.type==="date"?"date":["number","currency","percent"].includes(f.type)?"text":"text";
      const extra=f.type==="number"||f.type==="currency"||f.type==="percent"?' inputmode="decimal"':'';
      return '<div class="field"><label for="field_'+E(f.key)+'">'+E(f.label)+(f.required?" *":"")+'</label><input id="field_'+E(f.key)+'" type="'+type+'" name="'+E(f.key)+'" value="'+E(val)+'" '+extra+' '+(f.required?"required":"")+' maxlength="2000" oninput="App.preview()"></div>'
    }).join("");
    const types=c.types.map(t=>[t.key,t.label]),oldtype=old?.type_key||c.types[0].key;
    const derived=old?.type_key&& !c.types.some(t=>t.key===old.type_key);
    return '<div class="modal-header"><div><h2 id="modalTitle">'+(old?"Editar lançamento":"Novo lançamento")+'</h2><p>'+E(c.name)+'</p></div><button class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="entryForm" onsubmit="event.preventDefault();App.saveEntry()">'+
      (derived?'<div class="hint">O tipo anterior não existe mais. Selecione um tipo atual.</div>':"")+
      '<div class="form-grid"><div class="field full"><label>Tipo de lançamento *</label><select name="type_key" onchange="App.preview()">'+fSelect(types,oldtype)+'</select></div>'+fields+
      '<div class="field" id="manualField"><label>Valor do lançamento (R$)</label><input inputmode="decimal" name="manual_amount" value="'+E(old?.amount||"")+'" oninput="App.preview()"></div>'+
      '<div class="field"><label>Categoria</label><input name="category" maxlength="100" value="'+E(old?.category||"Geral")+'" placeholder="Ex.: Soja, Milho, Motorista"></div>'+
      '<div class="field full"><label>Observações</label><textarea name="notes" maxlength="3000" placeholder="Informações adicionais...">'+E(old?.notes||"")+'</textarea></div></div></form>'+
      '<div class="calc-preview" id="calcPreview"></div></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button><button class="btn btn-primary" onclick="App.saveEntry()">Salvar lançamento</button></div>';
  },
  preview(){
    const c=this.s.modalContext?.control,form=document.getElementById("entryForm"),box=document.getElementById("calcPreview");
    if(!c||!form||!box)return;
    const fd=new FormData(form),nums={};
    const parse=s=>{s=String(s||"0").trim();if(s.includes(","))s=s.replace(/\./g,"").replace(",",".");const n=Number(s);return Number.isFinite(n)?n:0};
    for(const f of c.fields)if(["number","currency","percent"].includes(f.type))nums[f.key]=parse(fd.get(f.key));
    let rows=[];
    for(const r of c.rules){
      const a=nums[r.a]||0,b=nums[r.b]||0;
      let n=({multiply:()=>a*b,percent:()=>a*b/100,subtract:()=>a-b,add:()=>a+b}[r.op]||(()=>0))();
      n=Math.round((n+Number.EPSILON)*100)/100;
      nums[r.key]=n;rows.push('<div class="calc-line"><span>'+E(r.label)+'</span><b>'+currency(n)+'</b></div>');
    }
    const t=c.types.find(x=>x.key===fd.get("type_key"))||c.types[0];
    const manual=document.getElementById("manualField");
    if(manual)manual.style.display=t.source==="manual"?"flex":"none";
    const amount=t.source==="manual"?parse(fd.get("manual_amount")):nums[t.source]||0;
    rows.push('<div class="calc-line" style="border-top:1px solid #bddbcf;padding-top:11px;margin-top:11px"><span>Valor do lançamento ('+(t.direction>0?"soma":t.direction<0?"subtrai":"informativo")+')</span><b>'+currency(amount)+'</b></div>');
    box.innerHTML='<strong>Prévia automática</strong>'+rows.join("");
  }
};
function stat(iconName,label,value,foot){
  const statIcons={"▦":"folder","▤":"folder","≡":"list","＋":"circle-plus","−":"circle-minus","◉":"wallet","◷":"settings"};
  const graphic=icon(statIcons[iconName]||"list");
  return '<div class="stat"><div class="stat-kicker">'+graphic+' '+E(label)+'</div><div class="stat-value">'+E(value)+'</div><div class="stat-foot">'+E(foot)+'</div></div>';
}
function boardCard(b,count){
  return '<div class="board-card" tabindex="0" role="button" onclick="App.navigate(\'board\','+b.id+')" onkeydown="if(event.key===\'Enter\')App.navigate(\'board\','+b.id+')"><div class="card-top"><span class="folder-icon">'+icon("folder")+'</span><span class="card-arrow">'+icon("arrow-right")+'</span></div><h3>'+E(b.name)+'</h3><p>'+count+' controle(s)</p></div>';
}
function controlCard(c){
  const mode={"saldo":"Saldo devedor","financeiro":"Financeiro","calculo":"Calculado","caminhao":"Caminhão","divida":"Dívidas","divida_sem_valor":"Pagamentos acumulados","recebimento":"Recebimentos","acerto_ab":"A × B","vale_funcionarios":"Vales de Funcionários"}[c.mode];
  const controlIcon=["calculo","caminhao"].includes(c.mode)?"truck":["financeiro","divida","divida_sem_valor","vale_funcionarios"].includes(c.mode)?"wallet":"clipboard";
  const menu='<div class="card-action-menu" id="controlMenu-'+c.id+'" role="group" aria-label="Ações do controle" hidden onclick="event.stopPropagation()" onkeydown="event.stopPropagation()">'+
   '<button type="button" onclick="App.controlMenuAction(event,\'configure\','+c.id+')">'+icon("settings")+' Configurar / editar</button>'+
   '<button type="button" onclick="App.controlMenuAction(event,\'type\','+c.id+')">'+icon("settings")+' Alterar tipo de controle</button>'+
   '<button type="button" onclick="App.controlMenuAction(event,\'move\','+c.id+')">'+icon("folder")+' Mover para pasta</button>'+
   '<button type="button" onclick="App.controlMenuAction(event,\'duplicate\','+c.id+')">'+icon("copy")+' Duplicar controle</button>'+
   '<button type="button" class="danger" onclick="App.controlMenuAction(event,\'delete\','+c.id+')">'+icon("trash")+' Excluir controle</button></div>';
  return '<div class="control-card" tabindex="0" role="link" aria-label="Abrir '+E(c.name)+'" onclick="App.navigate(\'control\','+c.id+')" onkeydown="if(event.target===this && event.key===\'Enter\')App.navigate(\'control\','+c.id+')">'+
   '<div class="title-line"><span class="control-icon">'+icon(controlIcon)+'</span><h3>'+E(c.name)+'</h3>'+
   '<button type="button" class="control-card-edit" title="Editar e configurar controle" aria-label="Ações de '+E(c.name)+'" aria-haspopup="true" aria-expanded="false" onclick="App.toggleControlMenu(event,'+c.id+')" onkeydown="event.stopPropagation()">'+icon("edit")+'</button>'+
   menu+'</div><p class="control-desc">'+(c.mode==="recebimento"?c.summary.item_total+' produto(s) · '+c.summary.count+' entrega(s)':c.mode==="vale_funcionarios"?c.summary.employees+' funcionário(s) · '+c.summary.count+' vale(s)':c.summary.count+' lançamento(s)'+(c.mode==="divida"||c.mode==="divida_sem_valor"?" · Pagamentos com descrição":" · "+c.fields.length+" campos"))+'</p>'+
   '<div class="control-bottom"><span><small>'+(c.mode==="acerto_ab"?"Saldo compensado":c.mode==="vale_funcionarios"?"Total a descontar":c.mode==="recebimento"?"Produtos concluídos":c.mode==="divida"?"Restante da dívida":c.mode==="divida_sem_valor"?"Total acumulado":"Saldo do controle")+'</small><strong>'+(c.mode==="acerto_ab"?(c.summary.settlement?.debtor?E(c.summary.settlement.debtor)+' deve '+currency(c.summary.settlement.amount):"Quitado"):c.mode==="recebimento"?c.summary.complete+' de '+c.summary.item_total:currency(c.summary.balance))+'</strong></span><span class="card-arrow">'+icon("arrow-right")+'</span></div></div>';
}
function empty(title,desc,action,label){
  return '<div class="empty-state"><strong>'+E(title)+'</strong><p>'+E(desc)+'</p><button class="btn btn-primary" onclick="'+action+'">'+icon("plus")+' '+E(label)+'</button></div>';
}
// Escape não descarta formulários em edição; fecha somente menus contextuais.
document.addEventListener("keydown",e=>{if(e.key==="Escape")App.closeControlMenus()});
document.addEventListener("click",e=>{
  if(!e.target.closest(".search-wrap"))App.closeSearch();
  if(!e.target.closest(".control-card-edit")&&!e.target.closest(".card-action-menu"))App.closeControlMenus();
});
document.getElementById("footerClock").textContent=new Date().toLocaleDateString("pt-BR");
App.initNavigation();
App.load();