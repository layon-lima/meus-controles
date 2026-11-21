"use strict";
/*
 * Central Novo Horizonte | Envio sequencial de contas
 *
 * O usuário ARRASTA PDFs para a página. Somente UM PDF é enviado
 * para OCR/preview por vez. A conferência, o salvamento, o R2, o Windows e
 * o tratamento de holerites são executados pelas MESMAS funções do CONTAS 4:
 * postPDF, startDetectedHolerite, accountModal e closeModal.
 *
 * Um PDF usa a importação normal, dois ou mais usam uma fila.
 * Nenhum envio paralelo, nenhum salvamento automático ou segunda implementação
 * de regras financeiras. A fila reside apenas na memória da aba.
 */
(() => {
  const MAX_FILES=100, MAX_PDF=30*1024*1024;
  const $=id=>document.getElementById(id);
  const state={
    files:[],candidates:[],index:0,checkingIndex:0,phase:"idle",
    saved:0,skipped:0,failed:0,duplicates:0,
    existingRecords:[],refreshAccountsOnNext:false,
    intent:"skip",stopAfterCurrent:false,epoch:0,ticket:null
  };
  let dock=null,observer=null,advanceTimer=null;
  const busy=()=>["checking","waiting","reading","review","error"].includes(state.phase);
  const fileNow=()=>state.files[state.index]||null;
  const count=()=>state.files.length;
  const nextTick=fn=>window.setTimeout(fn,90);

  const ACCOUNTS_API="/central/modules/contas/api/accounts";
  const MANIFEST_API="/central/modules/contas/api/windows/pdf-manifest";
  // O manifesto original é SOMENTE LEITURA e contém SHA-256 de PDFs
  // cadastrados, inclusive os arquivos disponíveis no Cloudflare R2.
  async function sha256(file){
    if(!window.crypto?.subtle || typeof file.arrayBuffer!=="function")
      throw new Error("Este navegador não permite verificar a integridade SHA-256 dos PDFs.");
    const bytes=await file.arrayBuffer();
    const digest=await window.crypto.subtle.digest("SHA-256",bytes);
    return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("");
  }
  function normalizedCode(value){
    return String(value||"").replace(/[^a-z0-9]/gi,"").toUpperCase();
  }
  function normalizedAmount(value){
    const n=Number(value);
    return Number.isFinite(n)&&n>0?Math.round(n*100):null;
  }
  function duplicateByPayment(fields,records){
    const code=normalizedCode(fields?.codigo_pagamento);
    if(!code)return null;
    const bank=/^[0-9]{44}$|^[0-9]{46}$|^[0-9]{47}$|^[0-9]{48}$/.test(code);
    const emv=code.startsWith("000201")&&code.length>=50;
    if(!bank&&!emv)return null;
    const amount=normalizedAmount(fields?.valor);
    const due=String(fields?.vencimento||"");
    for(const record of records){
      if(normalizedCode(record.codigo_pagamento)!==code)continue;
      // Repete as regras de proteção do motor CONTAS 4: linha digitável é
      // identificador único; Pix EMV exige também mesmo valor e vencimento.
      if(bank || (emv&&amount!==null&&due&&
                  normalizedAmount(record.valor)===amount&&
                  String(record.vencimento||"")===due))
        return Number(record.id)||0;
    }
    return null;
  }


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
    const checking=state.phase==="checking";
    const current=fileNow(),total=checking?state.candidates.length:count();
    const running=busy();
    // Apenas impedir ações concorrentes. Os botões de importação são
    // ocultos no layout da Central, mas o motor antigo permanece ativo.
    for(const id of ["pdfImport","newAccount","payrollNew"]){
      const button=$(id);
      if(button)button.disabled=running;
    }
    if(!total && state.phase!=="complete"){
      dock.hidden=true;return;
    }
    showDock();
    text("nh-batch-counter",checking
      ? Math.min(state.checkingIndex,total)+"/"+total
      :total?Math.min(state.index+1,total)+"/"+total:"");
    text("nh-batch-filename",checking?"Verificando PDFs antes da fila…":
      current?current.name:"Nenhum PDF pendente");
    text("nh-batch-message",message || (state.phase==="review"
      ?"Confira o formulário e clique em Salvar ou Cancelar. O próximo PDF será lido só depois."
      :state.phase==="reading"?"Lendo o PDF no servidor…"
      :state.phase==="error"?"Não foi possível analisar este arquivo."
      :state.phase==="complete"?"Processamento encerrado."
      :"Aguardando…"));
    text("nh-batch-summary",
      "Duplicados excluídos: "+state.duplicates+" · Confirmados: "+state.saved+
      " · Ignorados: "+state.skipped+" · Erros: "+state.failed);
    const progress=checking?(total?state.checkingIndex/total*100:0):
      state.phase==="complete"?100:
      total?Math.min(100,(state.index/total)*100):0;
    const bar=$("nh-batch-progress");
    if(bar){bar.style.width=progress+"%";bar.setAttribute("aria-valuenow",String(Math.round(progress)))}
    $("nh-batch-retry").hidden=state.phase!=="error";
    $("nh-batch-skip").hidden=state.phase!=="error";
    $("nh-batch-stop").hidden=!running||checking||state.stopAfterCurrent;
    $("nh-batch-close").hidden=state.phase!=="complete";
    $("nh-batch-state").dataset.phase=state.phase;
    dock.dataset.phase=state.phase;
  }
  function reset(){
    state.files=[];state.candidates=[];state.index=0;state.checkingIndex=0;state.phase="idle";
    state.saved=0;state.skipped=0;state.failed=0;state.duplicates=0;
    state.existingRecords=[];state.refreshAccountsOnNext=false;
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

  }
  function advance(saved){
    if(state.phase!=="review")return;
    if(saved){
      state.saved++;
      // O próximo OCR deve comparar também com a conta recém-confirmada.
      state.refreshAccountsOnNext=true;
    }else state.skipped++;
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
      if(state.refreshAccountsOnNext){
        const snapshot=await api(ACCOUNTS_API);
        if(!Array.isArray(snapshot.accounts))
          throw new Error("Não foi possível atualizar a lista de contas para conferir duplicidades.");
        if(currentEpoch!==state.epoch)return;
        state.existingRecords=snapshot.accounts;
        state.refreshAccountsOnNext=false;
      }
      // Uma chamada por vez e sem a próxima antes de fechar a conferência.
      const response=await postPDF("/central/modules/contas/api/import/preview",file,{
        "X-Pdf-Name":encodeURIComponent(file.name),
        "X-Ocr-Mode":"hybrid"
      });
      const result=await response.json().catch(()=>({error:"Resposta inválida do leitor de PDF."}));
      if(currentEpoch!==state.epoch)return;
      if(!response.ok||!result.ok||!result.ticket)
        throw new Error(result.error||"Não foi possível ler o PDF.");
      const duplicateId=duplicateByPayment(result.fields,state.existingRecords);
      if(duplicateId!==null){
        // OCR identificou uma linha única ou PIX EMV que já existe.
        // NÃO apresentar formulário e NÃO deixar o PDF na fila.
        state.ticket=result.ticket;
        await cancelTicket();
        if(currentEpoch!==state.epoch)return;
        state.duplicates++;
        state.files.splice(state.index,1);
        if(!count())return finish("Todos os PDFs foram identificados como duplicados.");
        if(state.index>=count())return finish(
          "Conferência concluída. Duplicados removidos antes de abrir formulário.");
        state.phase="waiting";
        render("Cobrança já cadastrada (conta "+duplicateId+"). Removida da fila.");
        const epoch=state.epoch;
        advanceTimer=nextTick(()=>{
          advanceTimer=null;
          if(epoch===state.epoch)processCurrent();
        });
        return;
      }
      state.ticket=result.ticket;
      pendingImportPDF={ticket:result.ticket,file};
      // REAPROVEITA INTEGRALMENTE os formulários originais: OCR, revisão,
      // holerites, funcionários/Pix, R2, Windows e validações de duplicidade.
      startDetectedHolerite(result);
      // Identificação do lote aparece dentro do próprio formulário antigo,
      // enquanto o painel flutuante fica atrás para não bloquear Salvar.
      const intro=$("dialogIntro");
      if(intro)intro.textContent=
        "Arquivo "+(state.index+1)+" de "+count()+" — "+file.name+". "+intro.textContent;
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
  async function begin(files){
    if(busy())return;
    if(!files.length)return;
    if(files.length>MAX_FILES){
      alert("Selecione no máximo "+MAX_FILES+" PDFs por lote.");return;
    }
    if($("backdrop")?.classList.contains("show")){
      alert("Conclua a conta aberta antes de iniciar um lote.");return;
    }
    if($("pdfImport")?.disabled){
      alert("Aguarde a importação individual em andamento antes de iniciar o lote.");return;
    }
    reset();
    state.phase="checking";state.candidates=files.slice();
    render("Consultando documentos já cadastrados, inclusive no R2…");
    const epoch=state.epoch;
    try{
      if(typeof api!=="function")
        throw new Error("Consulta de duplicidades do CONTAS 4 indisponível.");
      const [manifest,accountsSnapshot]=await Promise.all([
        api(MANIFEST_API),api(ACCOUNTS_API)
      ]);
      if(epoch!==state.epoch)return;
      if(manifest.r2_unavailable)
        throw new Error("R2 indisponível para conferir PDFs existentes.");
      if(!Array.isArray(manifest.items)||!Array.isArray(accountsSnapshot.accounts))
        throw new Error("Inventário de PDFs ou lista de contas inválido.");
      const registered=new Set(manifest.items.map(row=>
        String(row.sha256||"").trim().toLowerCase()
      ).filter(hash=>/^[a-f0-9]{64}$/.test(hash)));
      const inSelection=new Set(),unique=[];
      for(const file of files){
        const digest=await sha256(file);
        if(epoch!==state.epoch)return;
        state.checkingIndex++;
        if(registered.has(digest)||inSelection.has(digest))state.duplicates++;
        else {
          inSelection.add(digest);
          unique.push(file);
        }
        render("Verificando "+state.checkingIndex+" de "+files.length+
          " · duplicados encontrados: "+state.duplicates);
      }
      state.existingRecords=accountsSnapshot.accounts;
      state.candidates=[];
      state.files=unique;
      if(!unique.length)
        return finish("Todos os "+files.length+
          " PDFs já estavam cadastrados ou repetidos. Nenhum entrou na fila.");
      state.phase="waiting";
      render(state.duplicates
        ?state.duplicates+" duplicado(s) descartado(s). Iniciando conferência dos demais…"
        :"Nenhuma duplicidade exata encontrada. Iniciando a conferência…");
      processCurrent();
    }catch(error){
      if(epoch!==state.epoch)return;
      reset();
      const message="Não foi possível conferir duplicidades: "+
        (error.message||String(error))+". Nenhum arquivo entrou na fila. Arraste novamente.";
      if(typeof notice==="function")notice(message,true,11000);
      else window.alert(message);
    }
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
    if(!upload||!backdrop||$("nh-batch-dock"))return;

    // Não criar botão de envio ou seletor paralelo. O motor original do
    // CONTAS 4 continua disponível em funções, não como ação extra no topo.
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
    // O indicador só é exibido quando um lote de verdade começa; solte um
    // único PDF e o formulário usual aparece sem janela de fila.
    $("nh-batch-retry").addEventListener("click",()=>{
      if(state.phase!=="error")return;
      state.phase="waiting";processCurrent();
    });
    $("nh-batch-skip").addEventListener("click",skipError);
    $("nh-batch-stop").addEventListener("click",stop);
    $("nh-batch-close").addEventListener("click",reset);

    // O arquivo é detectado SOMENTE quando o usuário arrasta para a página.
    // Captura antes do handler antigo, que exigia um único PDF, para evitar
    // a mensagem "arraste apenas um PDF" e o duplo processamento.
    // Eventos de DROP capturados na JANELA, antes dos listeners legados
    // e de qualquer componente sobreposto. O browser só entrega "drop"
    // sobre uma superfície que aceitou "dragover" com preventDefault().
    // O código antigo tratava vários PDFs como erro; nunca deve receber
    // o mesmo evento após o coordenador da Central.
    const hasFiles=event=>{
      const data=event.dataTransfer;
      if(!data)return false;
      return Array.from(data.types||[]).includes("Files") ||
        (event.type==="drop" && Number(data.files?.length)>0);
    };
    const message=(value,error=true)=>{
      if(typeof notice==="function")notice(value,error,7500);
      else window.alert(value);
    };
    const clearDrop=()=>{
      document.documentElement.classList.remove("nh-contas-dragging-files");
      if(typeof hideDropZone==="function")hideDropZone();
      else $("dropZone")?.classList.remove("visible");
    };
    const validateFiles=files=>
      files.every(file=>/\.pdf$/i.test(file.name||"") &&
                       file.size>=5 && file.size<=MAX_PDF);
    const setDropCue=()=>{
      document.documentElement.classList.add("nh-contas-dragging-files");
      const description=$("dropZone")?.querySelector(".drop-zone-content span");
      if(description)description.textContent=
        "Solte os PDFs aqui. Um arquivo: conferência normal. Vários: fila individual.";
    };
    let dragDepth=0;
    window.addEventListener("dragenter",event=>{
      if(!hasFiles(event))return;
      event.preventDefault();
      dragDepth++;
      setDropCue();
    },true);
    window.addEventListener("dragover",event=>{
      if(!hasFiles(event))return;
      event.preventDefault();
      if(event.dataTransfer)event.dataTransfer.dropEffect=
        busy()?"none":"copy";
      setDropCue();
    },true);
    window.addEventListener("dragleave",event=>{
      if(!hasFiles(event))return;
      if(--dragDepth<=0){
        dragDepth=0;
        // Oculta a marcação após sair do navegador, não após trocar de
        // elemento interno. O legado também mantém sua própria contagem.
        if(!event.relatedTarget)clearDrop();
      }
    },true);
    window.addEventListener("drop",event=>{
      if(!hasFiles(event))return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dragDepth=0;
      const files=Array.from(event.dataTransfer?.files||[]);
      clearDrop();
      if(busy()){
        message("Finalize a conferência atual antes de arrastar mais arquivos.");return;
      }
      if(!files.length){
        message("Nenhum arquivo foi recebido. Arraste os PDFs do Explorador do Windows.");return;
      }
      if(!validateFiles(files)){
        message("Arraste somente PDFs válidos, com até 30 MB cada.");return;
      }
      if(files.length===1){
        const file=files[0];
        // Comprovante mantém o vínculo ao pagamento original; não criar
        // conta duplicada por engano.
        if(typeof isReceiptFilename==="function" &&
           isReceiptFilename(file.name)){
          if(typeof importDroppedReceipt==="function")
            Promise.resolve(importDroppedReceipt(file)).catch(e=>message(e.message));
          else message("Conferência de comprovante indisponível.");
        }else if(typeof importNewPDF==="function"){
          Promise.resolve(importNewPDF(file)).catch(e=>message(e.message));
        }else message("Motor de importação individual indisponível.");
        return;
      }
      if(typeof isReceiptFilename==="function" &&
         files.some(file=>isReceiptFilename(file.name))){
        message("Comprovantes de pagamento devem ser arrastados individualmente. O lote é para boletos e contas.");return;
      }
      begin(files);
    },true);
    // Ao voltar para o navegador, não deixar o feedback de arraste preso.
    window.addEventListener("blur",()=>{
      dragDepth=0;clearDrop();
    });
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
