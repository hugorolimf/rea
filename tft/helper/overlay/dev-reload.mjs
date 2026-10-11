// Recarregamento automático do overlay quando os arquivos mudam (sem reiniciar o servidor do helper).
//
// - Arquivos que a PÁGINA carrega do servidor (overlay/hud, v2, core): o servidor os lê do disco a cada pedido
//   (static-files.mjs, sem cache em memória), então basta recarregar a janela do HUD (o main guarda layout e modo).
// - Arquivos do PROCESSO PRINCIPAL (main.mjs e tudo que ele importa, inclusive hud/layout.mjs etc.) e o preload: só valem
//   num processo novo, então o Electron se reinicia sozinho (app.relaunch), depois de conferir que o código novo carrega.
// - overlay.config.json editado por fora (não pela gravação do próprio overlay): reinicia para aplicar (atalhos, porta).
// Nada aqui fala com o jogo nem com o servidor. As funções puras (grafo de imports, classificação, agrupamento) são
// testáveis sem Electron; `watchTrees` usa fs.watch (injetável).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Silêncio exigido depois da última mudança antes de recarregar a página: vários agentes gravam em rajadas, e cada
 * recarga derruba o que o usuário está fazendo no HUD.
 */
export const RELOAD_DEBOUNCE_MS = 3000;
/** Espera antes de reiniciar o Electron (o código pode estar no meio de uma edição). */
export const RELAUNCH_DEBOUNCE_MS = 3000;
/** Intervalo mínimo entre duas recargas (ou reinícios) aplicadas. */
export const MIN_APPLY_INTERVAL_MS = 10000;

/**
 * Portão das recargas: junta os pedidos e só os aplica quando nada impede (`isBlocked()` devolve o motivo, ex.:
 * "partida em andamento" ou "modo de edição", ou falso) e no máximo uma vez a cada `minInterval`. Pedido bloqueado fica
 * guardado e sai uma vez só quando `retry()` é chamado depois do desbloqueio; `onDefer(batch, motivo)` avisa uma vez por
 * motivo. `run({ kind, config, files })` aplica; "relaunch" ganha de "reload". Relógio injetável.
 * Devolve `{ request(batch), retry(), pending() }`.
 */
export function createApplyGate({
  run,
  isBlocked = () => false,
  minInterval = MIN_APPLY_INTERVAL_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onDefer = () => {},
}) {
  let pending = null,
    timer = null,
    lastAt = -Infinity,
    deferred = false;
  const merge = (a, b) =>
    a
      ? {
          kind:
            a.kind === "relaunch" || b.kind === "relaunch"
              ? "relaunch"
              : "reload",
          config: !!(a.config || b.config),
          files: [...new Set([...a.files, ...b.files])],
        }
      : { kind: b.kind, config: !!b.config, files: [...(b.files ?? [])] };
  const attempt = () => {
    timer = null;
    if (!pending) return;
    const why = isBlocked();
    if (why) {
      // Um aviso por motivo (ex.: "partida em andamento", "modo de edição"), não um por mudança.
      if (deferred !== why) onDefer(pending, why);
      deferred = why;
      return;
    }
    const wait = lastAt + minInterval - now();
    if (wait > 0) {
      timer = setTimer(attempt, wait);
      return;
    }
    const batch = pending;
    pending = null;
    deferred = false;
    lastAt = now();
    run(batch);
  };
  return {
    request(batch) {
      pending = merge(pending, batch);
      if (timer === null) attempt();
    },
    /** O bloqueio pode ter acabado (saiu do modo interativo, terminou o arraste): tenta de novo. */
    retry() {
      if (pending && timer === null) attempt();
    },
    pending: () => pending,
  };
}

const WATCHED_EXT = new Set([".mjs", ".js", ".cjs", ".css", ".html", ".json"]);

/** Chave de comparação de caminhos (no Windows o sistema de arquivos não diferencia maiúsculas). */
export function pathKey(p, platform = process.platform) {
  const n = path.resolve(p);
  return platform === "win32" ? n.toLowerCase() : n;
}

/**
 * O arquivo interessa ao recarregamento? Só tipos web/código; fora testes, temporários, node_modules e arquivos ocultos.
 */
export function isWatchedFile(file) {
  if (typeof file !== "string" || !file) return false;
  const parts = file.split(/[\\/]+/);
  if (parts.some((p) => p === "node_modules" || p.startsWith(".")))
    return false;
  const base = parts[parts.length - 1];
  if (/\.test\.m?js$/i.test(base) || /\.tmp$/i.test(base)) return false;
  return WATCHED_EXT.has(path.extname(base).toLowerCase());
}

/** Código sem comentários (aproximado: o bastante para os imports citados em comentários não contarem). */
const stripComments = (source) =>
  String(source ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/** Especificadores RELATIVOS importados estaticamente (e por `import("./x")` literal) por um código-fonte ESM. */
export function relativeImports(source) {
  const out = new Set();
  const text = stripComments(source);
  for (const m of text.matchAll(
    /(?:^|[\s;])(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g,
  ))
    out.add(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g))
    out.add(m[1]);
  return [...out];
}

/**
 * Arquivos locais do grafo de imports de `entry` (ele incluído), em caminhos absolutos. `readFile(abs)` devolve o texto
 * ou lança: arquivo que não pôde ser lido (ausente) fica de fora. Imports de pacotes e `node:*` ficam de fora.
 */
export function localImportGraph(entry, readFile) {
  const visited = new Set();
  const found = [];
  const stack = [path.resolve(entry)];
  while (stack.length) {
    const file = stack.pop();
    const key = pathKey(file);
    if (visited.has(key)) continue;
    visited.add(key);
    let source;
    try {
      source = readFile(file);
    } catch {
      continue;
    }
    found.push(file);
    for (const spec of relativeImports(source))
      stack.push(path.resolve(path.dirname(file), spec));
  }
  return found;
}

/**
 * O que fazer com uma mudança em `file`: "config" (overlay.config.json), "relaunch" (código do processo principal ou o
 * preload), "reload" (algo que a página carrega: dentro de `pageRoots`) ou null (não interessa).
 * `mainFiles`: caminhos do grafo do main + preload; `configFile`: overlay.config.json; `pageRoots`: pastas servidas à página.
 */
export function classifyChange(
  file,
  { mainFiles = [], configFile = null, pageRoots = [] },
) {
  if (typeof file !== "string" || !file) return null;
  const key = pathKey(file);
  if (configFile && key === pathKey(configFile)) return "config";
  if (!isWatchedFile(file)) return null;
  if (mainFiles.some((f) => pathKey(f) === key)) return "relaunch";
  if (pageRoots.some((r) => key.startsWith(pathKey(r) + path.sep)))
    return "reload";
  return null;
}

/**
 * Agrupa mudanças em rajada: cada `push(kind, file)` reinicia a espera; no fim chama `onFlush({ kind, config, files })`
 * uma vez, com `kind` "relaunch" se alguma mudança pediu reinício (ou config), senão "reload". A espera é a de reinício
 * quando ele está pendente. Relógio injetável.
 */
export function createChangeBatcher({
  onFlush,
  reloadDelay = RELOAD_DEBOUNCE_MS,
  relaunchDelay = RELAUNCH_DEBOUNCE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let kinds = new Set();
  let files = new Set();
  const fire = () => {
    timer = null;
    const batch = {
      kind:
        kinds.has("relaunch") || kinds.has("config") ? "relaunch" : "reload",
      config: kinds.has("config"),
      files: [...files],
    };
    kinds = new Set();
    files = new Set();
    onFlush(batch);
  };
  return {
    push(kind, file) {
      if (kind !== "reload" && kind !== "relaunch" && kind !== "config") return;
      kinds.add(kind);
      if (file) files.add(file);
      if (timer !== null) clearTimer(timer);
      const slow = kinds.has("relaunch") || kinds.has("config");
      timer = setTimer(fire, slow ? relaunchDelay : reloadDelay);
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      kinds = new Set();
      files = new Set();
    },
    pending: () => timer !== null,
  };
}

/**
 * Observa pastas (`roots`: `[{ dir, recursive }]`) e chama `onEvent(caminhoAbsoluto)` a cada aviso do sistema. Pasta
 * ausente ou erro do observador só vão ao log. `watch` é injetável (padrão fs.watch). Devolve `{ close() }`.
 */
export function watchTrees({
  roots,
  onEvent,
  log = () => {},
  watch = fs.watch,
}) {
  const watchers = [];
  for (const { dir, recursive } of roots) {
    try {
      const w = watch(dir, { recursive: recursive === true }, (_type, name) => {
        if (!name) return;
        onEvent(path.join(dir, String(name)));
      });
      w.on?.("error", (err) =>
        log(`observador de ${dir} falhou: ${err?.message ?? err}`),
      );
      watchers.push(w);
    } catch (err) {
      log(`não foi possível observar ${dir}: ${err?.message ?? err}`);
    }
  }
  return {
    close() {
      for (const w of watchers.splice(0)) {
        try {
          w.close();
        } catch {
          // Já fechado.
        }
      }
    },
  };
}

/** Nomes importados com `import { a, b as c } from "./x"` (relativos), por especificador. */
export function namedLocalImports(source) {
  const out = [];
  for (const m of stripComments(source).matchAll(
    /\bimport\s*\{([^}]*)\}\s*from\s*["'](\.{1,2}\/[^"']+)["']/g,
  )) {
    const names = m[1]
      .split(",")
      .map((n) =>
        n
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter(Boolean);
    out.push({ spec: m[2], names });
  }
  return out;
}

/**
 * Confere, ANTES de reiniciar o Electron, que o código novo do processo principal carrega (roda num processo filho com
 * ELECTRON_RUN_AS_NODE=1, ver dev-check.mjs). `entry`: main.mjs, que importa "electron" e por isso não é executado: só a
 * sintaxe (`--check`) e os nomes que ele importa dos módulos locais. `files`: os outros módulos do grafo, que são
 * importados de verdade (sintaxe e ligações); `.cjs` (o preload) só é compilado. Devolve a lista de problemas (vazia = ok).
 */
export async function checkMainGraph(
  entry,
  files,
  { spawnSync, execPath, vm } = {},
) {
  const problems = [];
  const read = (f) => fs.readFileSync(f, "utf8");
  if (entry) {
    const r = spawnSync(execPath, ["--check", entry], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
    if (r.status !== 0)
      problems.push(
        `${entry}: ${String(r.stderr || r.error?.message || "erro de sintaxe").trim()}`,
      );
    else
      for (const { spec, names } of namedLocalImports(read(entry))) {
        const target = path.resolve(path.dirname(entry), spec);
        try {
          const ns = await import(pathToFileURL(target).href);
          for (const n of names)
            if (!(n in ns)) problems.push(`${entry}: ${spec} não exporta ${n}`);
        } catch (err) {
          problems.push(`${target}: ${err?.message ?? err}`);
        }
      }
  }
  for (const file of files) {
    try {
      if (file.endsWith(".cjs"))
        new vm.Script(
          `(function (exports, require, module, __filename, __dirname) {${read(file)}\n})`,
          { filename: file },
        );
      else await import(pathToFileURL(file).href);
    } catch (err) {
      problems.push(`${file}: ${err?.message ?? err}`);
    }
  }
  return problems;
}
