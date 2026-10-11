// Rodar com: node --test tft/helper/tests/overlay-keys.test.mjs
// Legenda de atalhos e "Copiar comp" do overlay (overlay/hud/hotkeys.mjs, keys.mjs, layout `keys`), as regiões quentes
// que o processo principal confere (config.mjs) e o recarregamento automático (dev-reload.mjs). Nada aqui abre o
// Electron, o jogo ou o servidor.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { read, stripNonCode } from "./architecture/scan.mjs";
import { realCatalog } from "../v2/js/catalog-fixture.mjs";
import { buildModel } from "../v2/js/model.js";
import { planView } from "../v2/js/plan.js";
import { PART_STATE, nextItemRecipe } from "../v2/js/next-item.js";
import { buildStates } from "../v2/js/item-source.js";
import {
  DEFAULT_HOTKEYS,
  HOT_LIMITS,
  IDLE_UI,
  buildMode,
  cursorInHotRects,
  defaultConfig,
  isTeamCode,
  mouseIgnore,
  parseConfig,
  parseHotRects,
} from "../overlay/config.mjs";
import {
  MIN_APPLY_INTERVAL_MS,
  RELAUNCH_DEBOUNCE_MS,
  RELOAD_DEBOUNCE_MS,
  checkMainGraph,
  classifyChange,
  createApplyGate,
  createChangeBatcher,
  isWatchedFile,
  localImportGraph,
  namedLocalImports,
  relativeImports,
} from "../overlay/dev-reload.mjs";
import { anchorRects } from "../overlay/hud/geometry.mjs";
import { keepOutRects, wantedRect, stageFrame } from "../overlay/hud/fit.mjs";
import { helpHtml } from "../overlay/hud/help.mjs";
import {
  HOTKEY_ACTIONS,
  HOTKEY_IDS,
  commonModifiers,
  keyText,
  parseShortcuts,
  shortcutList,
} from "../overlay/hud/hotkeys.mjs";
import {
  COPIED_TEXT,
  COPY_FLASH_MS,
  keysHtml,
  teamCodeState,
} from "../overlay/hud/keys.mjs";
import {
  DEFAULT_LAYOUT,
  moveElement,
  parseLayout,
  resetLayout,
  resizeElement,
  setFolded,
  setHidden,
} from "../overlay/hud/layout.mjs";
import { overlayView } from "../overlay/hud/view.mjs";
import { healthOf } from "../overlay/hud/health.mjs";
import { normalizeMode } from "../overlay/hud/widgets.mjs";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const glyph = () => "";
/** Código medido numa partida real (PLANO-OVERLAY-RAPIDO 4.1). */
const MEASURED = "023f13fa4144234383f340f419000000TFTSet18";

/** O que a página recebe do host: o Mode montado pelo main, normalizado pela página. */
const pageMode = (cfg, status) =>
  normalizeMode(
    JSON.parse(
      JSON.stringify(
        buildMode({
          ui: { interactive: true, help: true, calibrating: false },
          cfg,
          game: { found: true, width: 1920, height: 1080 },
          hotkeyStatus: status,
        }),
      ),
    ),
  );

/* ---------- Lista única de atalhos ---------- */

test("atalhos: uma lista só (ids, padrão e rótulos) para o registro, a legenda e a ajuda", () => {
  assert.deepEqual(
    HOTKEY_ACTIONS.map((a) => a.id).sort(),
    [...HOTKEY_IDS].sort(),
    "toda ação com atalho tem rótulo e vice-versa",
  );
  assert.equal(DEFAULT_HOTKEYS.copyComp, "Control+Shift+F6");
  assert.equal(defaultConfig().hotkeys.copyComp, "Control+Shift+F6");
  for (const a of HOTKEY_ACTIONS) {
    assert.ok(a.label.length > 3 && a.short.length > 2, a.id);
    assert.ok(Object.isFrozen(a), a.id);
  }
  // O main registra percorrendo exatamente esta lista e guarda o resultado de cada um para a página.
  const main = stripNonCode(read("overlay/main.mjs"), { keepStrings: true });
  assert.match(main, /for \(const \{ id: name \} of HOTKEY_ACTIONS\)/);
  assert.match(main, /hotkeyStatus\[name\] = ok/);
  assert.match(
    main,
    /buildMode\(\{ ui, cfg, game: gameState\(\), hotkeyStatus \}\)/,
  );
  // A página não escreve teclas: nenhuma "F6".."F12" literal no HUD fora da lista única.
  for (const f of fs.readdirSync(new URL("../overlay/hud/", import.meta.url))) {
    if (!f.endsWith(".mjs") || f === "hotkeys.mjs") continue;
    const code = stripNonCode(read(`overlay/hud/${f}`), { keepStrings: true });
    assert.ok(
      !/["'`][^"'`]*\bF(?:6|7|8|9|10|11|12)\b/.test(code),
      `${f} escreve uma tecla`,
    );
  }
});

test("atalhos: a legenda mostra a lista registrada pelo main, com as teclas configuradas", () => {
  const cfg = parseConfig({ hotkeys: { toggle: "Control+Shift+F5" } });
  const status = Object.fromEntries(HOTKEY_IDS.map((id) => [id, true]));
  const mode = pageMode(cfg, status);
  assert.deepEqual(mode.shortcuts, shortcutList(cfg.hotkeys, status));
  const html = keysHtml({
    shortcuts: mode.shortcuts,
    copy: teamCodeState(null),
    esc,
  });
  // Compacta: Ctrl+Shift escrito uma vez; cada atalho é só a tecla final e o ícone, na ordem da lista; o significado
  // (rótulo e atalho inteiro) vai na dica do mouse.
  assert.match(
    html,
    /<li class="keys-pre"[^>]*><kbd>Ctrl\+Shift<\/kbd>\+<\/li>/,
  );
  let at = -1;
  for (const s of mode.shortcuts) {
    const row = `<kbd>${esc(s.accelerator.split("+").pop())}</kbd><i aria-label="${esc(s.short)}">${esc(s.icon)}</i>`;
    const i = html.indexOf(row);
    assert.ok(i > at, `${s.id}: linha ausente ou fora de ordem`);
    at = i;
    assert.ok(s.icon && s.icon.length <= 2, `${s.id}: ícone curto`);
  }
  assert.match(
    html,
    /title="Mostrar ou ocultar o overlay: Ctrl\+Shift\+F5"><kbd>F5<\/kbd><i aria-label="Mostrar\/ocultar">◐<\/i>/,
  );
  assert.ok(!/✖/.test(html));
  // A ajuda usa a mesma lista (tecla do registro, rótulo longo).
  const help = helpHtml(mode, healthOf(null, {}), { esc, glyph });
  for (const s of mode.shortcuts)
    assert.ok(
      help.includes(`<kbd>${esc(s.accelerator)}</kbd><span>${esc(s.label)}`),
      s.id,
    );
});

test("atalhos: o que falhou ao registrar aparece marcado na legenda (aberta e recolhida) e na ajuda", () => {
  const cfg = defaultConfig();
  const status = Object.fromEntries(HOTKEY_IDS.map((id) => [id, true]));
  status.copyComp = false;
  const mode = pageMode(cfg, status);
  const open = keysHtml({
    shortcuts: mode.shortcuts,
    copy: teamCodeState(null),
    esc,
  });
  assert.match(
    open,
    /<li data-ok="0" data-id="copyComp"[^>]*title="[^"]*já está em uso[^"]*"><kbd>F6<\/kbd><i aria-label="Copiar comp">⧉<\/i><b class="keys-fail">✖<\/b><\/li>/,
  );
  assert.equal((open.match(/data-ok="0"/g) ?? []).length, 1, "só o que falhou");
  assert.match(open, /<b class="keys-failn"[^>]*>1✖<\/b>/);
  const folded = keysHtml({
    shortcuts: mode.shortcuts,
    folded: true,
    copy: teamCodeState(null),
    esc,
  });
  assert.ok(!folded.includes("keys-list"), "recolhida: sem a lista");
  assert.match(folded, /1✖/, "recolhida: a falha continua visível");
  const help = helpHtml(mode, healthOf(null, {}), { esc, glyph });
  assert.match(
    help,
    /data-ok="0"[^>]*><kbd>Control\+Shift\+F6<\/kbd><span>[^<]*<b>\(falhou: tecla em uso\)<\/b>/,
  );
});

test("atalhos: host antigo sem lista deriva das teclas; registro ainda não tentado fica neutro", () => {
  const list = parseShortcuts(undefined, { toggle: "Control+Shift+F9" });
  assert.equal(list.length, HOTKEY_ACTIONS.length);
  assert.equal(list[0].accelerator, "Control+Shift+F9");
  assert.ok(list.every((s) => s.ok === null));
  assert.equal(list.find((s) => s.id === "copyComp").accelerator, "");
  const html = keysHtml({ shortcuts: list, copy: teamCodeState(null), esc });
  assert.match(
    html,
    /data-id="copyComp" title="[^"]*sem atalho[^"]*"><kbd>—<\/kbd><i aria-label="Copiar comp">⧉<\/i>/,
  );
  // Lixo do host não lança e não inventa ids.
  const junk = parseShortcuts(
    [null, 5, { id: "x" }, { id: "toggle", accelerator: 7, ok: "sim" }],
    {},
  );
  assert.deepEqual(
    junk.map((s) => s.id),
    HOTKEY_ACTIONS.map((a) => a.id),
  );
  assert.equal(junk[0].accelerator, "");
  assert.equal(junk[0].ok, null);
  // Teclas escapadas e modificadores diferentes: cada linha com o atalho inteiro.
  assert.equal(keyText("CommandOrControl+Alt+k"), "Ctrl+Alt+K");
  assert.equal(
    commonModifiers([{ accelerator: "Control+F1" }, { accelerator: "Alt+F2" }]),
    "",
  );
  const evil = keysHtml({
    shortcuts: parseShortcuts(
      [{ id: "toggle", accelerator: "Control+<b>", ok: true }],
      {},
    ),
    copy: teamCodeState(null),
    esc,
  });
  assert.ok(!evil.includes("<b>x") && !evil.includes("<kbd><b>"), "escapado");
});

/* ---------- Copiar comp ---------- */

const catalog = realCatalog();
const deps = {
  buildModel,
  planView,
  nextItemRecipe,
  partState: PART_STATE,
  buildStates,
  catalogItems: catalog.items,
};
const BASE = JSON.parse(
  fs.readFileSync(new URL("../live-mock-base.json", import.meta.url), "utf8"),
);
const liveView = (mutate = () => {}) => {
  const state = structuredClone(BASE.state),
    rec = structuredClone(BASE.rec);
  // Partida ao vivo, como no overlay-hud.test (liveInput).
  state.screen = {
    running: true,
    stage: "4-2",
    gold: 54,
    level: 8,
    xp: "23/68",
    items: [],
  };
  Object.assign(state, {
    actionable: true,
    sameGame: true,
    phase: "InProgress",
    ageSeconds: 3,
  });
  rec.metadata.actionable = true;
  rec.self.health = 58;
  mutate(rec);
  return overlayView(
    {
      unchanged: false,
      rev: "1",
      state: { at: 0, ageMs: 500, body: state },
      recommendation: { at: 0, ageMs: 800, body: rec },
    },
    { catalogReady: true, now: 10_000, receivedAt: 10_000, deps },
  );
};

test("copiar comp: o botão copia plan.teamCode da comp exibida, que o overlay já recebe em /api/overlay", () => {
  const v = liveView();
  assert.equal(v.status, "ready");
  const expected = BASE.rec.recommendations[0].teamCode.code;
  assert.ok(
    isTeamCode(expected),
    "o código da base tem o formato do planejador",
  );
  assert.equal(v.plan.teamCode, expected);
  const tc = teamCodeState(v);
  assert.equal(tc.code, expected);
  assert.equal(tc.reason, null);
  const html = keysHtml({
    shortcuts: shortcutList(DEFAULT_HOTKEYS, {}),
    copy: tc,
    esc,
  });
  assert.match(
    html,
    /<button type="button" class="keys-copy" data-hot data-hit data-act="copy-comp" aria-disabled="false" title="[^"]*\(Ctrl\+Shift\+F6\)">⧉ Copiar<\/button>/,
  );
  // Retorno depois de copiar: aria-live, 1,5 s.
  assert.equal(COPY_FLASH_MS, 1500);
  const done = keysHtml({
    shortcuts: [],
    copy: tc,
    flash: { text: COPIED_TEXT, tone: "ok" },
    esc,
  });
  assert.match(
    done,
    /<p class="keys-flash" role="status" aria-live="polite" data-tone="ok">Copiado: cole no Planejador<\/p>/,
  );
});

test("copiar comp: sem código o botão fica apagado e o clique ou o atalho explicam o motivo", () => {
  const err = "Campeão sem ID de importação confirmado: DA_X";
  const v = liveView((rec) => {
    for (const p of rec.recommendations)
      p.teamCode = { code: null, error: err };
  });
  const tc = teamCodeState(v);
  assert.deepEqual([tc.code, tc.reason], [null, err]);
  const html = keysHtml({ shortcuts: [], copy: tc, esc });
  // Apagado (aria-disabled) mas clicável: o clique mostra o motivo; o texto fica fora da tela padrão (dica do mouse).
  assert.match(
    html,
    /<button type="button" class="keys-copy" data-hot data-hit data-act="copy-comp" aria-disabled="true" title="Sem código para copiar: Campeão sem ID/,
  );
  assert.ok(
    !html.includes('<p class="keys-why"'),
    "motivo não ocupa a tela parada",
  );
  const shown = keysHtml({
    shortcuts: [],
    copy: tc,
    flash: { text: tc.reason, tone: "warn" },
    esc,
  });
  assert.match(
    shown,
    /data-tone="warn">Campeão sem ID de importação confirmado: DA_X<\/p>/,
  );
  // A página só chama o host com código; sem ele mostra o motivo por 2 s.
  const hud = stripNonCode(read("overlay/hud/hud.mjs"), { keepStrings: true });
  assert.match(
    hud,
    /if \(!tc\.code\) return flashCopy\(tc\.reason, "warn", COPY_ERROR_MS\);/,
  );
  // Sem plano: o motivo vem do estado da tela.
  assert.equal(
    teamCodeState({ status: "idle", plan: null }).reason,
    "Sem comp sugerida agora.",
  );
  assert.match(teamCodeState({ status: "ended" }).reason, /Partida encerrada/);
  assert.match(teamCodeState(null).reason, /\S/);
  assert.equal(teamCodeState({ plan: { teamCode: "" } }).code, null);
});

test("copiar comp: o main só grava código bem formado; a página não usa navigator.clipboard", () => {
  assert.equal(isTeamCode(MEASURED), true);
  for (const bad of [
    "",
    null,
    42,
    "FFFF0000000000000000000000000000TFTSet18",
    `${MEASURED} `,
    "023f13fa4144234383f340f41900000TFTSet18",
    "javascript:alert(1)",
    `02${"0".repeat(30)}TFTSet18; rm -rf`,
  ])
    assert.equal(isTeamCode(bad), false, String(bad));
  for (const f of [
    "hud/hud.mjs",
    "hud/keys.mjs",
    "hud/widgets.mjs",
    "preload.cjs",
  ]) {
    const code = stripNonCode(read(`overlay/${f}`), { keepStrings: true });
    assert.ok(!/navigator\.clipboard|execCommand/.test(code), f);
  }
  const main = stripNonCode(read("overlay/main.mjs"), { keepStrings: true });
  assert.match(main, /if \(!isTeamCode\(code\)\)/);
  assert.match(main, /clipboard\.writeText\(code\)/);
  // O atalho global pede à página, que copia pelo mesmo caminho do botão.
  const hud = stripNonCode(read("overlay/hud/hud.mjs"), { keepStrings: true });
  assert.match(hud, /onCopyRequest\?\.\(\(\) => void copyComp\(\)\)/);
  assert.match(hud, /"copy-comp"\) void copyComp\(\)/);
});

/* ---------- Regiões quentes (só o botão recebe clique fora do modo interativo) ---------- */

test("regiões quentes: fora do interativo só o botão captura, e só com o cursor dentro dele", () => {
  for (const mode of ["integrated", "panel"]) {
    assert.equal(
      mouseIgnore({ interactive: false, mode, hotCapture: true }),
      false,
      mode,
    );
    assert.equal(
      mouseIgnore({ interactive: false, mode, hotCapture: false }),
      true,
      mode,
    );
    assert.equal(
      mouseIgnore({ interactive: false, mode, pageCapture: true }),
      true,
      mode,
    );
  }
  // Modo de edição: a janela inteira captura (com ou sem região quente); ao sair, volta o click-through.
  assert.equal(
    mouseIgnore({ interactive: true, mode: "integrated", hotCapture: true }),
    false,
  );
  assert.equal(mouseIgnore({ interactive: true, mode: "integrated" }), false);
  assert.equal(mouseIgnore({ interactive: false, mode: "integrated" }), true);
  const rects = parseHotRects([{ x: 100, y: 200, width: 120, height: 30 }]);
  const bounds = { x: 1000, y: 50, width: 1920, height: 1080 };
  assert.equal(cursorInHotRects({ x: 1150, y: 260 }, bounds, 1, rects), true);
  assert.equal(cursorInHotRects({ x: 1150, y: 300 }, bounds, 1, rects), false);
  assert.equal(cursorInHotRects({ x: 1050, y: 260 }, bounds, 1, rects), false);
  // Painel com zoom 1,5: px CSS x 1,5 = DIP.
  assert.equal(
    cursorInHotRects(
      { x: 1000 + 150 * 1.5, y: 50 + 210 * 1.5 },
      bounds,
      1.5,
      rects,
    ),
    true,
  );
  assert.equal(cursorInHotRects(null, bounds, 1, rects), false);
  assert.equal(cursorInHotRects({ x: 1150, y: 260 }, bounds, 1, []), false);
});

test("regiões quentes: seguem o cursor REAL no main (não o movimento encaminhado à página); Esc só no modo de edição", () => {
  const main = stripNonCode(read("overlay/main.mjs"), { keepStrings: true });
  const sync = /function syncHot\(\) \{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
  assert.match(
    sync,
    /hotRects\.length > 0 && !ui\.interactive && alive\(\) && win\.isVisible\(\)/,
  );
  assert.ok(!/hotWanted/.test(sync), "não depende do aviso da página");
  assert.match(
    main,
    /screen\.getCursorScreenPoint\(\),\s*win\.getContentBounds\(\)/,
  );
  assert.match(main, /globalShortcut\.register\("Escape"/);
  assert.match(main, /globalShortcut\.unregister\("Escape"\)/);
  assert.match(main, /"captura: janela inteira \(modo de edição\)"/);
  assert.match(main, /"captura: liberada/);
});

test("modo de edição: aviso no topo com a tecla registrada; some fora dele", async () => {
  const { editBannerHtml } = await import("../overlay/hud/keys.mjs");
  const mode = pageMode(defaultConfig(), {});
  assert.equal(mode.interactive, true);
  const html = editBannerHtml(mode, esc);
  assert.match(html, /Modo de edição/);
  assert.match(html, /Ctrl\+Shift\+F10 ou Esc para voltar ao jogo/);
  assert.match(html, /cliques não vão para o jogo/);
  assert.equal(editBannerHtml({ ...mode, interactive: false }, esc), "");
  assert.equal(editBannerHtml({ ...mode, mode: "panel" }, esc), "");
});

test("regiões quentes: a página declara poucas e pequenas; lixo vira nada", () => {
  for (const junk of [undefined, null, "x", 5, {}, [null, "a", { x: "1" }]])
    assert.deepEqual(parseHotRects(junk), [], String(junk));
  const many = Array.from({ length: 10 }, (_, i) => ({
    x: i,
    y: 0,
    width: 5000,
    height: 5000,
  }));
  const out = parseHotRects(many);
  assert.equal(out.length, HOT_LIMITS.count);
  assert.ok(
    out.every(
      (r) => r.width <= HOT_LIMITS.width && r.height <= HOT_LIMITS.height,
    ),
  );
  assert.deepEqual(parseHotRects([{ x: 0, y: 0, width: 0, height: 10 }]), []);
  assert.equal(IDLE_UI.interactive, false);
});

/* ---------- Layout: legenda recolhível, salva no layout, fora da loja e do centro ---------- */

test("layout keys: recolher é salvo no layout e sobrevive a mover, redimensionar e esconder", () => {
  assert.equal(DEFAULT_LAYOUT.keys.folded, false);
  assert.equal(DEFAULT_LAYOUT.keys.hidden, false);
  const folded = setFolded(resetLayout(), "keys", true);
  assert.equal(folded.keys.folded, true);
  assert.equal(
    parseLayout(JSON.parse(JSON.stringify(folded))).keys.folded,
    true,
  );
  assert.equal(parseLayout({ keys: { folded: "sim" } }).keys.folded, false);
  const stage = { width: 1920, height: 1080 };
  assert.equal(moveElement(folded.keys, 30, -40, stage, 100).folded, true);
  assert.equal(resizeElement(folded.keys, 20, stage).folded, true);
  assert.equal(setHidden(folded, "keys", true).keys.folded, true);
  // Só a legenda tem o campo; os outros elementos continuam iguais.
  assert.equal("folded" in parseLayout(undefined).bar, false);
  assert.deepEqual(setFolded(resetLayout(), "bar", true), resetLayout());
});

test("layout keys: o padrão não cobre a loja, o banco, o ouro, as cartas de aprimoramento nem o carrossel", () => {
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 2560, height: 1080 },
    { width: 1600, height: 1200 },
  ]) {
    const frame = stageFrame(size);
    const k = frame.hud.height / 1080;
    // Altura da legenda aberta (~140 px a 1080p) escalada.
    const r = wantedRect("keys", DEFAULT_LAYOUT.keys, frame, k, 140 * k);
    const overlap = (a, b) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
    for (const z of keepOutRects(anchorRects(size)))
      assert.ok(
        !overlap(r, z),
        `${size.width}x${size.height}: cobre ${JSON.stringify(z)}`,
      );
    // Cartas de aprimoramento e carrossel: o centro do HUD (x de ~20% a ~78%).
    const h = frame.hud;
    const center = {
      x: h.x + 0.2 * h.width,
      y: h.y + 0.15 * h.height,
      width: 0.58 * h.width,
      height: 0.7 * h.height,
    };
    assert.ok(
      !overlap(r, center),
      `${size.width}x${size.height}: cobre o centro`,
    );
  }
});

/* ---------- Recarregamento automático ---------- */

test("recarregar: rajada de mudanças vira um só recarregamento, depois da espera", () => {
  const timers = [];
  let now = 0;
  const flushed = [];
  const FAST = 400,
    SLOW = 1200;
  const b = createChangeBatcher({
    onFlush: (batch) => flushed.push(batch),
    reloadDelay: FAST,
    relaunchDelay: SLOW,
    setTimer: (fn, ms) => {
      const t = { fn, at: now + ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.live = false;
    },
  });
  const advance = (ms) => {
    now += ms;
    for (const t of timers)
      if (t.live && t.at <= now) {
        t.live = false;
        t.fn();
      }
  };
  // Os padrões exigem silêncio de verdade: vários agentes gravam em rajadas.
  assert.ok(RELOAD_DEBOUNCE_MS >= 3000 && RELAUNCH_DEBOUNCE_MS >= 3000);
  b.push("reload", "a.css");
  advance(FAST - 1);
  b.push("reload", "b.mjs");
  advance(FAST - 1);
  assert.equal(flushed.length, 0, "cada mudança reinicia a espera");
  advance(1);
  assert.deepEqual(flushed, [
    { kind: "reload", config: false, files: ["a.css", "b.mjs"] },
  ]);
  // Código do main no meio da rajada: vira reinício, com a espera mais longa.
  b.push("reload", "c.css");
  b.push("relaunch", "main.mjs");
  advance(FAST + 1);
  assert.equal(flushed.length, 1);
  advance(SLOW);
  assert.deepEqual(flushed[1], {
    kind: "relaunch",
    config: false,
    files: ["c.css", "main.mjs"],
  });
  b.push("config", "overlay.config.json");
  advance(SLOW);
  assert.deepEqual(flushed[2], {
    kind: "relaunch",
    config: true,
    files: ["overlay.config.json"],
  });
  b.push("reload", "x.css");
  b.cancel();
  advance(10_000);
  assert.equal(flushed.length, 3, "cancelado não dispara");
  b.push("nada", "y");
  assert.equal(b.pending(), false);
});

test("recarregar: nada recarrega com o usuário mexendo no overlay; depois sai UMA vez; no máximo 1 a cada 10 s", () => {
  let now = 0,
    busy = false;
  const timers = [];
  const ran = [];
  const deferred = [];
  const gate = createApplyGate({
    run: (b) => ran.push(b),
    isBlocked: () => busy,
    onDefer: (b) => deferred.push(b.files.length),
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, at: now + ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.live = false;
    },
  });
  const advance = (ms) => {
    now += ms;
    for (const t of timers)
      if (t.live && t.at <= now) {
        t.live = false;
        t.fn();
      }
  };
  assert.equal(MIN_APPLY_INTERVAL_MS, 10000);
  gate.request({ kind: "reload", files: ["a.css"] });
  assert.equal(ran.length, 1, "livre: aplica já");
  // Modo interativo (ou arraste): acumula, não aplica, avisa uma vez.
  busy = true;
  now += 20000;
  gate.request({ kind: "reload", files: ["b.mjs"] });
  gate.request({ kind: "reload", files: ["c.mjs", "b.mjs"] });
  gate.retry();
  advance(60000);
  assert.equal(ran.length, 1, "nada durante o interativo");
  assert.deepEqual(deferred, [1], "um aviso só no log");
  busy = false;
  gate.retry();
  assert.equal(ran.length, 2, "saiu do interativo: aplica uma vez");
  assert.deepEqual(ran[1], {
    kind: "reload",
    config: false,
    files: ["b.mjs", "c.mjs"],
  });
  // Logo depois: espera completar 10 s desde a última.
  gate.request({ kind: "reload", files: ["d.css"] });
  gate.request({ kind: "relaunch", config: true, files: ["main.mjs"] });
  advance(9999);
  assert.equal(ran.length, 2);
  advance(1);
  assert.equal(ran.length, 3);
  assert.deepEqual(ran[2], {
    kind: "relaunch",
    config: true,
    files: ["d.css", "main.mjs"],
  });
  assert.equal(gate.pending(), null);
});

test("recarregar: o main adia recarga e reinício enquanto o usuário arrasta ou está no interativo/ajuda/calibração", () => {
  const main = stripNonCode(read("overlay/main.mjs"), { keepStrings: true });
  assert.match(
    main,
    /ui\.interactive \|\| ui\.help \|\| ui\.calibrating \|\| gesture !== null/,
  );
  assert.match(main, /isBlocked: userBusy/);
  // Ao sair desses modos (applyUi) e ao terminar o arraste do painel (stopGesture), tenta de novo.
  assert.ok((main.match(/applyGate\?\.retry\(\)/g) ?? []).length >= 2);
  // A recarga não mexe no estado de interação nem no layout: o main os reenvia quando a página carrega.
  assert.match(main, /wc\.on\("did-finish-load", \(\) => \{\s*reapply\(\);/);
  // Página nova: o click-through com encaminhamento do mouse é armado de novo (sem isso, depois de uma recarga a página
  // não recebe o movimento, nunca pede captura e os cliques do modo interativo vão para o jogo).
  assert.match(main, /const reapply = \(\) => \{[\s\S]{0,200}rearmIgnore\(\);/);
  assert.match(
    main,
    /function rearmIgnore\(\) \{[\s\S]{0,120}appliedIgnore = null;\s*applyIgnore\(\);/,
  );
  // Diagnóstico: alternância do interativo e cada mudança de captura vão ao log.
  assert.match(main, /log\(\s*`modo: interativo=/);
  assert.match(main, /"captura: liberada/);
  // Reinício automático do Electron: desligado por padrão.
  assert.match(
    main,
    /process\.env\.TFT_OVERLAY_RELAUNCH === "1" \|\| cfg\?\.devReload === true/,
  );
  assert.equal(defaultConfig().devReload, false, "opt-in");
  // Partida em andamento (janela do jogo presente): nenhuma recarga nem reinício; ao sumir o jogo, sai a adiada.
  assert.match(main, /gameRect !== null\s*\?\s*"partida em andamento"/);
  assert.match(
    main,
    /function onGameLost\(\) \{[\s\S]{0,200}applyGate\?\.retry\(\);/,
  );
  assert.match(main, /`recarga adiada: \$\{why\}/);
  assert.ok(
    !/ui = \{ \.\.\.IDLE_UI \};[\s\S]{0,200}reloadIgnoringCache/.test(main),
  );
});

test("recarregar: HUD/v2/core recarregam a página; código do main e preload reiniciam; o resto é ignorado", () => {
  const root = path.resolve("/helper");
  const ov = path.join(root, "overlay");
  const opts = {
    mainFiles: [
      path.join(ov, "main.mjs"),
      path.join(ov, "hud", "layout.mjs"),
      path.join(ov, "preload.cjs"),
    ],
    configFile: path.join(ov, "overlay.config.json"),
    pageRoots: [
      path.join(ov, "hud"),
      path.join(root, "v2"),
      path.join(root, "core"),
    ],
  };
  const c = (...p) => classifyChange(path.join(...p), opts);
  assert.equal(c(ov, "hud", "hud.css"), "reload");
  assert.equal(c(ov, "hud", "keys.mjs"), "reload");
  assert.equal(c(root, "v2", "js", "model.js"), "reload");
  assert.equal(c(root, "core", "items", "holdings.mjs"), "reload");
  assert.equal(
    c(ov, "hud", "layout.mjs"),
    "relaunch",
    "o main importa: só vale num processo novo",
  );
  assert.equal(c(ov, "main.mjs"), "relaunch");
  assert.equal(c(ov, "preload.cjs"), "relaunch");
  assert.equal(c(ov, "overlay.config.json"), "config");
  assert.equal(c(ov, "overlay.log"), null);
  assert.equal(c(ov, "overlay.config.json.123.1.tmp"), null);
  assert.equal(c(root, "v2", "js", "model.test.mjs"), null);
  assert.equal(
    c(root, "server.mjs"),
    null,
    "código do servidor não é do overlay",
  );
  assert.equal(c(root, "app", "overlay-feed.mjs"), null);
  assert.equal(c(ov, "node_modules", "electron", "index.js"), null);
  assert.equal(isWatchedFile(path.join(ov, "hud", ".swp.mjs")), false);
});

test("recarregar: o grafo de imports do main vem do código (e ignora imports citados em comentários)", () => {
  const files = {
    "/o/main.mjs":
      'import { app } from "electron";\nimport { a } from "./config.mjs";\n// import { z } from "./fantasma.mjs";\n/* import("./outro.mjs") */\nimport "./side.mjs";',
    "/o/config.mjs":
      'export { b } from "./hud/layout.mjs";\nimport fs from "node:fs";',
    "/o/hud/layout.mjs": "export const b = 1;",
    "/o/side.mjs": 'const m = import("./lazy.mjs");',
    "/o/lazy.mjs": "",
  };
  const readFile = (f) => {
    const key = f.replace(/\\/g, "/").replace(/^\w:/, "");
    if (!(key in files)) throw new Error("ENOENT");
    return files[key];
  };
  const graph = localImportGraph("/o/main.mjs", readFile).map((f) =>
    f.replace(/\\/g, "/").replace(/^\w:/, ""),
  );
  assert.deepEqual(graph.sort(), [
    "/o/config.mjs",
    "/o/hud/layout.mjs",
    "/o/lazy.mjs",
    "/o/main.mjs",
    "/o/side.mjs",
  ]);
  assert.deepEqual(relativeImports('export const x = "./nao.mjs";'), []);
  assert.deepEqual(
    namedLocalImports('import {\n  a,\n  b as c,\n} from "./m.mjs";'),
    [{ spec: "./m.mjs", names: ["a", "b"] }],
  );
  // O grafo real do main: os módulos puros do HUD que ele importa estão lá (mudar um deles reinicia o Electron).
  const mainFile = new URL("../overlay/main.mjs", import.meta.url);
  const real = localImportGraph(
    path.resolve(
      decodeURIComponent(mainFile.pathname).replace(/^\/(\w:)/, "$1"),
    ),
    (f) => fs.readFileSync(f, "utf8"),
  ).map((f) => path.basename(f));
  for (const f of [
    "main.mjs",
    "config.mjs",
    "layout.mjs",
    "hotkeys.mjs",
    "dev-reload.mjs",
  ])
    assert.ok(real.includes(f), f);
  assert.ok(
    !real.includes("hud.mjs") && !real.includes("keys.mjs"),
    "o HUD da página só recarrega",
  );
});

test("recarregar: código novo que não carrega não reinicia o Electron", async () => {
  const dir = fs.mkdtempSync(
    path.join((await import("node:os")).tmpdir(), "ovl-check-"),
  );
  try {
    const good = path.join(dir, "good.mjs"),
      bad = path.join(dir, "bad.mjs"),
      entry = path.join(dir, "main.mjs"),
      pre = path.join(dir, "pre.cjs");
    fs.writeFileSync(good, "export const a = 1;\n");
    fs.writeFileSync(bad, "export const x = ;\n");
    fs.writeFileSync(
      entry,
      'import { app } from "electron";\nimport { a, falta } from "./good.mjs";\n',
    );
    fs.writeFileSync(pre, 'const { contextBridge } = require("electron");\n');
    const okSpawn = () => ({ status: 0, stderr: "" });
    const problems = await checkMainGraph(entry, [good, bad, pre], {
      spawnSync: okSpawn,
      execPath: "node",
      vm,
    });
    assert.equal(problems.length, 2, problems.join("\n"));
    assert.match(problems[0], /não exporta falta/);
    assert.match(problems[1], /bad\.mjs/);
    assert.deepEqual(
      await checkMainGraph(null, [good, pre], {
        spawnSync: okSpawn,
        execPath: "node",
        vm,
      }),
      [],
    );
    const syntax = await checkMainGraph(entry, [], {
      spawnSync: () => ({ status: 1, stderr: "SyntaxError: x" }),
      execPath: "node",
      vm,
    });
    assert.match(syntax[0], /SyntaxError/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recarregar: o main confere o código novo antes de reiniciar e não grava por cima de config editada por fora", () => {
  const main = stripNonCode(read("overlay/main.mjs"), { keepStrings: true });
  assert.match(
    main,
    /const problems = await checkNewCode\(mainFiles\);\s*if \(problems\.length\)/,
  );
  assert.match(main, /app\.relaunch\(\{ args: \[here\] \}\)/);
  assert.match(main, /reloadIgnoringCache\(\)/);
  assert.match(main, /if \(keepConfigFile\) \{/);
  assert.match(main, /TFT_OVERLAY_WATCH === "0"/);
  // Nada de reiniciar o servidor nem pedir análise.
  assert.ok(!/\/api\/recommend|3218.*kill|taskkill/i.test(main));
});

/* ---------- Estabilidade: sonda do servidor e migração dos padrões ---------- */

test("sonda: timeout isolado não troca a página; 3 seguidos marcam fora do ar sem trocar o HUD; porta fechada é imediato", async () => {
  const { OFFLINE_AFTER_FAILS, PROBE_TIMEOUT_MS, probeResult, probeStep } =
    await import("../overlay/probe.mjs");
  assert.ok(
    PROBE_TIMEOUT_MS >= 6000,
    "maior que os picos de loop-lag em partida",
  );
  assert.equal(OFFLINE_AFTER_FAILS, 3);
  // Classificação do erro do fetch (undici).
  const refused = Object.assign(new TypeError("fetch failed"), {
    cause: { code: "ECONNREFUSED" },
  });
  assert.equal(probeResult(refused), "refused");
  assert.equal(probeResult(new DOMException("t", "TimeoutError")), "timeout");
  assert.equal(
    probeResult(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "UND_ERR_SOCKET" },
      }),
    ),
    "timeout",
  );
  assert.equal(probeResult(null, { ok: true }), "ok");
  assert.equal(probeResult(null, { ok: false }), "bad");
  // HUD carregado: timeouts nunca trocam a página.
  let s = { fails: 0, down: false, hudLoaded: true };
  for (let i = 1; i <= 5; i++) {
    const n = probeStep(s, "timeout");
    assert.equal(n.action, "none", `timeout ${i}`);
    assert.equal(n.down, i >= 3, `fora do ar só a partir do 3º (${i})`);
    s = { ...s, ...n };
  }
  // Volta na primeira resposta boa, sem recarregar a página já carregada.
  assert.deepEqual(probeStep(s, "ok"), {
    fails: 0,
    down: false,
    action: "none",
  });
  // Porta fechada: fora do ar na hora, mas o HUD carregado continua.
  assert.equal(
    probeStep({ fails: 0, down: false, hudLoaded: true }, "refused").down,
    true,
  );
  assert.equal(
    probeStep({ fails: 0, down: false, hudLoaded: true }, "refused").action,
    "none",
  );
  // HUD nunca carregado: porta fechada mostra offline.html; um timeout isolado não.
  assert.equal(
    probeStep({ fails: 0, hudLoaded: false }, "refused").action,
    "show-offline",
  );
  assert.equal(
    probeStep({ fails: 0, hudLoaded: false }, "timeout").action,
    "none",
  );
  assert.equal(
    probeStep({ fails: 0, hudLoaded: false, showingOffline: true }, "refused")
      .action,
    "none",
    "já está no aviso",
  );
  assert.equal(
    probeStep({ fails: 2, hudLoaded: false, showingOffline: true }, "ok")
      .action,
    "load-hud",
  );
  // O main usa estas regras e mantém o HUD carregado (lastOnline só vira false ao mostrar offline.html).
  const main = stripNonCode(read("overlay/main.mjs"), { keepStrings: true });
  assert.match(
    main,
    /probeStep\(\s*\{\s*\.\.\.probe,\s*hudLoaded: lastOnline === true/,
  );
  assert.ok(!/const PROBE_TIMEOUT_MS = 2500/.test(main));
});

test("migração: valor igual ao padrão antigo migra; editado fica; rodar duas vezes não muda nada", async () => {
  const { DEFAULTS_VERSION, migrateConfig, loadAndMigrateConfig, backupStamp } =
    await import("../overlay/config.mjs");
  assert.equal(DEFAULTS_VERSION, 2);
  const old = {
    hints: { verbosity: "normal", categories: { buy: true } },
    layout: { bar: { x: 0.5, y: 0.1, w: 0.2, hidden: false } },
  };
  const m = migrateConfig(old);
  assert.equal(m.migrated, true);
  assert.equal(m.raw.hints.verbosity, "minimal");
  assert.equal(m.raw.defaultsVersion, 2);
  assert.deepEqual(m.raw.layout, old.layout, "layout mexido pelo usuário fica");
  assert.equal(old.hints.verbosity, "normal", "não altera a entrada");
  assert.deepEqual(m.changes, ["hints.verbosity: normal -> minimal"]);
  // Escolha do usuário (diferente do padrão antigo) fica.
  assert.equal(
    migrateConfig({ hints: { verbosity: "detailed" } }).raw.hints.verbosity,
    "detailed",
  );
  // Idempotente: o migrado não muda de novo; e uma escolha "normal" feita DEPOIS da migração é respeitada.
  const again = migrateConfig(m.raw);
  assert.equal(again.migrated, false);
  assert.equal(again.raw, m.raw);
  assert.equal(
    migrateConfig({ defaultsVersion: 2, hints: { verbosity: "normal" } }).raw
      .hints.verbosity,
    "normal",
  );
  // Elemento de layout igual ao padrão antigo passa ao novo (tabela de exemplo).
  const table = [
    {
      from: 1,
      hints: {},
      layout: {
        dock: {
          old: { x: 0.8, y: 0.015, w: 0.125, hidden: false },
          now: { x: 0.7, y: 0.02, w: 0.125, hidden: false },
        },
      },
    },
  ];
  const lay = migrateConfig(
    {
      layout: {
        dock: { x: 0.8, y: 0.015, w: 0.125, hidden: false },
        bar: { x: 0.1 },
      },
    },
    table,
    2,
  );
  assert.deepEqual(lay.raw.layout.dock, {
    x: 0.7,
    y: 0.02,
    w: 0.125,
    hidden: false,
  });
  const moved = migrateConfig(
    { layout: { dock: { x: 0.81, y: 0.015, w: 0.125, hidden: false } } },
    table,
    2,
  );
  assert.equal(moved.raw.layout.dock.x, 0.81, "mexido à mão não é tocado");
  // No disco: backup ao lado, arquivo migrado, segunda carga sem migrar.
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovl-mig-"));
  try {
    const file = path.join(dir, "overlay.config.json");
    fs.writeFileSync(file, JSON.stringify(old));
    const when = new Date(2026, 9, 11, 20, 5, 9);
    const r1 = await loadAndMigrateConfig(file, when);
    assert.equal(r1.cfg.hints.verbosity, "minimal");
    assert.equal(
      path.basename(r1.migration.backup),
      "overlay.config.json.bak-20261011-200509",
    );
    assert.equal(
      JSON.parse(fs.readFileSync(r1.migration.backup, "utf8")).hints.verbosity,
      "normal",
      "backup é o original",
    );
    assert.equal(r1.text, fs.readFileSync(file, "utf8"));
    const r2 = await loadAndMigrateConfig(file, when);
    assert.equal(r2.migration, null, "segunda vez não migra");
    assert.equal(
      fs.readdirSync(dir).filter((f) => f.includes(".bak-")).length,
      1,
    );
    assert.equal(backupStamp(when), "20261011-200509");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
