"use strict";
/* Navegação única, sem iframe. Os formulários e APIs originais continuam ativos. */
(function () {
  const labels = [
    ["Painel", "/central/"],
    ["Controles", "/central/modules/controles/"],
    ["Recebimentos", "/central/modules/recebimentos/"],
    ["Transportadoras", "/central/modules/transportadoras/"],
    ["Contas", "/central/modules/contas/"],
    ["Funcionários", "/central/modules/funcionarios/"],
    ["Documentos", "/central/modules/documentos/"],
    ["Relatórios", "/central/modules/relatorios/"]
  ];
  const active = (location.pathname.match(/^\/central\/modules\/([a-z-]+)/) || [])[1] || "";
  document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("central-operational");
    const top = document.createElement("header");
    top.className = "central-shell-bar";
    const content = document.createElement("div");
    content.className = "central-shell-inner";
    const brand = document.createElement("a");
    brand.className = "central-home";
    brand.href = "/central/";
    const monogram = document.createElement("span");
    monogram.className = "central-mark";
    monogram.textContent = "NH";
    const copy = document.createElement("span");
    copy.className = "central-brandline";
    const strong = document.createElement("strong");
    strong.textContent = "Novo Horizonte";
    const small = document.createElement("small");
    small.textContent = "Central Administrativa";
    copy.append(strong, small);
    brand.append(monogram, copy);
    const nav = document.createElement("nav");
    nav.className = "central-tabs";
    nav.setAttribute("aria-label", "Módulos da Central");
    labels.forEach(([name, url]) => {
      const a = document.createElement("a");
      a.href = url;
      a.textContent = name;
      if (url.includes("/" + active + "/") && active) a.setAttribute("aria-current", "page");
      nav.append(a);
    });
    content.append(brand, nav);
    if (["controles", "recebimentos", "transportadoras", "relatorios"].includes(active)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "central-show-legacy";
      button.textContent = "Pastas";
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => {
        document.body.classList.toggle("central-drawer-open");
        button.setAttribute("aria-expanded",
          document.body.classList.contains("central-drawer-open") ? "true" : "false");
      });
      content.append(button);
    }
    top.append(content);
    document.body.insertBefore(top, document.body.firstChild);

    // Abre o módulo real e já seleciona a função existente correspondente.
    if (active === "funcionarios") {
      const tab = document.getElementById("tabHolerites");
      if (tab) tab.click();
    }
    const targetMode = {
      recebimentos: "recebimento", transportadoras: "caminhao"
    }[active];
    if (targetMode) {
      let retries = 0;
      const openNativeControl = () => {
        const app = window.App;
        const controls = app && app.s && app.s.state && app.s.state.controls;
        if (Array.isArray(controls) && typeof app.navigate === "function") {
          const match = controls.find(c => c.mode === targetMode);
          if (match) {
            app.navigate("control", Number(match.id));
            return;
          }
        }
        if (++retries < 30) setTimeout(openNativeControl, 200);
      };
      setTimeout(openNativeControl, 200);
    }
  });
})();
