"use strict";
// Marcar NF-e no Controles não envia nada até clicar no botão.
// Uma nota com dois produtos ocupa apenas uma seleção de nota.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const script=fs.readFileSync(path.join(__dirname,"../static/receiving.js"),"utf8");
const elements={
  main:{innerHTML:""},
  receivingGfarmSendBtn:{hidden:true,disabled:false,textContent:""},
  receivingGfarmSelectedCount:{textContent:""},
  receivingGfarmSelectAll:{disabled:false,checked:false,indeterminate:false},
};
const document={
  getElementById:id=>elements[id]||null,
  querySelectorAll:()=>[],
};
const E=value=>String(value??"").replace(/[&<>"']/g,char=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[char]));
const receipts=[
  {id:11,received_date:"2026-11-11",invoice_number:"101",access_key:"1".repeat(44),
   order_number:"P1",product:"A",supplier:"Fornecedor",invoice_issuer:"Fornecedor",
   received_qty:"10",unit:"KG",gfarm_status:"NAO_ENVIADO",gfarm_note_key:"chave:"+"1".repeat(44)},
  {id:12,received_date:"2026-11-11",invoice_number:"101",access_key:"1".repeat(44),
   order_number:"P1",product:"B",supplier:"Fornecedor",invoice_issuer:"Fornecedor",
   received_qty:"20",unit:"KG",gfarm_status:"NAO_ENVIADO",gfarm_note_key:"chave:"+"1".repeat(44)},
  {id:13,received_date:"2026-11-11",invoice_number:"102",access_key:"2".repeat(44),
   order_number:"P2",product:"C",supplier:"Fornecedor",invoice_issuer:"Fornecedor",
   received_qty:"30",unit:"KG",gfarm_status:"NAO_ENVIADO",gfarm_note_key:"chave:"+"2".repeat(44)},
];
let sent=null;
const sandbox={
  App:{
    s:{detail:{control:{id:7,mode:"recebimento"}},route:"control",id:7,
       receivingTab:{controlId:7,value:"notas"},
       receivingSearch:{controlId:7,queries:{pedidos:"",notas:""}},
       receivingData:{totals:{items:0,complete:0,partial:0,pending:0,receipts:3},
                      items:[],receipts}},
    async api(url,method,payload){sent={url,method,payload};return {notas:2,itens:3}},
    async load(){},toast(){},closeModal(){},
  },
  document,E,icon:()=>"",window:{},confirm:()=>true,
};
vm.createContext(sandbox);
vm.runInContext(script,sandbox);
sandbox.App.renderReceivingView();
const html=elements.main.innerHTML;
assert.ok(html.includes("Marcar notas"));
assert.ok(html.includes("receivingGfarmSendBtn"));
assert.ok(html.includes("Enviar ao GFARM"));
assert.equal((html.match(/data-gfarm-note=/g)||[]).length,3);
assert.ok(html.includes("Não enviada"));
assert.equal(sandbox.App.s.receivingGfarmSelection.keys.length,0);
assert.equal(elements.receivingGfarmSendBtn.hidden,true);
sandbox.App.receivingGfarmSelectNote(receipts[0].gfarm_note_key,true);
assert.equal(sandbox.App.s.receivingGfarmSelection.keys.length,1);
assert.ok(elements.receivingGfarmSendBtn.textContent.includes("1 nota"));
sandbox.App.receivingGfarmSelectAll(true);
assert.equal(sandbox.App.s.receivingGfarmSelection.keys.length,2);
assert.ok(elements.receivingGfarmSendBtn.textContent.includes("2 notas"));
sandbox.App.renderReceiving=async()=>{};
(async()=>{
  await sandbox.App.receivingGfarmSend();
  assert.ok(sent);
  assert.equal(sent.url,"/api/controls/7/receiving/gfarm/send");
  assert.equal(sent.method,"POST");
  // Envia identificadores representativos por nota, não duplica 2 produtos da mesma NF.
  assert.deepEqual(JSON.parse(JSON.stringify(sent.payload.receipt_ids)).sort((a,b)=>a-b),[11,13]);
  assert.equal(sandbox.App.s.receivingGfarmSelection.keys.length,0);
  assert.equal(elements.receivingGfarmSendBtn.hidden,true);

  // Notas aprovadas ou já enviadas não voltam a ser selecionáveis.
  receipts[0].gfarm_status="PENDENTE";
  receipts[1].gfarm_status="PENDENTE";
  sandbox.App.renderReceivingView();
  sandbox.App.receivingGfarmSelectAll(true);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.App.s.receivingGfarmSelection.keys)),
    [receipts[2].gfarm_note_key]);
  console.log("OK: seleção de NF-e inteira, envio somente pelo botão e bloqueio de reenviar.");
})().catch(error=>{console.error(error);process.exitCode=1});
