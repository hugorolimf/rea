/**
 * Registro do service worker (`/sw.js`, ver v2/sw.js): casca estática offline e instalável. O worker nunca toca em
 * `/api/*`; só guarda HTML, CSS, módulos, ícones e imagens do catálogo. Este módulo só liga a página ao worker.
 */

/** Só vale em contexto seguro (localhost ou https), com suporte e fora do mock (as capturas do mock não podem ser cacheadas). */
export function canRegister(win = globalThis) {
  return (
    !!win.navigator?.serviceWorker &&
    win.isSecureContext === true &&
    !/[?&]mock=/.test(win.location?.search ?? "")
  );
}

/** Caminhos que a página já carregou e que valem guardar offline (mesma origem, casca e imagens). */
export function shellUrls(entries, origin) {
  const keep = (p) =>
    p === "/" ||
    p === "/manifest.webmanifest" ||
    /^\/(v2|core)\//.test(p) ||
    /^\/assets\/[a-f0-9]{24}\.png$/.test(p) ||
    /^\/(economy|rules)\.mjs$/.test(p);
  const out = new Set(["/"]);
  for (const e of entries) {
    try {
      const u = new URL(e.name ?? e, origin);
      if (u.origin === origin && keep(u.pathname)) out.add(u.pathname);
    } catch {
      // URL inválida: ignora
    }
  }
  return [...out];
}

/**
 * Registra o worker. `onUpdate(aplicar)` é chamado quando há versão nova pronta: `aplicar()` a ativa e recarrega
 * (só quando o usuário pede, para nunca recarregar no meio de uma partida).
 */
export async function registerServiceWorker({ onUpdate = () => {} } = {}) {
  if (!canRegister()) return null;
  let registration;
  try {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  } catch {
    return null; // sem worker o app continua funcionando online
  }
  let accepted = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (accepted) location.reload();
  });
  const watch = (worker) =>
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller)
        onUpdate(() => {
          accepted = true;
          worker.postMessage({ type: "SKIP_WAITING" });
        });
    });
  if (registration.waiting && navigator.serviceWorker.controller)
    onUpdate(() => {
      accepted = true;
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    });
  registration.addEventListener("updatefound", () =>
    watch(registration.installing),
  );
  // Guarda o que esta página já carregou (a primeira visita não passou pelo worker).
  navigator.serviceWorker.ready
    .then((ready) => {
      const urls = shellUrls(
        performance.getEntriesByType("resource"),
        location.origin,
      );
      ready.active?.postMessage({ type: "CACHE_URLS", urls });
    })
    .catch(() => {});
  // Versão nova do worker: procura de tempos em tempos e quando a aba volta ao primeiro plano.
  const check = () => registration.update().catch(() => {});
  setInterval(check, 30 * 60 * 1000);
  document.addEventListener(
    "visibilitychange",
    () => !document.hidden && check(),
  );
  return registration;
}
