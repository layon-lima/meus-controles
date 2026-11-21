"use strict";
/*
 * Central Novo Horizonte — conferência de conta e PDF lado a lado.
 * Usa os MESMOS elementos e funções do formulário CONTAS 4, sem
 * interceptar Salvar, Cancelar, OCR, holerites, R2 ou cópia Windows.
 * O arquivo já está na memória do navegador durante a prévia.
 */
(() => {
  if (!location.pathname.startsWith("/central/modules/contas/")) return;
  const backdrop = document.getElementById("backdrop");
  if (!backdrop) return;

  let form = null, identity = null, objectURL = null, requestSerial = 0;
  const $ = id => document.getElementById(id);

  function sourceFor(formElement) {
    if (!formElement) return null;
    // No cadastro/importação o documento é o File exato que o usuário
    // arrastou. O processo original gerencia seu ticket e validações.
    const upload = typeof pendingImportPDF === "undefined" ? null : pendingImportPDF;
    const file = upload?.file;
    if (file && /\.pdf$/i.test(String(file.name || "")) &&
        typeof file.size === "number" && file.size >= 5)
      return {kind:"file", identity:file, file, name:file.name};

    // Na edição/releitura de uma conta existente, ler a versão atual
    // (R2/VPS) pelo endpoint já protegido do próprio CONTAS 4.
    const accountId = typeof selected === "undefined" ? null : Number(selected);
    const item = typeof accounts === "undefined" ? null :
      accounts.find(x => Number(x.id) === accountId);
    if (item?.has_pdf && Number.isSafeInteger(accountId) && accountId > 0)
      return {kind:"saved", identity:"account:"+accountId,
        accountId, name:String(item.observacoes || "PDF da conta")};
    return null;
  }

  function destroy() {
    ++requestSerial;
    form = null;identity = null;
    backdrop.classList.remove("nh-pdf-review-split");
    document.body.classList.remove("nh-pdf-review-open");
    const viewer = $("nh-account-pdf-review");
    if (viewer) viewer.remove();
    if (objectURL) {
      URL.revokeObjectURL(objectURL);
      objectURL = null;
    }
  }

  function viewerElements(source) {
    const section = document.createElement("section");
    section.id = "nh-account-pdf-review";
    section.className = "nh-pdf-review";
    section.setAttribute("aria-label", "Visualizador do PDF original");
    const head = document.createElement("header");
    head.className = "nh-pdf-review-head";
    const description = document.createElement("div");
    description.className = "nh-pdf-review-description";
    const eyebrow = document.createElement("small");
    eyebrow.textContent = "DOCUMENTO ORIGINAL";
    const title = document.createElement("strong");
    title.id = "nh-pdf-review-name";
    title.textContent = source.name || "Documento PDF";
    title.title = source.name || "Documento PDF";
    description.append(eyebrow, title);

    const controls = document.createElement("div");
    controls.className = "nh-pdf-review-controls";
    const link = document.createElement("a");
    link.id = "nh-pdf-review-open";
    link.target = "_blank";link.rel = "noopener noreferrer";
    link.textContent = "Abrir em outra guia";
    link.setAttribute("aria-label","Abrir este PDF em outra guia");
    link.hidden = true;
    controls.append(link);
    head.append(description,controls);

    const viewport = document.createElement("div");
    viewport.className = "nh-pdf-review-viewport";
    const status = document.createElement("p");
    status.id = "nh-pdf-review-status";
    status.setAttribute("role","status");
    status.textContent = "Preparando visualização do PDF…";
    viewport.append(status);
    const hint = document.createElement("p");
    hint.className = "nh-pdf-review-hint";
    hint.textContent =
      "Use a barra do visualizador para ampliar, localizar e trocar de página.";
    section.append(head,viewport,hint);
    return {section,viewport,status,link};
  }

  function showPDF(parts,blob,serial) {
    if (serial !== requestSerial || !parts.section.isConnected) return;
    if (blob.size < 5 || !(blob.type === "application/pdf" ||
                          blob.type === "" || blob.type === "application/octet-stream")) {
      parts.status.textContent = "O servidor não retornou um PDF válido.";
      return;
    }
    // URL local da sessão: o arquivo não sai do navegador nem entra em
    // qualquer serviço de terceiros. Revogar ao fechar/trocar de conta.
    const pdf = blob.type === "application/pdf" ? blob :
      new Blob([blob], {type:"application/pdf"});
    objectURL = URL.createObjectURL(pdf);
    const iframe = document.createElement("iframe");
    iframe.className = "nh-pdf-review-frame";
    iframe.title = "PDF para conferência — zoom e navegação de páginas";
    iframe.setAttribute("loading","eager");
    iframe.src = objectURL + "#toolbar=1&navpanes=0&view=FitH";
    parts.viewport.replaceChildren(iframe);
    parts.link.href = objectURL;
    parts.link.hidden = false;
  }

  async function fetchAccountPDF(accountId) {
    const endpoint = "/central/modules/contas/api/accounts/" + accountId + "/pdf";
    const request = () => fetch(endpoint,{
      credentials:"same-origin",cache:"no-store",
      headers:{"X-Local-Token":
        typeof token === "undefined" ? "" : String(token || "")}
    });
    let response = await request();
    if (response.status === 403 && typeof renewSessionToken === "function") {
      await renewSessionToken();
      response = await request();
    }
    if (!response.ok) {
      const error = await response.json().catch(()=>({}));
      throw new Error(error.error || "PDF não encontrado no R2/VPS.");
    }
    const blob = await response.blob();
    if (blob.size < 5 || blob.size > 30 * 1024 * 1024)
      throw new Error("O PDF possui tamanho inválido.");
    return blob;
  }

  async function attach(source) {
    const serial = requestSerial;
    const parts = viewerElements(source);
    const dialog = backdrop.querySelector(".dialog");
    if (!dialog) return;
    dialog.appendChild(parts.section);
    backdrop.classList.add("nh-pdf-review-split");
    document.body.classList.add("nh-pdf-review-open");

    if (source.kind === "file") {
      // Este arquivo já está em memória no fluxo OCR (inclusive lotes).
      showPDF(parts,source.file,serial);
      return;
    }
    try {
      const blob = await fetchAccountPDF(source.accountId);
      showPDF(parts,blob,serial);
    } catch(error) {
      if (serial === requestSerial && parts.status.isConnected)
        parts.status.textContent = error.message || "Falha ao carregar o PDF.";
    }
  }

  function syncReview() {
    const visible = backdrop.classList.contains("show");
    const currentForm = visible ? $("accountForm") : null;
    const source = visible ? sourceFor(currentForm) : null;
    if (!visible || !currentForm || !source) {
      if (form || $("nh-account-pdf-review")) destroy();
      return;
    }
    if (form === currentForm && identity === source.identity) return;
    destroy();
    form = currentForm;identity = source.identity;
    attach(source);
  }

  // Observa apenas a estrutura já existente. Não reconstrói o formulário,
  // não altera campos nem cria um segundo ciclo de aprovação.
  const observer = new MutationObserver(syncReview);
  observer.observe(backdrop,{
    attributes:true,attributeFilter:["class"],
    childList:true,subtree:true
  });
  syncReview();

  window.addEventListener("pagehide",()=>{
    observer.disconnect();destroy();
  },{once:true});
})();
