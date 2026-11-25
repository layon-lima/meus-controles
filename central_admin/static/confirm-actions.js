"use strict";
/* Confirmação de escrita comum à Central. Nenhuma chamada é enviada antes de aprovar. */
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
    let title=removing?"Confirmar exclusão":method==="PUT"||method==="PATCH"||/\/(?:edit|rename|move|pix)$/.test(path)?"Confirmar alteração":"Confirmar operação";
    let message=removing?"Deseja excluir este registro? A operação pode alterar os saldos e não poderá ser desfeita automaticamente.":"Deseja gravar esta operação? Os dados serão atualizados no sistema.";
    if(/\/(?:pay|pay-with-receipt)$/.test(path)){title="Confirmar pagamento";message="Deseja registrar este pagamento? O saldo e a situação dos lançamentos serão atualizados.";}
    else if(/\/(?:confirm-send|suggest)$/.test(path)){title="Confirmar envio";message="Deseja enviar a operação selecionada para pagamento?";}
    else if(/\/gfarm\/send$/.test(path)){title="Enviar para o GFARM";message="Deseja enviar os itens da nota fiscal para aprovação no GFARM?";}
    else if(/\/(?:xml|pdf|import|financial-import|mixed-import)\/confirm$|\/import\/commit$/.test(path)){title="Confirmar importação";message="Deseja registrar os dados conferidos? Os lançamentos e seus saldos serão atualizados.";}
    else if(/\/xml\/pending\/\d+\/assign$/.test(path)){title="Confirmar vínculo";message="Deseja registrar este produto no pedido selecionado?";}
    else if(/\/xml\/issuer$/.test(path)){title="Confirmar atualização de emitente";message="Deseja atualizar o emitente dos recebimentos identificados?";}
    else if(/\/complete$|\/truck\/closures$/.test(path)){title="Confirmar encerramento";message="Deseja concluir os registros selecionados? Novos lançamentos ou alterações poderão ficar bloqueados.";}
    else if(/\/funcionarios\/pix$|\/holerites\/funcionarios$/.test(path)){title="Confirmar cadastro de funcionário";message="Deseja salvar as informações do cadastro, inclusive a chave Pix informada?";}
    else if(/\/vincular(?:-conta)?$/.test(path)){title="Confirmar vínculo";message="Deseja salvar o vínculo entre os registros selecionados?";}
    else if(/\/(?:boards|controls|entries|items|receipts|employees|debts|payments|accounts|invoice)$/.test(path)&&method==="POST"){title="Confirmar lançamento";message="Deseja adicionar os dados informados ao sistema?";}
    return {title,message,removing,path,method};
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
  window.NHConfirm={ask,operation};
  window.fetch=async function(input,init){
    const op=operation(input,init);
    if(op&&!await ask(op.message,op.title,op.removing)){
      const error=new Error("Operação cancelada. Nenhuma alteração desta solicitação foi enviada.");
      error.name="NHOperationCancelled";throw error;
    }
    return originalFetch(input,init);
  };
})();
