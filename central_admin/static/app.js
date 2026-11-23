"use strict";

const el = id => document.getElementById(id);
let currentData = null;
let currentSection = "inicio";
let loading = false;

function node(tag, content, className) {
  const element = document.createElement(tag);
  element.textContent = content === null || content === undefined ? "" : String(content);
  if (className) element.className = className;
  return element;
}

function money(input) {
  const amount = Number(input);
  return Number.isFinite(amount) ?
    amount.toLocaleString("pt-BR", {style: "currency", currency: "BRL"}) : "—";
}
function setText(id, value) { el(id).textContent = String(value === null || value === undefined ? "—" : value); }
function setFeedback(message) {
  const box = el("feedback");
  box.textContent = message;
  box.hidden = !message;
}
function empty(message, url, label) {
  const outer = node("div", "", "empty-view");
  outer.append(node("strong", "Nada para mostrar"), node("span", message));
  if (url) {
    const link = node("a", label || "Abrir sistema original");
    link.href = url;
    outer.append(document.createElement("br"), link);
  }
  return outer;
}
function row(title, detail, value) {
  const box = node("div", "", "detail-row");
  const info = document.createElement("div");
  info.append(node("strong", title), node("small", detail));
  box.append(info, node("div", value, "row-value"));
  return box;
}
function renderDetails() {
  const view = el("detailList");
  view.replaceChildren();
  if (!currentData) {
    view.append(empty("Os dados ainda não foram consultados. Atualize o painel."));
    return;
  }
  if (currentSection === "contas") {
    setText("detailTitle", "Contas a pagar");
    setText("detailSubtitle", "Vencimentos e valores consultados diretamente no CONTAS 4.");
    if (!currentData.contas) {
      view.append(empty("Banco de Contas indisponível no momento.",
                        "https://contas-cloud.fazendanovohorizonte.com/", "Abrir CONTAS 4"));
    } else {
      const accounts = currentData.contas.proximas || [];
      if (!accounts.length) view.append(empty("Nenhuma conta em aberto."));
      accounts.forEach(a => view.append(row(a.fornecedor, a.documento + " • " + a.vencimento + " • " + a.status, money(a.valor))));
    }
  } else if (currentSection === "notas") {
    setText("detailTitle", "Recebimentos");
    setText("detailSubtitle", "Notas recebidas e pedidos registrados no Meus Controles.");
    if (!currentData.controles) {
      view.append(empty("Banco de recebimentos indisponível.",
                        "https://controles.fazendanovohorizonte.com/", "Abrir Meus Controles"));
    } else {
      const invoices = currentData.controles.recentes || [];
      if (!invoices.length) view.append(empty("Ainda não existem notas recebidas."));
      invoices.forEach(i => view.append(row("Nota " + i.invoice_number,
        i.supplier + " • Pedido " + i.order_number, "Recebida")));
    }
  } else if (currentSection === "vinculos") {
    setText("detailTitle", "Conferir vínculos");
    setText("detailSubtitle", "Sugestões entre notas recebidas e contas, sem criar ou pagar nada automaticamente.");
    if (!currentData.contas || !currentData.controles) {
      view.append(empty("As duas bases precisam estar disponíveis para cruzar as notas com as contas."));
    } else {
      const links = currentData.sugestoes || [];
      if (!links.length) view.append(empty("Não foram encontrados vínculos únicos que possam ser sugeridos."));
      links.forEach(s => view.append(row(s.supplier + " • Conta " + s.account_id,
        "NF " + s.invoice_number + " • " + s.reason, "Conferir")));
    }
  }
}

function goTo(section) {
  currentSection = section;
  const home = section === "inicio";
  el("homePanel").hidden = !home;
  el("detailPanel").hidden = home;
  if (!home) renderDetails();
  window.location.hash = section;
  window.scrollTo({top: 0, behavior: "smooth"});
}

function render(data) {
  currentData = data;
  const a = data.contas, r = data.controles;
  setText("kpiOpen", a ? a.em_aberto : "—");
  setText("kpiOverdue", a ? a.vencidas : "—");
  setText("kpiInvoices", r ? r.notas : "—");
  setText("kpiLinks", a && r ? (data.sugestoes || []).length : "—");
  setText("subOpen", a ? money(a.valor_em_aberto) + " pendentes" : "Fonte indisponível");
  setText("subOverdue", a ? "Não pagas, vencidas" : "Fonte indisponível");
  setText("subInvoices", r ? r.itens_pedido + " itens em pedidos" : "Fonte indisponível");
  setText("subLinks", a && r ? "Para conferir" : "Bases indisponíveis");
  setText("moduleAccounts", a ? a.em_aberto + " em aberto" : "Consultar contas");
  setText("moduleInvoices", r ? r.notas + " notas" : "Consultar notas");
  setText("moduleLinks", a && r ? (data.sugestoes || []).length + " sugestões" : "Ver sugestões");
  const connected = !!(a && r);
  const connection = el("connectionState");
  connection.classList.toggle("connected", connected);
  connection.lastChild.textContent = connected ? " Bases conectadas" :
    a || r ? " Integração parcial" : " Fontes indisponíveis";
  let reasons = [];
  for (const [name, source] of Object.entries(data.fontes || {})) {
    if (!source.disponivel) reasons.push(name + ": " + (source.erro || "indisponível"));
  }
  setFeedback(reasons.join(" • "));
  if (currentSection !== "inicio") renderDetails();
}

function openRequestedModuleAfterAuth() {
  // Link externo sem cookie Strict? A Home já está no mesmo domínio e
  // acabou de verificar a sessão no backend. Reabre o módulo de destino.
  const params = new URLSearchParams(window.location.search || "");
  const module = params.get("abrir");
  const valid = new Set([
    "funcionarios", "recebimentos", "contas", "documentos",
    "controles", "transportadoras", "relatorios"
  ]);
  if (!valid.has(module)) return;
  window.location.replace("/central/modules/" + module + "/");
  return true;
}

async function refreshEmployeesHome() {
  try {
    const today=new Date();
    const month=today.getFullYear()+"-"+String(today.getMonth()+1).padStart(2,"0");
    const response=await fetch("api/funcionarios/painel?competencia="+month,{
      credentials:"same-origin",cache:"no-store",
      headers:{"Accept":"application/json"}
    });
    if (!response.ok) throw new Error("Funcionários indisponíveis");
    const data=await response.json();
    const k=data.indicadores;
    if(!k)throw new Error("Resumo inválido");
    setText("moduleEmployees",k.funcionarios_com_pagamentos+
      " a receber · "+k.holerites_pendentes_mes+" holerite(s) pendente(s)");
    setText("moduleEmployeeMoney",money(k.total_a_pagar)+" a pagar");
    setText("moduleEmployeeVales",money(k.vales_a_descontar)+
      " em vales ainda a descontar"+
      (k.vales_sem_vinculo?" · "+k.vales_sem_vinculo+" sem vínculo":""));
  } catch(error) {
    setText("moduleEmployees","Consultar situação dos funcionários");
    setText("moduleEmployeeMoney","—");
    setText("moduleEmployeeVales","Não foi possível consultar as duas bases");
  }
}

async function refresh() {
  if (loading) return;
  loading = true;
  // Não bloquear o restante do dashboard esperando a consolidação mensal.
  void refreshEmployeesHome();
  const button = el("refreshData");
  button.disabled = true;
  button.textContent = "Atualizando…";
  try {
    const response = await fetch("api/resumo", {
      credentials: "same-origin",
      cache: "no-store",
      headers: {Accept: "application/json"}
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Este navegador precisa estar pareado com a Central. Abra o link privado "+
        "gerado na VPS para autorizar este navegador; depois entre em Funcionários."
      );
    }
    const data = await response.json();
    if (!data || !data.fontes) throw new Error("A API não retornou um resumo válido.");
    render(data);
    // Não redirecionar antes da confirmação de sessão. Sem pareamento,
    // permanece na Home com a explicação, em vez de repetir 401 infinitos.
    openRequestedModuleAfterAuth();
  } catch (error) {
    setFeedback(error.message || "Falha ao atualizar os dados da Central.");
    if (!currentData) render({fontes:{contas:{disponivel:false},controles:{disponivel:false}},
                              contas:null,controles:null,sugestoes:[]});
  } finally {
    button.disabled = false;
    button.textContent = "Atualizar";
    loading = false;
  }
}

async function pairBrowserFromPrivateLink() {
  const fragment = window.location.hash;
  if (!fragment.startsWith("#parear=")) return;
  const token = decodeURIComponent(fragment.slice("#parear=".length));
  // Nunca deixar o segredo na barra de endereço ou no histórico posterior.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (!/^[a-f0-9]{64}$/.test(token)) {
    setFeedback("Link de vinculação inválido.");
    return;
  }
  try {
    const response = await fetch("api/pair", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({token})
    });
    if (!response.ok) throw new Error("Não foi possível vincular este navegador à Central.");
  } catch (error) {
    setFeedback(error.message || "Falha ao vincular navegador.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-section]").forEach(button => {
    button.addEventListener("click", () => goTo(button.dataset.section));
  });
  el("backHome").addEventListener("click", () => goTo("inicio"));
  el("refreshData").addEventListener("click", refresh);
  window.addEventListener("hashchange", () => {
    const section = window.location.hash.slice(1);
    if (["inicio","contas","notas","vinculos"].includes(section) && section !== currentSection) {
      goTo(section);
    }
  });
  const start = window.location.hash.slice(1);
  if (["contas","notas","vinculos"].includes(start)) goTo(start);
  pairBrowserFromPrivateLink().then(refresh);
  setInterval(() => { if (!document.hidden) refresh(); }, 120000);
});
