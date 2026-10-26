"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const script=fs.readFileSync(path.join(__dirname,"../static/receiving.js"),"utf8");
const screen={innerHTML:""};
const supplierInput={value:"",setAttribute(){},focus(){}};
const supplierOptions={innerHTML:"",hidden:true};
const elements={
  main:screen,receivingSupplierInput:supplierInput,
  receivingSupplierOptions:supplierOptions
};
const document={
  getElementById:id=>elements[id]||null,
  querySelectorAll:()=>[]
};
const escape=value=>String(value??"").replace(/[&<>"']/g,x=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[x]));
const sandbox={
  App:{
    s:{
      detail:{control:{id:7,mode:"recebimento"}},
      receivingSearch:{controlId:7,query:""},
      receivingData:null,route:"control",id:7,
      receivingSelection:{controlId:7,ids:[]}
    },
    receivingApplyFilter(){},
    api:async()=>({}),
    load:async()=>{},
    toast(){},closeModal(){}
  },
  document,E:escape,icon:()=>"",confirm:()=>true,
  FormData:class{constructor(){ }get(){return ""}}
};
vm.createContext(sandbox);
vm.runInContext(script,sandbox);
const evaluate=expression=>vm.runInContext(expression,sandbox);
const catalog=evaluate(`rxSupplierCatalog([{supplier:"AGREX"},{supplier:"Ágrex"},{supplier:"Bayer"},{supplier:"Agrex Rural"},{supplier:""}])`);
assert.equal(catalog.length,3,"acentos/caixa devem ser equivalentes");
assert.equal(catalog.find(x=>x.key==="agrex").total,2);
assert.equal(evaluate('rxSupplierKey("  ÁgrÉx   rural  ")'),"agrex rural");
assert.equal(evaluate('rxSupplierMatches("AGR",rxSupplierCatalog([{supplier:"AGREX"},{supplier:"BAYER"}]))[0].name'),"AGREX");
assert.equal(evaluate('rxSupplierMatches("AGREZ",rxSupplierCatalog([{supplier:"AGREX"},{supplier:"BAYER"}]))[0].name'),"AGREX");
assert.equal(evaluate('rxSupplierMatches("AGREXZ",rxSupplierCatalog([{supplier:"AGREX"},{supplier:"BAYER"}]))[0].name'),"AGREX");
assert.equal(evaluate('rxSupplierMatches("XYZ",rxSupplierCatalog([{supplier:"AGREX"},{supplier:"BAYER"}])).length'),0);
const items=[
  {id:1,supplier:"Bayer",order_number:"B-10",product:"Produto B",status:"pending",receipts_count:0,ordered_qty:3,received_qty:0,remaining_qty:3,unit:"L"},
  {id:2,supplier:"AGREX",order_number:"A-12",product:"Produto A",status:"pending",receipts_count:0,ordered_qty:10,received_qty:0,remaining_qty:10,unit:"kg"},
  {id:3,supplier:"Ágrex",order_number:"A-2",product:"Produto C",status:"partial",receipts_count:1,ordered_qty:10,received_qty:3,remaining_qty:7,unit:"kg"},
  {id:4,supplier:"",order_number:"C-1",product:"Produto D",status:"pending",receipts_count:0,ordered_qty:2,received_qty:0,remaining_qty:2,unit:"kg"}
];
sandbox.App.s.receivingData={
  totals:{items:4,complete:0,partial:1,receipts:1},items,receipts:[]
};
sandbox.App.renderReceivingView();
const html=screen.innerHTML;
assert.equal((html.match(/class="receiving-supplier-group"/g)||[]).length,3);
assert.ok(html.indexOf('data-receiving-supplier="agrex"')<html.indexOf('data-receiving-supplier="bayer"'));
assert.ok(html.indexOf('data-receiving-supplier="bayer"')<html.indexOf('data-receiving-supplier=""'));
assert.ok(html.indexOf("A-2")<html.indexOf("A-12"),"pedidos numericos ordenados");
assert.ok(html.includes("2 pedidos · 2 produtos"));
assert.ok(html.includes("Fornecedor não informado"));
assert.ok(html.includes("receivingSelectAll")&&html.includes("receivingBulkDeleteBtn"),"marcacao em lote preservada");
supplierInput.value="AGREZ";
sandbox.App.receivingSupplierSuggest();
assert.equal(sandbox.App.s.receivingSupplierResults[0].name,"AGREX");
assert.equal(supplierOptions.hidden,false);
assert.ok(supplierOptions.innerHTML.includes("AGREX"));
sandbox.App.receivingChooseSupplier(0);
assert.equal(supplierInput.value,"AGREX");
assert.equal(supplierOptions.hidden,true);
console.log("OK: agrupamento por fornecedor, equivalencias, sugestoes e selecao multipla.");
