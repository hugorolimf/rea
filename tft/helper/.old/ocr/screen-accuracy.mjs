// Precisão do leitor de tela contra o GEP (Overwolf/TFTAcademy) como gabarito, campo a campo.
// O GEP só serve de verdade aqui: é a fonte observada que o helper dispensa quando a tela basta. Cada partida gravada
// (eventos do GEP + vídeo do TFTAcademy, ou recortes já guardados em tests/fixtures/screen/) vira quadros com a verdade
// esperada; o leitor lê o quadro a frio e `scoreFrame` conta, por campo, acertos, perdas (não leu) e falsos (leu errado).
// ESM puro: recebe linhas de eventos e leituras já normalizadas, não abre banco nem arquivo de imagem.
import { applyGepEvent, emptyGepState } from "./gep-reader.mjs";
import { isConsumable } from "./core/catalog/items.mjs";
import { reconcileLevel } from "./rules.mjs";
import { readFrame } from "./screen-reader.mjs";

/** Campos medidos, na ordem em que o relatório os lista. */
export const FIELDS = [
  "gold",
  "level",
  "xp",
  "stage",
  "shop",
  "items",
  "removers",
  "bench",
];

/** Janela (s) em que o valor da verdade precisa ficar parado em volta do quadro: absorve o erro de alinhamento do relógio. */
export const SETTLE_S = 2.5;

/**
 * Linha do tempo da verdade: reduz as linhas `{id, ts, feature, key, data}` (só os pares do jogador local que o leitor
 * do GEP aceita) e guarda o estado depois de cada uma, com o necessário para comparar com a tela. `env` é o catálogo
 * (`{isChampion, isItem, wispOf}`), como em `applyGepEvent`.
 */
export function buildTimeline(rows, env = {}) {
  const state = emptyGepState(),
    timeline = [];
  for (const row of rows) {
    applyGepEvent(state, row, env);
    timeline.push({
      ts: row.ts,
      kind: row.key,
      gold: state.gold?.value ?? null,
      level: state.level?.value ?? null,
      xp: state.xp?.value ?? null,
      stage: state.stage?.value ?? null,
      round: state.stage?.name ?? null,
      shopVisible: state.shopVisible,
      shop: state.shop?.value?.map(slotOf) ?? null,
      bank: state.items?.bank ?? null,
      removers: state.items?.removers ?? null,
      bench: state.bench?.value?.map(unitOf) ?? null,
    });
  }
  return timeline;
}

const slotOf = (card) =>
  card === null
    ? null
    : card.wisp
      ? { wisp: true, text: card.text }
      : { id: card.id ?? null, text: card.text };
const unitOf = (u) => ({ id: u.id, stars: u.stars, cell: u.cell });

/** Estado da verdade no instante `at` (s desde o início da partida): a última entrada com `ts - startedAt <= at`. */
export function stateAt(timeline, startedAt, at) {
  let found = null;
  for (const e of timeline) {
    if (e.ts - startedAt <= at) found = e;
    else break;
  }
  return found;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Verdade de um quadro: o valor de cada campo só vale se não mudou em [at - settle, at + settle] (mudança perto do quadro
 * é ambígua: a imagem e o evento não têm o mesmo relógio). Campo instável ou desconhecido fica `undefined`. Com a loja
 * escondida (`shop_visible false`: carrossel, escolha de aprimoramento) a barra de baixo (ouro, nível, XP, loja) não está
 * na tela e esses campos também ficam `undefined`: não é falha do leitor não os ler.
 */
export function truthAt(timeline, startedAt, at, settle = SETTLE_S) {
  const first = stateAt(timeline, startedAt, at - settle),
    last = stateAt(timeline, startedAt, at + settle);
  if (!first || !last) return {};
  // Depois do último evento gravado não há verdade: o vídeo pode seguir (a gravação do TFTAcademy às vezes passa do fim do banco).
  if (at - settle > timeline[timeline.length - 1].ts - startedAt + 30)
    return {};
  const window = timeline.filter((e) => {
    const t = e.ts - startedAt;
    return t > at - settle && t <= at + settle;
  });
  const stable = (name) =>
    window.every((e) => same(e[name], first[name])) &&
    same(first[name], last[name])
      ? (last[name] ?? undefined)
      : undefined;
  const hud =
    window.every((e) => e.shopVisible !== false) && first.shopVisible !== false;
  const out = {
    stage: stable("stage"),
    items: stable("bank"),
    removers: stable("removers"),
    bench: stable("bench"),
  };
  if (hud) {
    out.gold = stable("gold");
    out.level = stable("level");
    out.xp = stable("xp");
    out.shop = stable("shop");
  } else if (
    window.every((e) => e.shopVisible === false) &&
    first.shopVisible === false
  ) {
    // Barra de baixo escondida (carrossel, escolha de aprimoramento): o certo é não ler nada dela.
    out.absent = ["gold", "level", "xp", "shop"];
  }
  if (out.items) out.removers ??= 0;
  return Object.fromEntries(
    Object.entries(out).filter(([, v]) => v !== undefined && v !== null),
  );
}

/**
 * O que o servidor veria de uma linha do leitor lida a frio: `readFrame` com o nível reconciliado do número lido e do total do
 * XP (`reconcileLevel`, sem leitura anterior). `champion` resolve o nome da carta da loja (`championResolver`).
 */
export function readOf(event, champion) {
  const frame = readFrame(event, { champion }),
    level = reconcileLevel({
      ocr: frame.level,
      xp: frame.xp,
      prevXp: null,
      held: null,
      trusted: false,
    });
  return { ...frame, level: level.level };
}

/** Contagem de acertos de duas listas como multiconjuntos: `{hit, miss, wrong}` (perdidos e falsos). */
export function compareBags(truth, read) {
  const left = new Map();
  for (const id of read) left.set(id, (left.get(id) ?? 0) + 1);
  let hit = 0;
  for (const id of truth) {
    const n = left.get(id) ?? 0;
    if (n > 0) {
      left.set(id, n - 1);
      hit++;
    }
  }
  const wrong = [...left.values()].reduce((sum, n) => sum + n, 0);
  return { hit, miss: truth.length - hit, wrong };
}

const tally = () => ({ n: 0, hit: 0, miss: 0, wrong: 0 });
const add = (t, outcome) => {
  t.n++;
  t[outcome]++;
};

/**
 * Compara a leitura de um quadro com a verdade. `read` = `{gold, level, xp, stage, shop: [{text, id}|null] x5, items,
 * bank, removers, bench}` (já normalizada: nulo = não lido). Devolve `{field: {n, hit, miss, wrong}}` só dos campos com
 * verdade, e `misses`: o que errou, para o relatório mostrar exemplos.
 */
export function scoreFrame(read, truth) {
  const out = {},
    misses = [],
    note = (field, expected, got) => misses.push({ field, expected, got });
  for (const name of truth.absent ?? []) {
    const t = (out[name] ??= tally()),
      got =
        name === "shop"
          ? (read.shop ?? []).filter(Boolean).length || null
          : (read[name] ?? null);
    add(t, got === null ? "hit" : "wrong");
    if (got !== null) note(name, "(oculto)", got);
  }
  for (const name of ["gold", "level", "xp", "stage"]) {
    if (truth[name] === undefined) continue;
    const t = (out[name] = tally()),
      got = read[name] ?? null;
    if (got === null) {
      add(t, "miss");
      note(name, truth[name], null);
    } else if (String(got) === String(truth[name])) add(t, "hit");
    else {
      add(t, "wrong");
      note(name, truth[name], got);
    }
  }
  if (truth.shop) {
    const t = (out.shop = tally());
    truth.shop.forEach((slot, i) => {
      const got = read.shop?.[i] ?? null;
      let outcome;
      if (slot === null) outcome = got === null ? "hit" : "wrong";
      else if (got === null) outcome = "miss";
      else if (slot.wisp) outcome = got.id ? "wrong" : "hit";
      else outcome = got.id === slot.id ? "hit" : got.id ? "wrong" : "miss";
      add(t, outcome);
      if (outcome !== "hit")
        note(
          `shop${i}`,
          slot?.id ?? slot?.text ?? null,
          got?.id ?? got?.text ?? null,
        );
    });
  }
  if (truth.items) {
    // Itens para montar (o banco sem consumíveis): contagem por multiconjunto; consumíveis só entram em `removers`.
    const t = (out.items = { ...tally(), exact: 0, frames: 1 }),
      want = truth.items.filter((id) => !isConsumable(id)),
      got = (read.bank ?? read.items ?? []).filter((id) => !isConsumable(id)),
      c = compareBags(want, got);
    t.n = want.length;
    t.hit = c.hit;
    t.miss = c.miss;
    t.wrong = c.wrong;
    t.exact = c.miss === 0 && c.wrong === 0 ? 1 : 0;
    if (!t.exact) note("items", want, got);
  }
  if (truth.removers !== undefined && truth.items) {
    const t = (out.removers = tally()),
      got = read.removers ?? null;
    if (got === null || got === undefined) {
      add(t, "miss");
      note("removers", truth.removers, null);
    } else if (got === truth.removers) add(t, "hit");
    else {
      add(t, "wrong");
      note("removers", truth.removers, got);
    }
  }
  if (truth.bench) {
    // Reserva por posição (célula 1..9): ocupada ou não, e o campeão quando a leitura o identifica.
    const t = (out.bench = tally()),
      bySlot = new Map(truth.bench.map((u) => [u.cell, u])),
      cells = read.bench?.cells ?? null;
    if (cells) {
      for (let cell = 1; cell <= cells.length; cell++) {
        const want = bySlot.get(cell),
          got = cells[cell - 1];
        add(
          t,
          Boolean(want) === Boolean(got) ? "hit" : want ? "miss" : "wrong",
        );
        if (Boolean(want) !== Boolean(got))
          note(`bench${cell}`, want?.id ?? null, got ? "ocupada" : null);
      }
    }
  }
  return { fields: out, misses };
}

/** Soma os placares de vários quadros por campo. */
export function summarize(scores) {
  const sum = {};
  for (const { fields } of scores)
    for (const [name, t] of Object.entries(fields)) {
      const s = (sum[name] ??= {
        ...tally(),
        ...(name === "items" ? { exact: 0, frames: 0 } : {}),
      });
      for (const k of Object.keys(t)) s[k] = (s[k] ?? 0) + t[k];
    }
  return sum;
}

/** `{acerto, recall, precisao}` em fração (null sem casos): recall = acertos / casos; precisão = acertos / (acertos + falsos). */
export function rates(t) {
  const frac = (a, b) => (b > 0 ? a / b : null);
  return {
    recall: frac(t.hit, t.n),
    precision: frac(t.hit, t.hit + t.wrong),
  };
}

const pct = (v) =>
  v === null ? "  -  " : `${(v * 100).toFixed(1).padStart(5)}%`;

/** Tabela de texto do relatório: um campo por linha, com casos, acertos, perdas, falsos, recall e precisão. */
export function formatReport(
  summary,
  title = "Precisão do leitor de tela contra o GEP",
) {
  const lines = [
    title,
    "campo      casos  acertos  perdas  falsos   recall  precisão",
  ];
  for (const name of FIELDS) {
    const t = summary[name];
    if (!t) continue;
    const r = rates(t);
    lines.push(
      `${name.padEnd(9)} ${String(t.n).padStart(6)} ${String(t.hit).padStart(8)} ${String(t.miss).padStart(7)} ${String(t.wrong).padStart(7)}  ${pct(r.recall)}  ${pct(r.precision)}${t.frames ? `   quadros exatos ${t.exact}/${t.frames}` : ""}`,
    );
  }
  return lines.join("\n");
}
