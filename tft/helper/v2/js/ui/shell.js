import { setForcedReducedMotion } from "../dom.js";
import { PREF_SPECS, effectiveTheme, nextTheme } from "../prefs.js";
import { viewForKey, viewInfo } from "../router.js";

/**
 * Casca do app: navegação, tema, movimento, estado da conexão, anúncios para leitor de tela, avisos temporários
 * (toasts), instalação do PWA, diálogo de ajustes/atalhos e atalhos de teclado. Não conhece telas nem dados da
 * partida: o main.js liga as telas por callbacks.
 *
 * `mountShell({ prefs, persistent, goTo, onMeta })`:
 * - `prefs` (prefs.js `createPrefs`) e `persistent` (as preferências sobrevivem ao fechar a página);
 * - `goTo(view)` troca de tela (o main.js escreve o hash); `onMeta(botão)` abre o modal da comp sugerida (atalho M).
 */

const THEME_ICON = { auto: "auto", light: "sun", dark: "moon" };
const THEME_TEXT = {
  auto: "automático (segue o sistema)",
  light: "claro",
  dark: "escuro",
};
const THEME_COLOR = { dark: "#0c131c", light: "#eff3f8" };

const $ = (id) => document.getElementById(id);
const editable = (n) =>
  n instanceof Element &&
  (n.closest("input, select, textarea, [contenteditable='true']") != null ||
    n.closest("[role='textbox']") != null);

export function mountShell({ prefs, persistent = true, goTo, onMeta = null }) {
  const html = document.documentElement,
    app = $("app"),
    stage = $("stage"),
    conn = $("conn"),
    announcer = $("announcer"),
    toasts = $("toasts"),
    helpDlg = $("help-dlg"),
    themeBtn = $("btn-theme"),
    installBtn = $("btn-install"),
    systemDark = matchMedia("(prefers-color-scheme: dark)"),
    colorMetas = [...document.querySelectorAll('meta[name="theme-color"]')],
    originalColors = colorMetas.map((m) => m.content);

  /* ---------- Tema e preferências visuais ---------- */
  // `?theme=light|dark` na URL vale só para esta página (links de captura e testes); qualquer escolha do usuário o substitui.
  let override = /[?&]theme=(light|dark)\b/.exec(location.search)?.[1] ?? null;
  const currentTheme = () => override ?? prefs.get("theme");
  /** Grava uma preferência vinda do usuário; escolher o tema desfaz o `?theme=` da URL. */
  function choose(key, value) {
    if (key === "theme") override = null;
    if (!prefs.set(key, value)) applyPrefs(); // sem mudança no valor guardado, ainda redesenha (o `override` saiu)
  }
  function applyPrefs() {
    const theme = currentTheme();
    if (theme === "auto") delete html.dataset.theme;
    else html.dataset.theme = theme;
    if (prefs.get("stickyHud")) delete html.dataset.stickyHud;
    else html.dataset.stickyHud = "off";
    if (prefs.get("motion") === "reduce") html.dataset.motion = "reduce";
    else delete html.dataset.motion;
    setForcedReducedMotion(prefs.get("motion") === "reduce");
    // Cor da barra do navegador/PWA acompanha o tema escolhido (no automático, volta a seguir o sistema).
    colorMetas.forEach((m, i) => {
      m.content =
        theme === "auto"
          ? originalColors[i]
          : THEME_COLOR[effectiveTheme(theme, systemDark.matches)];
    });
    const icon = THEME_ICON[theme];
    themeBtn.querySelector("use").setAttribute("href", `#i-${icon}`);
    const text = `Tema: ${THEME_TEXT[theme]}`;
    themeBtn.setAttribute("aria-label", text);
    themeBtn.title = `${text}. Clique para alternar. Atalho: T`;
    syncSettings();
    watchTop();
  }
  function cycleTheme() {
    choose("theme", nextTheme(currentTheme()));
    announce(`Tema ${THEME_TEXT[currentTheme()]}`);
  }
  themeBtn.addEventListener("click", cycleTheme);
  prefs.subscribe(applyPrefs);
  systemDark.addEventListener("change", applyPrefs);

  /* ---------- Topo fixo: o painel gruda logo abaixo dele ---------- */
  const top = $("live-top"),
    tallEnough = matchMedia("(min-height: 641px)");
  function watchTop() {
    if (!top) return;
    const sticky =
        prefs.get("stickyHud") && tallEnough.matches && viewId === "live",
      h = sticky ? Math.round(top.getBoundingClientRect().height) : 0;
    stage.style.setProperty("--live-top-h", `${h}px`);
  }
  if (typeof ResizeObserver === "function" && top)
    new ResizeObserver(watchTop).observe(top);
  tallEnough.addEventListener("change", watchTop);

  /* ---------- Navegação ---------- */
  let viewId = null;
  function setView(next) {
    const info = viewInfo(next);
    if (viewId === next) return;
    const first = viewId === null;
    viewId = next;
    app.dataset.view = next;
    $("view-title").textContent = info.title;
    for (const a of document.querySelectorAll(".nav-link"))
      if (a.dataset.view === next) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    if (!first) stage.scrollTo({ top: 0 });
    watchTop();
  }

  /* ---------- Anúncios e avisos temporários ---------- */
  let announceTimer = 0;
  /** Leitor de tela: fala `text` de forma educada (sem interromper). Repetir o mesmo texto também fala. */
  function announce(text) {
    clearTimeout(announceTimer);
    announcer.textContent = "";
    announceTimer = setTimeout(() => (announcer.textContent = text), 60);
  }
  /**
   * Aviso visual temporário no canto. `action` opcional: `{ label, run }`. Devolve uma função que o fecha.
   * Não é anunciado sozinho (o contêiner é `aria-live="off"`): quem chama usa `announce` se for importante.
   */
  function toast(text, { action = null, ms = 6000 } = {}) {
    const node = document.createElement("div");
    node.className = "toast";
    const span = document.createElement("span");
    span.textContent = text;
    node.append(span);
    const close = () => node.remove();
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-go";
      b.textContent = action.label;
      b.addEventListener("click", () => {
        close();
        action.run();
      });
      node.append(b);
    }
    toasts.append(node);
    if (ms > 0) setTimeout(close, ms);
    return close;
  }

  /* ---------- Estado da conexão ---------- */
  let lastConn = null;
  /** Desenha o resumo de `connectionView` (connection.js) na pílula da barra e anuncia as mudanças de situação. */
  function setConnection(view) {
    conn.dataset.tone = view.tone;
    if (view.pulse) conn.setAttribute("data-pulse", "");
    else conn.removeAttribute("data-pulse");
    const label = conn.querySelector(".conn-label"),
      detail = conn.querySelector(".conn-detail");
    if (label.textContent !== view.label) label.textContent = view.label;
    if (detail.textContent !== view.detail) detail.textContent = view.detail;
    conn.title = view.title;
    app.dataset.conn = view.state;
    const kind = view.tone === "ok" ? "ok" : view.state;
    if (lastConn !== null && kind !== lastConn) {
      if (view.state === "offline" || view.state === "reconnecting")
        announce(`${view.label}: ${view.detail}`);
      else if (
        view.tone === "ok" &&
        ["offline", "reconnecting"].includes(lastConn)
      )
        announce("Conexão com o servidor restabelecida");
    }
    lastConn = kind;
  }

  /* ---------- Instalação do PWA ---------- */
  let deferredInstall = null;
  const standalone = () =>
    matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: window-controls-overlay)").matches ||
    navigator.standalone === true;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    installBtn.hidden = standalone() || prefs.get("installDismissed");
  });
  addEventListener("appinstalled", () => {
    deferredInstall = null;
    installBtn.hidden = true;
    toast("App instalado. Ele abre numa janela própria.");
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice.catch(() => ({}));
    deferredInstall = null;
    installBtn.hidden = true;
    if (outcome === "dismissed") prefs.set("installDismissed", true);
  });

  /* ---------- Ajustes e atalhos ---------- */
  const setTheme = $("set-theme"),
    setMotion = $("set-motion"),
    setSticky = $("set-sticky");
  function syncSettings() {
    for (const [group, key] of [
      [setTheme, "theme"],
      [setMotion, "motion"],
    ])
      for (const b of group.querySelectorAll("button"))
        b.setAttribute(
          "aria-pressed",
          String(
            b.dataset.v === (key === "theme" ? currentTheme() : prefs.get(key)),
          ),
        );
    setSticky.checked = prefs.get("stickyHud");
    $("storage-note").hidden = persistent;
  }
  for (const [group, key] of [
    [setTheme, "theme"],
    [setMotion, "motion"],
  ])
    group.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (b && key in PREF_SPECS) choose(key, b.dataset.v);
    });
  setSticky.addEventListener("change", () =>
    prefs.set("stickyHud", setSticky.checked),
  );
  /** Abre Ajustes e atalhos; ao fechar, o navegador devolve o foco a quem estava focado. */
  function openHelp() {
    if (helpDlg.open) return;
    helpDlg.showModal();
    helpDlg.querySelector("[data-close]").focus();
  }
  $("btn-help").addEventListener("click", openHelp);
  helpDlg.addEventListener("click", (e) => {
    if (e.target === helpDlg || e.target.closest("[data-close]"))
      helpDlg.close();
  });

  /* ---------- Atalhos de teclado ---------- */
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (editable(e.target)) return;
    if (e.key === "?") {
      e.preventDefault();
      return helpDlg.open ? helpDlg.close() : openHelp();
    }
    if (document.querySelector("dialog[open]")) return;
    const view = viewForKey(e.key);
    if (view) {
      e.preventDefault();
      return goTo(view);
    }
    if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      return cycleTheme();
    }
    if ((e.key === "m" || e.key === "M") && onMeta) {
      const trigger = document.querySelector(".goal-link");
      if (trigger && !trigger.hidden) {
        e.preventDefault();
        onMeta(trigger);
      }
    }
  });

  applyPrefs();
  /** Linha de rodapé do diálogo de ajustes (estado do modo offline/instalação). */
  const setAppInfo = (text) => ($("app-version").textContent = text);
  return {
    setView,
    setConnection,
    announce,
    toast,
    watchTop,
    openHelp,
    setAppInfo,
  };
}
