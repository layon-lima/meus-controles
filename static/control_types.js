"use strict";
/* Alteração reversível de modelo: não converte nem apaga dados de outros modelos. */
Object.assign(App,{
  async changeControlTypeForm(id){
    if(!this.canOpenForm())return;
    const c=this.s.state?.controls?.find(c=>Number(c.id)===Number(id));
    if(!c)return this.toast("Controle não encontrado. Atualize a página.",true);
    try{
      const report=await this.api("/api/controls/"+id+"/type");
      if(!this.s.state?.controls?.some(x=>Number(x.id)===Number(id)))return;
      this.s.modal="change-control-type";
      this.s.modalContext={controlId:id,report,mode:report.current_mode};
      this.changeControlTypeRender();
    }catch(err){this.toast(err.message,true)}
  },
  changeControlTypeFields(){
    const ctx=this.s.modalContext;
    if(!ctx)return "";
    const mode=ctx.mode,old=ctx.report.saved_settings;
    if(mode==="divida"){
      const initial=old.divida?.opening_amount||"";
      const paid=ctx.report.payments_total||"0.00";
      return '<div class="field"><label for="controlTypeOpening">Valor inicial da dívida (R$)</label>'+
        '<input id="controlTypeOpening" inputmode="decimal" required placeholder="Informe o valor da dívida" value="'+E(initial)+'">'+
        '<small>Pagamentos já registrados neste controle: '+currency(paid)+
        '. O valor inicial não pode ser menor que os pagamentos.</small></div>';
    }
    if(mode==="acerto_ab"){
      return '<div class="form-grid"><div class="field"><label for="controlTypePartyA">Pessoa A</label>'+
        '<input id="controlTypePartyA" required maxlength="160" value="'+E(old.acerto_ab?.party_a||"")+'" placeholder="Nome da primeira pessoa"></div>'+
        '<div class="field"><label for="controlTypePartyB">Pessoa B</label>'+
        '<input id="controlTypePartyB" required maxlength="160" value="'+E(old.acerto_ab?.party_b||"")+'" placeholder="Nome da segunda pessoa"></div></div>';
    }
    if(mode==="caminhao"){
      return '<p class="control-type-hint">As opções de fretes, despesas e comissões serão ativadas. Configure motorista e comissão em Ajustes depois da troca.</p>';
    }
    if(["calculo","saldo","financeiro"].includes(mode)){
      return '<p class="control-type-hint">Os campos, cálculos e tipos de lançamento já configurados continuarão disponíveis para edição. Nenhum lançamento anterior será reclassificado.</p>';
    }
    if(mode==="divida_sem_valor"){
      return '<p class="control-type-hint">Os pagamentos cadastrados neste controle serão somados sem limite. A configuração de dívida inicial ficará guardada caso você volte ao tipo com valor fixo.</p>';
    }
    return '<p class="control-type-hint">As funções do modelo selecionado serão disponibilizadas sem alterar registros já salvos.</p>';
  },
  changeControlTypeRender(){
    const ctx=this.s.modalContext;
    if(!ctx?.report)return;
    const p=ctx.report,mode=ctx.mode;
    const current=p.models.find(x=>x.mode===p.current_mode)?.label||p.current_mode;
    const target=p.models.find(x=>x.mode===mode);
    const group=p.models.find(x=>x.mode===p.current_mode)?.group;
    const switching=mode!==p.current_mode;
    const oldCount=p.counts[group]||0;
    const newCount=p.counts[target?.group]||0;
    const warning=switching?
      '<p class="control-type-warning"><strong>Seus dados serão preservados.</strong> '+
      (group!==target.group?
        oldCount+' registro(s) do tipo anterior continuarão guardados, mas não serão exibidos neste novo modelo. '+
        (newCount?newCount+' registro(s) antigos deste novo modelo voltarão a aparecer. ':''):
        'Os registros existentes desta família continuarão no controle. ')+
      'Nenhuma conversão ou exclusão de lançamentos será feita.</p>':
      '<p class="control-type-hint">Selecione um tipo diferente para alterar as funcionalidades deste controle.</p>';
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal control-type-modal" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Alterar tipo de controle</h2>'+
      '<p>'+E(p.name)+'</p></div>'+
      '<button type="button" class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><div class="control-type-current">Tipo atual: <strong>'+E(current)+'</strong></div>'+
      '<form id="changeControlTypeForm" onsubmit="event.preventDefault();App.saveControlType()">'+
      '<div class="field"><label for="controlTypeSelect">Novo tipo de controle</label>'+
      '<select id="controlTypeSelect" name="mode" onchange="App.changeControlTypeSelected(this.value)">'+
      fSelect(p.models.map(x=>[x.mode,x.label]),mode)+'</select></div>'+
      '<div id="controlTypeFields" class="control-type-fields">'+this.changeControlTypeFields()+'</div>'+
      '<div id="controlTypeWarning">'+warning+'</div>'+
      '<label class="control-type-consent"><input id="controlTypeConsent" type="checkbox" '+
      (switching?"":"disabled")+'>'+
      '<span>Entendi que as funções do tipo anterior ficarão ocultas, mas seus dados serão mantidos para uma possível volta.</span></label>'+
      '</form>'+
      (p.recent_changes.length?'<details class="control-type-history"><summary>Últimas mudanças de tipo</summary>'+
      p.recent_changes.map(x=>'<p>'+E(p.models.find(m=>m.mode===x.previous_mode)?.label||x.previous_mode)+
      ' → '+E(p.models.find(m=>m.mode===x.new_mode)?.label||x.new_mode)+
      ' · '+E(x.changed_at)+'</p>').join("")+'</details>':"")+'</div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" id="confirmControlType" '+(switching?"":"disabled")+
      ' onclick="App.saveControlType()">'+icon("check")+' Aplicar novo tipo</button></div></div></div>';
  },
  changeControlTypeSelected(mode){
    const ctx=this.s.modalContext;
    if(!ctx||!ctx.report.models.some(x=>x.mode===mode))return;
    ctx.mode=mode;
    this.changeControlTypeRender();
  },
  async saveControlType(){
    const ctx=this.s.modalContext;
    if(this.s.modal!=="change-control-type"||!ctx)return;
    const mode=ctx.mode;
    if(mode===ctx.report.current_mode)return;
    const form=document.getElementById("changeControlTypeForm");
    if(!form||!form.reportValidity())return;
    if(!document.getElementById("controlTypeConsent")?.checked)
      return this.toast("Confirme que deseja alterar o tipo mantendo os dados anteriores.",true);
    const body={mode};
    if(mode==="divida")body.opening_amount=document.getElementById("controlTypeOpening").value;
    if(mode==="acerto_ab")body.pair_settings={
      party_a:document.getElementById("controlTypePartyA").value,
      party_b:document.getElementById("controlTypePartyB").value
    };
    const button=document.getElementById("confirmControlType");
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{
      await this.api("/api/controls/"+ctx.controlId+"/type","PATCH",body);
      this.closeModal();
      if(this.s.route==="control"&&this.s.id===ctx.controlId){
        this.s.detail=null;
        this.s.pairId=null;
      }
      await this.load();
      this.toast("Tipo alterado. As novas funções estão disponíveis e os dados anteriores foram preservados.");
    }catch(err){
      if(button)button.disabled=false;
      this.toast(err.message,true);
    }
  }
});
