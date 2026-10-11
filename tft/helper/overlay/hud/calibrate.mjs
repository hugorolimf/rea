/**
 * Modo calibrar: desenha os contornos de TODAS as âncoras (loja, banco, ouro, nível/XP, estágio) sobre o HUD calculado
 * e oferece controles (setas de 1 ou 5 px, escala, arrastar a grade, restaurar, concluir) para alinhá-los com o jogo
 * a olho. Não há captura de tela nem leitura do jogo: a calibração é só um deslocamento e uma escala da grade, salvos
 * pelo host (`saveCalibration`). `calibrationShapes`, `calibrationHtml`, `controlsHtml` e `calibrateAction` são puras.
 */
import { DEFAULT_CALIBRATION, nudgeCalibration } from "./geometry.mjs";

/** Passos das setas em px da tela e da escala (fino e grosso). */
export const STEPS = Object.freeze([1, 5]);
const SCALE_STEPS = { 1: 0.005, 5: 0.02 };
const WHEEL_SCALE = 0.01;
const SAVE_DELAY_MS = 250;

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const px = (v) => `${Math.round((finite(v) ?? 0) * 10) / 10}px`;

/** Contornos a desenhar: `[{ id, kind, label, rect }]` (retângulos de `anchorRects`, em px do palco). */
export function calibrationShapes(rects) {
  const out = [],
    add = (id, kind, label, rect) => {
      if (rect && finite(rect.width) !== null)
        out.push({ id, kind, label, rect });
    };
  if (!rects) return out;
  add("hud", "hud", "HUD", rects.hud);
  (rects.shopCards ?? []).forEach((r, i) =>
    add(`shop-${i + 1}`, "shop", `Loja ${i + 1}`, r),
  );
  (rects.shopNames ?? []).forEach((r, i) =>
    add(`name-${i + 1}`, "name", "", r),
  );
  (rects.bankSlots ?? []).forEach((r, i) =>
    add(`bank-${i + 1}`, "bank", `${i + 1}`, r),
  );
  add("gold", "gold", "Ouro", rects.gold);
  add("level", "level", "Nível", rects.level);
  add("xp", "xp", "XP", rects.xp);
  add("stage", "stage", "Estágio", rects.stage);
  return out;
}

/** HTML dos contornos da grade (camada sem ponteiros; a superfície de arrastar é um nó persistente à parte). */
export function calibrationHtml(rects, ui) {
  const { esc } = ui;
  return calibrationShapes(rects)
    .map(
      (s) =>
        `<div class="cal" data-kind="${esc(s.kind)}" data-id="${esc(s.id)}" style="left:${px(s.rect.x)};top:${px(s.rect.y)};width:${px(s.rect.width)};height:${px(s.rect.height)}">${s.label ? `<span class="cal-tag">${esc(s.label)}</span>` : ""}</div>`,
    )
    .join("");
}

const pct = (v) =>
  `${(Math.round((finite(v) ?? 0) * 10000) / 100).toFixed(2)}%`;

/** HTML dos controles: setas (passo de 1 ou 5 px), escala, valores atuais, restaurar e concluir. */
export function controlsHtml(calibration, step, ui) {
  const { esc, glyph } = ui,
    arrow = (dx, dy, label, g) =>
      `<button type="button" class="hp-btn cal-arrow" data-act="nudge" data-dx="${dx}" data-dy="${dy}" title="${esc(label)}">${g}</button>`;
  return `<header class="hp-head"><b>Calibrar</b><button type="button" class="hp-btn" data-act="cdone">Concluir</button></header><p class="hp-note">Arraste a grade sobre o jogo, gire a roda do mouse para a escala ou use os botões até os contornos casarem com o HUD do TFT.</p><div class="cal-pad">${arrow(0, -1, "Subir a grade", "↑")}${arrow(-1, 0, "Mover a grade para a esquerda", "←")}<button type="button" class="hp-btn cal-step" data-act="cstep" title="Alternar o passo entre 1 e 5 px">${esc(step)} px</button>${arrow(1, 0, "Mover a grade para a direita", "→")}${arrow(0, 1, "Descer a grade", "↓")}</div><div class="hp-row"><span>Escala da grade</span><button type="button" class="hp-btn" data-act="cscale" data-d="-1" title="Diminuir a grade">−</button><output>${esc(pct(calibration.scale))}</output><button type="button" class="hp-btn" data-act="cscale" data-d="1" title="Aumentar a grade">+</button></div><p class="hp-note">Deslocamento: ${esc(pct(calibration.dx))} na horizontal, ${esc(pct(calibration.dy))} na vertical. ${glyph("flag")}</p><div class="hp-row"><button type="button" class="hp-btn" data-act="creset">Restaurar</button></div>`;
}

/**
 * O que um botão dos controles faz: `{ calibration }` (nova calibração), `{ step }`, `{ done: true }` ou null.
 * `data`: `dataset` do botão; `state`: `{ calibration, rects, stage, step }`. As setas movem em px da tela, convertidos
 * em frações do HUD para `nudgeCalibration`.
 */
export function calibrateAction(data, state) {
  const { calibration, rects, stage, step = 1 } = state,
    w = finite(rects?.hud?.width) || finite(stage?.width) || 1920,
    h = finite(rects?.hud?.height) || finite(stage?.height) || 1080;
  switch (data?.act) {
    case "nudge": {
      const dx = Number(data.dx),
        dy = Number(data.dy);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
      return {
        calibration: nudgeCalibration(calibration, {
          dx: (dx * step) / w,
          dy: (dy * step) / h,
        }),
      };
    }
    case "cscale": {
      const d = Number(data.d);
      if (!Number.isFinite(d)) return null;
      return {
        calibration: nudgeCalibration(calibration, {
          dscale: d * (SCALE_STEPS[step] ?? SCALE_STEPS[1]),
        }),
      };
    }
    case "creset":
      return { calibration: { ...DEFAULT_CALIBRATION } };
    case "cstep":
      return { step: step === STEPS[0] ? STEPS[1] : STEPS[0] };
    case "cdone":
      return { done: true };
    default:
      return null;
  }
}

/**
 * Liga a superfície de arrastar e o painel de controles. `surface`: nó persistente sobre o retângulo do HUD (recebe
 * o arrasto e a roda); `panel`: contêiner dos controles; `getState()`: `{ calibration, rects, stage }` atuais (com a
 * prévia, se houver); `preview(cal)`: redesenha com a calibração provisória; `ui`: `{ esc, glyph }`.
 * Devolve `{ render(calibration, ui), busy() }`.
 */
export function mountCalibrate({
  surface,
  panel,
  host,
  getState,
  preview,
  ui,
}) {
  let step = STEPS[0],
    drag = null,
    timer = null,
    last = null;
  const call = (name, ...args) => {
    try {
      if (typeof host?.[name] === "function") host[name](...args);
    } catch {
      // O host revalida; a página não depende da resposta.
    }
  };
  const save = (cal) => {
    last = null;
    clearTimeout(timer);
    timer = null;
    call("saveCalibration", cal);
  };
  panel.dataset.hit = "";
  surface.dataset.hit = "";

  panel.addEventListener("click", (e) => {
    const button =
      e.target instanceof Element ? e.target.closest("[data-act]") : null;
    if (!button) return;
    const result = calibrateAction(
      { ...button.dataset },
      { ...getState(), step },
    );
    if (!result) return;
    if (result.done) call("setCalibrating", false);
    if (result.step) {
      step = result.step;
      panel.dataset.sig = "";
      panel.innerHTML = controlsHtml(getState().calibration, step, ui);
    }
    if (result.calibration) {
      preview(result.calibration);
      save(result.calibration);
    }
  });

  surface.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || drag) return;
    const { calibration, rects, stage } = getState();
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      // Sem captura o arrasto ainda funciona dentro da superfície.
    }
    e.preventDefault();
    drag = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: calibration,
      w: finite(rects?.hud?.width) || stage.width,
      h: finite(rects?.hud?.height) || stage.height,
      cal: null,
    };
  });
  surface.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.cal = nudgeCalibration(drag.start, {
      dx: (e.clientX - drag.x) / drag.w,
      dy: (e.clientY - drag.y) / drag.h,
    });
    preview(drag.cal);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const cal = drag.cal;
    drag = null;
    if (cal) save(cal);
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    surface.addEventListener(type, end);
  surface.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const base = last ?? getState().calibration;
      last = nudgeCalibration(base, {
        dscale: e.deltaY < 0 ? WHEEL_SCALE : -WHEEL_SCALE,
      });
      preview(last);
      clearTimeout(timer);
      const cal = last;
      timer = setTimeout(() => save(cal), SAVE_DELAY_MS);
    },
    { passive: false },
  );

  return {
    busy: () => drag !== null,
    render(calibration, renderUi = ui) {
      const html = controlsHtml(calibration, step, renderUi);
      if (panel.dataset.sig !== html) {
        panel.dataset.sig = html;
        panel.innerHTML = html;
      }
    },
  };
}
