// Mantém um único processo leitor de tela (screen-reader.ps1) vivo só enquanto há partida em andamento.
// O script emite uma linha JSON apenas quando alguma leitura muda, então o custo em repouso é mínimo.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
// Animações e painéis cobrem o HUD por instantes: um valor que some só é descartado depois deste prazo,
// e o banco de itens só muda quando a nova leitura se mantém por ITEMS_SETTLE_MS.
const HOLD_MS = 15000,
  ITEMS_SETTLE_MS = 3000,
  OBSCURED_SLOTS = 5;
/** Cria o leitor; `candidates` é a lista [{id,file}] de ícones de item a reconhecer no banco. */
const fold = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = keep;
    }
  }
  return row[b.length];
}
/** `champions` é [{id,names:[...]}] com os nomes em cada idioma do cliente; usado para reconhecer a loja. */
export function screenReader(root, candidates, champions = [], augments = []) {
  // Aprimoramentos: nome exato ou com poucos erros de OCR. O set atual vem primeiro para ganhar em nomes repetidos.
  const augmentKeys = [...augments]
    .sort((a, b) => b.set - a.set)
    .flatMap((a) =>
      [a.name, a.nameEn]
        .filter(Boolean)
        .map((name) => ({ id: a.id, key: fold(name) })),
    )
    .filter((k) => k.key.length >= 5);
  const augmentExact = new Map();
  for (const k of augmentKeys)
    if (!augmentExact.has(k.key)) augmentExact.set(k.key, k.id);
  function augment(text) {
    const key = fold(text);
    if (key.length < 5) return null;
    const exact = augmentExact.get(key);
    if (exact) return exact;
    if (key.length < 8) return null;
    let best = null,
      bestD = 3;
    for (const k of augmentKeys) {
      if (Math.abs(k.key.length - key.length) > 2) continue;
      const d = distance(key, k.key);
      if (d < bestD) {
        bestD = d;
        best = k.id;
      }
    }
    return best;
  }
  let augmentChoice = null,
    augmentMisses = 0;
  const known = champions
    .flatMap((c) => c.names.map((name) => ({ id: c.id, key: fold(name) })))
    .filter((k) => k.key.length > 1);
  // Aceita o nome exato ou com poucos erros de OCR, desde que haja um único campeão mais próximo.
  function champion(text) {
    const key = fold(text);
    if (key.length < 2) return null;
    const exact = known.find((k) => k.key === key);
    if (exact) return exact.id;
    const limit = key.length <= 4 ? 1 : 2;
    let best = null,
      bestD = limit + 1,
      tie = false;
    for (const k of known) {
      const d = distance(key, k.key);
      if (d < bestD) {
        bestD = d;
        best = k.id;
        tie = false;
      } else if (d === bestD && k.id !== best) tie = true;
    }
    return best && !tie ? best : null;
  }
  const script = path.join(root, "screen-reader.ps1"),
    candidatesPath = path.join(root, "../data/item-icon-candidates.json");
  let child = null,
    starting = false,
    error = null,
    windowVisible = null,
    itemsTimer = null;
  // missingSince marca quando o script passou a reportar o campo como não lido (0 = lido na última leitura).
  const fields = {
    gold: { value: null, missingSince: 0 },
    level: { value: null, missingSince: 0 },
    xp: { value: null, missingSince: 0 },
    stage: { value: null, missingSince: 0 },
  };
  let items = null,
    unknownItems = 0,
    shop = null,
    removers = null;
  function reset() {
    augmentChoice = null;
    augmentMisses = 0;
    windowVisible = null;
    items = null;
    unknownItems = 0;
    shop = null;
    removers = null;
    clearTimeout(itemsTimer);
    for (const f of Object.values(fields)) {
      f.value = null;
      f.missingSince = 0;
    }
  }
  function accept(event) {
    windowVisible = event.window === true;
    if (!windowVisible) return;
    const now = Date.now();
    const read = {
      gold: Number.isInteger(event.gold) ? event.gold : null,
      level: Number.isInteger(event.level) ? event.level : null,
      xp: typeof event.xp === "string" ? event.xp : null,
      stage:
        typeof event.stage === "string" && /^\d-\d$/.test(event.stage)
          ? event.stage
          : null,
    };
    for (const [name, value] of Object.entries(read)) {
      if (value !== null) {
        fields[name].value = value;
        fields[name].missingSince = 0;
      } else if (!fields[name].missingSince) fields[name].missingSince = now;
    }
    if (Array.isArray(event.band)) {
      const found = [
        ...new Set(
          event.band
            .map((line) => (typeof line === "string" ? augment(line) : null))
            .filter(Boolean),
        ),
      ].slice(0, 3);
      if (found.length >= 2) {
        augmentChoice = found;
        augmentMisses = 0;
      } else if (++augmentMisses >= 2) augmentChoice = null;
    }
    if (Array.isArray(event.shop))
      shop = event.shop.map((text) => {
        const raw = typeof text === "string" ? text.trim() : "";
        return raw ? { text: raw, id: champion(raw) } : null;
      });
    const unknown = Number.isInteger(event.unknownItems)
      ? event.unknownItems
      : 0;
    if (unknown >= OBSCURED_SLOTS || !Array.isArray(event.items)) return;
    const next = event.items.filter(
        (i) => typeof i === "string" && !/Consumable_|Reforger/.test(i),
      ),
      nextRemovers = Number.isInteger(event.removers) ? event.removers : null;
    clearTimeout(itemsTimer);
    itemsTimer = setTimeout(() => {
      items = next;
      unknownItems = unknown;
      removers = nextRemovers;
    }, ITEMS_SETTLE_MS);
    itemsTimer.unref();
  }
  async function start() {
    if (child || starting) return;
    starting = true;
    try {
      await fs.writeFile(candidatesPath, JSON.stringify(candidates));
      const proc = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-File",
          script,
          "-Candidates",
          candidatesPath,
          "-ParentPid",
          String(process.pid),
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      child = proc;
      error = null;
      let buffer = "";
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk) => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at).trim();
          buffer = buffer.slice(at + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (event.error) error = String(event.error);
            else {
              error = null;
              accept(event);
            }
          } catch {}
        }
      });
      proc.on("error", (e) => {
        error = e.message;
        if (child === proc) child = null;
      });
      proc.on("exit", () => {
        if (child === proc) child = null;
      });
    } catch (e) {
      error = e.message;
    } finally {
      starting = false;
    }
  }
  function stop() {
    const proc = child;
    child = null;
    reset();
    proc?.kill();
  }
  const held = (name) => {
    const f = fields[name];
    return f.missingSince && Date.now() - f.missingSince > HOLD_MS
      ? null
      : f.value;
  };
  return {
    /** Liga com partida em andamento e desliga quando a fase é outra; null (fase desconhecida) mantém como está. */
    sync(active) {
      if (active === true) void start();
      else if (active === false && child) stop();
    },
    /** Última leitura; campos nulos significam "não lido", nunca zero. */
    status() {
      return {
        running: !!child,
        error,
        window: windowVisible,
        stage: held("stage"),
        gold: held("gold"),
        level: held("level"),
        xp: held("xp"),
        items: windowVisible ? items : null,
        unknownItems: windowVisible ? unknownItems : 0,
        shop: windowVisible ? shop : null,
        removers: windowVisible ? removers : null,
        augments: windowVisible && child ? augmentChoice : null,
      };
    },
    /** Grava uma captura da tela principal inteira para calibrar as regiões lidas. */
    capture(file) {
      return new Promise((resolve, reject) => {
        let out = "";
        const proc = spawn(
          "powershell.exe",
          ["-NoProfile", "-File", script, "-FullPng", file],
          { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
        );
        proc.stdout.setEncoding("utf8");
        proc.stdout.on("data", (c) => (out += c));
        proc.on("error", reject);
        proc.on("exit", (code) => {
          try {
            if (code !== 0)
              throw Error("Captura falhou (código " + code + ").");
            resolve(JSON.parse(out.trim()));
          } catch (e) {
            reject(e);
          }
        });
      });
    },
    stop,
  };
}
