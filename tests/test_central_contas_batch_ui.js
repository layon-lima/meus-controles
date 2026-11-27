"use strict";
/* Drag & drop: um PDF segue o importador normal; vários PDFs passam
 * pela fila sequencial, sem botões adicionais nem importação paralela.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {webcrypto}=require("node:crypto");
const vm=require("node:vm");
const source=fs.readFileSync("central_admin/static/contas_batch.js","utf8");
const style=fs.readFileSync("central_admin/static/contas_batch.css","utf8");
const gateway=fs.readFileSync("central_admin/operations_gateway.py","utf8");
assert.ok(source.includes('postPDF("/central/modules/contas/api/import/preview"'),
  "Todos os PDFs precisam ser encaminhados ao proxy com sessão");
assert.ok(source.includes('startDetectedHolerite(result)'),
  "Usar a própria identificação de holerite do motor");
assert.ok(!source.includes('"/api/import/commit"'),
  "A fila não pode cadastrar conta automaticamente");
assert.ok(source.includes("MutationObserver(modalChanged)"),
  "Próximo arquivo só após a janela de conferência ser fechada");
assert.ok(gateway.includes('"X-Pdf-Name", "X-Ocr-Mode"'),
  "Proxy deve preservar nome e modo de OCR");
assert.ok(gateway.includes("contas_batch.js?v="),"Carregar extensão somente na área Contas");
assert.ok(style.includes(".nh-batch-dock"),"Mostrar progresso");
for(const id of ["#aiConnect","#mobileBtn","#pdfImport"]){
  assert.ok(style.includes(id),"Esconder ação do cabeçalho: "+id);
}
assert.ok(!source.includes("nh-contas-batch-action"),"Botão antigo foi removido");
assert.ok(!source.includes('picker.multiple=true'),"Não criar seletor de lote");
assert.ok(source.includes('window.addEventListener("drop",event=>'),
  "Capturar drop na janela antes dos eventos do sistema antigo");
assert.ok(source.includes('window.addEventListener("dragover",event=>'),
  "Permitir explicitamente soltar PDFs no navegador");
assert.ok(source.includes('event.stopImmediatePropagation()'),
  "Evitar que o importador antigo processe o mesmo PDF novamente");
assert.ok(source.includes('importDroppedReceipt(file)'),"Não mudar tratamento de comprovantes");
assert.ok(source.includes('importNewPDF(file)'),"Um PDF deve usar o importador original");
assert.ok(source.includes('api(MANIFEST_API)'),"Consultar hash de TODOS os PDFs no R2");
assert.ok(source.includes('api(ACCOUNTS_API)'),"Consultar identificadores de contas existentes");
assert.ok(source.includes('sha256(file)'),"Comparar o arquivo exato em bytes");
assert.ok(source.includes('duplicateByPayment(result.fields,state.existingRecords)'),
  "OCR deve identificar duplicidade de linha digitável antes do formulário");
assert.ok(!source.includes("fornecedor,valor,vencimento") ||
          source.includes("normalizedCode"),
  "Não descartar contas apenas porque fornecedor, valor e vencimento coincidem");

let context;
class E {
  constructor(tag="div",id=""){
    this.tagName=tag;this.id=id;this.listeners={};this.children=[];
    this.textContent="";this.hidden=false;this.disabled=false;this.files=[];
    this.value="";this.style={width:""};this.dataset={};
    this._classes=new Set();
    this.classList={
      add:(name)=>{this._classes.add(name);this.changed()},
      remove:(name)=>{this._classes.delete(name);this.changed()},
      contains:(name)=>this._classes.has(name)
    };
  }
  set innerHTML(markup){
    this._html=markup;
    for(const id of [...markup.matchAll(/id="([^"]+)"/g)].map(x=>x[1])){
      if(!elements.has(id))elements.set(id,new E("button",id));
    }
  }
  get innerHTML(){return this._html||""}
  changed(){if(this.observer)this.observer()}
  setAttribute(name,value){this[name]=value}
  addEventListener(type,fn){this.listeners[type]=fn}
  insertAdjacentElement(pos,element){elements.set(element.id,element)}
  appendChild(element){this.children.push(element);if(element.id)elements.set(element.id,element)}
  click(){if(this.listeners.click)this.listeners.click()}
}
const elements=new Map();
const pdfImport=new E("button","pdfImport");
const backdrop=new E("div","backdrop");
elements.set("pdfImport",pdfImport);elements.set("backdrop",backdrop);
const body=new E("body","body");
const document={
  readyState:"complete",body,listeners:{},
  documentElement:{classList:{
    names:new Set(),
    add(name){this.names.add(name)},
    remove(name){this.names.delete(name)},
    contains(name){return this.names.has(name)}
  }},
  createElement(tag){return new E(tag)},
  getElementById(id){return elements.get(id)||null},
  addEventListener(type,fn){this.listeners[type]=fn}
};
const calls=[],cancelled=[],introduced=[],single=[],receipts=[],dropCleared=[],alerts=[];
let pending=0,maxSimultaneous=0,failNext=false;
const BANK_CODE="12345678901234567890123456789012345678901234567";
const postPDF=async(path,file,headers)=>{
  pending++;maxSimultaneous=Math.max(maxSimultaneous,pending);
  calls.push({path,file:file.name,headers});
  await Promise.resolve();
  pending--;
  if(failNext){failNext=false;return {ok:false,json:async()=>({error:"Falha simulada OCR"})}}
  const fields=file.name==="duplicado-codigo.pdf"?
    {fornecedor:"Fornecedor X",codigo_pagamento:BANK_CODE,valor:250,vencimento:"2026-11-22"}:
    file.name==="mesmo-fornecedor-valor.pdf"?
    {fornecedor:"Fornecedor X",codigo_pagamento:"",valor:250,vencimento:"2026-11-22"}:
    {fornecedor:file.name};
  return {ok:true,json:async()=>({ok:true,ticket:"T-"+file.name,fields})};
};
const startDetectedHolerite=result=>{
  introduced.push(result.ticket);
  backdrop.classList.add("show");
};
const registered=[],accountsDB=[];
const api=async(path,method,data)=>{
  if(path.endsWith("/api/windows/pdf-manifest"))
    return {ok:true,items:registered,r2_unavailable:false};
  if(path.endsWith("/api/accounts"))
    return {ok:true,accounts:accountsDB.slice()};
  cancelled.push({path,method,data});return {ok:true};
};
const importNewPDF=file=>single.push(file.name);
const importDroppedReceipt=file=>receipts.push(file.name);
const isReceiptFilename=name=>/comprovante/i.test(name);
const hideDropZone=()=>dropCleared.push(true);
let pendingImportPDF=null;
class MutationObserver {
  constructor(fn){this.fn=fn}
  observe(target,options){target.observer=()=>this.fn()}
  disconnect(){backdrop.observer=null}
}
const timers=[];
const win={
  listeners:{},
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length},
  addEventListener(type,fn){this.listeners[type]=fn},
  alert(text){alerts.push(text);},
  crypto:webcrypto
};
const location={pathname:"/central/modules/contas/"};
context={document,window:win,location,postPDF,startDetectedHolerite,api,
  importNewPDF,importDroppedReceipt,isReceiptFilename,hideDropZone,
  MutationObserver,console,alert(){},pendingImportPDF,Date,Uint8Array};
vm.runInNewContext(source,context);
const flush=async()=>{for(let i=0;i<160;i++)await new Promise(resolve=>setImmediate(resolve))};
const waitUntil=async(predicate,label)=>{
  const until=Date.now()+2500;
  while(Date.now()<until){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw new Error("Timeout aguardando "+label+"; alertas="+JSON.stringify(alerts)+
    "; fase="+(elements.get("nh-batch-state")?.dataset?.phase||"?"));
};
const next=async()=>{
  const task=timers.find(item=>item.ms===90);
  assert.ok(task,"Uma etapa terminou e agendou exatamente um próximo PDF");
  timers.splice(timers.indexOf(task),1);
  task.fn();await flush();
};
const pdf=(name,bytes=name)=>({
  name,size:1000,lastModified:12,
  arrayBuffer:async()=>Uint8Array.from(Buffer.from(bytes)).buffer
});
const digest=async file=>Buffer.from(
  await webcrypto.subtle.digest("SHA-256",await file.arrayBuffer())
).toString("hex");
assert.equal(elements.has("nh-contas-batch-files"),false,"Não há input extra");
assert.equal(elements.has("nh-contas-batch-action"),false,"Não há botão de lote");
const drop=(files)=> {
  const event={
    dataTransfer:{types:["Files"],files},
    preventDefault(){this.prevented=true;},
    stopImmediatePropagation(){this.stopped=true;}
  };
  win.listeners.drop(event);
  assert.equal(event.prevented,true,"Drop deve ser tratado pela Central");
  assert.equal(event.stopped,true,"Motor antigo não pode processar de novo");
  return event;
};
const errorStatus=()=>elements.get("nh-batch-message").textContent;

(async()=>{
  // A entrada deve ser detectada ainda no dragenter (sem botão).
  const entering={
    dataTransfer:{types:["Files"]},
    preventDefault(){this.prevented=true}
  };
  win.listeners.dragenter(entering);
  assert.equal(entering.prevented,true);
  assert.equal(document.documentElement.classList.contains("nh-contas-dragging-files"),true,
    "Deve sinalizar visualmente que a página aceita PDFs");
  const over={
    dataTransfer:{types:["Files"],dropEffect:"none"},
    preventDefault(){this.prevented=true}
  };
  win.listeners.dragover(over);
  assert.equal(over.prevented,true,"dragover precisa liberar o evento drop");
  assert.equal(over.dataTransfer.dropEffect,"copy");
  drop([pdf("boleto-simples.pdf")]);await flush();
  assert.equal(document.documentElement.classList.contains("nh-contas-dragging-files"),false,
    "Sinal de arraste desaparece após soltar");
  assert.deepEqual(single,["boleto-simples.pdf"],"PDF único é importado normalmente");
  assert.equal(calls.length,0,"Um arquivo não cria fila");
  drop([pdf("comprovante-de-pagamento.pdf")]);await flush();
  assert.deepEqual(receipts,["comprovante-de-pagamento.pdf"],
    "Comprovante único continua no fluxo de pagamento");
  assert.equal(calls.length,0);
  drop([pdf("conta.pdf"),pdf("comprovante.pdf")]);
  assert.equal(calls.length,0,"Não misturar comprovantes e novas contas");
  assert.ok(alerts.at(-1).includes("Comprovantes de pagamento"));
  drop([pdf("conta-01.pdf"),pdf("holerite-02.pdf"),pdf("conta-03.pdf")]);
  await flush();
  assert.equal(calls.length,1,"Selecionar 3 arquivos só processa o primeiro. Alertas: "+JSON.stringify(alerts)+"; status: "+errorStatus());
  assert.equal(calls[0].path,"/central/modules/contas/api/import/preview");
  assert.equal(calls[0].headers["X-Ocr-Mode"],"hybrid");
  assert.equal(introduced[0],"T-conta-01.pdf");
  assert.equal(backdrop.classList.contains("show"),true);
  assert.equal(pdfImport.disabled,true);
  assert.ok(errorStatus().includes("Confira"),"Pedir conferência manual");
  // Clicar Salvar sem a janela fechar NÃO pode avançar.
  const save={closest:selector=>selector==="#save"};
  document.listeners.click({target:save});
  await flush();
  assert.equal(calls.length,1);
  // Quando o CONTAS 4 termina de salvar, fecha a própria janela.
  backdrop.classList.remove("show");await flush();await next();
  assert.equal(calls.length,2,"Somente após salvar inicia o segundo");
  assert.equal(introduced[1],"T-holerite-02.pdf");

  // Reconhecimento de funcionário pode exigir MAIS uma conferência:
  // a primeira etapa não fecha o backdrop e NÃO avança.
  document.listeners.click({target:save});
  await flush();
  assert.equal(calls.length,2,"Holerite ainda está em conferência");
  // Cancelar o segundo deve pular, jamais confirmar.
  const cancel={closest:selector=>selector==="#cancel"};
  document.listeners.click({target:cancel});
  backdrop.classList.remove("show");await flush();await next();
  assert.equal(calls.length,3,"Após cancelar segundo, o terceiro é apresentado");
  assert.equal(introduced.length,3);
  // Falha OCR congela a fila até usuário decidir repetir/pular.

  const cancel3={closest:selector=>selector==="#cancel"};
  document.listeners.click({target:cancel3});
  backdrop.classList.remove("show");await flush();
  assert.equal(elements.get("nh-batch-state").dataset.phase,"complete");
  assert.equal(calls.length,3);
  assert.equal(maxSimultaneous,1);
  assert.equal(elements.get("nh-batch-close").hidden,false);
  assert.equal(pdfImport.disabled,false);

  // Nova fila com OCR falhando no primeiro arquivo: não pula sozinha.
  failNext=true;
  drop([pdf("com-erro.pdf"),pdf("seguinte.pdf")]);await flush();
  assert.equal(calls.length,4);
  assert.equal(elements.get("nh-batch-state").dataset.phase,"error");
  assert.ok(errorStatus().includes("Falha simulada OCR"));
  assert.equal(calls.length,4,"A fila espera a decisão do usuário");
  elements.get("nh-batch-retry").listeners.click();await flush();
  assert.equal(calls.length,5,"Botão tentar novamente só reenvia um PDF");
  assert.equal(introduced.at(-1),"T-com-erro.pdf");
  document.listeners.click({target:cancel});
  backdrop.classList.remove("show");await flush();await next();
  assert.equal(calls.length,6,"O próximo arquivo ainda foi enviado individualmente");
  document.listeners.click({target:save});
  backdrop.classList.remove("show");await flush();
  assert.equal(elements.get("nh-batch-state").dataset.phase,"complete");
  assert.equal(maxSimultaneous,1,"Nunca existem duas análises simultâneas");
  assert.equal(cancelled.length,0,"Nenhuma prévia válida foi descartada por erro de fluxo");
  assert.equal(dropCleared.length,5,"Área de arrastar fecha após cada tentativa");
  assert.equal(elements.has("nh-contas-batch-action"),false);
  assert.equal(elements.has("nh-contas-batch-files"),false);

  // O PDF exato já existe no R2, e há outro PDF repetido no mesmo lote.
  const r2File=pdf("ja-cadastrado.pdf");
  registered.push({id:91,sha256:await digest(r2File)});
  const countBefore=calls.length;
  drop([r2File,pdf("novo-documento.pdf","BYTES-IGUAIS"),
        pdf("copia-com-outro-nome.pdf","BYTES-IGUAIS")]);
  await waitUntil(()=>calls.length===countBefore+1,"remoção de SHA-256 repetido");
  assert.equal(calls.length,countBefore+1,"Só o PDF realmente novo chega ao OCR");
  assert.equal(calls.at(-1).file,"novo-documento.pdf");
  assert.ok(elements.get("nh-batch-summary").textContent.includes("Duplicados excluídos: 2"),
    "Uma cópia do R2 e uma cópia dentro do lote descartadas ANTES da fila");
  document.listeners.click({target:cancel});
  backdrop.classList.remove("show");await flush();
  assert.equal(elements.get("nh-batch-state").dataset.phase,"complete");

  // Se TODOS forem duplicados, não deve existir uma fila a ser processada.
  const noNew=calls.length;
  drop([r2File,pdf("mesmo-r2-renomeado.pdf","ja-cadastrado.pdf")]);
  await waitUntil(()=>elements.get("nh-batch-state").dataset.phase==="complete",
    "filtragem completa quando ambos os PDFs já estão no R2");
  assert.equal(calls.length,noNew);
  assert.equal(elements.get("nh-batch-state").dataset.phase,"complete");
  assert.ok(errorStatus().includes("Nenhum entrou na fila"));

  // Linha digitável única: o OCR descarta ANTES de abrir a conferência.
  accountsDB.push({id:301,codigo_pagamento:BANK_CODE,
    fornecedor:"Fornecedor X",valor:250,vencimento:"2026-11-22"});
  const forms=introduced.length,prevCalls=calls.length;
  drop([pdf("duplicado-codigo.pdf"),pdf("mesmo-fornecedor-valor.pdf")]);
  await waitUntil(()=>calls.length===prevCalls+1,"OCR do primeiro PDF após SHA-256");
  assert.equal(calls.length,prevCalls+1,"Primeiro PDF passa pelo OCR somente uma vez");
  assert.equal(introduced.length,forms,"Cobrança repetida não deve abrir formulário");
  assert.equal(cancelled.length,1,"Ticket do OCR duplicado deve ser cancelado");
  assert.equal(cancelled[0].path,"/central/modules/contas/api/import/cancel");
  assert.equal(cancelled[0].data.ticket,"T-duplicado-codigo.pdf");
  await next();
  assert.equal(calls.length,prevCalls+2);
  assert.equal(introduced.length,forms+1,
    "Mesmo fornecedor+valor+vencimento SEM identificador não é duplicidade");
  assert.equal(calls.at(-1).file,"mesmo-fornecedor-valor.pdf");
  document.listeners.click({target:cancel});
  backdrop.classList.remove("show");await flush();
  assert.ok(elements.get("nh-batch-summary").textContent.includes("Duplicados excluídos: 1"),
    "Pular cobrança já existente não aumenta os erros de OCR");

  console.log("OK: duplicados SHA-256 no R2/no lote filtrados antes da fila");
  console.log("OK: linha digitável repetida excluída após OCR, sem bloquear conta legítima");
  console.log("OK: 3 PDFs selecionados; OCR sequencial, revisão, holerite e cancelamento");
  console.log("OK: erro pausa a fila, permite tentar novamente, não salva automaticamente");
})().catch(error=>{console.error(error);process.exitCode=1});
