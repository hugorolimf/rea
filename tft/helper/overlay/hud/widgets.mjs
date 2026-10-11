/**
 * Elementos posicionáveis do modo integrado (dock, barra, dicas, rolagem, itens, formação, plano): normalização do
 * modo recebido do host, criação dos invólucros, aplicação do layout, arrastar e redimensionar com o ponteiro e o
 * teste de acerto que liga e desliga o click-through. As contas de posição (`moveElement`, `resizeElement`,
 * `clampElement`) são de `layout.mjs`; aqui só se ligam ao DOM. A página só MOSTRA: nada aqui envia entrada ao jogo.
 */
import { parseCalibration } from "./geometry.mjs";
import { parseHintSettings } from "./hints.mjs";
import {
  ELEMENT_IDS,
  ELEMENT_LABELS,
  clampElement,
  moveElement,
  parseLayout,
  resizeElement,
  setHidden,
} from "./layout.mjs";

/** Altura de referência do HUD do jogo: `--k` = altura do palco / 1080 x escala do usuário. */
export const BASE_HEIGHT = 1080;

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const word = (v) => (typeof v === "string" ? v : "");

/** Fator de escala do conteúdo (`--k`) para um palco `{width,height}` e a escala escolhida pelo usuário. */
export function stageScale(stage, scale = 1) {
  const h = finite(stage?.height),
    s = finite(scale);
  return Math.max(
    0.2,
    ((h && h > 0 ? h : BASE_HEIGHT) / BASE_HEIGHT) * (s && s > 0 ? s : 1),
  );
}

/**
 * Modo do host (`window.overlayHost.getMode()` / `onMode`) em forma segura: o que faltar ou vier inválido vira o padrão
 * e um host sem `layout` (versão 1 do contrato) cai no modo painel. `help` e `calibrating` só valem no modo
 * interativo. Nunca lança.
 */
export function normalizeMode(raw) {
  const m = raw && typeof raw === "object" ? raw : {},
    integrated =
      m.mode === "integrated" && !!m.layout && typeof m.layout === "object",
    interactive = m.interactive === true,
    game = m.game && typeof m.game === "object" ? m.game : {},
    fs =
      game.fullscreen && typeof game.fullscreen === "object"
        ? game.fullscreen
        : null,
    keys = m.hotkeys && typeof m.hotkeys === "object" ? m.hotkeys : {};
  return {
    interactive,
    help: interactive && m.help === true,
    calibrating: interactive && integrated && m.calibrating === true,
    mode: integrated ? "integrated" : "panel",
    follow: m.follow !== false,
    scale: finite(m.scale) !== null && m.scale > 0 ? m.scale : 1,
    opacity: finite(m.opacity) !== null ? m.opacity : 1,
    hotkeys: {
      toggle: word(keys.toggle),
      interactive: word(keys.interactive),
      anchor: word(keys.anchor),
      quit: word(keys.quit),
      help: word(keys.help),
      calibrate: word(keys.calibrate),
    },
    layout: parseLayout(m.layout),
    calibration: parseCalibration(m.calibration),
    hints: parseHintSettings(m.hints),
    game: {
      found: integrated && game.found === true,
      width: finite(game.width),
      height: finite(game.height),
      fullscreen: fs
        ? { warn: fs.warn === true, kind: word(fs.kind), text: word(fs.text) }
        : null,
    },
  };
}

/** Modo padrão sem host (aba comum do navegador): painel, sem interação. */
export const PANEL_MODE = Object.freeze(normalizeMode(null));

/* ---------- Acerto do ponteiro ---------- */

/** O ponto está dentro de algum retângulo (`{left,top,right,bottom}` como o `DOMRect`), com folga `pad`? */
export function pointInRects(x, y, rects, pad = 0) {
  return rects.some(
    (r) =>
      x >= r.left - pad &&
      x <= r.right + pad &&
      y >= r.top - pad &&
      y <= r.bottom + pad,
  );
}

/**
 * Resultado de um arrasto: `kind` "move" ou "resize" aplicado ao elemento do início do gesto com o deslocamento total
 * em px do palco. Pura (usa `layout.mjs`).
 */
export function gestureResult(kind, start, dxPx, dyPx, stage, heightPx = 0) {
  return kind === "resize"
    ? resizeElement(start, dxPx, stage)
    : moveElement(start, dxPx, dyPx, stage, heightPx);
}

/** Retângulos dos elementos que ficam clicáveis no modo interativo (`[data-hit]` visíveis). */
function hitRects(root) {
  const out = [];
  for (const n of root.querySelectorAll("[data-hit]")) {
    if (n.getClientRects().length === 0) continue;
    out.push(n.getBoundingClientRect());
  }
  return out;
}

/**
 * Liga e desliga o click-through conforme o ponteiro: sobre um `[data-hit]` (ou durante um arrasto) a janela passa a
 * receber o mouse (`host.setIgnore(false)`); fora deles volta a ignorar (`setIgnore(true)`) e o resto da tela segue
 * clicável no jogo. O ponto vem dos eventos do documento (o host encaminha o movimento mesmo ignorando o mouse) e,
 * em redundância, do `pointerover` dos próprios elementos. `isActive()`: modo interativo integrado; `isBusy()`: há um
 * arrasto ou controle em uso. Devolve `{ sync() }` para reavaliar após mudar de modo.
 */
export function mountHitTest({
  host,
  isActive,
  isBusy = () => false,
  root = document,
}) {
  let ignoring = null,
    point = null,
    frame = 0;
  const set = (value) => {
    if (ignoring === value) return;
    ignoring = value;
    try {
      if (typeof host?.setIgnore === "function") host.setIgnore(value);
    } catch {
      // Sem o canal, o host decide sozinho.
    }
  };
  const evaluate = () => {
    frame = 0;
    // Fora do modo interativo integrado o host manda no click-through (inclusive o painel interativo, que não passa por aqui).
    if (!isActive()) {
      ignoring = null;
      return;
    }
    if (isBusy()) return set(false);
    if (!point) return;
    set(!pointInRects(point.x, point.y, hitRects(root), 2));
  };
  const queue = () => {
    if (frame) return;
    // Um timer curto (e não o quadro de animação) para funcionar mesmo com a janela sem pintar.
    frame = setTimeout(evaluate, 8);
  };
  const see = (e) => {
    if (typeof e.clientX === "number") point = { x: e.clientX, y: e.clientY };
    queue();
  };
  for (const type of ["pointermove", "mousemove", "pointerover"])
    window.addEventListener(type, see, { capture: true, passive: true });
  root.addEventListener("mouseleave", () => {
    point = null;
    if (isActive()) set(true);
  });
  return {
    sync() {
      // Mudou o modo: ao sair do interativo o host já volta a ignorar o mouse; ao entrar, reavalia o ponteiro.
      if (!isActive()) {
        point = null;
        ignoring = null;
      } else queue();
    },
  };
}

/* ---------- Invólucros ---------- */

const make = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};

/**
 * Cria um invólucro por elemento dentro de `stage` e devolve `{ [id]: { wrap, inner, body } }`. `body` recebe o
 * conteúdo (as seções do HUD); a alça de arrastar, o botão de esconder e a alça de redimensionar só aparecem no modo
 * interativo (CSS) e são os únicos pontos clicáveis do elemento.
 */
export function buildElements(stage) {
  const map = {};
  for (const id of ELEMENT_IDS) {
    const label = ELEMENT_LABELS[id] ?? id,
      body = make("div", { class: "el-body" }),
      hide = make(
        "button",
        {
          type: "button",
          class: "el-x",
          "data-hit": "",
          "data-act": "hide",
          title: `Esconder: ${label}`,
        },
        "×",
      ),
      grip = make(
        "div",
        {
          class: "el-grip",
          "data-hit": "",
          "data-act": "move",
          title: `Arraste para mover: ${label}`,
        },
        make("span", {}, `⠿ ${label}`),
        hide,
      ),
      rs = make("div", {
        class: "el-rs",
        "data-hit": "",
        "data-act": "resize",
        title: `Arraste para redimensionar: ${label}`,
      }),
      inner = make("div", { class: "el-in" }, body, grip, rs),
      wrap = make("div", { class: "el", "data-el": id, hidden: "" }, inner);
    stage.append(wrap);
    map[id] = { wrap, inner, body };
  }
  return map;
}

/** O invólucro tem algum filho visível? (as seções vazias ficam `hidden`) */
const hasContent = (body) => [...body.children].some((c) => !c.hidden);

/**
 * Aplica o layout (frações do palco) aos invólucros: esconde o que o usuário escondeu e, fora do modo interativo, o que
 * está vazio (no interativo o vazio aparece tracejado para poder ser posicionado). Devolve as alturas visuais.
 */
export function applyLayout(map, layout, stage, { interactive = false } = {}) {
  const heights = {};
  for (const id of ELEMENT_IDS) {
    const item = map[id],
      cfg = layout[id];
    if (!item || !cfg) continue;
    const filled = hasContent(item.body),
      shown = !cfg.hidden && (filled || interactive);
    item.wrap.hidden = !shown;
    item.wrap.dataset.empty = filled ? "0" : "1";
    if (!shown) continue;
    // A largura entra antes da medida: a altura do conteúdo depende dela. A altura visual (já com a escala) serve para
    // manter o elemento dentro do palco.
    item.wrap.style.width = `${clampElement(cfg, stage, 0).w * 100}%`;
    const height = item.inner.getBoundingClientRect().height;
    const el = clampElement(cfg, stage, height);
    item.wrap.style.left = `${el.x * 100}%`;
    item.wrap.style.top = `${el.y * 100}%`;
    item.wrap.style.width = `${el.w * 100}%`;
    item.wrap.style.height = `${height}px`;
    heights[id] = height;
  }
  return heights;
}

/* ---------- Arrastar e redimensionar ---------- */

/**
 * Arrastar (alça) e redimensionar (canto) dos elementos com captura do ponteiro. `getState()`:
 * `{ interactive, layout, stage }` atuais; `preview(layout)`: redesenha a posição durante o gesto; ao soltar, salva
 * pelo host (`saveLayout`). O botão "×" esconde o elemento. Devolve `{ busy() }`.
 */
export function mountWidgets({ stage, host, getState, preview, map }) {
  let gesture = null;
  const call = (name, ...args) => {
    try {
      if (typeof host?.[name] === "function") host[name](...args);
    } catch {
      // O host revalida e pode recusar; a página não depende da resposta.
    }
  };
  const finish = (commit) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    if (commit && g.layout) call("saveLayout", g.layout);
  };

  stage.addEventListener("pointerdown", (e) => {
    const handle =
        e.target instanceof Element ? e.target.closest("[data-act]") : null,
      act = handle?.dataset.act;
    if (e.button !== 0 || (act !== "move" && act !== "resize")) return;
    const { interactive, layout, stage: size } = getState(),
      id = handle.closest("[data-el]")?.dataset.el;
    if (!interactive || !id || !layout[id]) return;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Sem captura o gesto ainda funciona; soltar fora cai em pointercancel.
    }
    e.preventDefault();
    gesture = {
      id,
      kind: act,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: { ...layout[id] },
      base: layout,
      size,
      height: map[id]?.inner.getBoundingClientRect().height ?? 0,
      layout: null,
    };
  });
  stage.addEventListener("pointermove", (e) => {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const g = gesture,
      next = gestureResult(
        g.kind,
        g.start,
        e.clientX - g.x,
        e.clientY - g.y,
        g.size,
        g.height,
      );
    g.layout = { ...g.base, [g.id]: next };
    preview(g.layout);
  });
  for (const type of ["pointerup", "pointercancel"])
    stage.addEventListener(type, (e) => {
      if (gesture && e.pointerId === gesture.pointerId) finish(true);
    });
  stage.addEventListener("lostpointercapture", (e) => {
    if (gesture && e.pointerId === gesture.pointerId) finish(true);
  });
  stage.addEventListener("click", (e) => {
    const btn =
      e.target instanceof Element
        ? e.target.closest('[data-act="hide"]')
        : null;
    if (!btn) return;
    const { interactive, layout } = getState(),
      id = btn.closest("[data-el]")?.dataset.el;
    if (interactive && id && layout[id])
      call("saveLayout", setHidden(layout, id, true));
  });

  return {
    busy: () => gesture !== null,
    /** Solta um gesto em andamento (saiu do modo interativo): salva o que já foi feito. */
    release: () => finish(true),
  };
}
