// Mantém um único processo leitor de tela (screen-reader.ps1) vivo só enquanto há partida em andamento.
// O script emite uma linha JSON apenas quando alguma leitura muda, então o custo em repouso é mínimo.
import { reconcileLevel } from "./rules.mjs";
import { CONSUMABLE } from "./item-tiers.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
// Animações e painéis cobrem o HUD por instantes: um valor que some continua valendo até a próxima leitura
// (o leitor é zerado no início e no fim da partida) e só é marcado como não confirmado depois de HOLD_MS.
// O banco de itens só muda quando a nova leitura se mantém por ITEMS_SETTLE_MS; com OBSCURED_SLOTS ou mais espaços
// não reconhecidos (algo cobrindo o banco, ou itens sem ícone no catálogo) o que se reconheceu vale igual, mas só
// depois de OBSCURED_SETTLE_FACTOR vezes esse prazo, para uma cobertura passageira não apagar nem trocar o banco.
// Leitor que cai só é relançado depois de RETRY_MS, dobrando a cada queda até RETRY_MAX_MS.
const HOLD_MS = 15000,
  ITEMS_SETTLE_MS = 3000,
  OBSCURED_SLOTS = 5,
  OBSCURED_SETTLE_FACTOR = 3,
  RETRY_MS = 30000,
  RETRY_MAX_MS = 300000,
  STDERR_TAIL = 600;
// Consumíveis ocupam espaço no banco, mas não são itens para montar: ficam fora da análise (`items`) e dentro de `bank`.
const NOT_BUILDABLE = CONSUMABLE;
// Número vindo do script (às vezes texto, com ponto decimal fixo); null se não for número.
const number = (v) => {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v.replace(",", "."))
        : NaN;
  return Number.isFinite(n) ? n : null;
};
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
/**
 * Cria o leitor; `candidates` é a lista [{id,file}] de ícones de item a reconhecer no banco.
 * `champions` é [{id,names:[...]}] com os nomes em cada idioma do cliente; usado para reconhecer a loja.
 * `options.launch` troca o `spawn` do leitor e `options.settleMs` o prazo do banco de itens (testes).
 */
export function screenReader(
  root,
  candidates,
  champions = [],
  augments = [],
  { launch = spawn, settleMs = ITEMS_SETTLE_MS } = {},
) {
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
    itemsTimer = null,
    pendingItemsKey = null,
    // Última queda do processo ({code, at, wait}) e a espera aplicada à próxima.
    lastExit = null,
    retryMs = RETRY_MS;
  // Processos encerrados por stop(): a saída deles não conta como queda.
  const stopped = new WeakSet();
  // missingSince marca quando o script passou a reportar o campo como não lido (0 = lido na última leitura).
  const fields = {
    gold: { value: null, missingSince: 0 },
    level: { value: null, missingSince: 0 },
    xp: { value: null, missingSince: 0 },
    stage: { value: null, missingSince: 0 },
  };
  // Como o nível retido foi obtido: "ocr+xp", "ocr", "xp" (inferido do total do XP) ou "held"; conflito e empate de XP.
  let levelMeta = null,
    items = null,
    bank = null,
    unknownItems = 0,
    shop = null,
    removers = null,
    // Diagnóstico ao vivo do banco (sem imagem): o que o leitor pensou de cada espaço e onde achou a coluna.
    bankDebug = null,
    bankGeometry = null;
  function reset() {
    bankDebug = null;
    bankGeometry = null;
    augmentChoice = null;
    augmentMisses = 0;
    windowVisible = null;
    items = null;
    bank = null;
    unknownItems = 0;
    shop = null;
    removers = null;
    levelMeta = null;
    clearTimeout(itemsTimer);
    pendingItemsKey = null;
    retryMs = RETRY_MS;
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
    // Nível: o número lido e o total do XP mostrado ("4/10" → 4) se conferem. Sem o número, o total diz o nível
    // (empate 2 ou 68 pelo último nível; XP menor que a leitura anterior com o mesmo total indica subida, 8 → 9). Com
    // os dois em conflito vale o plausível em relação ao último nível (ver reconcileLevel). Só o XP desta leitura
    // corrobora o número: o retido de antes pode ser de outro nível. Lido antes de sobrescrever os campos.
    const reconciled = reconcileLevel({
      ocr: read.level,
      xp: read.xp,
      prevXp: fields.xp.value,
      held: fields.level.value,
      trusted: !stale("level"),
    });
    read.level = reconciled.level;
    if (reconciled.level !== null)
      levelMeta = {
        source: reconciled.source,
        conflict: reconciled.conflict,
        ambiguous: reconciled.ambiguous,
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
      // A oferta fica até chegar outra (ou a partida acabar): sair do painel para olhar o tabuleiro não a apaga.
      // O servidor a descarta quando uma das cartas é marcada como escolhida.
      if (found.length >= 2) {
        augmentChoice = found;
        augmentMisses = 0;
      }
    }
    if (Array.isArray(event.shop))
      shop = event.shop.map((text) => {
        const raw = typeof text === "string" ? text.trim() : "";
        return raw ? { text: raw, id: champion(raw) } : null;
      });
    // Diagnóstico por espaço: melhor candidato (best) com a distância do 1º (d1) e a do melhor de outra família (d2); mean e
    // spread = brilho médio e desvio da assinatura (espaço vazio é escuro e liso). Não passa pelo debounce: é a leitura de agora.
    if (Array.isArray(event.bankDebug))
      bankDebug = event.bankDebug
        .filter((s) => s && Number.isInteger(s.slot))
        .map((s) => ({
          slot: s.slot,
          value: typeof s.value === "string" ? s.value : "",
          best: typeof s.best === "string" ? s.best : null,
          d1: number(s.d1),
          d2: number(s.d2),
          mean: number(s.mean),
          spread: number(s.spread),
          kept: s.kept === true,
        }));
    if (event.bankGeo && typeof event.bankGeo === "object")
      bankGeometry = {
        mode: event.bankGeo.mode === "frame" ? "frame" : "assumed",
        x: number(event.bankGeo.x),
        ncc: number(event.bankGeo.ncc),
        contrast: number(event.bankGeo.contrast),
        client:
          typeof event.bankGeo.client === "string"
            ? event.bankGeo.client
            : null,
      };
    const unknown = Number.isInteger(event.unknownItems)
      ? event.unknownItems
      : 0;
    if (!Array.isArray(event.items)) return;
    // Espaços reconhecidos, na ordem do banco e repetidos como estão (dois itens iguais são dois espaços).
    // Espaços não reconhecidos não derrubam os reconhecidos: seguem contados em unknownItems.
    const nextBank = event.items.filter((i) => typeof i === "string"),
      next = nextBank.filter((i) => !NOT_BUILDABLE.test(i)),
      nextRemovers = Number.isInteger(event.removers) ? event.removers : null;
    // O debounce só recomeça quando a leitura do banco muda: outros campos mudando não adiam a aplicação.
    const key = JSON.stringify([nextBank, unknown, nextRemovers]);
    if (key === pendingItemsKey) return;
    clearTimeout(itemsTimer);
    // Voltou ao valor já aplicado (leitura errada passageira): nada a aplicar.
    if (key === JSON.stringify([bank, unknownItems, removers])) {
      pendingItemsKey = null;
      return;
    }
    pendingItemsKey = key;
    itemsTimer = setTimeout(
      () => {
        items = next;
        bank = nextBank;
        unknownItems = unknown;
        removers = nextRemovers;
        pendingItemsKey = null;
      },
      unknown >= OBSCURED_SLOTS ? settleMs * OBSCURED_SETTLE_FACTOR : settleMs,
    );
    itemsTimer.unref();
  }
  async function start() {
    if (child || starting) return;
    if (lastExit && Date.now() - lastExit.at < lastExit.wait) return;
    starting = true;
    try {
      await fs.writeFile(candidatesPath, JSON.stringify(candidates));
      const proc = launch(
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
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      child = proc;
      // O erro anterior só é limpo quando chega um evento válido, para a interface não piscar entre erro e ok.
      let buffer = "",
        stderr = "",
        reported = false,
        ended = false;
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-STDERR_TAIL);
      });
      // Queda (não pedida por stop): registra código e horário e dobra a espera até a próxima tentativa.
      const crash = (code, message) => {
        if (ended) return;
        ended = true;
        if (child === proc) child = null;
        if (stopped.has(proc)) return;
        lastExit = { code, at: Date.now(), wait: retryMs };
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
        if (message) error = message;
        else if (!reported) {
          const tail = stderr.trim().split(/\r?\n/).slice(-3).join(" | ");
          error =
            "leitor encerrou (código " + code + ")" + (tail ? ": " + tail : "");
        }
      };
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
            if (event.error) {
              error = String(event.error);
              reported = true;
              // Sem leitura enquanto dura o erro: os valores retidos ficam velhos depois de HOLD_MS.
              const now = Date.now();
              for (const f of Object.values(fields))
                if (!f.missingSince) f.missingSince = now;
            } else {
              error = null;
              retryMs = RETRY_MS;
              accept(event);
            }
          } catch {}
        }
      });
      proc.on("error", (e) => crash(null, e.message));
      proc.on("exit", (code) => crash(code, null));
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
    if (proc) {
      stopped.add(proc);
      proc.kill();
    }
  }
  const stale = (name) => {
    const f = fields[name];
    return (
      f.value !== null &&
      !!f.missingSince &&
      Date.now() - f.missingSince > HOLD_MS
    );
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
        stage: fields.stage.value,
        gold: fields.gold.value,
        level: fields.level.value,
        levelSource:
          fields.level.value === null ? null : (levelMeta?.source ?? null),
        levelConflict: levelMeta?.conflict === true,
        levelAmbiguous: levelMeta?.ambiguous === true,
        xp: fields.xp.value,
        // Campos mantidos da última leitura, sem confirmação há mais de HOLD_MS (tela coberta).
        stale: Object.fromEntries(
          Object.keys(fields).map((k) => [k, stale(k)]),
        ),
        // Itens para a análise (sem consumíveis) e o banco inteiro como foi lido, para a interface mostrar tudo.
        items: windowVisible ? items : null,
        bank: windowVisible ? bank : null,
        unknownItems: windowVisible ? unknownItems : 0,
        shop: windowVisible ? shop : null,
        removers: windowVisible ? removers : null,
        // Por espaço do banco: valor, melhor candidato, d1, d2, brilho e desvio; e onde a coluna foi achada
        // (mode "frame" = moldura confirmada; "assumed" = suposta, leitura mais rígida). Ver FONTES-DE-DADOS.md.
        bankDebug: windowVisible ? bankDebug : null,
        bankGeometry: windowVisible ? bankGeometry : null,
        augments: child ? augmentChoice : null,
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
