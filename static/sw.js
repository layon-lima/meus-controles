/* PWA Central de Controles. APENAS o shell é armazenado; nunca API/dados financeiros. */
"use strict";
const CACHE = "central-de-controles-shell-20261022-conferencia-1";
const SHELL = [
  "/", "/manifest.webmanifest", "/static/icons.svg", "/favicon.ico",
  "/pwa-icon-192.png", "/pwa-icon-512.png",
  "/static/app.css", "/static/desktop_compact.css?v=20261022-conferencia-1", "/static/truck.css?v=20261022-conferencia-1", "/static/truck_workflow.css?v=20261022-conferencia-1",
  "/static/debt.css?v=20261022-conferencia-1", "/static/open_debt.css?v=20261022-conferencia-1", "/static/receiving.css?v=20261022-conferencia-1",
  "/static/pair.css?v=20261022-conferencia-1", "/static/control_types.css", "/static/receiving_import.css",
  "/static/app.js?v=20261022-conferencia-1", "/static/truck.js?v=20261022-conferencia-1", "/static/truck_workflow.js?v=20261022-conferencia-1",
  "/static/debt.js?v=20261022-conferencia-1", "/static/open_debt.js?v=20261022-conferencia-1", "/static/receiving.js?v=20261022-conferencia-1",
  "/static/pair.js?v=20261022-conferencia-1", "/static/pair_records.js?v=acerto-misto-formulario-20261014",
  "/static/pair_financial_import.js?v=acerto-misto-formulario-20261014",
  "/static/control_types.js", "/static/receiving_import.js", "/static/pwa.js"
];
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Instalação só com acesso aos scripts; sem dados privados no cache.
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("central-de-controles-shell-") && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Nunca armazenar ou servir respostas privadas da API a partir do cache.
  if (url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => {
      return (await caches.match("/")) || Response.error();
    }));
    return;
  }
  if (!SHELL.includes(url.pathname + url.search) && !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(req).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(req, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(req)) || Response.error()));
});
