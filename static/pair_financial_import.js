"use strict";
/* Importação financeira real do A x B: prévia, datas suspeitas e confirmação. */
Object.assign(App,{
  pairFinancialImportForm(){
    if(!this.canOpenForm())return;
    const data=this.s.pairData;
    if(!data)return;
    this.s.modal="pair-financial-import";
    this.s.modalContext={controlId:data.control_id,payload:null,preview:null};
    document.getElementById("modalRoot").innerHTML=
      '<div class="modal-backdrop"><div class="modal ab-form ab-financial-modal" role="dialog" aria-modal="false" aria-labelledby="modalTitle">'+
      '<div class="modal-header"><div><h2 id="modalTitle">Importar dívidas e pagamentos</h2>'+
      '<p>Os valores entrarão no saldo do A × B, com a direção de cada lançamento.</p></div>'+
      '<button type="button" class="close" onclick="App.closeModal()" aria-label="Fechar">'+icon("x")+'</button></div>'+
      '<div class="modal-body"><div class="field"><label for="pairFinancialFile">Arquivo de importação (.json)</label>'+
      '<input type="file" id="pairFinancialFile" accept=".json,application/json" onchange="App.pairFinancialPreview()"></div>'+
      '<div id="pairFinancialResult" aria-live="polite" class="ab-import-result"></div></div>'+
      '<div class="modal-footer"><button class="btn" onclick="App.closeModal()">Cancelar</button>'+
      '<button class="btn btn-primary" id="pairFinancialConfirmButton" onclick="App.pairFinancialConfirm()" disabled>'+
      icon("check")+' Confirmar importação</button></div></div></div>';
  },
  async pairFinancialPreview(){
    const file=document.getElementById("pairFinancialFile")?.files?.[0];
    if(!file)return;
    if(file.size>1800000){
      this.toast("Arquivo muito grande (limite de 1,8 MB).",true);
      return;
    }
    try{return await this.pairFinancialPreviewPayload(JSON.parse(await file.text()));}
    catch(error){this.toast("Não foi possível ler o arquivo: "+error.message,true);}
  },
  async pairFinancialPreviewPayload(payload){
    const ctx=this.s.modalContext;
    if(this.s.modal!=="pair-financial-import"||!ctx)return;
    ctx.payload=null;ctx.preview=null;
    const result=document.getElementById("pairFinancialResult");
    const confirmBtn=document.getElementById("pairFinancialConfirmButton");
    if(confirmBtn)confirmBtn.disabled=true;
    try{
      const mixed=payload?.format==="central-pair-mixed-v1";
      const endpoint=mixed?"mixed-import":"financial-import";
      const preview=await this.api("/api/controls/"+ctx.controlId+"/pair/"+endpoint+"/preview","POST",payload);
      if(this.s.modal!=="pair-financial-import"||this.s.modalContext!==ctx)return;
      ctx.payload=payload;ctx.preview=preview;
      const dateless=preview.missing_dates||[];
      const unusual=preview.unusual_dates||[];
      const names=this.s.pairData?.settings||{party_a:"Pessoa A",party_b:"Pessoa B"};
      let panel='<div class="ab-import-preview"><strong>'+E(preview.source_name)+'</strong>'+
        '<div class="ab-financial-stats"><span>'+preview.count+' movimentações</span>'+
        '<span>'+preview.debt_count+' dívida(s)</span><span>'+preview.payment_count+' pagamento(s)</span>'+ 
        (mixed?'<span>'+preview.record_count+' registro(s) neutro(s)</span>':'')+'</div>'+
        '<p><strong>'+E(names.party_a)+' deve a '+E(names.party_b)+':</strong> '+currency(preview.debt_total)+'</p>'+
        '<p><strong>'+E(names.party_a)+' pagou a '+E(names.party_b)+':</strong> '+currency(preview.payment_total)+'</p>'+
        (mixed?'<p><strong>Salários e registros informativos:</strong> '+currency(preview.neutral_total)+' — não alteram o saldo.</p>':'')+
        '<p><strong>'+preview.new_count+' lançamento(s) novos</strong> · '+preview.already_imported+' já importados</p>'+
        '<p class="ab-financial-warning">A planilha será lançada como dívida e pagamento real, alterando o saldo. O destinatário original aparece na descrição no formato “QUEM RECEBEU - DESCRIÇÃO”.</p>';
      if(dateless.length){
        panel+='<div class="ab-financial-dates"><strong>Data ausente — preenchimento obrigatório</strong>';
        for(const line of dateless){
          panel+='<label for="pairFinancialDate'+line.source_row+'">Linha '+line.source_row+': '+E(line.description)+
            '</label><input type="date" required id="pairFinancialDate'+line.source_row+'">';
        }
        panel+='</div>';
      }
      if(unusual.length){
        panel+='<div class="ab-financial-dates"><strong>Confira a data incomum</strong>'+
          '<p>Não alterei a data original. Você pode corrigi-la ou confirmar que deseja mantê-la.</p>';
        for(const line of unusual){
          panel+='<label for="pairFinancialDate'+line.source_row+'">Linha '+line.source_row+
            ' — '+E(abDate(line.date))+' · '+E(line.description)+'</label>'+
            '<input id="pairFinancialDate'+line.source_row+'" type="date" placeholder="Data corrigida">';
        }
        panel+='<label class="ab-financial-consent"><input type="checkbox" id="pairFinancialAcceptOldDate">'+
          'Manter a data original de 1900 caso eu não a corrija.</label></div>';
      }
      panel+='<label class="ab-financial-consent"><input id="pairFinancialMatching" type="checkbox">'+
        'Se existirem lançamentos manuais idênticos, autorizo conferir e incluir as linhas do arquivo mesmo assim.</label>'+
        '<p class="ab-financial-hint">Os registros serão inseridos no controle aberto. Fechamentos anteriores são protegidos; nenhuma movimentação será confirmada automaticamente como quitada.</p></div>';
      if(result)result.innerHTML=panel;
      if(confirmBtn)confirmBtn.disabled=preview.new_count<=0;
    }catch(error){
      const outdated=payload?.format==="central-pair-mixed-v1" &&
        (/rota n.o encontrada|n.o encontrada|404|mixed-import/i.test(String(error.message||"")));
      const message=outdated?
        "O aplicativo local ainda não tem o importador misto. No painel da Central, use Atualizar tudo; depois recarregue o aplicativo com Ctrl+F5.":
        String(error.message||"Erro ao validar o arquivo.");
      if(result)result.textContent="Não foi possível validar o arquivo: "+message;
      this.toast(message,true);
    }
  },
  async pairFinancialConfirm(){
    const ctx=this.s.modalContext;
    if(this.s.modal!=="pair-financial-import"||!ctx?.payload||!ctx.preview)return;
    const changedDates={};
    for(const d of [...(ctx.preview.missing_dates||[]),...(ctx.preview.unusual_dates||[])]){
      const value=document.getElementById("pairFinancialDate"+d.source_row)?.value;
      if(value)changedDates[String(d.source_row)]=value;
      if(!value&&(ctx.preview.missing_dates||[]).some(x=>x.source_row===d.source_row)){
        this.toast("Informe a data ausente na linha "+d.source_row+".",true);
        return;
      }
    }
    const needsOldDate=(ctx.preview.unusual_dates||[]).some(d=>!changedDates[String(d.source_row)]);
    const confirmOld=!!document.getElementById("pairFinancialAcceptOldDate")?.checked;
    if(needsOldDate&&!confirmOld){
      this.toast("Corrija a data de 1900 ou confirme que deseja mantê-la.",true);
      return;
    }
    const mixed=ctx.payload?.format==="central-pair-mixed-v1";
    if(!confirm("Importar "+ctx.preview.new_count+
      (mixed?" lançamentos (dívidas, pagamentos e registros neutros)? Só as dívidas e pagamentos alterarão o saldo de JONAS × MARCOS.":
      " dívidas e pagamentos reais? Isso ALTERARÁ o saldo do controle JONAS × MARCOS.")))return;
    const btn=document.getElementById("pairFinancialConfirmButton");
    if(btn?.disabled)return;
    if(btn)btn.disabled=true;
    try{
      const res=await this.api("/api/controls/"+ctx.controlId+"/pair/"+
        (mixed?"mixed-import":"financial-import")+"/confirm","POST",{
        payload:ctx.payload,batch_id:ctx.preview.batch_id,corrected_dates:changedDates,
        accept_unusual_dates:confirmOld,
        accept_matching_existing:!!document.getElementById("pairFinancialMatching")?.checked
      });
      this.closeModal();
      await this.renderPair();
      await this.load();
      this.toast(mixed?
        (res.inserted_financial+" dívidas/pagamentos e "+res.inserted_neutral+" registros neutros importados."):
        (res.inserted+" movimentações importadas. Saldo recalculado."));
    }catch(error){
      if(btn)btn.disabled=false;
      this.toast(error.message,true);
    }
  }
});
