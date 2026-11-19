"use strict";
let adminToken = "";
const el = (id) => document.getElementById(id);

function node(tag, value, className) {
  const item = document.createElement(tag);
  item.textContent = String(value === null || value === undefined ? "" : value);
  if (className) item.className = className;
  return item;
}
function blank(id, message) {
  el(id).replaceChildren(node("p", message, "empty"));
}
function addRow(id, title, detail, value) {
  const line = node("div", "", "item");
  const info = document.createElement("div");
  info.append(node("b", title), node("small", detail));
  line.append(info, node("div", value, "value"));
  el(id).append(line);
}
function money(number) {
  const value = Number(number);
  return Number.isFinite(value) ?
    value.toLocaleString("pt-BR", {style:"currency", currency:"BRL"}) : "—";
}
function render(data) {
  const a = data.contas, n = data.controles;
  const sourceStatus = (name, source) => source.disponivel ?
    name + ": conectado" : name + ": " + (source.erro || "indisponível");
  el("feedback").textContent = sourceStatus("Contas", data.fontes.contas) +
    " · " + sourceStatus("Controles", data.fontes.controles);
  const cards = [
    ["Contas em aberto", a ? a.em_aberto : "—", "CONTAS 4"],
    ["Valor pendente", a ? money(a.valor_em_aberto) : "—", "Banco financeiro"],
    ["NF-e recebidas", n ? n.notas : "—", "Meus Controles"],
    ["Possíveis vínculos", a && n ? data.sugestoes.length : "—", "Requer conferência"]
  ];
  el("cards").replaceChildren();
  for (const [label, value, note] of cards) {
    const card = node("div", "", "card");
    card.append(node("small", label), node("strong", value), node("span", note));
    el("cards").append(card);
  }
  ["mini-notas","mini-contas","lista-notas","lista-contas","lista-vinculos"].forEach(id => el(id).replaceChildren());
  if (!a) {
    blank("mini-contas", "Dados financeiros indisponíveis.");
    blank("lista-contas", "Dados financeiros indisponíveis.");
  } else if (!a.proximas.length) {
    blank("mini-contas", "Nenhuma conta em aberto.");
    blank("lista-contas", "Nenhuma conta em aberto.");
  } else {
    a.proximas.forEach((account, index) => {
      const detail = account.vencimento + " · " + account.documento;
      if (index < 5) addRow("mini-contas", account.fornecedor, detail, money(account.valor));
      addRow("lista-contas", account.fornecedor, detail + " · " + account.status, money(account.valor));
    });
  }
  if (!n) {
    blank("mini-notas", "Dados de recebimento indisponíveis.");
    blank("lista-notas", "Dados de recebimento indisponíveis.");
  } else if (!n.recentes.length) {
    blank("mini-notas", "Nenhuma nota recebida.");
    blank("lista-notas", "Nenhuma nota recebida.");
  } else {
    n.recentes.forEach((invoice, index) => {
      if (index < 5) addRow("mini-notas", "NF " + invoice.invoice_number,
        invoice.supplier, "Pedido " + invoice.order_number);
      addRow("lista-notas", "NF " + invoice.invoice_number,
        invoice.supplier, "Pedido " + invoice.order_number);
    });
  }
  if (!(a && n)) {
    blank("lista-vinculos", "Os dois bancos precisam estar disponíveis.");
  } else if (!data.sugestoes.length) {
    blank("lista-vinculos", "Nenhum vínculo inequívoco sugerido.");
  } else {
    data.sugestoes.forEach(link => addRow("lista-vinculos",
      "Conta " + link.account_id + " · " + link.supplier,
      link.reason + " · " + link.account_document + " · Conferência necessária",
      "NF " + link.invoice_number));
  }
}

async function connect() {
  adminToken = el("token").value.trim();
  if (adminToken.length < 32) {
    el("feedback").textContent = "Informe a chave privada completa.";
    return;
  }
  el("connect").disabled = true;
  try {
    const response = await fetch("api/resumo", {
      headers: {"Authorization": "Bearer " + adminToken},
      cache: "no-store"
    });
    if (response.status === 401) throw new Error("Chave administrativa inválida.");
    const data = await response.json();
    render(data);
    if (!data.ok) el("feedback").textContent += " · Nenhuma base acessível.";
    el("login").hidden = true;
    el("token").value = "";
  } catch (error) {
    el("feedback").textContent = error.message || "Não foi possível conectar.";
  } finally {
    adminToken = "";
    el("connect").disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".nav").forEach(other => other.classList.toggle("active", other === button));
    document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === button.dataset.view));
    el("title").textContent = button.textContent;
  }));
  el("connect").addEventListener("click", connect);
  el("token").addEventListener("keydown", event => {if (event.key === "Enter") connect();});
  blank("mini-notas", "Conecte-se para consultar.");
  blank("mini-contas", "Conecte-se para consultar.");
});
