"use strict";
/* Importação local de pedidos: arquivo fora do GitHub e verificação antes de gravar. */
Object.assign(App,{
  receivingOpenImportFromSettings(){
    this.closeModal();
    this.receivingChooseImport();
  },
  receivingChooseImport(){
    if(!this.canOpenForm())return;
    const control=this.s.detail?.control;
    if(control?.mode!=="recebimento")return;
    const input=document.getElementById("receivingImportInput");
    if(!input)return this.toast("Abra primeiro o controle de recebimentos.",true);
    input.value="";
    input.click();
  },
  async receivingLoadImportFile(file){
    if(!file)return;
    const control=this.s.detail?.control;
    if(!control||control.mode!=="recebimento")return;
    if(!/\.json$/i.test(file.name)||file.size>512*1024)
      return this.toast("Escolha um arquivo JSON de pedidos com até 512 KB.",true);
    try{
      const documentData=JSON.parse(await file.text());
      const result=await this.api("/api/controls/"+control.id+"/receiving/import/preview",
        "POST",{document:documentData});
      this.s.modal="receiving-import";
      this.s.modalContext={controlId:control.id,document:documentData,preview:result,working:false};
      this.receivingImportPreviewUI();
    }catch(e){this.toast("Falha ao ler os pedidos: "+e.message,true)}
  },
  receivingImportPreviewUI(){
    const ctx=this.s.modalContext;
    if(!ctx?.preview)return;
    const p=ctx.preview;
    const count=Number(p.already_imported?p.repeat_count:p.new_count)||0;
    const consentRequired=!!p.requires_duplicate_consent;
    const approved=!!ctx.allowDuplicates;
    const available=count>0&&(!consentRequired||approved);
    const rows=(p.preview_items||[]).map(x=>
      '<div class="receiving-import-row"><span><strong>'+E(x.product)+'</strong>'+
      '<small>Referências: '+E(x.order_number)+' · Fornecedor: '+E(x.supplier||"Não informado")+'</small></span>'+
      '<b>'+rxNum(x.ordered_qty)+' '+E(x.unit)+'</b></div>').join("");
    const units=Object.entries(p.items_by_unit||{}).map(([unit,n])=>
      '<span>'+n+' item(ns) em '+E(unit)+'</span>').join("");
    const warning=p.unknown_suppliers?
      '<p class="receiving-import-warning">Fornecedor não informado em '+p.unknown_suppliers+
      ' produto(s). O campo ficará vazio para você completar depois, sem inventar um nome.</p>':"";
    const repeated=p.already_imported?
      '<p class="receiving-import-warning">Este mesmo arquivo já foi importado antes. Se representar um pedido NOVO, é possível cadastrar todos os itens novamente, mas você precisa confirmar isso abaixo.</p>':
      p.matched?
      '<p class="receiving-import-warning">'+p.matched+' produto(s) coincidem com registros antigos. Isso NÃO impede um novo pedido. Confirme abaixo que são novos lançamentos.</p>':"";
    const approval=consentRequired?
      '<label class="receiving-import-consent"><input type="checkbox" onchange="App.receivingApproveDuplicateBatch(this.checked)" '+
      (approved?"checked":"")+'>'+
      '<span>Confirmo que estes são <b>novos pedidos/lote</b>, mesmo com produtos, referências e quantidades já cadastrados.</span></label>':"";
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal receiving-import-modal" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Conferir pedidos antes de importar</h2>'+
      '<p>Controle de destino: <strong>'+E(p.source)+'</strong></p></div>'+
      '<button class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><div class="receiving-import-stats">'+
      '<div><small>Itens no arquivo</small><strong>'+p.count+'</strong></div>'+
      '<div><small>Itens neste lote</small><strong>'+count+'</strong></div>'+
      '<div><small>Coincidem com antigos</small><strong>'+p.matched+'</strong></div>'+
      '<div><small>Recebimentos iniciais</small><strong>0 (0%)</strong></div></div>'+
      '<div class="receiving-import-unit-summary">'+units+'</div>'+
      '<p class="receiving-import-info">As quantidades são mantidas em suas próprias unidades, sem somar KG, L, DOS e TON. Nenhuma nota fiscal será criada.</p>'+
      warning+repeated+approval+
      '<div class="receiving-import-preview-list">'+rows+'</div>'+
      (p.count>60?'<p class="secondary-text">Mostrando os primeiros 60 itens para conferência.</p>':'')+
      '</div><div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" id="receivingConfirmImport" onclick="App.receivingConfirmImport()" '+
      (available?"":"disabled")+'> '+icon("check")+' '+(p.already_imported?"Cadastrar novo lote com ":"Importar ")+count+' produtos</button></div></div></div>';
  },
  receivingApproveDuplicateBatch(checked){
    if(!this.s.modalContext||this.s.modal!=="receiving-import")return;
    this.s.modalContext.allowDuplicates=!!checked;
    this.receivingImportPreviewUI();
  },
  async receivingConfirmImport(){
    const ctx=this.s.modalContext;
    if(!ctx||ctx.working||!ctx.preview)return;
    const p=ctx.preview;
    if(p.requires_duplicate_consent&&!ctx.allowDuplicates)return;
    if(!p.can_import&&!p.already_imported)return;
    ctx.working=true;
    const btn=document.getElementById("receivingConfirmImport");
    if(btn)btn.disabled=true;
    try{
      const response=await this.api("/api/controls/"+ctx.controlId+"/receiving/import/confirm",
        "POST",{document:ctx.document,fingerprint:p.fingerprint,
          allow_duplicates:!!ctx.allowDuplicates,repeat_batch:!!p.already_imported,
          confirmation_token:p.confirmation_token});
      this.closeModal();
      await this.load();
      this.toast(response.already_imported?"Esta confirmação já foi processada. Nenhum produto foi duplicado.":
        response.imported+" produtos cadastrados neste lote, com 0% recebido.");
    }catch(e){
      ctx.working=false;
      if(btn)btn.disabled=false;
      this.toast(e.message,true);
    }
  }
});
