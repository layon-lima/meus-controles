/* Instalação PWA e recuperação da interface após retorno da conexão.
   Nunca envia movimentações automaticamente; o banco da VPS é a única fonte. */
"use strict";
(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const banner = document.getElementById("connectionStatus");
  let wasOffline = false;
  let pendingReload = false;
  let nextCheck = null;
  let delay = 5000;
  function show(message) {
    if (!banner) return;
    banner.textContent = message;
    banner.hidden = false;
  }
  function hide() {
    if (banner) banner.hidden = true;
  }
  async function check() {
    if (!navigator.onLine) {
      wasOffline = true;
      show("Sem conexão — lançamentos não serão enviados. Aguarde a internet voltar.");
      return false;
    }
    try {
      const response = await fetch("/api/ready", {cache: "no-store", credentials: "same-origin"});
      if (!response.ok) throw new Error("Servidor indisponível");
      const data = await response.json();
      if (!data.ok) throw new Error("Banco indisponível");
      if (wasOffline || pendingReload) {
        wasOffline = false;
        if (typeof App !== "undefined" && !App.s.modal) {
          pendingReload = false;
          await App.load();
        } else {
          // Mantém a solicitação de atualização até o formulário ser fechado.
          pendingReload = true;
        }
      }
      delay = 5000;
      if (pendingReload) show("Conexão restabelecida. Feche o formulário para atualizar os dados.");
      else hide();
      return true;
    } catch (_) {
      wasOffline = true;
      show("Conectando à Central de Controles… seus dados continuam na VPS.");
      return false;
    }
  }
  async function loop() {
    const ok = await check();
    delay = ok ? 30000 : Math.min(delay * 2, 30000);
    nextCheck = window.setTimeout(loop, delay);
  }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", {scope: "/"}).catch(() => {
        // A interface web normal continua disponível quando o PWA é bloqueado.
      });
    });
  }
  window.addEventListener("online", () => {
    if (nextCheck) window.clearTimeout(nextCheck);
    loop();
  });
  window.addEventListener("offline", () => {
    wasOffline = true;
    show("Sem conexão — lançamentos não serão enviados. Aguarde a internet voltar.");
  });
  window.setTimeout(loop, 1200);
})();
