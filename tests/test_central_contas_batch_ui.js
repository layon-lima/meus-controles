"use strict";
/* Teste de integração da fila: nunca envia 2 arquivos simultâneos, revisão
 * do CONTAS permanece soberana, cancelamentos não criam contas.
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
const calls=[],cancelled=[],introduced=[];
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
const picker=elements.get("nh-contas-batch-files");
const button=elements.get("nh-contas-batch-action");
assert.ok(picker&&button,"Botão novo junto de Importar PDF");
assert.equal(picker.multiple,true);
const errorStatus=()=>elements.get("nh-batch-message").textContent;

(async()=>{
  picker.files=[pdf("conta-01.pdf"),pdf("holerite-02.pdf"),pdf("conta-03.pdf")];
  picker.listeners.change();await flush();
  assert.equal(calls.length,1,"Selecionar 3 arquivos só processa o primeiro");
  assert.equal(calls[0].path,"/central/modules/contas/api/import/preview");
  assert.equal(calls[0].headers["X-Ocr-Mode"],"hybrid");
  assert.equal(introduced[0],"T-conta-01.pdf");
  assert.equal(backdrop.classList.contains("show"),true);
  assert.equal(button.disabled,true);
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
  const review=elements.get("nh-batch-file" );
  assert.equal(review,null);
  const cancel3={closest:selector=>selector==="#cancel"};
  document.listeners.click({target:cancel3});
  backdrop.classList.remove("show");await flush();
  assert.equal(elements.get("nh-batch-state").dataset.phase,"complete");
  assert.equal(calls.length,3);
  assert.equal(maxSimultaneous,1);
  assert.equal(elements.get("nh-batch-close").hidden,false);
  assert.equal(button.disabled,false);

  // Nova fila com OCR falhando no primeiro arquivo: não pula sozinha.
  failNext=true;
  picker.files=[pdf("com-erro.pdf"),pdf("seguinte.pdf")];
  picker.listeners.change();await flush();
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
  console.log("OK: 3 PDFs selecionados; OCR sequencial, revisão, holerite e cancelamento");
  console.log("OK: erro pausa a fila, permite tentar novamente, não salva automaticamente");
})().catch(error=>{console.error(error);process.exitCode=1});
