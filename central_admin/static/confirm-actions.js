"use strict";
/* Feedback após a resposta do servidor. Não interceptar a ação com perguntas. */
(()=>{
  if(window.NHConfirm)return;
  const originalFetch=window.fetch.bind(window);
  const writes=new Set(["POST","PUT","PATCH","DELETE"]);
  const readOnly=[
    /^\/api\/pair$/,
    /^\/api\/export\/excel$/,
    /^\/api\/reports\/controls\.xlsx$/,
    /^\/api\/recebimentos\/resumo\.xlsx$/,
    /^\/api\/controls\/\d+\/receiving\/invoices\.xlsx$/,
    /^\/api\/controls\/\d+\/receiving\/(?:xml\/preview|pdf\/(?:preview|page|region)|fiscal\/pdf\/preview|import\/preview)$/,
    /^\/api\/controls\/\d+\/(?:debt\/import|pair\/(?:import|financial-import|mixed-import))\/preview$/,
    /^\/api\/import\/(?:preview|cancel)$/,
    /^\/api\/accounts\/\d+\/(?:verify-receipt|prepare-send)$/,
    /^\/api\/batch\/prepare-send$/,
    /^\/api\/receipts\/(?:eligible|identify)$/,
    /^\/api\/holerites\/identificar$/,
    /^\/api\/ai\/correct$/
  ];
  function operation(input,init={}){
    const raw=typeof input==="string"||input instanceof URL?String(input):input.url;
    const url=new URL(raw,window.location.href);
    if(url.origin!==window.location.origin)return null;
    const method=String(init.method||input?.method||"GET").toUpperCase();
    const match=url.pathname.match(/^\/central\/(?:modules\/[a-z-]+\/)?(api\/.*)$/);
    if(!match||!writes.has(method))return null;
    const path="/"+match[1];
    if(method==="POST"&&readOnly.some(re=>re.test(path)))return null;
    const removing=method==="DELETE"||/\/(?:delete|bulk-delete|undo|cancel-suggestion)(?:\/|$)/.test(path);
    return {removing,path,method};
  }
  // Um aviso visível, acima dos formulários e fora de qualquer container rolável.
  // Mensagens específicas do módulo substituem o aviso genérico da mesma operação.
  let last=null;
  function notify(message,error=false,{fallback=false}={}){
    try{
      let root=document.getElementById("nh-operation-notices");
      if(!root){
        root=document.createElement("div");root.id="nh-operation-notices";
        root.setAttribute("aria-label","Notificações");document.body.append(root);
      }
      const now=Date.now();
      const info=!error&&!fallback&&/^(?:conferindo|carregando|importando|processando|lendo|buscando|gerando|enviando|aguarde|selecione|informe|solte|revise)\b/i.test(String(message));
      let item;
      if(!info&&!fallback&&last?.fallback&&last.error===error&&now-last.time<3500&&last.item.isConnected){
        item=last.item;clearTimeout(last.timer);
        item.querySelector(".nh-operation-text").textContent=String(message);
      }else{
        item=document.createElement("div");item.className="nh-operation-notice"+(error?" is-error":info?" is-info":"");
        item.setAttribute("role",error?"alert":"status");
        const mark=document.createElement("span");mark.className="nh-operation-mark";mark.textContent=error?"!":info?"i":"✓";mark.setAttribute("aria-hidden","true");
        const text=document.createElement("span");text.className="nh-operation-text";text.textContent=String(message);
        const close=document.createElement("button");close.type="button";close.textContent="×";close.setAttribute("aria-label","Fechar notificação");
        close.addEventListener("click",()=>item.remove());
        item.append(mark,text,close);root.append(item);
        while(root.children.length>4)root.firstElementChild.remove();
      }
      last={item,error,fallback,time:now,timer:setTimeout(()=>item.remove(),error?10000:5500)};
    }catch(_){/* A apresentação nunca interfere no resultado da gravação. */}
  }
  function successMessage(op,status,data){
    if(status===202)return "Solicitação recebida pelo servidor. Processamento pendente.";
    const path=op.path;
    if(/\/gfarm\/send$/.test(path))return "Solicitação enviada ao GFARM.";
    if(/\/(?:pay|pay-with-receipt)$/.test(path))return "Pagamento registrado com sucesso.";
    if(/\/(?:confirm-send|suggest)$/.test(path))return "Envio registrado com sucesso.";
    if(/\/funcionarios\/pix$/.test(path))return "Chave Pix atualizada com sucesso.";
    if(/\/(?:xml|pdf|import|financial-import|mixed-import)\/confirm$|\/import\/commit$/.test(path))return "Importação concluída com sucesso.";
    if(/\/(?:vincular(?:-conta)?|assign)$/.test(path))return "Vínculo salvo com sucesso.";
    if(/\/complete$|\/truck\/closures$/.test(path))return "Encerramento registrado com sucesso.";
    if(op.removing)return "Exclusão concluída com sucesso.";
    if(op.method==="PUT"||op.method==="PATCH"||/\/(?:edit|rename|move)$/.test(path))return "Alteração salva com sucesso.";
    return "Operação concluída com sucesso.";
  }
  let queue=Promise.resolve();
  function show(title,message,removing){
    return new Promise(resolve=>{
      const previous=document.activeElement;
      const dialog=document.createElement("dialog");
      dialog.className="nh-confirm-dialog";
      dialog.setAttribute("aria-labelledby","nh-confirm-title");
      dialog.setAttribute("aria-describedby","nh-confirm-message");
      const heading=document.createElement("h2");heading.id="nh-confirm-title";heading.textContent=title;
      const paragraph=document.createElement("p");paragraph.id="nh-confirm-message";paragraph.textContent=message;
      const actions=document.createElement("div");actions.className="nh-confirm-actions";
      const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Cancelar";cancel.className="nh-confirm-cancel";
      const approve=document.createElement("button");approve.type="button";approve.textContent="Confirmar";approve.className="nh-confirm-approve"+(removing?" nh-confirm-danger":"");
      actions.append(cancel,approve);dialog.append(heading,paragraph,actions);
      let done=false;
      function finish(ok){
        if(done)return;done=true;
        dialog.close();dialog.remove();
        if(previous?.isConnected)previous.focus({preventScroll:true});
        resolve(ok);
      }
      cancel.addEventListener("click",()=>finish(false));
      approve.addEventListener("click",()=>finish(true));
      dialog.addEventListener("cancel",e=>{e.preventDefault();finish(false);});
      dialog.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();finish(false);}});
      dialog.addEventListener("close",()=>finish(false));
      document.body.append(dialog);
      try{dialog.showModal();cancel.focus();}catch{dialog.remove();resolve(false);}
    });
  }
  function ask(message,title="Confirmar operação",removing=false){
    const next=queue.then(()=>show(title,String(message),removing));
    queue=next.catch(()=>false);
    return next;
  }
  // O diálogo permanece exclusivamente para decisões específicas existentes
  // (descartar formulário, escolha de fornecedor, consentimento), não para cada POST.
  window.NHConfirm={ask,operation};
  window.NHFeedback={notify};
  window.fetch=async function(input,init){
    let op=null;
    try{op=operation(input,init);}catch{}
    let response;
    try{response=await originalFetch(input,init);}
    catch(error){
      if(op)notify("Não foi possível verificar o resultado da operação. Atualize a lista antes de tentar novamente.",true,{fallback:true});
      throw error;
    }
    if(!op)return response;
    // Não consumir o corpo usado pelo módulo. Uma resposta 2xx com ok:false
    // ou error também é falha. Não afirmar sucesso com HTML/login ou JSON inválido.
    try{
      let data=null,valid=response.status===204;
      const type=response.headers.get("Content-Type")||"";
      if(type.includes("json")){
        try{data=await response.clone().json();valid=data!==null&&typeof data==="object";}catch{}
      }
      const reason=data?.error||data?.erro;
      const failed=!response.ok||data?.ok===false||data?.success===false||!!reason;
      if(failed){
        if(response.status===403&&/sess[aã]o inv[aá]lida|reabra pelo iniciador/i.test(String(reason||"")))return response;
        notify(typeof reason==="string"?reason:"Operação não concluída. Confira os dados.",true,{fallback:true});
      }else if(valid){
        notify(successMessage(op,response.status,data),false,{fallback:true});
      }else{
        notify("O servidor respondeu, mas não foi possível confirmar o resultado. Atualize a lista.",true,{fallback:true});
      }
    }catch(_){/* Nunca modificar o retorno da API. */}
    return response;
  };
})();
