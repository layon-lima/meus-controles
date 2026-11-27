"use strict";
/*
 * Inicialização de rota da Central (somente os módulos legados sob /central).
 * Executado no <head> antes da pintura e antes dos scripts defer dos motores.
 * Não navega, não consulta APIs e não altera nem recria dados.
 */
(() => {
  if (!/^\/central\/modules\/(?:controles|transportadoras|relatorios|contas|documentos)(?:\/|$)/
        .test(window.location.pathname)) return;
  const html = document.documentElement;
  html.classList.add("nh-route-boot");
  let finished = false;
  const ready = () => {
    if (finished) return;
    finished = true;
    html.classList.remove("nh-route-boot");
  };
  // Se um motor legado falhar ao iniciar, não manter a tela bloqueada.
  const safety = window.setTimeout(ready, 15000);
  window.NHCentralRoute = {
    ready() {
      window.clearTimeout(safety);
      ready();
    },
    get pending() { return !finished; }
  };
})();
