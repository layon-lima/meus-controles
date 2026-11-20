"use strict";
/*
 * Central Novo Horizonte | Envio sequencial de contas
 *
 * O usuário escolhe todos os PDFs de uma só vez. Somente UM PDF é enviado
 * para OCR/preview por vez. A conferência, o salvamento, o R2, o Windows e
 * o tratamento de holerites são executados pelas MESMAS funções do CONTAS 4:
 * postPDF, startDetectedHolerite, accountModal e closeModal.
 *
 * Nenhum envio paralelo, nenhum salvamento automático ou segunda implementação
 * de regras financeiras. A fila reside apenas na memória da aba.
 */
(() => {
  const MAX_FILES=100, MAX_PDF=30*1024*1024;
  const $=id=>document.getElementById(id);
  const state={
    files:[],index:0,phase:"idle",saved:0,skipped:0,failed:0,
    intent:"skip",stopAfterCurrent:false,epoch:0,ticket:null
  };
  let dock=null,action=null,picker=null,observer=null,advanceTimer=null;
  const busy=()=>["reading","review","error"].includes(state.phase);
  const fileNow=()=>state.files[state.index]||null;
  const count=()=>state.files.length;
  const nextTick=fn=>window.setTimeout(fn,90);

  function element(tag,cls,textValue){
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(textValue!=null)el.textContent=textValue;
    return el;
  }
  function text(id,value){const target=$(id);if(target)target.textContent=value}
  function showDock(){
    dock.hidden=false;
    dock.classList.add("nh-batch-visible");
  }
  function render(message){
    const current=fileNow(),total=count();
    const running=busy();
    if(action){
      action.disabled=running;
      action.setAttribute("aria-disabled",String(running));
    }
    // A fila precisa ser a ÚNICA fonte de previews em andamento: evita que
    // o usuário inicie outro PDF (ou um cadastro paralelo) entre dois OCRs.
    for(const id of ["pdfImport","newAccount","payrollNew"]){
      const button=$(id);
      if(button)button.disabled=running;
    }
    if(!total){
      dock.hidden=true;return;
    }
    showDock();
    text("nh-batch-counter",total?Math.min(state.index+1,total)+"/"+total:"");
    text("nh-batch-filename",current?current.name:"Lote concluído");
    text("nh-batch-message",message || (state.phase==="review"
      ?"Confira o formulário e clique em Salvar ou Cancelar. O próximo PDF será lido só depois."
      :state.phase==="reading"?"Lendo o PDF no servidor…"
      :state.phase==="error"?"Não foi possível analisar este arquivo."
      :state.phase==="complete"?"Processamento encerrado."
      :"Aguardando…"));
    text("nh-batch-summary",
      "Confirmados: "+state.saved+" · Ignorados: "+state.skipped+" · Erros: "+state.failed);
    const progress=total?Math.min(100,(state.index/total)*100):0;
    const bar=$("nh-batch-progress");
    if(bar){bar.style.width=progress+"%";bar.setAttribute("aria-valuenow",String(Math.round(progress)))}
    $("nh-batch-retry").hidden=state.phase!=="error";
    $("nh-batch-skip").hidden=state.phase!=="error";
    $("nh-batch-stop").hidden=!running||state.stopAfterCurrent;
    $("nh-batch-close").hidden=state.phase!=="complete";
    $("nh-batch-state").dataset.phase=state.phase;
  }
  function reset(){
    state.files=[];state.index=0;state.phase="idle";
    state.saved=0;state.skipped=0;state.failed=0;
    state.intent="skip";state.stopAfterCurrent=false;state.ticket=null;
    state.epoch++;
    if(observer){observer.disconnect();observer=null}
    if(advanceTimer){clearTimeout(advanceTimer);advanceTimer=null}
    render();
  }
  function finish(message){
    state.phase="complete";state.index=state.files.length;
    state.ticket=null;
    render(message||("Lote finalizado. "+state.saved+" conta(s) confirmada(s)."));
    if(action)action.disabled=false;
  }
  function advance(saved){
    if(state.phase!=="review")return;
    if(saved)state.saved++;else state.skipped++;
    state.ticket=null;
    state.index++;
    if(state.stopAfterCurrent||state.index>=count()){
      finish(state.stopAfterCurrent
        ?"Fila interrompida. Os arquivos restantes não foram enviados."
        :"Lote concluído. Todos os arquivos foram apresentados individualmente.");
      return;
    }
    state.phase="waiting";
    render("Preparando o próximo documento…");
    const epoch=state.epoch;
    advanceTimer=nextTick(()=>{
      advanceTimer=null;
      if(epoch===state.epoch)processCurrent();
    });
  }
  function modalChanged(){
    if(state.phase!=="review")return;
    const backdrop=$("backdrop");
    if(!backdrop || backdrop.classList.contains("show"))return;
    // O CONTAS 4 só remove .show depois de salvar ou após confirmar a saída.
    // Um erro de validação deixa o formulário aberto e NÃO libera a fila.
    advance(state.intent==="save");
  }
  function observeModal(){
    const backdrop=$("backdrop");
    if(!backdrop||typeof MutationObserver==="undefined"){
      throw new Error("Este navegador não oferece o controle necessário para conferência sequencial.");
    }
    if(observer)observer.disconnect();
    observer=new MutationObserver(modalChanged);
    observer.observe(backdrop,{attributes:true,attributeFilter:["class"]});
  }
  async function cancelTicket(){
    const ticket=state.ticket;
    if(!ticket)return;
    state.ticket=null;
    try {
      if(typeof api==="function")await api("/central/modules/contas/api/import/cancel","POST",{ticket});
    } catch(err) {
      console.warn("A prévia rejeitada expirará no servidor.",err);
    }
  }
  async function processCurrent(){
    if(state.stopAfterCurrent){finish("Fila encerrada. Nenhum outro PDF enviado.");return}
    if(state.index>=count()){finish();return}
    const file=fileNow();
    if(!file)return finish();
    if(!/\.pdf$/i.test(file.name||"") || file.size<5 || file.size>MAX_PDF){
      state.phase="error";
      return render("Arquivo inválido ou maior que 30 MB. Pule ou selecione outro lote.");
    }
    const backdrop=$("backdrop");
    if(backdrop?.classList.contains("show")){
      state.phase="error";
      return render("Há um formulário aberto. Conclua ou cancele antes de continuar.");
    }
    if(typeof postPDF!=="function"||typeof startDetectedHolerite!=="function"||
       typeof pendingImportPDF==="undefined"){
      state.phase="error";
      return render("O motor original de Contas ainda não carregou. Atualize a página.");
    }
    const currentEpoch=state.epoch;
    state.phase="reading";state.intent="skip";state.ticket=null;
    render("Analisando "+file.name+" ("+(state.index+1)+" de "+count()+")…");
    try {
      // Uma chamada por vez e sem a próxima antes de fechar a conferência.
      const response=await postPDF("/central/modules/contas/api/import/preview",file,{
        "X-Pdf-Name":encodeURIComponent(file.name),
        "X-Ocr-Mode":"hybrid"
      });
      const result=await response.json().catch(()=>({error:"Resposta inválida do leitor de PDF."}));
      if(currentEpoch!==state.epoch)return;
      if(!response.ok||!result.ok||!result.ticket)
        throw new Error(result.error||"Não foi possível ler o PDF.");
      state.ticket=result.ticket;
      pendingImportPDF={ticket:result.ticket,file};
      // REAPROVEITA INTEGRALMENTE os formulários originais: OCR, revisão,
      // holerites, funcionários/Pix, R2, Windows e validações de duplicidade.
      startDetectedHolerite(result);
      if(!backdrop?.classList.contains("show"))
        throw new Error("A conferência não foi aberta pelo Contas.");
      state.phase="review";
      state.intent="skip";
      observeModal();
      render();
    }catch(error){
      if(currentEpoch!==state.epoch)return;
      const failedTicket=state.ticket;
      await cancelTicket();
      if(typeof pendingImportPDF!=="undefined" &&
         pendingImportPDF?.ticket===failedTicket)pendingImportPDF=null;
      state.phase="error";
      render("Não foi possível analisar "+file.name+": "+(error.message||String(error)));
    }
  }
  function begin(files){
    if(busy())return;
    if(!files.length)return;
    if(files.length>MAX_FILES){
      alert("Selecione no máximo "+MAX_FILES+" PDFs por lote.");return;
    }
    if($("backdrop")?.classList.contains("show")){
      alert("Conclua a conta aberta antes de iniciar um lote.");return;
    }
    reset();
    state.files=files.slice();
    state.phase="waiting";
    render("Arquivos selecionados. Iniciando o primeiro…");
    processCurrent();
  }
  function skipError(){
    if(state.phase!=="error")return;
    state.failed++;
    state.index++;
    if(state.index>=count())return finish();
    state.phase="waiting";
    render("Pulando o documento com erro…");
    processCurrent();
  }
  function stop(){
    if(state.phase==="reading"||state.phase==="review"){
      state.stopAfterCurrent=true;
      render("Fila será encerrada após este documento. Nenhum outro será lido.");
      return;
    }
    if(state.phase==="error"||state.phase==="waiting")finish("Fila interrompida.");
  }
  function initialize(){
    // A integração só existe no módulo Contas, nunca nos holerites separados.
    if(!location.pathname.startsWith("/central/modules/contas/"))return;
    const upload=$("pdfImport"),backdrop=$("backdrop");
    if(!upload||!backdrop||$("nh-contas-batch-action"))return;

    action=element("button","nh-batch-action","Enviar várias contas");
    action.type="button";action.id="nh-contas-batch-action";
    action.title="Selecionar diversos PDFs e conferir uma conta por vez";
    picker=element("input");picker.type="file";
    picker.id="nh-contas-batch-files";
    picker.accept=".pdf,application/pdf";picker.multiple=true;picker.hidden=true;
    action.addEventListener("click",()=>picker.click());
    picker.addEventListener("change",()=>{
      const files=Array.from(picker.files||[]);
      picker.value="";
      begin(files);
    });
    upload.insertAdjacentElement("afterend",action);
    document.body.appendChild(picker);

    dock=element("aside","nh-batch-dock");dock.id="nh-batch-dock";
    dock.setAttribute("aria-label","Fila de envio de contas");
    dock.innerHTML=
      '<div class="nh-batch-head"><strong>Importação sequencial</strong>'+
      '<span id="nh-batch-counter"></span></div>'+
      '<div id="nh-batch-filename" class="nh-batch-file"></div>'+
      '<p id="nh-batch-message" role="status" aria-live="polite"></p>'+
      '<div class="nh-batch-progress-track"><div id="nh-batch-progress" role="progressbar" '+
      'aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div></div>'+
      '<p id="nh-batch-summary"></p><div class="nh-batch-controls" id="nh-batch-state">'+
      '<button type="button" id="nh-batch-retry" hidden>Tentar de novo</button>'+
      '<button type="button" id="nh-batch-skip" hidden>Pular arquivo</button>'+
      '<button type="button" id="nh-batch-stop" hidden>Parar após este</button>'+
      '<button type="button" id="nh-batch-close" hidden>Fechar</button></div>';
    dock.hidden=true;document.body.appendChild(dock);
    $("nh-batch-retry").addEventListener("click",()=>{
      if(state.phase!=="error")return;
      state.phase="waiting";processCurrent();
    });
    $("nh-batch-skip").addEventListener("click",skipError);
    $("nh-batch-stop").addEventListener("click",stop);
    $("nh-batch-close").addEventListener("click",reset);

    // Bloqueia o arrastar-soltar do importador simples durante o lote.
    // Contas antigas continuam com seu comportamento quando a fila termina.
    document.addEventListener("drop",event=>{
      if(!busy())return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if(typeof notice==="function")
        notice("Conclua o PDF atual do lote antes de arrastar outro.",true,6500);
    },true);
    // Detecta intenção de salvar/cancelar SEM modificar o frontend original.
    // O avanço ocorre SOMENTE quando a janela realmente fecha.
    document.addEventListener("click",event=>{
      if(state.phase!=="review")return;
      if(event.target.closest("#save"))state.intent="save";
      else if(event.target.closest("#cancel") || event.target===backdrop)
        state.intent="skip";
    },true);
    document.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&state.phase==="review")state.intent="skip";
    },true);
    window.addEventListener("beforeunload",event=>{
      if(state.phase!=="reading"&&state.phase!=="review")return;
      event.preventDefault();
      event.returnValue="";
    });
  }
  if(document.readyState==="loading")
    document.addEventListener("DOMContentLoaded",initialize,{once:true});
  else initialize();
})();
