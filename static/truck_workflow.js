"use strict";
/* Conferencia de comprovantes e fechamento por capitulos, somente CHAVE ERRADA. */
const workflowDate=value=>value?value.slice(8,10)+"/"+value.slice(5,7)+"/"+value.slice(0,4):"—";
const workflowPlusDays=(iso,days)=>{const d=new Date(iso+"T12:00:00");d.setDate(d.getDate()+days);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const workflowDateControls=(prefix,start,end)=>
  '<div class="truck-workflow-dates">'+
  '<label>De <input type="date" id="'+prefix+'Start" value="'+E(start)+'" onchange="App.truckWorkflowDateChanged(\''+prefix+'\')" required></label>'+
  '<label>Até <input type="date" id="'+prefix+'End" value="'+E(end)+'" onchange="App.truckWorkflowDateChanged(\''+prefix+'\')" required></label>'+
  '</div>';
const workflowMetric=(label,value)=>'<div class="truck-workflow-metric"><small>'+E(label)+'</small><strong>'+truckMoney(value)+'</strong></div>';
Object.assign(App,{
  truckEntryStatus(day){
    const wf=this.s.truckReport?.workflow;
    if(!wf?.enabled)return "";
    if(wf.closures?.some(x=>day>=x.start_date&&day<=x.end_date))return "Fechado";
    if(wf.checks?.some(x=>day>=x.start_date&&day<=x.end_date))return "Conferido";
    return "";
  },
  truckWorkflowOpen(tab){
    if(!["checks","closures"].includes(tab)||!this.s.truckReport?.workflow?.enabled)return;
    this.s.truckTab=tab;
    this.renderTruckView();
  },
  truckReviewMarkup(){
    const wf=this.s.truckReport?.workflow;
    if(!wf?.enabled)return "";
    const earliest=wf.pending_check_from||truckDate();
    const suggestedEnd=workflowPlusDays(earliest,6);
    const endSuggested=suggestedEnd>truckDate()? (earliest>truckDate()?earliest:truckDate()):suggestedEnd;
    const range=this.s.truckReviewRange||{start:earliest,end:endSuggested};
    const preview=this.s.truckReviewPreview;
    const checks=wf.checks||[];
    const previews=preview?'<div class="truck-review-preview">'+
      '<div class="truck-workflow-panel-head"><strong>'+workflowDate(preview.start_date)+' a '+workflowDate(preview.end_date)+' · '+preview.count+' lançamento(s)</strong>'+
      '<button class="btn btn-sm" type="button" onclick="App.truckMarkAllReview()">'+icon("check")+' Marcar todos</button></div>'+
      (preview.entries.length?'<div class="truck-review-items">'+preview.entries.map(item=>{
        const checked=this.s.truckReviewMarked?.has(item.id);
        const kind=item.kind==="freight"?"Frete":item.kind==="expense"?"Despesa":"Vale";
        return '<label class="truck-review-item"><input type="checkbox" data-review-id="'+item.id+'" onchange="App.truckToggleReview('+item.id+',this.checked)" '+(checked?"checked":"")+'>'+
          '<span class="truck-review-item-content"><strong>'+E(item.description)+'</strong><small>'+workflowDate(item.event_date)+' · '+E(kind)+' · '+E(item.category)+'</small></span>'+
          '<b>'+truckMoney(item.amount)+'</b></label>';
      }).join("")+'</div>':'<p class="secondary-text">Nenhum lançamento neste período. Verifique se realmente não houve movimentações.</p>')+
      '<div class="truck-review-confirm"><span id="truckReviewProgress" class="secondary-text">'+
      (this.s.truckReviewMarked?.size||0)+' de '+preview.count+' lançamentos verificados</span>'+
      '<button type="button" id="truckReviewConfirmButton" class="btn btn-primary" onclick="App.truckConfirmReview()" '+((this.s.truckReviewMarked?.size||0)!==preview.count?"disabled":"")+'>'+
      icon("check")+' Confirmar conferência</button></div></div>':"";
    const history=checks.length?checks.map(c=>'<div class="truck-workflow-history-row">'+
      '<div><strong>'+workflowDate(c.start_date)+' a '+workflowDate(c.end_date)+'</strong>'+
      '<small>'+c.entry_count+' lançamento(s) · confirmado em '+E(c.created_at.slice(0,16).replace("T"," "))+'</small></div>'+
      (c.closed?'<span class="truck-workflow-tag closed">Fechado</span>':
      '<button type="button" class="btn btn-sm" onclick="App.truckReopenReview('+c.id+')">'+icon("edit")+' Reabrir</button>')+'</div>').join(""):
      '<p class="secondary-text">Nenhuma conferência registrada ainda.</p>';
    return '<section id="truck-panel-checks" role="tabpanel" aria-labelledby="truck-tab-checks" class="truck-workflow-view">'+
      '<div class="truck-workflow-head"><div><h2>Conferência de comprovantes</h2>'+
      '<p>Verifique os comprovantes físicos e marque cada lançamento antes de confirmar.</p></div>'+
      '<div class="truck-workflow-status"><strong>Conferido até: '+workflowDate(wf.last_checked_until)+'</strong>'+
      '<span>Conferência pendente desde '+workflowDate(wf.pending_check_from)+'</span></div></div>'+
      '<section class="panel truck-workflow-section"><div class="panel-header"><h3>Conferir um período</h3></div>'+
      '<div class="panel-body"><div class="truck-workflow-form">'+workflowDateControls("truckReview",range.start,range.end)+
      '<button class="btn btn-primary" type="button" onclick="App.truckPreviewReview()">'+icon("search")+' Buscar lançamentos</button></div>'+previews+'</div></section>'+
      '<section class="panel truck-workflow-section"><div class="panel-header"><h3>Conferências registradas</h3></div>'+
      '<div class="panel-body">'+history+'</div></section></section>';
  },
  truckCloseMarkup(){
    const wf=this.s.truckReport?.workflow;
    if(!wf?.enabled)return "";
    const earliest=wf.pending_close_from||truckDate();
    const suggestedEnd=workflowPlusDays(earliest,29);
    const endSuggested=suggestedEnd>truckDate()?(earliest>truckDate()?earliest:truckDate()):suggestedEnd;
    const range=this.s.truckCloseRange||{start:earliest,end:endSuggested};
    const p=this.s.truckClosePreview;
    const preview=p?'<div class="truck-close-preview">'+
      (p.ready?
      '<p class="truck-workflow-success">'+icon("check")+' Período completamente conferido. Pode ser fechado.</p>'+
      '<div class="truck-workflow-metrics">'+
      workflowMetric("Fretes",p.totals.freight)+workflowMetric("Saídas",p.totals.cash_out)+
      workflowMetric("Resultado",p.totals.operating_result)+workflowMetric("Comissão acumulada",p.totals.driver_due_at_close)+'</div>'+
      '<p class="secondary-text">'+p.entry_count+' lançamento(s) serão arquivados e protegidos. Os totais do próximo capítulo recomeçam; a comissão do motorista continua.</p>'+
      '<div class="truck-workflow-action-right"><button type="button" class="btn btn-primary" onclick="App.truckConfirmClose()">'+icon("lock")+' Confirmar fechamento</button></div>':
      '<p class="truck-workflow-warning">'+icon("alert-circle")+' '+E(p.message||"Existem dias sem conferência neste período.")+'</p>')+
      '</div>':"";
    const history=(wf.closures||[]).length?wf.closures.map(c=>
      '<div class="truck-workflow-history-row">'+
      '<div><strong>'+workflowDate(c.start_date)+' a '+workflowDate(c.end_date)+'</strong>'+
      '<small>'+c.entry_count+' lançamento(s) · Resultado: '+truckMoney(c.totals.operating_result)+'</small></div>'+
      '<div class="truck-workflow-history-actions"><button class="btn btn-sm" type="button" onclick="App.truckShowClosure('+c.id+')">'+icon("list")+' Consultar</button>'+
      '<button class="btn btn-sm" type="button" onclick="App.truckExportClosure('+c.id+')">'+icon("download")+' CSV</button></div></div>').join(""):
      '<p class="secondary-text">Nenhum fechamento registrado ainda.</p>';
    const details=this.s.truckClosureDetail;
    const archive=details?'<section class="panel truck-workflow-section"><div class="panel-header"><h3>Arquivo fechado · '+
        workflowDate(details.start_date)+' a '+workflowDate(details.end_date)+'</h3>'+
        '<button type="button" class="btn btn-sm" onclick="App.truckHideClosure()">'+icon("x")+' Fechar visualização</button></div>'+
        '<div class="panel-body"><div class="truck-workflow-metrics">'+workflowMetric("Fretes",details.totals.freight)+
        workflowMetric("Saídas",details.totals.cash_out)+workflowMetric("Comissão no fechamento",details.totals.driver_due_at_close)+'</div>'+
        '<div class="truck-workflow-snapshot">'+details.entries.map(e=>
        '<div class="truck-workflow-history-row"><div><strong>'+E(e.description)+'</strong><small>'+
        workflowDate(e.event_date)+' · '+E(e.category)+'</small></div><strong>'+truckMoney(e.amount)+'</strong></div>').join("")+
        '</div></div></section>':"";
    return '<section id="truck-panel-closures" role="tabpanel" aria-labelledby="truck-tab-closures" class="truck-workflow-view">'+
      '<div class="truck-workflow-head"><div><h2>Fechamentos por período</h2>'+
      '<p>Um fechamento arquiva os lançamentos conferidos. Não apaga registros nem zera a comissão do motorista.</p></div>'+
      '<div class="truck-workflow-status"><strong>Último fechamento: '+workflowDate(wf.last_closed_until)+'</strong>'+
      '<span>Próximo capítulo desde '+workflowDate(wf.pending_close_from)+'</span></div></div>'+
      '<section class="panel truck-workflow-section"><div class="panel-header"><h3>Fechar um capítulo</h3></div>'+
      '<div class="panel-body"><div class="truck-workflow-form">'+workflowDateControls("truckClose",range.start,range.end)+
      '<button class="btn btn-primary" type="button" onclick="App.truckPreviewClose()">'+icon("search")+' Verificar período</button></div>'+preview+'</div></section>'+
      '<section class="panel truck-workflow-section"><div class="panel-header"><h3>Histórico de fechamentos</h3></div>'+
      '<div class="panel-body">'+history+'</div></section>'+archive+'</section>';
  },
  truckWorkflowDateChanged(prefix){
    const start=document.getElementById(prefix+"Start")?.value;
    const end=document.getElementById(prefix+"End")?.value;
    if(prefix==="truckReview"){
      this.s.truckReviewRange={start,end};
      this.s.truckReviewPreview=null;
      this.s.truckReviewMarked=null;
      document.querySelector(".truck-review-preview")?.remove();
    }else{
      this.s.truckCloseRange={start,end};
      this.s.truckClosePreview=null;
      document.querySelector(".truck-close-preview")?.remove();
    }
  },
  async truckPreviewReview(){
    const cid=this.s.id;
    const start=document.getElementById("truckReviewStart")?.value;
    const end=document.getElementById("truckReviewEnd")?.value;
    if(!start||!end){this.toast("Informe as duas datas.",true);return}
    this.s.truckReviewRange={start,end};
    this.s.truckReviewPreview=null;
    this.s.truckReviewMarked=new Set();
    try{
      this.s.truckReviewPreview=await this.api("/api/controls/"+cid+"/truck/check-preview?start="+encodeURIComponent(start)+"&end="+encodeURIComponent(end));
      this.renderTruckView();
    }catch(err){this.toast(err.message,true)}
  },
  truckToggleReview(id,checked){
    if(!this.s.truckReviewMarked)this.s.truckReviewMarked=new Set();
    if(checked)this.s.truckReviewMarked.add(id);
    else this.s.truckReviewMarked.delete(id);
    const count=this.s.truckReviewMarked.size;
    const total=this.s.truckReviewPreview?.count||0;
    const message=document.getElementById("truckReviewProgress");
    const button=document.getElementById("truckReviewConfirmButton");
    if(message)message.textContent=count+" de "+total+" lançamentos verificados";
    if(button)button.disabled=count!==total;
  },
  truckMarkAllReview(){
    const p=this.s.truckReviewPreview;
    if(!p)return;
    this.s.truckReviewMarked=new Set(p.entries.map(e=>e.id));
    document.querySelectorAll("[data-review-id]").forEach(el=>{el.checked=true});
    this.truckToggleReview(null,false);
  },
  async truckConfirmReview(){
    const p=this.s.truckReviewPreview;
    if(!p)return;
    const ids=[...(this.s.truckReviewMarked||new Set())];
    if(ids.length!==p.count){this.toast("Marque todos os lançamentos após conferir os comprovantes.",true);return}
    if(!confirm("Confirmar que os comprovantes físicos e todos os lançamentos deste período estão corretos?"))return;
    try{
      await this.api("/api/controls/"+this.s.id+"/truck/checks","POST",{
        start:p.start_date,end:p.end_date,fingerprint:p.fingerprint,checked_ids:ids
      });
      this.s.truckReviewPreview=null;
      this.s.truckReviewMarked=null;
      await this.load();
      this.toast("Conferência confirmada. O período seguinte permanece pendente.");
    }catch(err){this.toast(err.message,true)}
  },
  async truckReopenReview(id){
    if(!confirm("Reabrir esta conferência? Os lançamentos voltarão a permitir correções até serem conferidos novamente."))return;
    try{
      await this.api("/api/truck-checks/"+id,"DELETE");
      this.s.truckReviewPreview=null;
      this.s.truckReviewRange=null;
      await this.load();
      this.toast("Conferência reaberta.");
    }catch(err){this.toast(err.message,true)}
  },
  async truckPreviewClose(){
    const start=document.getElementById("truckCloseStart")?.value;
    const end=document.getElementById("truckCloseEnd")?.value;
    if(!start||!end){this.toast("Informe as duas datas.",true);return}
    this.s.truckCloseRange={start,end};
    this.s.truckClosePreview=null;
    try{
      this.s.truckClosePreview=await this.api("/api/controls/"+this.s.id+"/truck/close-preview?start="+encodeURIComponent(start)+"&end="+encodeURIComponent(end));
      this.renderTruckView();
    }catch(err){this.toast(err.message,true)}
  },
  async truckConfirmClose(){
    const p=this.s.truckClosePreview;
    if(!p?.ready)return;
    if(!confirm("Fechar DEFINITIVAMENTE "+workflowDate(p.start_date)+" a "+workflowDate(p.end_date)+"? Os lançamentos ficarão arquivados e não poderão ser editados."))return;
    try{
      await this.api("/api/controls/"+this.s.id+"/truck/closures","POST",{
        start:p.start_date,end:p.end_date,fingerprint:p.fingerprint
      });
      this.s.truckClosePreview=null;
      this.s.truckCloseRange=null;
      this.s.truckMonth="";
      await this.load();
      this.toast("Fechamento registrado. Novo capítulo iniciado, mantendo a comissão acumulada.");
    }catch(err){this.toast(err.message,true)}
  },
  async truckShowClosure(id){
    try{
      this.s.truckClosureDetail=await this.api("/api/truck-closures/"+id);
      this.renderTruckView();
    }catch(err){this.toast(err.message,true)}
  },
  truckHideClosure(){
    this.s.truckClosureDetail=null;
    this.renderTruckView();
  },
  truckExportClosure(id){
    window.location.href="/api/truck-closures/"+id+"/export.csv";
  }
});
