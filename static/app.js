"use strict";
const E = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const currency = n => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(n||0));
const number = n => new Intl.NumberFormat("pt-BR",{maximumFractionDigits:2}).format(Number(n||0));
const deep = x => JSON.parse(JSON.stringify(x));
const slug = value => String(value||"campo").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").replace(/^[^a-z]+/,"") || "campo";
const fieldTypes = [["text","Texto"],["date","Data"],["number","Número"],["currency","Dinheiro (R$)"],["percent","Porcentagem (%)"]];
const ops = [["multiply","Multiplicar"],["percent","Calcular porcentagem"],["subtract","Subtrair"],["add","Somar"]];
const directions = [[1,"Soma (+)"],[-1,"Subtrai (−)"],[0,"Não altera saldo"]];
const fSelect=(items,value)=>items.map(([k,label])=>'<option value="'+E(k)+'" '+(String(k)===String(value)?"selected":"")+'>'+E(label)+'</option>').join("");
function template(mode="calculo"){
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
  return {name:mode==="calculo"?"Controle de Fretes":"Novo controle",mode,board_id:App.s.state?.boards?.[0]?.id||0,
    fields,
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
  s:{state:null,detail:null,route:"home",id:null,query:"",modal:null,draft:null,step:0,editing:null},
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
  async load(){
    try{
      this.s.state=await this.api("/api/state");
      if(this.s.route==="control" && this.s.id){
        try{this.s.detail=await this.api("/api/controls/"+this.s.id)}
        catch{this.s.route="home";this.s.id=null;this.s.detail=null}
      }
      this.render();
    }catch(e){this.toast(e.message,true);document.getElementById("main").innerHTML='<div class="empty-state"><strong>Servidor indisponível</strong>Verifique o painel de controle e tente novamente.</div>'}
  },
  navigate(route,id){
    this.s.route=route;this.s.id=id||null;this.s.query="";
    document.getElementById("search").value="";
    this.toggleMenu(false);
    if(route==="control") this.load();
    else{this.s.detail=null;this.render()}
  },
  search(q){this.s.query=(q||"").trim().toLowerCase();this.renderMain()},
  toggleMenu(open){
    document.getElementById("sidebar").classList.toggle("open",open);
    document.getElementById("mobileShade").classList.toggle("open",open);
  },
  render(){
    const boards=this.s.state?.boards||[];
    const controls=this.s.state?.controls||[];
    document.getElementById("homeLink").classList.toggle("active",this.s.route==="home");
    document.getElementById("sideBoards").innerHTML=boards.map(b=>
      '<button class="board-link '+(this.s.route==="board"&&this.s.id===b.id?"active":"")+'" onclick="App.navigate(\'board\','+b.id+')"><span>▤</span><span>'+E(b.name)+'</span><span class="count">'+controls.filter(c=>c.board_id===b.id).length+'</span></button>').join("");
    this.renderMain();
  },
  renderMain(){
    const st=this.s.state;if(!st)return;
    const {boards,controls}=st;
    let title="Visão geral",crumb="CENTRAL / VISÃO GERAL";
    if(this.s.route==="board"){
      const b=boards.find(x=>x.id===this.s.id);if(!b)return this.navigate("home");
      title=b.name;crumb="CENTRAL / QUADROS";
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
      const totalEntries=controls.reduce((a,c)=>a+c.summary.count,0);
      const filtered=controls.filter(c=>c.name.toLowerCase().includes(this.s.query));
      main.innerHTML='<section class="intro"><div><div class="eyebrow">PAINEL DE GESTÃO</div><h2>Tudo o que você controla, em um só lugar.</h2><p class="subtext">Crie quadros, personalize seus formulários e acompanhe lançamentos sem planilhas ou fórmulas.</p></div><button class="btn" onclick="App.newBoard()">＋ Novo quadro</button></section>'+
      '<section class="stat-grid">'+stat("▤","Quadros",boards.length,"Áreas organizadas")+stat("▦","Controles",controls.length,"Personalizados")+stat("≡","Lançamentos",totalEntries,"Registros salvos")+stat("◷","Atualização","Local","Dados em SQLite")+'</section>'+
      '<div class="section-heading"><h2>Seus quadros</h2><p>'+boards.length+' quadros</p></div>'+
      (boards.length?'<div class="board-grid">'+boards.map(b=>boardCard(b,controls.filter(c=>c.board_id===b.id).length)).join("")+'</div>':empty("Nenhum quadro","Crie um quadro para organizar seus controles.","App.newBoard()","Criar quadro"))+
      '<div class="section-heading"><h2>Controles</h2><p>'+filtered.length+' encontrados</p></div>'+
      (filtered.length?'<div class="control-grid">'+filtered.map(controlCard).join("")+'</div>':empty("Nenhum controle encontrado","Crie um controle e comece a lançar.","App.newControl()","Criar controle"));
    } else if(this.s.route==="board"){
      const b=boards.find(x=>x.id===this.s.id);
      const found=controls.filter(c=>c.board_id===b.id&&c.name.toLowerCase().includes(this.s.query));
      main.innerHTML='<section class="intro"><div><div class="eyebrow">QUADRO DE CONTROLES</div><h2>'+E(b.name)+'</h2><p class="subtext">Agrupe e acompanhe controles relacionados. Cada controle tem seu próprio formulário.</p></div><div class="actions-end"><button class="btn" onclick="App.renameBoard('+b.id+')">Renomear</button><button class="btn btn-primary" onclick="App.newControl('+b.id+')">＋ Novo controle</button></div></section>'+
       '<section class="stat-grid">'+stat("▦","Controles",found.length,"Neste quadro")+stat("≡","Lançamentos",found.reduce((n,c)=>n+c.summary.count,0),"Neste quadro")+'</section>'+
       (found.length?'<div class="control-grid">'+found.map(controlCard).join("")+'</div>':empty("Quadro vazio","Adicione um controle para começar.","App.newControl("+b.id+")","Criar controle"))+
       '<div class="danger-zone"><button class="btn btn-quiet btn-sm" onclick="App.deleteBoard('+b.id+')">Excluir quadro</button></div>';
    } else if(this.s.route==="control")this.renderControl();
  },
  renderControl(){
    const d=this.s.detail,c=d.control,sum=d.summary;
    const mode={"saldo":"Saldo devedor","financeiro":"Entradas e saídas","calculo":"Controle calculado"}[c.mode];
    const entries=d.entries.filter(e=>[e.category,e.type_label,...Object.values(e.data)].join(" ").toLowerCase().includes(this.s.query));
    const datefield=c.fields.find(f=>f.type==="date");
    const subjectfield=c.fields.find(f=>f.type==="text");
    const cSummary=(rows,key)=>rows.length?rows.map(x=>'<div class="info-row"><span>'+E(x.name)+'</span><strong class="'+(Number(x.total)<0?"negative":"")+'">'+currency(x.total)+'</strong></div>').join(""):'<p class="secondary-text">Sem dados para exibir.</p>';
    document.getElementById("main").innerHTML='<section class="intro"><div><div class="eyebrow">'+E(mode)+'</div><h2>'+E(c.name)+'</h2><p class="subtext">Formulário próprio, cálculos automáticos e registro de cada movimentação.</p></div><div class="actions-end"><button class="btn" onclick="App.editControl('+c.id+')">⚙ Configurar</button><button class="btn btn-primary" onclick="App.newEntry()">＋ Novo lançamento</button></div></section>'+
      '<section class="stat-grid">'+stat("＋","Total somado",currency(sum.plus),"Valores que aumentam")+stat("−","Total subtraído",currency(sum.minus),"Valores que diminuem")+stat("◉","Saldo do controle",currency(sum.balance),"Conforme os tipos definidos")+stat("≡","Lançamentos",sum.count,"Registros salvos")+'</section>'+
      '<div class="details-layout"><div class="stack"><section class="panel"><div class="panel-header"><h3>Histórico de lançamentos</h3><div class="actions-end"><button class="btn btn-sm" onclick="App.exportCsv('+c.id+')">↓ Exportar CSV</button><button class="btn btn-sm btn-primary" onclick="App.newEntry()">＋ Lançar</button></div></div>'+
      (entries.length?'<div class="table-wrap"><table><thead><tr><th>Data</th><th>Referência</th><th>Tipo</th><th>Categoria</th><th style="text-align:right">Valor</th><th style="text-align:right">Ações</th></tr></thead><tbody>'+
      entries.map(e=>{const showdate=datefield?e.data[datefield.key]:"";
        const dateText=showdate&&/^\d{4}-\d\d-\d\d$/.test(showdate)?showdate.slice(8)+"/"+showdate.slice(5,7)+"/"+showdate.slice(0,4):"—";
        const subject=subjectfield?e.data[subjectfield.key]:"Lançamento #"+e.id;
        return '<tr><td>'+E(dateText)+'</td><td><b>'+E(subject)+'</b>'+(e.notes?'<div class="secondary-text">'+E(e.notes.slice(0,65))+'</div>':"")+'</td><td>'+E(e.type_label)+'</td><td><span class="chip">'+E(e.category)+'</span></td><td class="numeric '+(e.direction<0?"negative":e.direction===0?"neutral":"positive")+'">'+(e.direction>0?"+":e.direction<0?"−":"") +currency(e.amount)+'</td><td><div class="table-actions"><button class="mini-action" onclick="App.editEntry('+e.id+')">Editar</button><button class="mini-action" onclick="App.deleteEntry('+e.id+')">Excluir</button></div></td></tr>'}).join("")+
      '</tbody></table></div>':empty("Sem lançamentos","Adicione o primeiro lançamento para começar.","App.newEntry()","Novo lançamento"))+'</section></div>'+
      '<aside class="stack"><section class="panel"><div class="panel-header"><h3>Resumo por categoria</h3></div><div class="panel-body">'+cSummary(sum.by_category)+'</div></section>'+
      '<section class="panel"><div class="panel-header"><h3>Resumo por tipo</h3></div><div class="panel-body">'+cSummary(sum.by_type)+'</div></section>'+
      '<section class="panel"><div class="panel-header"><h3>Estrutura</h3></div><div class="panel-body"><p class="secondary-text">'+c.fields.length+' campos · '+c.rules.length+' cálculos · '+c.types.length+' tipos de lançamento</p><div class="actions-end" style="margin-top:14px"><button class="btn btn-sm" onclick="App.duplicateControl('+c.id+')">Duplicar controle</button><button class="btn btn-sm btn-danger" onclick="App.deleteControl('+c.id+')">Excluir</button></div></div></section></aside></div>';
  },
  async renameBoard(id){
    const b=this.s.state.boards.find(x=>x.id===id),name=prompt("Nome do quadro:",b.name);
    if(name===null)return;
    try{await this.api("/api/boards/"+id,"PATCH",{name});this.toast("Quadro atualizado.");await this.load()}catch(e){this.toast(e.message,true)}
  },
  async newBoard(){
    const name=prompt("Nome do novo quadro:");
    if(name===null)return;
    try{const b=await this.api("/api/boards","POST",{name});await this.load();this.navigate("board",b.id);this.toast("Quadro criado.")}catch(e){this.toast(e.message,true)}
  },
  async deleteBoard(id){
    if(!confirm("Excluir este quadro e TODOS os controles e lançamentos dele? Esta ação não pode ser desfeita."))return;
    try{await this.api("/api/boards/"+id,"DELETE");await this.load();this.navigate("home");this.toast("Quadro excluído.")}catch(e){this.toast(e.message,true)}
  },
  async duplicateControl(id){
    try{const r=await this.api("/api/controls/"+id+"/duplicate","POST",{});this.navigate("control",r.id);this.toast("Controle duplicado sem copiar lançamentos.")}catch(e){this.toast(e.message,true)}
  },
  async deleteControl(id){
    if(!confirm("Excluir o controle e TODOS os lançamentos dele? Esta ação não pode ser desfeita."))return;
    try{await this.api("/api/controls/"+id,"DELETE");await this.load();this.navigate("home");this.toast("Controle excluído.")}catch(e){this.toast(e.message,true)}
  },
  exportCsv(id){window.location.href="/api/controls/"+id+"/export.csv"},
  newControl(boardId){
    this.s.modal="builder";this.s.editing=null;this.s.step=0;this.s.draft=template();
    if(boardId)this.s.draft.board_id=boardId;
    this.renderModal();
  },
  editControl(id){
    this.s.modal="builder";this.s.editing=id;this.s.step=0;this.s.draft=deep(this.s.detail.control);
    this.renderModal();
  },
  updateDraft(prop,value){this.s.draft[prop]=value},
  mode(mode){
    if(this.s.editing)return;
    const old=this.s.draft;
    this.s.draft=template(mode);this.s.draft.name=old.name;this.s.draft.board_id=old.board_id;
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
      this.closeModal();await this.load();this.navigate("control",id);
      this.toast("Controle salvo com sucesso.");
    }catch(e){this.toast(e.message,true)}
  },
  builderNext(delta){this.s.step=Math.max(0,Math.min(3,this.s.step+delta));this.renderModal()},
  newEntry(){
    this.s.modal="entry";this.s.editing=null;this.renderModal();
  },
  editEntry(id){
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
    for(const f of this.s.detail.control.fields)p.data[f.key]=fd.get(f.key)||"";
    try{
      const id=this.s.editing;
      await this.api(id?"/api/entries/"+id:"/api/controls/"+this.s.id+"/entries",id?"PUT":"POST",p);
      this.closeModal();await this.load();this.toast(id?"Lançamento atualizado.":"Lançamento salvo.");
    }catch(e){this.toast(e.message,true)}
  },
  closeModal(){this.s.modal=null;this.s.draft=null;this.s.editing=null;document.getElementById("modalRoot").innerHTML=""},
  renderModal(){
    const root=document.getElementById("modalRoot");
    if(!this.s.modal)return root.innerHTML="";
    root.innerHTML='<div class="modal-backdrop" id="backdrop"><div class="modal '+(this.s.modal==="builder"?"large":"")+'" role="dialog" aria-modal="true" aria-labelledby="modalTitle">'+
      (this.s.modal==="builder"?this.builderHTML():this.entryHTML())+'</div></div>';
    document.getElementById("backdrop").addEventListener("click",e=>{if(e.target.id==="backdrop")this.closeModal()});
    if(this.s.modal==="entry")this.preview();
  },
  builderHTML(){
    const d=this.s.draft,step=this.s.step;
    const heads=["1. Dê um nome ao controle","2. Monte seu formulário","3. Configure os cálculos","4. Defina os lançamentos"];
    const sub=["Comece com um modelo pronto. Você pode alterar tudo depois.","Escolha as informações que serão preenchidas em cada lançamento.","Os resultados aparecem automaticamente, sem digitar fórmulas.","Defina quais lançamentos somam, diminuem ou apenas informam."];
    let body='';
    if(step===0){
      body='<div class="form-grid"><div class="field full"><label>Nome do controle</label><input maxlength="150" value="'+E(d.name)+'" oninput="App.updateDraft(\'name\',this.value)"></div>'+
        '<div class="field full"><label>Em qual quadro?</label><select onchange="App.updateDraft(\'board_id\',Number(this.value))">'+
        fSelect(this.s.state.boards.map(b=>[b.id,b.name]),d.board_id)+'</select></div></div>'+
        '<div class="field" style="margin-top:19px"><label>O que você deseja controlar?</label><div class="wizard-choice">'+
        [["saldo","Saldo devedor","Acompanhar quanto falta receber."],["financeiro","Entradas e saídas","Registrar entradas, despesas e saldo."],["calculo","Cálculos automáticos","Fretes, comissões e valores calculados."]].map(([m,title,desc])=>
          '<button class="choice '+(d.mode===m?"selected":"")+'" '+(this.s.editing?"disabled":"")+' onclick="App.mode(\''+m+'\')"><strong>'+title+'</strong><small>'+desc+'</small></button>').join("")+'</div></div>'+
        (this.s.editing?'<div class="hint" style="margin-top:15px">O modelo de um controle existente não muda. É possível editar seus campos e regras nas próximas etapas.</div>':'');
    }else if(step===1){
      body='<div class="hint">Os campos abaixo formam a tela de lançamento. Para criar outro, clique em <b>Adicionar campo</b>.</div>'+
      d.fields.map((f,i)=>'<div class="form-row-card"><div class="field"><label>Nome do campo</label><input value="'+E(f.label)+'" maxlength="150" oninput="App.setItem(\'fields\','+i+',\'label\',this.value)"></div>'+
       '<div class="field"><label>Formato</label><select onchange="App.setItem(\'fields\','+i+',\'type\',this.value)">'+fSelect(fieldTypes,f.type)+'</select></div>'+
       '<button class="btn btn-sm" title="Remover campo" onclick="App.removeField('+i+')">✕</button>'+
       (f.type==="percent"?'<div class="field"><label>Valor padrão (%)</label><input value="'+E(f.default||"")+'" oninput="App.setItem(\'fields\','+i+',\'default\',this.value)"></div>':'')+
       '<label class="secondary-text" style="align-self:end"><input type="checkbox" '+(f.required?"checked":"")+' onchange="App.setItem(\'fields\','+i+',\'required\',this.checked)"> Obrigatório</label>'+
       '</div>').join("")+
      '<button class="btn btn-sm" onclick="App.addField()">＋ Adicionar campo</button>';
    }else if(step===2){
      body='<div class="hint">Exemplo: <b>Peso carregado × Valor por kg = Valor do frete</b>. Escolha os campos e a operação, sem escrever fórmulas.</div>'+
      (d.rules.length?d.rules.map((r,i)=>{
        const prev=[...d.fields.filter(f=>["number","currency","percent"].includes(f.type)),...d.rules.slice(0,i)].map(f=>[f.key,f.label]);
        return '<div class="config-rule"><div class="field"><label>Nome do resultado</label><input maxlength="150" value="'+E(r.label)+'" oninput="App.setItem(\'rules\','+i+',\'label\',this.value)"></div>'+
         '<div class="field"><label>Operação</label><select onchange="App.setItem(\'rules\','+i+',\'op\',this.value)">'+fSelect(ops,r.op)+'</select></div>'+
         '<div class="field"><label>Primeiro valor</label><select onchange="App.setItem(\'rules\','+i+',\'a\',this.value)">'+fSelect(prev,r.a)+'</select></div>'+
         '<div class="field"><label>Segundo valor</label><select onchange="App.setItem(\'rules\','+i+',\'b\',this.value)">'+fSelect(prev,r.b)+'</select></div>'+
         '<button class="btn btn-sm" onclick="App.removeRule('+i+')">✕</button></div>';
      }).join(""):'<p class="secondary-text">Este controle ainda não possui cálculos automáticos.</p>')+
      '<button class="btn btn-sm" style="margin-top:10px" onclick="App.addRule()">＋ Adicionar cálculo</button>';
    }else{
      const available=[["manual","Valor digitado"],...d.fields.filter(f=>["number","currency","percent"].includes(f.type)).map(f=>[f.key,f.label]),...d.rules.map(r=>[r.key,r.label])];
      body='<div class="hint">Cada lançamento terá um comportamento. Exemplo: <b>Pagamento recebido</b> diminui o saldo; <b>Nova cobrança</b> aumenta.</div>'+
       d.types.map((t,i)=>'<div class="config-type"><div class="field"><label>Nome do lançamento</label><input maxlength="150" value="'+E(t.label)+'" oninput="App.setItem(\'types\','+i+',\'label\',this.value)"></div>'+
       '<div class="field"><label>Comportamento</label><select onchange="App.setItem(\'types\','+i+',\'direction\',this.value)">'+fSelect(directions,t.direction)+'</select></div>'+
       '<div class="field"><label>De onde vem o valor?</label><select onchange="App.setItem(\'types\','+i+',\'source\',this.value)">'+fSelect(available,t.source)+'</select></div>'+
       '<button class="btn btn-sm" onclick="App.s.draft.types.splice('+i+',1);App.renderModal()">✕</button></div>').join("")+
       '<button class="btn btn-sm" style="margin-top:10px" onclick="App.addType()">＋ Novo tipo de lançamento</button>'+
       '<p class="secondary-text" style="margin-top:14px">Registros antigos permanecem guardados com seus valores e cálculos originais quando você muda as regras.</p>';
    }
    return '<div class="modal-header"><div><h2 id="modalTitle">'+(this.s.editing?"Configurar controle":"Criar controle")+'</h2><p>'+E(heads[step])+'</p></div><button class="close" onclick="App.closeModal()" aria-label="Fechar">×</button></div>'+
      '<div class="modal-body"><div class="step-dots">'+[0,1,2,3].map(i=>'<div class="step-dot '+(i<=step?"done":"")+'"></div>').join("")+'</div><h3 style="margin-bottom:13px">'+E(sub[step])+'</h3>'+body+'</div>'+
      '<div class="modal-footer"><button class="btn" onclick="'+(step===0?"App.closeModal()":"App.builderNext(-1)")+'">'+(step===0?"Cancelar":"Voltar")+'</button>'+
      '<div class="tagline"><span class="secondary-text">Etapa '+(step+1)+' de 4</span><button class="btn btn-primary" onclick="'+(step===3?"App.saveControl()":"App.builderNext(1)")+'">'+(step===3?"Salvar controle":"Continuar →")+'</button></div></div>';
  },
  entryHTML(){
    const c=this.s.detail.control;
    const old=this.s.editing?this.s.detail.entries.find(e=>e.id===this.s.editing):null;
    const now=new Date(),today=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
    const fields=c.fields.map(f=>{
      const val=old?.data?.[f.key]??(f.type==="date"?today:(f.default||""));
      let type=f.type==="date"?"date":["number","currency","percent"].includes(f.type)?"text":"text";
      const extra=f.type==="number"||f.type==="currency"||f.type==="percent"?' inputmode="decimal"':'';
      return '<div class="field"><label for="field_'+E(f.key)+'">'+E(f.label)+(f.required?" *":"")+'</label><input id="field_'+E(f.key)+'" type="'+type+'" name="'+E(f.key)+'" value="'+E(val)+'" '+extra+' '+(f.required?"required":"")+' maxlength="2000" oninput="App.preview()"></div>'
    }).join("");
    const types=c.types.map(t=>[t.key,t.label]),oldtype=old?.type_key||c.types[0].key;
    const derived=old?.type_key&& !c.types.some(t=>t.key===old.type_key);
    return '<div class="modal-header"><div><h2 id="modalTitle">'+(old?"Editar lançamento":"Novo lançamento")+'</h2><p>'+E(c.name)+'</p></div><button class="close" onclick="App.closeModal()" aria-label="Fechar">×</button></div>'+
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
    const c=this.s.detail?.control,form=document.getElementById("entryForm"),box=document.getElementById("calcPreview");
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
function stat(icon,label,value,foot){
  return '<div class="stat"><div class="stat-kicker"><span>'+icon+'</span> '+E(label)+'</div><div class="stat-value">'+E(value)+'</div><div class="stat-foot">'+E(foot)+'</div></div>';
}
function boardCard(b,count){
  return '<div class="board-card" tabindex="0" role="button" onclick="App.navigate(\'board\','+b.id+')" onkeydown="if(event.key===\'Enter\')App.navigate(\'board\','+b.id+')"><div class="card-top"><span class="folder-icon">▤</span><span class="card-arrow">→</span></div><h3>'+E(b.name)+'</h3><p>'+count+' controle(s)</p></div>';
}
function controlCard(c){
  const mode={"saldo":"Saldo devedor","financeiro":"Financeiro","calculo":"Calculado"}[c.mode];
  return '<div class="control-card" tabindex="0" role="button" onclick="App.navigate(\'control\','+c.id+')" onkeydown="if(event.key===\'Enter\')App.navigate(\'control\','+c.id+')"><div class="title-line"><h3>'+E(c.name)+'</h3><span class="pill">'+E(mode)+'</span></div><p class="control-desc">'+c.summary.count+' lançamento(s) · '+c.fields.length+' campos</p><div class="control-bottom"><span><small>Saldo do controle</small><br><strong>'+currency(c.summary.balance)+'</strong></span><span class="card-arrow">→</span></div></div>';
}
function empty(title,desc,action,label){
  return '<div class="empty-state"><strong>'+E(title)+'</strong><p>'+E(desc)+'</p><button class="btn btn-primary" onclick="'+action+'">'+E(label)+'</button></div>';
}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&App.s.modal)App.closeModal()});
document.getElementById("footerClock").textContent=new Date().toLocaleDateString("pt-BR");
App.load();