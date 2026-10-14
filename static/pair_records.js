"use strict";
/* Registro neutro do Acerto A x B: documenta fluxos sem alterar saldos. */
Object.assign(App,{
  pairRecordRow(e){
    const date=e.record_date?abDate(e.record_date):(e.original_date?E(e.original_date):"Sem data");
    const source=e.from_name||"Origem não informada";
    const dest=e.to_name||"Destino não informado";
    const sourceInfo=[e.original_type?("Tipo na planilha: "+e.original_type):"",
      e.original_balance?("Saldo original informado: "+currency(e.original_balance)):""].filter(Boolean).join(" · ");
    return '<tr class="ab-neutral-row"><td>'+date+'</td>'+
      '<td><span class="ab-kind ab-kind-neutral">Registro · não altera saldo</span>'+
      '<b>'+E(e.description)+'</b>'+
      (sourceInfo?'<small class="ab-note">'+E(sourceInfo)+'</small>':'')+
      (e.notes?'<small class="ab-note">'+E(e.notes)+'</small>':'')+'</td>'+
      '<td><small class="ab-direction">Origem → Destino</small>'+E(source)+
      ' <span class="ab-arrow">→</span> '+E(dest)+'</td>'+
      '<td class="numeric">'+currency(e.amount)+'</td>'+
      '<td><div class="table-actions">'+
      '<button class="mini-action" onclick="App.pairRecordForm('+e.id+')">'+icon("edit")+' Editar</button>'+
      '<button class="mini-action" onclick="App.pairRecordDelete('+e.id+')">'+icon("trash")+' Excluir</button>'+
      '</div></td></tr>';
  },
  pairRecordForm(id=null){
    if(!this.canOpenForm())return;
    const data=this.s.pairData;
    const old=id?data?.records?.find(r=>r.id===id):null;
    if(id&&!old)return this.toast("Registro não encontrado.",true);
    this.s.modal="pair-neutral";
    this.s.modalContext={controlId:data.control_id,old:old?deep(old):null};
    const date=old?.record_date||"";
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal ab-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">'+(old?"Editar registro":"Novo registro")+'</h2>'+
      '<p>Documentação sem impacto no saldo do A × B.</p></div>'+
      '<button class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><form id="pairRecordForm" onsubmit="event.preventDefault();App.pairRecordSave()">'+
      '<div class="form-grid">'+
      '<div class="field"><label>Data'+(old?" (opcional na correção)":"")+'</label>'+
      '<input name="date" type="date" value="'+E(date)+'" '+(old?"":"required")+'></div>'+
      '<div class="field"><label>Valor (R$)</label>'+
      '<input name="amount" required inputmode="decimal" value="'+E(old?.amount||"")+'"></div>'+
      '<div class="field"><label>De quem saiu (origem)</label>'+
      '<input name="from_name" maxlength="160" value="'+E(old?.from_name||"")+'" placeholder="Pessoa ou empresa de origem"></div>'+
      '<div class="field"><label>Quem recebeu (destino)</label>'+
      '<input name="to_name" maxlength="160" value="'+E(old?.to_name||"")+'" placeholder="Pessoa ou empresa destinatária"></div>'+
      '<div class="field full"><label>Motivo / descrição</label>'+
      '<input name="description" maxlength="220" required value="'+E(old?.description||"")+'"></div>'+
      '<div class="field full"><label>Observações</label>'+
      '<textarea name="notes" maxlength="1500" rows="2">'+E(old?.notes||"")+'</textarea></div></div></form>'+
      '<p class="ab-hint">Este registro é apenas informativo. Seu valor não soma nem abate a dívida e não altera fechamentos.</p></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" onclick="App.pairRecordSave()">'+icon("check")+' Salvar registro</button>'+
      '</div></div></div>';
  },
  async pairRecordSave(){
    const form=document.getElementById("pairRecordForm"),ctx=this.s.modalContext;
    if(!form||!ctx||!form.reportValidity())return;
    const f=new FormData(form);
    const p={date:f.get("date")||null,amount:f.get("amount"),
      from_name:f.get("from_name"),to_name:f.get("to_name"),
      description:f.get("description"),notes:f.get("notes")};
    if(ctx.old){
      p.date_raw=ctx.old.original_date||"";
      p.original_type=ctx.old.original_type||"";
      p.original_balance=ctx.old.original_balance||"";
    }
    try{
      await this.api(ctx.old?"/api/pair-records/"+ctx.old.id:
        "/api/controls/"+ctx.controlId+"/pair/records",ctx.old?"PUT":"POST",p);
      this.closeModal();await this.renderPair();this.toast("Registro salvo sem alterar o saldo.");
    }catch(err){this.toast(err.message,true)}
  },
  async pairRecordDelete(id){
    if(!confirm("Excluir este registro informativo? O saldo não será alterado."))return;
    try{
      await this.api("/api/pair-records/"+id,"DELETE");
      await this.renderPair();this.toast("Registro removido. Saldo preservado.");
    }catch(err){this.toast(err.message,true)}
  },
  pairImportRecords(){
    if(!this.canOpenForm())return;
    const data=this.s.pairData;if(!data)return;
    this.s.modal="pair-import";
    this.s.modalContext={controlId:data.control_id,payload:null,preview:null};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal ab-form" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Importar registros A × B</h2>'+
      '<p>Adicione várias linhas de uma vez, sem mexer no saldo.</p></div>'+
      '<button class="close" aria-label="Fechar" onclick="App.closeModal()">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><p class="ab-hint">Selecione o arquivo JSON. O sistema identificará automaticamente registros neutros ou dívidas e pagamentos reais, com prévia antes de confirmar.</p>'+
      '<div class="field"><label>Arquivo de registros (.json)</label>'+
      '<input id="pairImportFile" type="file" accept=".json,application/json" onchange="App.pairPreviewImport()"></div>'+
      '<div id="pairImportResult" class="ab-import-result" aria-live="polite"></div></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" id="pairConfirmImport" onclick="App.pairConfirmImport()" disabled>'+
      icon("check")+' Confirmar importação</button></div></div></div>';
  },
  async pairPreviewImport(){
    const ctx=this.s.modalContext;
    if(this.s.modal!=="pair-import"||!ctx)return;
    ctx.payload=null;ctx.preview=null;
    const button=document.getElementById("pairConfirmImport");
    if(button)button.disabled=true;
    const output=document.getElementById("pairImportResult");
    try{
      const file=document.getElementById("pairImportFile")?.files?.[0];
      if(!file)return;
      if(file.size>1500000)throw Error("Arquivo muito grande (limite de 1,5 MB).");
      const data=JSON.parse(await file.text());
      if(data?.format==="central-pair-financial-v1"){
        this.pairFinancialImportForm();
        await this.pairFinancialPreviewPayload(data);
        return;
      }
      const result=await this.api("/api/controls/"+ctx.controlId+"/pair/import/preview","POST",data);
      if(this.s.modal!=="pair-import"||this.s.modalContext!==ctx)return;
      ctx.payload=data;ctx.preview=result;
      output.innerHTML='<div class="ab-import-preview"><strong>'+E(result.source_name)+'</strong>'+
        '<p><b>'+result.count+'</b> registros encontrados · <b>'+result.new_count+'</b> novos · '+
        '<b>'+result.already_imported+'</b> já importados</p>'+
        '<p>Valores documentados: '+currency(result.total_recorded)+
        ' (não afetam o saldo do acerto).</p>'+
        (result.warnings?.length?'<div class="ab-import-warnings"><strong>Avisos da planilha:</strong>'+
          result.warnings.map(w=>'<p>'+E(w)+'</p>').join("")+'</div>':'')+
        '<p><strong>Os registros ficarão apenas informativos.</strong> Nenhuma dívida ou pagamento real será criado automaticamente.</p></div>';
      if(button)button.disabled=result.new_count===0;
    }catch(err){
      if(output)output.textContent="Não foi possível conferir o arquivo: "+err.message;
      this.toast(err.message,true);
    }
  },
  async pairConfirmImport(){
    const ctx=this.s.modalContext;
    if(this.s.modal!=="pair-import"||!ctx?.preview||!ctx.payload)return;
    if(!confirm("Importar "+ctx.preview.new_count+
      " registros informativos? O saldo líquido do A × B não será alterado."))return;
    const button=document.getElementById("pairConfirmImport");
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{
      const result=await this.api("/api/controls/"+ctx.controlId+"/pair/import/confirm",
        "POST",{payload:ctx.payload,batch_id:ctx.preview.batch_id});
      this.closeModal();
      await this.renderPair();
      this.toast(result.inserted+" registros importados sem alterar o saldo.");
    }catch(err){if(button)button.disabled=false;this.toast(err.message,true)}
  }
});
