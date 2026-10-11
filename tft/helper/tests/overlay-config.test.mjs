// Rodar com: node --test tft/helper/tests/overlay-config.test.mjs
// Cobre a configuração pura do overlay (validação, geometria, salvar/carregar atômico) e a leitura do retângulo
// da janela do jogo. Nada aqui abre o Electron nem executa PowerShell.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_HOTKEYS,
  DEFAULT_PORT,
  IDLE_UI,
  MIN_SIZE,
  buildMode,
  configSnapshot,
  defaultBounds,
  defaultConfig,
  fitBounds,
  loadConfig,
  mouseIgnore,
  nextUi,
  normalizeAccelerator,
  parseConfig,
  parseMode,
  resolvePort,
  saveConfig,
} from "../overlay/config.mjs";
import { findGameRect, parseRect } from "../overlay/game-window.mjs";
import { parseCalibration } from "../overlay/hud/geometry.mjs";
import { parseHintSettings } from "../overlay/hud/hints.mjs";
import { parseLayout } from "../overlay/hud/layout.mjs";

test("parseConfig: ausente ou lixo vira o padrão", () => {
  const def = defaultConfig();
  for (const raw of [undefined, null, 42, "não é json", "[1,2]", [], "null"])
    assert.deepEqual(parseConfig(raw), def, String(raw));
  assert.deepEqual(parseConfig({}), def);
  assert.equal(def.display, "primary");
  assert.equal(def.scale, 1);
  assert.equal(def.opacity, 0.92);
  assert.equal(def.visible, true);
  assert.equal(def.bounds, null);
  assert.deepEqual(def.hotkeys, DEFAULT_HOTKEYS);
  // Fase 2: integrado e seguindo o jogo por padrão; layout, calibração e dicas vêm dos parsers.
  assert.equal(def.mode, "integrated");
  assert.equal(def.follow, true);
  assert.deepEqual(def.layout, parseLayout(undefined));
  assert.deepEqual(def.calibration, parseCalibration(undefined));
  assert.deepEqual(def.hints, parseHintSettings(undefined));
  assert.equal(DEFAULT_HOTKEYS.help, "Control+Shift+F8");
  assert.equal(DEFAULT_HOTKEYS.calibrate, "Control+Shift+F7");
});

test("parseConfig: caminho feliz preserva valores válidos (objeto ou texto JSON)", () => {
  const raw = {
    port: 4000,
    display: 2,
    bounds: { x: -1920, y: 40, width: 500, height: 700 },
    scale: 1.25,
    opacity: 0.5,
    visible: false,
    hotkeys: {
      toggle: "Control+Shift+F5",
      interactive: "Alt+I",
      quit: "Ctrl+Alt+Q",
      anchor: "Control+Alt+G",
      help: "Control+Alt+H",
      calibrate: "Control+Alt+K",
    },
    mode: "panel",
    follow: false,
    layout: parseLayout({ plan: { x: 0.3, y: 0.3, w: 0.2, hidden: false } }),
    calibration: parseCalibration({ dx: 0.01, dy: -0.02, scale: 1.1 }),
    hints: parseHintSettings({ verbosity: "detailed" }),
  };
  const expected = { ...raw };
  assert.deepEqual(parseConfig(raw), expected);
  assert.deepEqual(parseConfig(JSON.stringify(raw)), expected);
  // Configuração antiga (fase 1, só os quatro atalhos): completa com os padrões novos.
  const old = parseConfig({ hotkeys: { toggle: "Control+Shift+F5" } });
  assert.equal(old.hotkeys.toggle, "Control+Shift+F5");
  assert.equal(old.hotkeys.help, DEFAULT_HOTKEYS.help);
  assert.equal(old.mode, "integrated");
});

test("parseConfig: modo, seguir, layout, calibração e dicas inválidos voltam ao padrão", () => {
  const def = defaultConfig();
  for (const mode of ["painel", 1, null, {}, "Panel"])
    assert.equal(parseConfig({ mode }).mode, "integrated", String(mode));
  assert.equal(parseMode("panel"), "panel");
  assert.equal(parseMode("integrated"), "integrated");
  for (const follow of ["sim", 1, null, "false"])
    assert.equal(parseConfig({ follow }).follow, true, String(follow));
  assert.equal(parseConfig({ follow: false }).follow, false);
  const bad = parseConfig({ layout: "x", calibration: 7, hints: [] });
  assert.deepEqual(bad.layout, def.layout);
  assert.deepEqual(bad.calibration, def.calibration);
  assert.deepEqual(bad.hints, def.hints);
});

test("parseConfig: valores inválidos voltam ao padrão, fora do intervalo é limitado", () => {
  const cfg = parseConfig({
    port: 70000,
    display: "esquerda",
    bounds: { x: "1", y: 0, width: 400, height: 400 },
    scale: "grande",
    opacity: null,
    visible: "sim",
  });
  assert.equal(cfg.port, null);
  assert.equal(cfg.display, "primary");
  assert.equal(cfg.bounds, null);
  assert.equal(cfg.scale, 1);
  assert.equal(cfg.opacity, 0.92);
  assert.equal(cfg.visible, true);

  assert.equal(parseConfig({ scale: 0.1 }).scale, 0.6);
  assert.equal(parseConfig({ scale: 9 }).scale, 2);
  assert.equal(parseConfig({ opacity: 0 }).opacity, 0.2);
  assert.equal(parseConfig({ opacity: 5 }).opacity, 1);
  assert.equal(parseConfig({ scale: Infinity }).scale, 1);
  assert.equal(parseConfig({ opacity: NaN }).opacity, 0.92);
  assert.equal(parseConfig({ scale: 1.234 }).scale, 1.23);
});

test("parseConfig: porta, monitor e retângulo", () => {
  for (const p of [0, -1, 1.5, 65536, "abc", true, null])
    assert.equal(parseConfig({ port: p }).port, null, String(p));
  assert.equal(parseConfig({ port: "8080" }).port, 8080);
  for (const d of ["primary", "cursor", "game", 0, 7])
    assert.equal(parseConfig({ display: d }).display, d);
  assert.equal(parseConfig({ display: "3" }).display, 3);
  for (const d of [-1, 1.5, {}, null])
    assert.equal(parseConfig({ display: d }).display, "primary");

  // Largura e altura abaixo do mínimo são elevadas; coordenadas absurdas anulam o retângulo.
  assert.deepEqual(
    parseConfig({ bounds: { x: 10.4, y: 20.6, width: 10, height: 10 } }).bounds,
    {
      x: 10,
      y: 21,
      width: MIN_SIZE.width,
      height: MIN_SIZE.height,
    },
  );
  assert.equal(
    parseConfig({ bounds: { x: 1e9, y: 0, width: 400, height: 400 } }).bounds,
    null,
  );
  assert.equal(
    parseConfig({ bounds: { x: 0, y: 0, width: 400 } }).bounds,
    null,
  );
  assert.equal(parseConfig({ bounds: "0,0,400,400" }).bounds, null);
});

test("hotkeys: aceleradores inválidos ou repetidos voltam ao padrão da ação", () => {
  assert.equal(
    normalizeAccelerator("Control+Alt+O"),
    normalizeAccelerator("alt+ctrl+o"),
  );
  for (const bad of [
    "O",
    "Control",
    "Control+Alt",
    "Foo+O",
    "Control+",
    "",
    5,
    null,
    "Control+Alt+Oo+",
    `Control+${"x".repeat(80)}`,
  ])
    assert.equal(normalizeAccelerator(bad), null, String(bad));

  const hk = parseConfig({
    hotkeys: {
      toggle: "O",
      interactive: DEFAULT_HOTKEYS.toggle,
      quit: 7,
      anchor: "control+alt+g",
      extra: "Control+X",
    },
  }).hotkeys;
  assert.deepEqual(Object.keys(hk), [
    "toggle",
    "interactive",
    "quit",
    "anchor",
    "help",
    "calibrate",
  ]);
  assert.equal(hk.help, DEFAULT_HOTKEYS.help);
  assert.equal(hk.calibrate, DEFAULT_HOTKEYS.calibrate);
  assert.equal(hk.toggle, DEFAULT_HOTKEYS.toggle);
  assert.equal(hk.interactive, DEFAULT_HOTKEYS.interactive);
  // Repetido: a duplicata cai no padrão da própria ação (acima, "interactive" repetia o toggle).
  const dup = parseConfig({
    hotkeys: { toggle: "Control+Alt+X", interactive: "Control+Alt+X" },
  }).hotkeys;
  assert.equal(dup.toggle, "Control+Alt+X");
  assert.equal(dup.interactive, DEFAULT_HOTKEYS.interactive);
  assert.equal(hk.quit, DEFAULT_HOTKEYS.quit);
  assert.equal(hk.anchor, "control+alt+g");
  // Os atalhos novos também não podem repetir os existentes.
  const clash = parseConfig({
    hotkeys: { help: DEFAULT_HOTKEYS.toggle, calibrate: "Control+Alt+K" },
  }).hotkeys;
  assert.equal(clash.help, DEFAULT_HOTKEYS.help);
  assert.equal(clash.calibrate, "Control+Alt+K");
});

test("resolvePort: config, depois TFT_HELPER_PORT, depois 3218", () => {
  assert.equal(resolvePort({ port: 4000 }, { TFT_HELPER_PORT: "5000" }), 4000);
  assert.equal(resolvePort({ port: null }, { TFT_HELPER_PORT: "5000" }), 5000);
  assert.equal(
    resolvePort({ port: null }, { TFT_HELPER_PORT: "lixo" }),
    DEFAULT_PORT,
  );
  assert.equal(resolvePort(defaultConfig(), {}), 3218);
});

test("defaultBounds e fitBounds: canto superior direito e recolocação", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(defaultBounds(area), {
    x: 1920 - 420 - 16,
    y: 16,
    width: 420,
    height: 640,
  });
  const small = { x: 100, y: 50, width: 300, height: 200 };
  const b = defaultBounds(small);
  assert.ok(b.width <= 300 && b.height <= 200);
  assert.ok(b.x >= small.x && b.x + b.width <= small.x + small.width);

  const monitors = [area, { x: 1920, y: 0, width: 1280, height: 720 }];
  // Cabe: não muda.
  const ok = { x: 1500, y: 100, width: 420, height: 640 };
  assert.deepEqual(fitBounds(ok, monitors), ok);
  // Monitor removido (fora de todos): vai para o preferido.
  const lost = { x: 5000, y: 3000, width: 420, height: 640 };
  assert.deepEqual(fitBounds(lost, monitors, 0), {
    x: 1500,
    y: 440,
    width: 420,
    height: 640,
  });
  // Parcialmente fora: entra no monitor de maior interseção.
  const partial = fitBounds(
    { x: 1800, y: 900, width: 420, height: 640 },
    monitors,
  );
  assert.deepEqual(partial, { x: 1500, y: 440, width: 420, height: 640 });
  // Maior que o monitor: reduzida ao monitor.
  const huge = fitBounds({ x: 0, y: 0, width: 5000, height: 5000 }, [area]);
  assert.deepEqual(huge, { x: 0, y: 0, width: 1920, height: 1080 });
  // Sem monitores válidos: devolve cópia inalterada.
  assert.deepEqual(fitBounds(ok, []), ok);
});

test("saveConfig/loadConfig: ida e volta atômica em diretório temporário", async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "overlay-config-"),
  );
  try {
    const file = path.join(dir, "sub", "overlay.config.json");
    // Ausente e corrompido: padrão.
    assert.deepEqual(await loadConfig(file), defaultConfig());
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, "{ quebrado", "utf8");
    assert.deepEqual(await loadConfig(file), defaultConfig());

    const cfg = {
      ...defaultConfig(),
      port: 4321,
      display: "cursor",
      bounds: { x: 12, y: 34, width: 480, height: 600 },
      scale: 1.5,
      opacity: 0.7,
      visible: false,
      mode: "panel",
      follow: false,
      layout: parseLayout({ plan: { x: 0.3, y: 0.3, w: 0.2, hidden: false } }),
      calibration: parseCalibration({ dx: 0.02, dy: 0.01, scale: 0.9 }),
      hints: parseHintSettings({ verbosity: "minimal" }),
    };
    await saveConfig(file, cfg);
    assert.deepEqual(await loadConfig(file), cfg);
    assert.deepEqual(JSON.parse(await fs.promises.readFile(file, "utf8")), cfg);

    // Regravações seguidas não deixam temporários (o main serializa as gravações).
    for (const n of [1, 2, 3, 4, 5])
      await saveConfig(file, { ...cfg, scale: 1 + n / 10 });
    assert.equal((await loadConfig(file)).scale, 1.5);
    assert.deepEqual(await fs.promises.readdir(path.dirname(file)), [
      "overlay.config.json",
    ]);

    // Um valor inválido entregue ao salvar é normalizado antes de ir para o disco.
    await saveConfig(file, { ...cfg, scale: 99, hotkeys: { toggle: "x" } });
    const clean = await loadConfig(file);
    assert.equal(clean.scale, 2);
    assert.equal(clean.hotkeys.toggle, DEFAULT_HOTKEYS.toggle);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("configSnapshot: o modo integrado nunca sobrescreve os bounds do painel", () => {
  const live = { x: 0, y: 0, width: 1920, height: 1080 };
  const saved = { x: 1500, y: 16, width: 420, height: 640 };
  const integrated = configSnapshot(
    { ...defaultConfig(), mode: "integrated", bounds: saved },
    live,
  );
  assert.deepEqual(integrated.bounds, saved);
  const panel = configSnapshot(
    { ...defaultConfig(), mode: "panel", bounds: saved },
    live,
  );
  assert.deepEqual(panel.bounds, live);
  // Janela inexistente: mantém o que havia.
  assert.deepEqual(
    configSnapshot({ ...defaultConfig(), mode: "panel", bounds: saved }, null)
      .bounds,
    saved,
  );
  // Não altera a configuração de origem.
  const cfg = { ...defaultConfig(), mode: "panel" };
  configSnapshot(cfg, live).hotkeys.toggle = "x";
  assert.equal(cfg.hotkeys.toggle, DEFAULT_HOTKEYS.toggle);
  assert.equal(cfg.bounds, null);
});

test("nextUi: interativo é o mestre; ajuda e calibração o implicam e são exclusivas", () => {
  const on = nextUi(IDLE_UI, "toggleInteractive");
  assert.deepEqual(on, { interactive: true, help: false, calibrating: false });
  assert.deepEqual(nextUi(on, "toggleInteractive"), IDLE_UI);
  // Ajuda liga o interativo; o atalho de novo sai do interativo por inteiro.
  const help = nextUi(IDLE_UI, "toggleHelp");
  assert.deepEqual(help, { interactive: true, help: true, calibrating: false });
  assert.deepEqual(nextUi(help, "toggleHelp"), IDLE_UI);
  // Fechar a ajuda pelo botão (setHelp false) mantém o interativo.
  assert.deepEqual(nextUi(help, "setHelp", false), {
    interactive: true,
    help: false,
    calibrating: false,
  });
  // Calibrar troca a ajuda (exclusivas).
  const cal = nextUi(help, "setCalibrating", true);
  assert.deepEqual(cal, { interactive: true, help: false, calibrating: true });
  assert.deepEqual(nextUi(cal, "toggleCalibrating"), IDLE_UI);
  assert.deepEqual(nextUi(cal, "setHelp", true), help);
  // Sair do interativo desliga os dois.
  assert.deepEqual(nextUi(cal, "exitInteractive"), IDLE_UI);
  assert.deepEqual(nextUi(help, "exitInteractive"), IDLE_UI);
  // Valor não booleano não liga nada; ação desconhecida e estado inválido não mudam nada.
  assert.deepEqual(nextUi(IDLE_UI, "setHelp", "sim"), IDLE_UI);
  assert.deepEqual(nextUi(cal, "naoExiste"), cal);
  assert.deepEqual(nextUi(undefined, "naoExiste"), IDLE_UI);
  // Nunca devolve o objeto congelado de origem (o main o guarda e o compara).
  assert.notEqual(nextUi(IDLE_UI, "exitInteractive"), IDLE_UI);
});

test("mouseIgnore: click-through por padrão; captura só com interativo ligado", () => {
  // Fora do interativo a janela sempre ignora, mesmo que a página peça captura.
  for (const mode of ["integrated", "panel"])
    for (const pageCapture of [true, false])
      assert.equal(
        mouseIgnore({ interactive: false, mode, pageCapture }),
        true,
        `${mode} ${pageCapture}`,
      );
  // Integrado interativo: ignora até a página pedir captura (ponteiro sobre elemento interativo).
  assert.equal(
    mouseIgnore({ interactive: true, mode: "integrated", pageCapture: false }),
    true,
  );
  assert.equal(
    mouseIgnore({ interactive: true, mode: "integrated", pageCapture: true }),
    false,
  );
  // Painel interativo captura tudo (arrastar e redimensionar).
  assert.equal(
    mouseIgnore({ interactive: true, mode: "panel", pageCapture: false }),
    false,
  );
  assert.equal(mouseIgnore({}), true);
});

test("buildMode: objeto Mode completo, sem aliasing com a configuração", () => {
  const cfg = {
    ...defaultConfig(),
    mode: "integrated",
    scale: 1.2,
    opacity: 0.8,
  };
  const game = {
    found: true,
    width: 1920,
    height: 1080,
    fullscreen: { warn: false, kind: "windowed", text: "ok" },
  };
  const mode = buildMode({
    ui: { interactive: true, help: true, calibrating: false },
    cfg,
    game,
  });
  assert.deepEqual(Object.keys(mode).sort(), [
    "calibrating",
    "calibration",
    "follow",
    "game",
    "help",
    "hints",
    "hotkeys",
    "interactive",
    "layout",
    "mode",
    "opacity",
    "scale",
  ]);
  assert.equal(mode.interactive, true);
  assert.equal(mode.help, true);
  assert.equal(mode.calibrating, false);
  assert.equal(mode.mode, "integrated");
  assert.equal(mode.follow, true);
  assert.equal(mode.scale, 1.2);
  assert.equal(mode.opacity, 0.8);
  assert.deepEqual(mode.hotkeys, DEFAULT_HOTKEYS);
  assert.notEqual(mode.hotkeys, cfg.hotkeys);
  assert.deepEqual(mode.game, game);
  // Sem jogo: found false, tamanho e aviso nulos.
  const none = buildMode({ ui: IDLE_UI, cfg, game: { found: false } });
  assert.deepEqual(none.game, {
    found: false,
    width: null,
    height: null,
    fullscreen: null,
  });
  assert.deepEqual(buildMode({ ui: IDLE_UI, cfg }).game, none.game);
  // Tamanho inválido vira null.
  assert.equal(
    buildMode({
      ui: IDLE_UI,
      cfg,
      game: { found: true, width: "1920", height: NaN },
    }).game.width,
    null,
  );
});

test("parseRect: retângulo em pixels físicos a partir da saída do PowerShell", () => {
  assert.deepEqual(parseRect("100,50,1380,770\r\n"), {
    x: 100,
    y: 50,
    width: 1280,
    height: 720,
  });
  assert.deepEqual(parseRect("aviso qualquer\n-1920, 0, 0, 1080\n"), {
    x: -1920,
    y: 0,
    width: 1920,
    height: 1080,
  });
  // Vazio, invertido, minimizado, texto e tipos errados: null.
  for (const bad of [
    "",
    "   ",
    "1,2,3",
    "a,b,c,d",
    "100,100,100,200",
    "200,0,100,50",
    "-32000,-32000,-31840,-31972",
    "1,2,3,4,5",
    null,
    undefined,
    5,
  ])
    assert.equal(parseRect(bad), null, String(bad));
});

test("findGameRect: devolve o retângulo, ou null em falha, timeout ou fora do Windows", async () => {
  const calls = [];
  const exec = (file, args, options, cb) => {
    calls.push({ file, args, options });
    cb(null, "0,0,1920,1080\r\n");
  };
  assert.deepEqual(await findGameRect({ exec, platform: "win32" }), {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  assert.equal(calls[0].file, "powershell.exe");
  assert.deepEqual(calls[0].args.slice(0, 3), [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
  ]);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.timeout, 4000);
  assert.ok(calls[0].args[3].includes("TFTClient-Win64-Shipping"));
  assert.ok(
    !calls[0].args[3].includes('"'),
    "o script não pode conter aspas duplas",
  );
  // Coordenadas físicas reais: o processo precisa declarar consciência de DPI antes de ler o retângulo.
  assert.ok(calls[0].args[3].includes("SetProcessDPIAware"));
  assert.ok(
    calls[0].args[3].indexOf("Aware()") <
      calls[0].args[3].indexOf("GetWindowRect($p"),
  );

  const failing = (_f, _a, _o, cb) => cb(new Error("timeout"), "");
  assert.equal(await findGameRect({ exec: failing, platform: "win32" }), null);
  const throwing = () => {
    throw new Error("sem PowerShell");
  };
  assert.equal(await findGameRect({ exec: throwing, platform: "win32" }), null);
  assert.equal(await findGameRect({ exec, platform: "linux" }), null);
  assert.equal(calls.length, 1);
});
