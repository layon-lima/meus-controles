"use strict";
/* Drag & drop: um PDF segue o importador normal; vários PDFs passam
 * pela fila sequencial, sem botões adicionais nem importação paralela.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
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
assert.ok(source.includes('document.addEventListener("drop",event=>'),
  "Usar drop real para importar a fila");
assert.ok(source.includes('importDroppedReceipt(file)'),"Não mudar tratamento de comprovantes");
assert.ok(source.includes('importNewPDF(file)'),"Um PDF deve usar o importador original");

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
  createElement(tag){return new E(tag)},
  getElementById(id){return elements.get(id)||null},
  addEventListener(type,fn){this.listeners[type]=fn}
};
const calls=[],cancelled=[],introduced=[],single=[],receipts=[],dropCleared=[];
let pending=0,maxSimultaneous=0,failNext=false;
const postPDF=async(path,file,headers)=>{
  pending++;maxSimultaneous=Math.max(maxSimultaneous,pending);
  calls.push({path,file:file.name,headers});
  await Promise.resolve();
  pending--;
  if(failNext){failNext=false;return {ok:false,json:async()=>({error:"Falha simulada OCR"})}}
  return {ok:true,json:async()=>({ok:true,ticket:"T-"+file.name,fields:{fornecedor:file.name}})};
};
const startDetectedHolerite=result=>{
  introduced.push(result.ticket);
  backdrop.classList.add("show");
};
const api=async(path,method,data)=>{cancelled.push({path,method,data});return {ok:true}};
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
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length},
  addEventListener(){},
};
const location={pathname:"/central/modules/contas/"};
context={document,window:win,location,postPDF,startDetectedHolerite,api,
  importNewPDF,importDroppedReceipt,isReceiptFilename,hideDropZone,
  MutationObserver,console,alert(){},pendingImportPDF,Date};
vm.runInNewContext(source,context);
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve()};
const next=async()=>{
  const task=timers.find(item=>item.ms===90);
  assert.ok(task,"Uma etapa terminou e agendou exatamente um próximo PDF");
  timers.splice(timers.indexOf(task),1);
  task.fn();await flush();
};
const pdf=(name)=>({name,size:1000,lastModified:12});
assert.equal(elements.has("nh-contas-batch-files"),false,"Não há input extra");
assert.equal(elements.has("nh-contas-batch-action"),false,"Não há botão de lote");
const drop=(files)=> {
  const event={
    dataTransfer:{types:["Files"],files},
    preventDefault(){this.prevented=true;},
    stopImmediatePropagation(){this.stopped=true;}
  };
  document.listeners.drop(event);
  assert.equal(event.prevented,true,"Drop deve ser tratado pela Central");
  assert.equal(event.stopped,true,"Motor antigo não pode processar de novo");
  return event;
};
const errorStatus=()=>elements.get("nh-batch-message").textContent;

(async()=>{
  drop([pdf("boleto-simples.pdf")]);await flush();
  assert.deepEqual(single,["boleto-simples.pdf"],"PDF único é importado normalmente");
  assert.equal(calls.length,0,"Um arquivo não cria fila");
  drop([pdf("comprovante-de-pagamento.pdf")]);await flush();
  assert.deepEqual(receipts,["comprovante-de-pagamento.pdf"],
    "Comprovante único continua no fluxo de pagamento");
  assert.equal(calls.length,0);
  drop([pdf("conta-01.pdf"),pdf("holerite-02.pdf"),pdf("conta-03.pdf")]);
  await flush();
  assert.equal(calls.length,1,"Selecionar 3 arquivos só processa o primeiro");
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
  assert.equal(dropCleared.length,4,"Área de arrastar precisa fechar a cada importação");
  assert.equal(elements.has("nh-contas-batch-action"),false);
  assert.equal(elements.has("nh-contas-batch-files"),false);
  console.log("OK: 3 PDFs selecionados; OCR sequencial, revisão, holerite e cancelamento");
  console.log("OK: erro pausa a fila, permite tentar novamente, não salva automaticamente");
})().catch(error=>{console.error(error);process.exitCode=1});
