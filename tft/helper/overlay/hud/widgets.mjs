/**
 * Elementos posicionáveis do modo integrado (dock, barra, dicas, rolagem, itens, formação, plano): normalização do
 * modo recebido do host, criação dos invólucros, aplicação do layout, arrastar e redimensionar com o ponteiro e o
 * teste de acerto que liga e desliga o click-through. As contas de posição (`moveElement`, `resizeElement`) são de
 * `layout.mjs` e a adaptação ao tamanho do jogo (escala, colisões, recolhimento) é de `fit.mjs`; aqui só se ligam ao DOM.
 * A página só MOSTRA: nada aqui envia entrada ao jogo.
 */
import {
  BASE_HEIGHT,
  arrangeElements,
  scaleFactor,
  stageFrame,
  wantedRect,
} from "./fit.mjs";
import { parseCalibration } from "./geometry.mjs";
import { parseHintSettings } from "./hints.mjs";
import { HOTKEY_IDS, parseShortcuts } from "./hotkeys.mjs";
import {
  ELEMENT_IDS,
  ELEMENT_LABELS,
  moveElement,
  parseLayout,
  resizeElement,
  setHidden,
} from "./layout.mjs";

export { BASE_HEIGHT };

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const word = (v) => (typeof v === "string" ? v : "");

/**
 * Fator de escala do conteúdo (`--k`) para um palco `{width,height}` e a escala escolhida pelo usuário: a do HUD 16:9
 * (o menor dos eixos: altura/1080 ou largura/1920) vezes a do usuário, com piso e teto de legibilidade (`fit.mjs`).
 */
export function stageScale(stage, scale = 1) {
  return scaleFactor(stage, scale);
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
    hotkeys: Object.fromEntries(HOTKEY_IDS.map((id) => [id, word(keys[id])])),
    // Atalhos como o main os registrou (tecla + registrou/falhou); a legenda e a ajuda só leem daqui.
    shortcuts: parseShortcuts(m.shortcuts, keys),
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
function hitRects(root, selector = "[data-hit]") {
  const out = [];
  for (const n of root.querySelectorAll(selector)) {
    if (n.getClientRects().length === 0) continue;
    out.push(n.getBoundingClientRect());
  }
  return out;
}

/** Regiões quentes (`[data-hot]` visíveis e habilitados): clicáveis mesmo FORA do modo interativo. */
const hotRects = (root) =>
  hitRects(root, "[data-hot]:not([disabled])").filter(
    (r) => r.width > 0 && r.height > 0,
  );

/** Retângulos quentes no formato do host (`{x,y,width,height}` em px CSS, arredondados). */
export const hotRectList = (rects) =>
  rects.map((r) => ({
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.right - r.left),
    height: Math.round(r.bottom - r.top),
  }));

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
    frame = 0,
    hot = null,
    hotSig = "";
  const set = (value) => {
    if (ignoring === value) return;
    ignoring = value;
    try {
      if (typeof host?.setIgnore === "function") host.setIgnore(value);
    } catch {
      // Sem o canal, o host decide sozinho.
    }
  };
  /** Ponteiro sobre uma região quente (fora do modo interativo); o host confere o cursor antes de capturar. */
  const setHot = (value) => {
    if (hot === value) return;
    hot = value;
    try {
      if (typeof host?.setHot === "function") host.setHot(value);
    } catch {
      // Host sem regiões quentes (contrato antigo): o botão só funciona no modo interativo.
    }
  };
  const evaluate = () => {
    frame = 0;
    // Fora do modo interativo integrado o host manda no click-through (inclusive o painel interativo, que não passa por aqui);
    // só as regiões quentes ([data-hot], como "Copiar comp") pedem captura, e o host confere a posição do cursor.
    if (!isActive()) {
      ignoring = null;
      setHot(!!point && pointInRects(point.x, point.y, hotRects(root), 0));
      return;
    }
    setHot(false);
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
    setHot(false);
    if (isActive()) set(true);
  });
  return {
    sync() {
      // Mudou o modo: ao sair do interativo o host já volta a ignorar o mouse; ao entrar, reavalia o ponteiro.
      if (!isActive()) {
        point = null;
        ignoring = null;
        setHot(false);
      } else queue();
    },
    /**
     * Informa ao host onde estão as regiões quentes (depois de cada desenho; só quando mudam) e reavalia o ponteiro: um
     * botão que apareceu, sumiu ou mudou de lugar sob o cursor liga ou desliga a captura sem esperar o próximo movimento.
     */
    reportHot() {
      const list = hotRectList(hotRects(root));
      const sig = JSON.stringify(list);
      if (sig !== hotSig) {
        hotSig = sig;
        try {
          if (typeof host?.setHotRects === "function") host.setHotRects(list);
        } catch {
          // Host antigo: sem regiões quentes.
        }
      }
      queue();
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
 * Aplica o layout (frações do HUD 16:9, ver `fit.mjs`) aos invólucros: esconde o que o usuário escondeu e, fora do modo
 * interativo, o que está vazio (no interativo o vazio aparece tracejado para poder ser posicionado). Fora do modo
 * interativo a posição final é a EFETIVA: `arrangeElements` empilha o que colide, usa as faixas livres e recolhe o de menor
 * prioridade que não cabe; o layout salvo não é alterado. No interativo mostra-se o salvo, para editar o que se vê.
 *
 * `opts`: `{ interactive, k, keepOut, sticky }` (`k` = `--k`; `keepOut` = `keepOutRects`; `sticky` = recolhidos do desenho
 * anterior). Devolve `{ heights, arrangement }` (alturas visuais em px e o resultado de `arrangeElements`).
 */
export function applyLayout(
  map,
  layout,
  stage,
  { interactive = false, k = 1, keepOut = [], sticky = [] } = {},
) {
  const heights = {},
    shownIds = [];
  const frame = stageFrame(stage);
  for (const id of ELEMENT_IDS) {
    const item = map[id],
      cfg = layout[id];
    if (!item || !cfg) continue;
    const filled = hasContent(item.body),
      shown = !cfg.hidden && (filled || interactive);
    item.wrap.hidden = !shown;
    item.wrap.dataset.empty = filled ? "0" : "1";
    delete item.wrap.dataset.collapsed;
    if (!shown) continue;
    shownIds.push(id);
  }
  // Primeira passada: a largura desejada entra antes da medida (a altura do conteúdo depende dela).
  for (const id of shownIds) {
    const want = wantedRect(id, layout[id], frame, k, 0, !interactive);
    if (want) map[id].wrap.style.width = `${want.width}px`;
  }
  for (const id of shownIds)
    heights[id] = map[id].inner.getBoundingClientRect().height;
  // Segunda: a posição efetiva, já com as alturas medidas.
  const arrangement = arrangeElements({
    stage,
    layout,
    heights,
    ids: shownIds,
    k,
    keepOut,
    sticky,
    auto: !interactive,
  });
  for (const id of shownIds) {
    const item = map[id],
      rect = arrangement.rects[id];
    if (!rect) {
      // Recolhido por falta de espaço (ou palco inválido): sai de cena; o dock e a ajuda dizem qual.
      item.wrap.hidden = true;
      if (frame.width) item.wrap.dataset.collapsed = "1";
      continue;
    }
    item.wrap.dataset.moved = arrangement.moved.includes(id) ? "1" : "0";
    item.wrap.style.left = `${rect.x}px`;
    item.wrap.style.top = `${rect.y}px`;
    item.wrap.style.width = `${rect.width}px`;
    item.wrap.style.height = `${heights[id]}px`;
  }
  return { heights, arrangement };
}

/* ---------- Arrastar e redimensionar ---------- */

/**
 * Arrastar (alça) e redimensionar (canto) dos elementos com captura do ponteiro. `getState()`:
 * `{ interactive, layout, stage }` atuais, onde `stage` = `{width,height}` do QUADRO do layout (o HUD 16:9, `stageFrame().hud`):
 * o layout é fração dele, então os deslocamentos em px viram fração dividindo por essas medidas. `preview(layout)`:
 * redesenha a posição durante o gesto; ao soltar, salva pelo host (`saveLayout`). O botão "×" esconde o elemento.
 * Devolve `{ busy() }`.
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
