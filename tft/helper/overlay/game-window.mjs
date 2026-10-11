// Descobre em que monitor está a janela do TFT, só consultando a posição dela (GetWindowRect).
// Não lê memória, não injeta e não toca no processo do jogo; é opt-in (display "game" ou atalho anchor).
import { execFile } from "node:child_process";

/** Processos candidatos à janela do jogo, na ordem de preferência. */
export const GAME_PROCESSES = Object.freeze([
  "TFTClient-Win64-Shipping",
  "League of Legends",
]);

// Uma linha só e sem aspas duplas (o argumento passa por -Command): as aspas do DllImport entram via [char]34.
function buildScript(names) {
  const list = names.map((n) => `'${n}'`).join(",");
  return [
    "$ErrorActionPreference='Stop'",
    "$q=[string][char]34",
    // SetProcessDpiAwarenessContext(-4) = per-monitor v2 (pixels físicos reais em qualquer monitor); SetProcessDPIAware é o recuo.
    "$src='[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } [DllImport(QQuser32.dllQQ)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect); [DllImport(QQuser32.dllQQ)] public static extern bool SetProcessDPIAware(); [DllImport(QQuser32.dllQQ)] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx); public static bool Aware() { try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return true; } catch (Exception) { } try { return SetProcessDPIAware(); } catch (Exception) { return false; } }'.Replace('QQ',$q)",
    "Add-Type -Namespace Tft -Name Win -UsingNamespace System.Runtime.InteropServices -MemberDefinition $src",
    "[void][Tft.Win]::Aware()",
    `$p=Get-Process -Name ${list} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`,
    "if(-not $p){ exit 2 }",
    "$r=New-Object Tft.Win+RECT",
    "if(-not [Tft.Win]::GetWindowRect($p.MainWindowHandle,[ref]$r)){ exit 3 }",
    "Write-Output ('{0},{1},{2},{3}' -f $r.Left,$r.Top,$r.Right,$r.Bottom)",
  ].join("; ");
}

/**
 * Converte a saída "esq,topo,dir,base" (pixels físicos) em {x,y,width,height}.
 * Devolve null para texto inválido, retângulo vazio ou janela minimizada (coordenadas ~ -32000).
 */
export function parseRect(text) {
  if (typeof text !== "string") return null;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const m = /^(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)$/.exec(
    lines.at(-1) ?? "",
  );
  if (!m) return null;
  const [left, top, right, bottom] = m.slice(1).map(Number);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0 || width > 100000 || height > 100000)
    return null;
  if (left <= -30000 || top <= -30000) return null;
  return { x: left, y: top, width, height };
}

/**
 * Retângulo da janela do TFT em pixels físicos, ou null (processo ausente, timeout, PowerShell indisponível).
 * `exec` é injetável para teste.
 */
export function findGameRect({
  exec = execFile,
  timeoutMs = 4000,
  platform = process.platform,
} = {}) {
  if (platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      exec(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          buildScript(GAME_PROCESSES),
        ],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 },
        (err, stdout) => resolve(err ? null : parseRect(String(stdout))),
      );
    } catch {
      resolve(null);
    }
  });
}
