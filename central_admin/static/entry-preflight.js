"use strict";
/* Entrada em duas fases: o fundo cresce primeiro; conteúdo aparece depois.
 * Executado no <head> ANTES do CSS e da primeira pintura, sem conteúdo privado.
 */
(function () {
  const key = "nh-central-expand-entry";
  let timestamp = 0;
  try {
    timestamp = Number(window.sessionStorage.getItem(key));
    window.sessionStorage.removeItem(key);
  } catch (_) { return; }
  const elapsed = Date.now() - timestamp;
  if (!timestamp || elapsed < 0 || elapsed > 12000) return;

  const html = document.documentElement;
  html.classList.add("nh-start-arriving");
  let revealed = false;
  let receivedPageReveal = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    html.classList.add("nh-start-revealing");
    html.classList.remove("nh-start-arriving");
    window.setTimeout(() => html.classList.remove("nh-start-revealing"), 300);
  };

  // O navegador informa a conclusão da expansão. Não depender de uma
  // duração aproximada que possa terminar antes em máquinas mais lentas.
  window.addEventListener("pagereveal", event => {
    receivedPageReveal = true;
    const transition = event.viewTransition;
    if (transition && transition.finished && typeof transition.finished.then === "function") {
      transition.finished.then(
        () => window.setTimeout(reveal, 45),
        reveal
      );
    } else {
      // Sem View Transitions, o fallback já animou o vidro antes de navegar.
      window.setTimeout(reveal, 100);
    }
  }, {once:true});

  // Compatibilidade com navegadores que não disparam pagereveal.
  window.addEventListener("pageshow", () => {
    window.setTimeout(() => {
      if (!receivedPageReveal) reveal();
    }, 110);
  }, {once:true});

  // Segurança: a página nunca permanece invisível caso a transição falhe.
  window.setTimeout(reveal, 1200);
})();