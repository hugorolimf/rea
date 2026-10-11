/*
 * Service worker do TFT Compass (servido em /sw.js por static-files.mjs, escopo "/").
 *
 * - NUNCA intercepta `/api/*` (estado, recomendação e SSE sempre vão direto ao servidor), nem `/overlay/*`, nem o mock.
 * - Casca (HTML, CSS, módulos de /v2 e /core): rede primeiro (o servidor manda `no-cache`, então o app está sempre
 *   fresco) e, sem rede ou com o servidor parado, a cópia guardada. Assim a interface abre offline e mostra o estado
 *   "servidor indisponível" em vez de uma página de erro do navegador.
 * - Imagens do catálogo (/assets/<hash>.png) e ícones: cache primeiro (o nome é o hash do conteúdo).
 * - A página manda `CACHE_URLS` com o que já carregou (a primeira visita ainda não passava pelo worker).
 * Mude `VERSION` para invalidar tudo ao alterar a política abaixo.
 */
const VERSION = "1";
const SHELL = `tft-shell-v${VERSION}`;
const IMAGES = `tft-img-v${VERSION}`;
const NETWORK_TIMEOUT_MS = 4000;

const isImage = (p) =>
  /^\/assets\/[a-f0-9]{24}\.png$/.test(p) || p.startsWith("/v2/icons/");
const isShell = (p) =>
  p === "/" ||
  p === "/manifest.webmanifest" ||
  p.startsWith("/v2/") ||
  p.startsWith("/core/") ||
  /^\/(economy|rules)\.mjs$/.test(p);
const bypass = (p) =>
  p === "/sw.js" ||
  p.startsWith("/api/") ||
  p.startsWith("/overlay/") ||
  p.startsWith("/live-mock");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest"]))
      .catch(() => {}), // servidor sem o manifesto (versão antiga): instala assim mesmo
  );
  // A versão nova só assume quando a página pedir (SKIP_WAITING), para não recarregar no meio da partida.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("tft-") && key !== SHELL && key !== IMAGES)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data ?? {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "CACHE_URLS" && Array.isArray(data.urls))
    event.waitUntil(
      (async () => {
        const shell = await caches.open(SHELL),
          img = await caches.open(IMAGES);
        await Promise.all(
          data.urls.map(async (u) => {
            const path = new URL(u, self.location.origin).pathname;
            if (!isShell(path) && !isImage(path)) return;
            try {
              const cache = isImage(path) ? img : shell;
              if (await cache.match(u)) return;
              const res = await fetch(u, { cache: "no-cache" });
              if (res.ok) await cache.put(u, res);
            } catch {
              // fora do ar: fica para a próxima visita
            }
          }),
        );
      })(),
    );
});

/** Rede primeiro; cai para o cache se a rede falhar ou passar de NETWORK_TIMEOUT_MS. */
async function networkFirst(request, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  const net = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  try {
    return await Promise.race([
      net,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS),
      ),
    ]);
  } catch {
    const hit =
      (await cache.match(request, {
        ignoreSearch: request.mode === "navigate",
      })) ?? (fallbackKey ? await cache.match(fallbackKey) : undefined);
    if (hit) {
      net.catch(() => {}); // a resposta tardia é descartada sem erro não tratado
      return hit;
    }
    return net; // sem cópia: devolve o erro de rede de verdade
  }
}

/** Cache primeiro; busca e guarda se faltar. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || bypass(url.pathname)) return;
  if (isImage(url.pathname))
    return void event.respondWith(cacheFirst(request, IMAGES));
  if (request.mode === "navigate")
    return void event.respondWith(networkFirst(request, SHELL, "/"));
  if (isShell(url.pathname))
    return void event.respondWith(networkFirst(request, SHELL));
});
