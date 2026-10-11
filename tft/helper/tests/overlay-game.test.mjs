// Rodar com: node --test tft/helper/tests/overlay-game.test.mjs
// Cobre o rastreador da janela do jogo (linhas, script, ciclo de vida com spawn e relógio simulados) e a leitura do
// modo de tela do ini local. Nada aqui abre o Electron nem executa PowerShell: o filho é um objeto falso.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createGameTracker,
  parseTrackerLine,
  trackerCommand,
  trackerScript,
} from "../overlay/game-tracker.mjs";
import {
  describeFullscreen,
  gameUserSettingsPath,
  parseFullscreenMode,
  readFullscreenMode,
} from "../overlay/display-mode.mjs";

// --- linhas do rastreador ---

test("parseTrackerLine: R x y w h, N e ruído", () => {
  assert.deepEqual(parseTrackerLine("R 100 50 1920 1080"), {
    rect: { x: 100, y: 50, width: 1920, height: 1080 },
  });
  assert.deepEqual(parseTrackerLine("R -1920 0 1920 1080\r"), {
    rect: { x: -1920, y: 0, width: 1920, height: 1080 },
  });
  assert.deepEqual(parseTrackerLine("  R 0 0 800 600  "), {
    rect: { x: 0, y: 0, width: 800, height: 600 },
  });
  assert.deepEqual(parseTrackerLine("N"), { rect: null });
  assert.deepEqual(parseTrackerLine(" N\r"), { rect: null });
  // Vazio, minimizada (~ -32000), formato errado e tipos errados: ignorado (null).
  for (const bad of [
    "",
    "   ",
    "n",
    "NN",
    "R",
    "R 1 2 3",
    "R 1 2 3 4 5",
    "R a b c d",
    "R 0 0 0 600",
    "R 0 0 800 0",
    "R 0 0 -800 600",
    "R -32000 -32000 800 600",
    "R 0 0 100001 600",
    "R 1.5 2 800 600",
    "r 0 0 800 600",
    "Add-Type : erro qualquer",
    null,
    undefined,
    42,
  ])
    assert.equal(parseTrackerLine(bad), null, String(bad));
});

// --- script ---

test("trackerScript: sem aspas duplas, sem chamadas de entrada e com a identificação da janela do TFT", () => {
  const script = trackerScript({ parentPid: 4242, intervalMs: 750 });
  assert.ok(!script.includes('"'), "o script não pode conter aspas duplas");
  // Somente leitura da posição: nenhuma API de entrada, captura, memória ou injeção.
  for (const forbidden of [
    "SendInput",
    "mouse_event",
    "keybd_event",
    "SetCursorPos",
    "PostMessage",
    "SendMessage",
    "SetForegroundWindow",
    "SetWindowsHookEx",
    "ReadProcessMemory",
    "WriteProcessMemory",
    "OpenProcess",
    "CreateRemoteThread",
    "CopyFromScreen",
    "BitBlt",
    "SendKeys",
  ])
    assert.ok(!script.includes(forbidden), forbidden);
  // Identificação da janela do TFT: classe UnrealWindow, título "TFT...", visível e não minimizada.
  for (const needle of [
    "UnrealWindow",
    "TFT",
    "IsWindowVisible",
    "IsIconic",
    "GetClientRect",
    "ClientToScreen",
  ])
    assert.ok(script.includes(needle), needle);
  assert.ok(script.includes("SetProcessDPIAware"));
  assert.ok(script.includes("$parent=4242"));
  assert.ok(script.includes("Start-Sleep -Milliseconds 750"));
  // A fonte C# vai numa string simples do PowerShell: sem aspas simples, e as duplas entram por QQ.
  const m = /\$src='([\s\S]*?)'\.Replace\('QQ',\$q\)/.exec(script);
  assert.ok(
    m,
    "a fonte C# deve estar numa string simples seguida de Replace('QQ', $q)",
  );
  assert.ok(!m[1].includes("'"));
  assert.ok(m[1].includes("QQuser32.dllQQ"));
  assert.ok(script.includes("[char]34"));
});

test("trackerScript: pid e intervalo são sanitizados", () => {
  assert.ok(trackerScript({ parentPid: "abc" }).includes("$parent=0"));
  assert.ok(trackerScript({ parentPid: -5 }).includes("$parent=0"));
  // Texto com injeção de comando não vira número: o pid cai em 0 e o texto nunca entra no script.
  assert.ok(
    trackerScript({ parentPid: "7; Remove-Item x" }).includes("$parent=0"),
  );
  assert.ok(
    !trackerScript({ parentPid: "7; Remove-Item x" }).includes("Remove-Item"),
  );
  assert.ok(trackerScript({ parentPid: 4242.9 }).includes("$parent=4242"));
  assert.ok(
    trackerScript({ intervalMs: 1 }).includes("Start-Sleep -Milliseconds 250"),
  );
  assert.ok(
    trackerScript({ intervalMs: 9e9 }).includes(
      "Start-Sleep -Milliseconds 10000",
    ),
  );
  assert.ok(
    trackerScript({ intervalMs: "lixo" }).includes(
      "Start-Sleep -Milliseconds 750",
    ),
  );
  assert.ok(trackerScript().includes("$parent=0"));
});

test("trackerCommand: PowerShell oculto com o script em -EncodedCommand (UTF-16LE em base64)", () => {
  const options = { parentPid: 99, intervalMs: 500 };
  const { file, args } = trackerCommand(options);
  assert.equal(file, "powershell.exe");
  assert.deepEqual(args.slice(0, 4), [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
  ]);
  assert.equal(args.at(-2), "-EncodedCommand");
  assert.ok(!args.includes("-Command"));
  assert.equal(
    Buffer.from(args.at(-1), "base64").toString("utf16le"),
    trackerScript(options),
  );
});

// --- ciclo de vida do rastreador ---

class FakeChild extends EventEmitter {
  constructor(file, args, options) {
    super();
    this.file = file;
    this.args = args;
    this.options = options;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killed = 0;
  }
  kill() {
    this.killed += 1;
    return true;
  }
}

function harness({ platform = "win32", throwOnSpawn = false } = {}) {
  const children = [];
  const changes = [];
  const logs = [];
  const timers = new Map();
  let nextId = 1;
  const clock = { now: 0 };
  const tracker = createGameTracker({
    platform,
    parentPid: 4242,
    spawn: (file, args, options) => {
      if (throwOnSpawn) throw new Error("sem PowerShell");
      const child = new FakeChild(file, args, options);
      children.push(child);
      return child;
    },
    onChange: (rect) => changes.push(rect),
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    now: () => clock.now,
    log: (m) => logs.push(m),
  });
  /** Dispara o único temporizador pendente (reinício agendado) e devolve o atraso que ele tinha. */
  const fire = () => {
    const [[id, timer]] = [...timers.entries()];
    timers.delete(id);
    timer.fn();
    return timer.ms;
  };
  return { tracker, children, changes, logs, timers, clock, fire };
}

const A = { x: 100, y: 50, width: 1920, height: 1080 };
const B = { x: 0, y: 0, width: 1280, height: 720 };

test("createGameTracker: spawn com PowerShell oculto, sem stdin, e nada fora do Windows", () => {
  const h = harness();
  assert.equal(h.tracker.start(), true);
  assert.equal(h.children.length, 1);
  assert.equal(h.children[0].file, "powershell.exe");
  assert.ok(h.children[0].args.includes("-EncodedCommand"));
  assert.equal(h.children[0].options.windowsHide, true);
  assert.equal(h.children[0].options.stdio[0], "ignore");
  assert.equal(h.tracker.running(), true);
  // start() repetido não cria um segundo filho.
  assert.equal(h.tracker.start(), true);
  assert.equal(h.children.length, 1);

  const linux = harness({ platform: "linux" });
  assert.equal(linux.tracker.start(), false);
  assert.equal(linux.children.length, 0);
  assert.equal(linux.tracker.running(), false);
  assert.equal(linux.tracker.refresh(), false);
});

test("createGameTracker: onChange só quando o retângulo muda", () => {
  const h = harness();
  h.tracker.start();
  const out = h.children[0].stdout;
  out.emit("data", "N\n"); // sem jogo desde o início: não é mudança
  assert.deepEqual(h.changes, []);
  out.emit("data", "R 100 50 1920 1080\n");
  out.emit("data", "R 100 50 1920 1080\n"); // igual
  out.emit("data", "ruído do PowerShell\n"); // ignorado
  assert.deepEqual(h.changes, [A]);
  assert.deepEqual(h.tracker.last(), A);
  out.emit("data", "R 0 0 1280 720\nR 0 0 1280 720\n");
  assert.deepEqual(h.changes, [A, B]);
  out.emit("data", "N\n");
  out.emit("data", "N\n");
  assert.deepEqual(h.changes, [A, B, null]);
  assert.equal(h.tracker.last(), null);
});

test("createGameTracker: linhas fragmentadas, CRLF e Buffer", () => {
  const h = harness();
  h.tracker.start();
  const out = h.children[0].stdout;
  out.emit("data", Buffer.from("R 100 5"));
  assert.deepEqual(h.changes, []);
  out.emit("data", Buffer.from("0 1920 1080\r\nN"));
  assert.deepEqual(h.changes, [A]);
  out.emit("data", "\r\n");
  assert.deepEqual(h.changes, [A, null]);
  // Saída gigante sem quebra de linha não cresce sem limite e não atrapalha as linhas seguintes.
  out.emit("data", "x".repeat(10000));
  out.emit("data", "\nR 0 0 1280 720\n");
  assert.deepEqual(h.changes.at(-1), B);
});

test("createGameTracker: filho que morre avisa null, reinicia com espera crescente e zera quando estável", () => {
  const h = harness();
  h.tracker.start();
  h.children[0].stdout.emit("data", "R 100 50 1920 1080\n");
  h.children[0].emit("error", new Error("falha"));
  h.children[0].emit("exit", 1); // erro + saída do mesmo filho: um único tratamento
  assert.deepEqual(h.changes, [A, null]);
  assert.equal(h.timers.size, 1);
  assert.equal(h.tracker.running(), false);

  assert.equal(h.fire(), 2000);
  assert.equal(h.children.length, 2);
  assert.equal(h.tracker.running(), true);

  // Morre de novo logo na partida (sem dados e sem estabilidade): espera dobra, sem novo aviso (já era null).
  h.children[1].emit("exit", 1);
  assert.deepEqual(h.changes, [A, null]);
  assert.equal(h.fire(), 4000);
  assert.equal(h.children.length, 3);

  // Depois de rodar estável, a espera volta ao valor base.
  h.clock.now = 60000;
  h.children[2].emit("exit", 0);
  assert.equal(h.fire(), 2000);
  assert.equal(h.children.length, 4);

  // O novo filho volta a reportar normalmente.
  h.children[3].stdout.emit("data", "R 100 50 1920 1080\n");
  assert.deepEqual(h.changes, [A, null, A]);
});

test("createGameTracker: falha ao iniciar o processo não lança e tenta de novo", () => {
  const h = harness({ throwOnSpawn: true });
  assert.doesNotThrow(() => h.tracker.start());
  assert.equal(h.tracker.running(), false);
  assert.equal(h.timers.size, 1);
  assert.ok(h.logs.some((l) => l.includes("sem PowerShell")));
});

test("createGameTracker: refresh reinicia o filho e a próxima leitura notifica mesmo sem mudança", () => {
  const h = harness();
  assert.equal(h.tracker.refresh(), false); // sem start(), nada a fazer
  h.tracker.start();
  const first = h.children[0];
  first.stdout.emit("data", "R 100 50 1920 1080\n");
  assert.deepEqual(h.changes, [A]);

  assert.equal(h.tracker.refresh(), true);
  assert.equal(first.killed, 1);
  assert.equal(h.children.length, 2);
  // O filho antigo, mesmo morrendo depois, não gera aviso nem reinício.
  first.stdout.emit("data", "R 9 9 800 600\n");
  first.emit("exit", 1);
  assert.deepEqual(h.changes, [A]);
  assert.equal(h.timers.size, 0);

  h.children[1].stdout.emit("data", "R 100 50 1920 1080\n");
  assert.deepEqual(h.changes, [A, A]);
  h.children[1].stdout.emit("data", "R 100 50 1920 1080\n");
  assert.deepEqual(h.changes, [A, A]);
});

test("createGameTracker: stop mata o filho, cancela o reinício e não chama onChange", () => {
  const h = harness();
  h.tracker.start();
  const child = h.children[0];
  child.stdout.emit("data", "R 100 50 1920 1080\n");
  h.tracker.stop();
  assert.equal(child.killed, 1);
  assert.equal(h.tracker.running(), false);
  assert.equal(h.tracker.last(), null);
  assert.deepEqual(h.changes, [A]); // nenhum null por causa do stop
  // A saída tardia do filho morto não reinicia nada.
  child.emit("exit", 1);
  child.stdout.emit("data", "R 0 0 1280 720\n");
  assert.equal(h.timers.size, 0);
  assert.equal(h.children.length, 1);
  assert.deepEqual(h.changes, [A]);

  // Reinício pendente também é cancelado por stop().
  const g = harness();
  g.tracker.start();
  g.children[0].emit("exit", 1);
  assert.equal(g.timers.size, 1);
  g.tracker.stop();
  assert.equal(g.timers.size, 0);

  // Pode iniciar de novo depois de parar.
  assert.equal(h.tracker.start(), true);
  assert.equal(h.children.length, 2);
  h.tracker.stop();
  h.tracker.stop(); // idempotente
});

// --- modo de tela (GameUserSettings.ini) ---

const REAL_INI = [
  "[/Script/TFTSettings.TFTUserSettings]",
  "bUseVSync=False",
  "ResolutionSizeX=1920",
  "ResolutionSizeY=1080",
  "LastUserConfirmedResolutionSizeX=1920",
  "LastUserConfirmedResolutionSizeY=1080",
  "WindowPosX=-1",
  "WindowPosY=-1",
  "FullscreenMode=2",
  "LastConfirmedFullscreenMode=2",
  "PreferredFullscreenMode=1",
  "Version=5",
  "",
  "[ScalabilityGroups]",
  "sg.ResolutionQuality=100.000000",
  "",
  "[/Script/Engine.GameUserSettings]",
  "bUseDesiredScreenHeight=False",
  "",
].join("\n");

test("parseFullscreenMode: só a chave FullscreenMode, não LastConfirmed nem Preferred", () => {
  assert.equal(parseFullscreenMode(REAL_INI), 2);
  assert.equal(parseFullscreenMode(REAL_INI.replace(/\n/g, "\r\n")), 2);
  assert.equal(parseFullscreenMode("FullscreenMode=0\n"), 0);
  assert.equal(parseFullscreenMode("[x]\n  FullscreenMode = 1  \n"), 1);
  // As chaves parecidas vêm antes e com valores diferentes: vale a exata.
  assert.equal(
    parseFullscreenMode(
      "LastConfirmedFullscreenMode=0\nPreferredFullscreenMode=0\nFullscreenMode=1\n",
    ),
    1,
  );
  assert.equal(
    parseFullscreenMode(
      "FullscreenMode=2\nLastConfirmedFullscreenMode=0\nPreferredFullscreenMode=0\n",
    ),
    2,
  );
  // Só as chaves parecidas, comentário, valor fora do enum, lixo e tipos errados: null.
  assert.equal(
    parseFullscreenMode(
      "LastConfirmedFullscreenMode=0\nPreferredFullscreenMode=0\n",
    ),
    null,
  );
  assert.equal(parseFullscreenMode("SomeFullscreenMode=0\n"), null);
  assert.equal(parseFullscreenMode(";FullscreenMode=0\n"), null);
  assert.equal(parseFullscreenMode("FullscreenMode=3\n"), null);
  assert.equal(parseFullscreenMode("FullscreenMode=-1\n"), null);
  assert.equal(parseFullscreenMode("FullscreenMode=abc\n"), null);
  assert.equal(parseFullscreenMode("FullscreenMode=\n"), null);
  for (const bad of ["", null, undefined, 2, {}])
    assert.equal(parseFullscreenMode(bad), null, String(bad));
});

test("describeFullscreen: 0 avisa (tela cheia exclusiva), 1 e 2 não, desconhecido não", () => {
  const exclusive = describeFullscreen(0);
  assert.equal(exclusive.mode, 0);
  assert.equal(exclusive.warn, true);
  assert.equal(exclusive.kind, "exclusive");
  assert.match(exclusive.text, /tela cheia exclusiva/i);
  assert.match(exclusive.text, /janela/i);

  const borderless = describeFullscreen(1);
  assert.deepEqual(
    [borderless.mode, borderless.warn, borderless.kind],
    [1, false, "borderless"],
  );
  assert.match(borderless.text, /sem borda/i);

  const windowed = describeFullscreen(2);
  assert.deepEqual(
    [windowed.mode, windowed.warn, windowed.kind],
    [2, false, "windowed"],
  );
  assert.notEqual(
    describeFullscreen(2, { rectCoversMonitor: true }).text,
    windowed.text,
  );
  assert.equal(describeFullscreen(2, { rectCoversMonitor: true }).warn, false);

  for (const unknown of [null, undefined, 3, "2"]) {
    const d = describeFullscreen(unknown);
    assert.deepEqual(
      [d.mode, d.warn, d.kind],
      [null, false, "unknown"],
      String(unknown),
    );
    assert.ok(d.text.length > 0);
  }
  // Cobrir o monitor não esconde o aviso de tela cheia exclusiva.
  assert.equal(describeFullscreen(0, { rectCoversMonitor: true }).warn, true);
});

test("gameUserSettingsPath e readFullscreenMode: leitura somente do ini local", async () => {
  assert.equal(gameUserSettingsPath({}), null);
  assert.equal(gameUserSettingsPath({ LOCALAPPDATA: "" }), null);
  const file = gameUserSettingsPath({
    LOCALAPPDATA: path.join("C:", "Users", "x", "AppData", "Local"),
  });
  assert.deepEqual(file.split(path.sep).slice(-5), [
    "TFT",
    "Saved",
    "Config",
    "WindowsClient",
    "GameUserSettings.ini",
  ]);

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "overlay-ini-"));
  try {
    const ini = path.join(dir, "GameUserSettings.ini");
    assert.equal(await readFullscreenMode(ini), null); // ausente
    await fs.promises.writeFile(ini, REAL_INI, "utf8");
    assert.equal(await readFullscreenMode(ini), 2);
    await fs.promises.writeFile(
      ini,
      REAL_INI.replace("FullscreenMode=2\n", "FullscreenMode=0\n"),
      "utf8",
    );
    assert.equal(await readFullscreenMode(ini), 0);
    // Não modifica o arquivo.
    assert.ok(
      (await fs.promises.readFile(ini, "utf8")).includes("FullscreenMode=0"),
    );
    assert.equal(await readFullscreenMode(dir), null); // diretório: ilegível
    assert.equal(await readFullscreenMode(null), null);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
