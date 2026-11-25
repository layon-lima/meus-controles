"use strict";
/* Rascunho vivo: mantém DOM, arquivos, callbacks e contexto do motor intactos.
   Um formulário por página. Nenhum dado financeiro gravado no armazenamento local. */
(()=>{
  if(window.NHDrafts)return;
  let draft=null,dock=null,discarding=false,decision=false,restoringHistory=false;
  const $=selector=>document.querySelector(selector);
  function find(){
    const rx=$("#rx-mask");
    if(rx&&(rx.querySelector("#rx-submit")||rx.querySelector("#rx-page-read")))
      return {root:rx,panel:rx.querySelector(".rx-dialog"),head:rx.querySelector(".rx-dialog-head"),close:"[data-close]",kind:"rx"};
    const contas=$("#backdrop.show");
    if(contas&&contas.querySelector("#dialogBody"))
      return {root:contas,panel:contas.querySelector(".dialog"),head:contas.querySelector("#dialogTitle"),close:"#cancel",kind:"contas"};
    const legacy=$("#modalRoot .modal-backdrop");
    if(legacy){
      const panel=legacy.querySelector(".modal");
      if(panel?.querySelector("form,input:not([type=hidden]),select,textarea,[onclick*='Save'],[onclick*='Confirm']"))
        return {root:legacy,panel,head:panel.querySelector(".modal-header"),close:"[onclick*='App.closeModal()']",kind:"legacy"};
    }
    const pix=$("[data-nh-draft='pix']");
    if(pix)return {root:pix,panel:pix,head:pix.querySelector(".nhf-pix-actions"),close:"[data-nh-draft-cancel]",kind:"pix"};
    return null;
  }
  function title(d){
    return (d.panel?.querySelector("h2,h3,#modalTitle,#dialogTitle")?.textContent||
      (d.kind==="pix"?"Editar chave Pix":"Formulário em aberto")).trim()||"Formulário em aberto";
  }
  function info(message){
    window.NHFeedback?.notify(message,false);
  }
  function busy(d){
    return !!(window.NHFeedback?.isWriting?.()||
      d?.root.querySelector("#rx-submit:disabled,#save:disabled,[data-nh-draft-save]:disabled"));
  }
  function clear(){
    dock?.remove();dock=null;
    if(draft){
      draft.root.classList.remove("nh-draft-minimized");
      draft.root.removeAttribute("inert");
    }
    draft=null;
  }
  function current(){
    const found=find();
    if(draft&&(!found||found.root!==draft.root||found.panel!==draft.panel))clear();
    if(!found||!found.panel)return null;
    if(!draft)draft={...found,minimized:false,href:location.href,history:window.history.state,controlValue:$("#rx-control")?.value};
    draft.head=found.head;
    return draft;
  }
  function button(label,cls,handler){
    const el=document.createElement("button");el.type="button";el.className=cls;el.textContent=label;
    el.addEventListener("click",handler);return el;
  }
  function renderDock(d){
    dock?.remove();
    dock=document.createElement("aside");dock.id="nh-draft-dock";
    dock.setAttribute("aria-label","Formulário minimizado");
    const reopen=button("","nh-draft-reopen",restore);
    const heading=document.createElement("strong");heading.textContent=title(d);
    const subtitle=document.createElement("span");subtitle.textContent="Não salvo · Clique para continuar";
    reopen.append(heading,subtitle);
    const drop=button("×","nh-draft-discard",discard);
    drop.setAttribute("aria-label","Descartar formulário");drop.title="Descartar formulário";
    dock.append(reopen,drop);document.body.append(dock);reopen.focus({preventScroll:true});
  }
  function minimize(){
    const d=current();
    if(!d||d.minimized)return false;
    if(busy(d)){info("Aguarde a operação em andamento.");return false;}
    d.focus=d.root.contains(document.activeElement)?document.activeElement:null;
    d.minimized=true;d.root.classList.add("nh-draft-minimized");d.root.setAttribute("inert","");
    renderDock(d);
    return true;
  }
  function restore(){
    const d=current();
    if(!d||!d.minimized)return false;
    d.minimized=false;d.root.classList.remove("nh-draft-minimized");d.root.removeAttribute("inert");
    dock?.remove();dock=null;
    const focus=d.focus?.isConnected?d.focus:d.panel.querySelector("input:not([type=hidden]),select,textarea,button");
    focus?.focus({preventScroll:true});return true;
  }
  async function discard(){
    const d=current();
    if(!d||decision||busy(d))return;
    decision=true;
    try{
      const ok=await window.NHConfirm.ask("Os dados não salvos e a conferência carregada serão descartados. Deseja realmente descartar?","Descartar formulário",true);
      if(!ok||current()!==d)return;
      const close=d.root.querySelector(d.close);
      if(!close){restore();info("Reabra o formulário para concluir ou cancelar.");return;}
      restore();discarding=true;
      try{close.click();}finally{discarding=false;}
      current();
    }finally{decision=false;}
  }
  function stop(e){e.preventDefault();e.stopImmediatePropagation();}
  function isDecision(target){return !!target.closest?.(".nh-confirm-dialog,#nh-operation-notices,#nh-draft-dock");}
  function safeBackground(target){
    return !!target.closest?.("#rx-search,#search,#statusFilter,[data-tab],[data-group]");
  }
  function blockNavigation(){
    const d=current();
    if(!d||discarding)return false;
    if(!d.minimized)minimize();
    info("Formulário não salvo. Reabra e salve ou descarte antes de trocar de tela.");
    return true;
  }
  window.NHDrafts={minimize,restore,discard,blockNavigation,isDiscarding:()=>discarding,hasDraft:()=>!!current()};
  window.addEventListener("click",e=>{
    if(discarding||isDecision(e.target))return;
    const d=current();if(!d)return;
    if(d.panel.contains(e.target)){
      if(e.target.closest(d.close)){
        stop(e);minimize();
      }
      return;
    }
    if(d.minimized&&safeBackground(e.target))return;
    // Não acionar botões atrás da janela nem encerrar sua prévia por acidente.
    if(!d.minimized||e.target.closest?.("a,button,input,select,textarea,[onclick],[role=button],[role=link]")){
      stop(e);
      if(d.minimized)info("Reabra ou descarte o formulário minimizado antes de iniciar outra operação.");
      else minimize();
    }
  },true);
  window.addEventListener("keydown",e=>{
    if(discarding||isDecision(e.target))return;
    const d=current();if(!d)return;
    if(e.key==="Escape"){
      // Primeiro deixa o seletor de pedidos fechar suas próprias sugestões.
      if(e.target.getAttribute?.("aria-expanded")==="true"&&e.target.getAttribute?.("role")==="combobox")return;
      stop(e);d.minimized?restore():minimize();
    }else if((e.key==="Enter"||e.key===" ")&&!d.panel.contains(e.target)&&!safeBackground(e.target)&&
      e.target.closest?.("a,button,[onclick],[role=button],[role=link]")){
      stop(e);
    }
  },true);
  window.addEventListener("change",e=>{
    const d=current();
    if(d&&e.target.id==="rx-control"&&d.controlValue!==undefined){
      stop(e);e.target.value=d.controlValue;info("Finalize o formulário antes de trocar de controle.");
    }
  },true);
  window.addEventListener("drop",e=>{
    const d=current();
    if(d&&!d.panel.contains(e.target)&&e.dataTransfer?.files?.length){
      stop(e);info("Há um formulário não salvo. Finalize ou descarte antes de importar outro arquivo.");
    }
  },true);
  window.addEventListener("popstate",e=>{
    if(restoringHistory||!draft||draft.href===location.href||!current())return;
    // Evitar que o motor apague modalContext ao navegar pelo histórico interno.
    stop(e);restoringHistory=true;
    try{window.history.pushState(draft.history,"",draft.href);}finally{restoringHistory=false;}
    blockNavigation();
  },true);
  window.addEventListener("beforeunload",e=>{
    // Recarregar/fechar a aba de verdade destrói arquivos e callbacks em memória.
    if(current()){e.preventDefault();e.returnValue="";}
  });
  function init(){
    new MutationObserver(()=>current()).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["class","data-nh-draft"]});
    current();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
