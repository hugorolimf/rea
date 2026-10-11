// Rastreador SOMENTE-LEITURA da janela do TFT: um PowerShell persistente que, a cada ~750 ms (120 ms enquanto a janela está
// mudando; ver `trackerScript`), imprime a área cliente
// da janela do jogo em pixels físicos. A janela do TFT é identificada por: classe `UnrealWindow`, título começando
// por "TFT", visível e não minimizada.
// Só consulta posição (EnumWindows, GetClientRect, ClientToScreen). Não lê memória, não injeta, não captura tela e
// não envia entrada nenhuma ao jogo ou ao Windows. Linhas de saída: `R x y largura altura` ou `N` (sem janela).
import { spawn as nodeSpawn } from "node:child_process";

/** Intervalo padrão entre leituras, em ms. */
export const TRACK_INTERVAL_MS = 750;
/**
 * Intervalo RÁPIDO, em ms, enquanto o retângulo do jogo está mudando (arrastar a borda da janela, trocar janela e janela sem
 * borda): o overlay acompanha sem atraso perceptível. Volta ao lento sozinho quando estabiliza.
 */
export const TRACK_FAST_MS = 120;
/** Quanto tempo, em ms, o intervalo rápido continua depois da última mudança antes de voltar ao lento. */
export const TRACK_SETTLE_MS = 2500;

// Fonte C#: sem aspas duplas nem simples (o script passa por uma string simples do PowerShell); as aspas duplas
// entram como QQ e são trocadas por [char]34 no script.
const CSHARP = [
  "using System;using System.Text;using System.Runtime.InteropServices;",
  "public static class TftTrack {",
  "  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }",
  "  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }",
  "  delegate bool EnumProc(IntPtr h, IntPtr l);",
  "  [DllImport(QQuser32.dllQQ)] static extern bool EnumWindows(EnumProc f, IntPtr l);",
  "  [DllImport(QQuser32.dllQQ)] static extern bool IsWindowVisible(IntPtr h);",
  "  [DllImport(QQuser32.dllQQ)] static extern bool IsIconic(IntPtr h);",
  "  [DllImport(QQuser32.dllQQ, CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);",
  "  [DllImport(QQuser32.dllQQ, CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);",
  "  [DllImport(QQuser32.dllQQ)] static extern bool GetClientRect(IntPtr h, out RECT r);",
  "  [DllImport(QQuser32.dllQQ)] static extern bool ClientToScreen(IntPtr h, ref POINT p);",
  "  [DllImport(QQuser32.dllQQ)] static extern bool SetProcessDPIAware();",
  "  [DllImport(QQuser32.dllQQ)] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);",
  "  // Pixels físicos reais: per-monitor v2 (-4) quando existir; senão consciente de DPI do sistema.",
  "  public static bool Aware() {",
  "    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return true; } catch (Exception) { }",
  "    try { return SetProcessDPIAware(); } catch (Exception) { return false; }",
  "  }",
  "  // Área cliente da janela do jogo: {x, y, largura, altura}, ou null se não estiver visível.",
  "  public static int[] Client() {",
  "    int[] found = null;",
  "    EnumWindows((h, l) => {",
  "      if (!IsWindowVisible(h) || IsIconic(h)) return true;",
  "      var c = new StringBuilder(64); GetClassName(h, c, 64); if (c.ToString() != QQUnrealWindowQQ) return true;",
  "      var t = new StringBuilder(64); GetWindowText(h, t, 64); if (!t.ToString().Trim().StartsWith(QQTFTQQ, StringComparison.Ordinal)) return true;",
  "      RECT r; GetClientRect(h, out r); var p = new POINT(); ClientToScreen(h, ref p);",
  "      if (r.R > 200 && r.B > 200) { found = new[] { p.X, p.Y, r.R, r.B }; }",
  "      return found == null;",
  "    }, IntPtr.Zero);",
  "    return found;",
  "  }",
  "}",
].join("\n");

const toInt = (v, min, max, fallback) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

/**
 * Texto do script PowerShell persistente. Termina sozinho quando `parentPid` deixa de existir ou quando a saída é
 * fechada. Sem aspas duplas e sem nenhuma chamada de entrada (SendInput, mouse_event, keybd_event, SetCursorPos...).
 *
 * Cadência adaptativa: dorme `intervalMs` (lento) em repouso; quando a linha lida muda (a janela foi movida,
 * redimensionada, minimizada...), dorme `fastMs` até `settleMs` depois da última mudança e então volta ao lento. A decisão
 * é toda do próprio script (sem canal de volta do Electron): é só comparar a linha atual com a anterior.
 */
export function trackerScript({
  parentPid = 0,
  intervalMs = TRACK_INTERVAL_MS,
  fastMs = TRACK_FAST_MS,
  settleMs = TRACK_SETTLE_MS,
} = {}) {
  const parent = toInt(parentPid, 0, 0x7fffffff, 0);
  const every = toInt(intervalMs, 250, 10000, TRACK_INTERVAL_MS);
  // O rápido nunca passa do lento; o piso evita um laço apertado.
  const quick = Math.min(toInt(fastMs, 50, 1000, TRACK_FAST_MS), every);
  const settle = toInt(settleMs, 500, 30000, TRACK_SETTLE_MS);
  return [
    "$ErrorActionPreference='Stop'",
    "$q=[string][char]34",
    `$src='${CSHARP}'.Replace('QQ',$q)`,
    "Add-Type -TypeDefinition $src",
    "[void][TftTrack]::Aware()",
    `$parent=${parent}`,
    "$last=''; $fastUntil=[DateTime]::MinValue",
    "while($true){",
    "  if($parent -gt 0 -and -not (Get-Process -Id $parent -ErrorAction SilentlyContinue)){ break }",
    "  $line='N'",
    "  try { $c=[TftTrack]::Client(); if($c -ne $null){ $line='R '+$c[0]+' '+$c[1]+' '+$c[2]+' '+$c[3] } } catch { $line='N' }",
    "  [Console]::Out.WriteLine($line); [Console]::Out.Flush()",
    `  if($line -ne $last){ $last=$line; $fastUntil=[DateTime]::UtcNow.AddMilliseconds(${settle}) }`,
    `  if([DateTime]::UtcNow -lt $fastUntil){ Start-Sleep -Milliseconds ${quick} } else { Start-Sleep -Milliseconds ${every} }`,
    "}",
  ].join("\n");
}

/** Executável e argumentos para iniciar o rastreador (script em -EncodedCommand: sem problemas de aspas). */
export function trackerCommand(options = {}) {
  const encoded = Buffer.from(trackerScript(options), "utf16le").toString(
    "base64",
  );
  return {
    file: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      encoded,
    ],
  };
}

/**
 * Interpreta uma linha do rastreador. `R x y w h` => `{ rect: {x,y,width,height} }`; `N` => `{ rect: null }`;
 * qualquer outra coisa (ruído, retângulo vazio, minimizada com coordenadas ~ -32000) => null (linha ignorada).
 */
export function parseTrackerLine(line) {
  if (typeof line !== "string") return null;
  const text = line.trim();
  if (text === "N") return { rect: null };
  const m = /^R (-?\d{1,6}) (-?\d{1,6}) (\d{1,6}) (\d{1,6})$/.exec(text);
  if (!m) return null;
  const [x, y, width, height] = m.slice(1).map(Number);
  if (width <= 0 || height <= 0 || width > 100000 || height > 100000)
    return null;
  if (x <= -30000 || y <= -30000) return null;
  return { rect: { x, y, width, height } };
}

const sameRect = (a, b) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height);

/**
 * Rastreador da janela do jogo. `spawn` e os relógios são injetáveis (teste). `onChange(rect|null)` só é chamado quando
 * o retângulo muda (ou na primeira leitura depois de `refresh()`). Se o filho morre, `onChange(null)` avisa que a
 * posição é desconhecida e ele é reiniciado com espera crescente (até `restartMaxMs`).
 * Retorna { start, stop, refresh, last, running }.
 */
export function createGameTracker({
  onChange = () => {},
  spawn = nodeSpawn,
  platform = process.platform,
  parentPid = process.pid,
  intervalMs = TRACK_INTERVAL_MS,
  fastMs = TRACK_FAST_MS,
  settleMs = TRACK_SETTLE_MS,
  restartBaseMs = 2000,
  restartMaxMs = 30000,
  stableMs = 10000,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
} = {}) {
  let wanted = false;
  let child = null;
  let startedAt = 0;
  let timer = null;
  let delay = restartBaseMs;
  let buffer = "";
  let lastRect = null;
  let forceNext = false;

  const notify = (rect) => {
    try {
      onChange(rect);
    } catch (err) {
      log(
        `falha em onChange do rastreador: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const killQuietly = (proc) => {
    try {
      proc?.kill();
    } catch {
      // Processo já encerrado.
    }
  };

  const report = (rect) => {
    const changed = forceNext || !sameRect(lastRect, rect);
    forceNext = false;
    lastRect = rect;
    if (changed) notify(rect);
  };

  const onData = (chunk) => {
    buffer += String(chunk);
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    if (buffer.length > 4096) buffer = "";
    for (const part of parts) {
      const parsed = parseTrackerLine(part);
      if (!parsed) continue;
      delay = restartBaseMs;
      report(parsed.rect);
    }
  };

  function scheduleRestart() {
    clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      if (wanted && !child) launch();
    }, delay);
    delay = Math.min(delay * 2, restartMaxMs);
  }

  function launch() {
    const { file, args } = trackerCommand({
      parentPid,
      intervalMs,
      fastMs,
      settleMs,
    });
    let proc;
    try {
      proc = spawn(file, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      log(
        `rastreador não iniciou: ${err instanceof Error ? err.message : String(err)}`,
      );
      scheduleRestart();
      return;
    }
    child = proc;
    buffer = "";
    startedAt = now();
    let ended = false;
    const gone = (why) => {
      if (ended) return;
      ended = true;
      if (child !== proc) return; // substituído por refresh() ou parado por stop()
      child = null;
      killQuietly(proc);
      if (now() - startedAt >= stableMs) delay = restartBaseMs;
      log(`rastreador encerrou (${why})`);
      if (lastRect !== null) {
        lastRect = null;
        notify(null);
      }
      if (wanted) scheduleRestart();
    };
    proc.stdout?.on("data", (chunk) => {
      if (child === proc) onData(chunk); // dados de um filho já substituído ou parado são descartados
    });
    proc.stderr?.on("data", (chunk) =>
      log(`rastreador stderr: ${String(chunk).trim().slice(0, 300)}`),
    );
    proc.once("error", (err) =>
      gone(`erro: ${err instanceof Error ? err.message : String(err)}`),
    );
    proc.once("exit", (code) => gone(`saída ${code}`));
  }

  return {
    /** Inicia o filho (só no Windows). Devolve true se está ativo. */
    start() {
      if (platform !== "win32") return false;
      if (wanted) return true;
      wanted = true;
      delay = restartBaseMs;
      launch();
      return true;
    },
    /** Para o rastreador e mata o filho. Não chama `onChange`. */
    stop() {
      wanted = false;
      clearTimer(timer);
      timer = null;
      const proc = child;
      child = null;
      lastRect = null;
      forceNext = false;
      buffer = "";
      killQuietly(proc);
    },
    /** Força nova detecção: reinicia o filho e a próxima leitura chama `onChange` mesmo sem mudança. */
    refresh() {
      if (!wanted) return false;
      clearTimer(timer);
      timer = null;
      const proc = child;
      child = null;
      killQuietly(proc);
      forceNext = true;
      delay = restartBaseMs;
      launch();
      return true;
    },
    /** Último retângulo conhecido (pixels físicos da área cliente) ou null. */
    last: () => lastRect,
    /** O filho está em execução. */
    running: () => child !== null,
  };
}
