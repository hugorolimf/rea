// Rodar com: node --test "tft/helper/tests/*.test.mjs"
// Precisão do leitor de tela contra o GEP (screen-accuracy.mjs): a verdade de um quadro só vale parada em volta do instante,
// a barra de baixo escondida conta como "não ler", e cada campo soma acertos, perdas e falsos separados.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTimeline,
  compareBags,
  formatReport,
  rates,
  readOf,
  scoreFrame,
  summarize,
  truthAt,
} from "../screen-accuracy.mjs";

const START = 1000,
  row = (id, dt, feature, key, data) => ({
    id,
    ts: START + dt,
    feature,
    key,
    data: typeof data === "string" ? data : JSON.stringify(data),
  }),
  champions = new Set(["DA_18_Leona", "DA_18_Yorick"]),
  env = {
    isChampion: (n) => champions.has(n),
    isItem: () => true,
    wispOf: (n) =>
      /Wisp/.test(n) ? { id: n, name: null, known: false } : null,
  };

/** Uma partida curta e sintética: roster, ouro, XP, estágio, loja, banco de itens e a loja escondida no carrossel. */
function timeline() {
  const bank = (items) => [
    { summoner: "Hero", tag_line: "T1", bench_items: items },
    {
      summoner: "Outro",
      tag_line: "T2",
      bench_items: [{ name: "DA_Component_BFSword", count: 9 }],
    },
  ];
  return buildTimeline(
    [
      row(1, 0, "roster", "player_status", {
        Hero: { localplayer: true, tag_line: "T1" },
      }),
      row(2, 1, "match_info", "round_type", { stage: "2-1", name: "PVP" }),
      row(3, 1, "store", "shop_visible", "true"),
      row(4, 2, "me", "gold", '"50"'),
      row(5, 2, "me", "xp", { level: "5", current_xp: "10", xp_max: "20" }),
      row(6, 3, "store", "shop_pieces", {
        slot_1: { name: "DA_18_Leona" },
        slot_2: { name: "DA_AbandonWisp18" },
        slot_3: { name: "Sold" },
        slot_4: { name: "DA_18_Yorick" },
        slot_5: { name: "Sold" },
      }),
      row(
        7,
        3,
        "bench",
        "item_bench",
        bank([
          { name: "DA_Component_ChainVest", count: 2 },
          { name: "DA_Consumable_ItemRemover", count: 3 },
        ]),
      ),
      row(8, 20, "me", "gold", '"54"'),
      row(9, 40, "store", "shop_visible", "false"),
      row(10, 40, "match_info", "round_type", {
        stage: "2-4",
        name: "Carousel",
      }),
      row(11, 70, "store", "shop_visible", "true"),
    ],
    env,
  );
}

test("verdade do quadro: o campo só vale parado em volta do instante; sem evento por muito tempo depois do fim não há verdade", () => {
  const tl = timeline();
  const calm = truthAt(tl, START, 10);
  assert.equal(calm.gold, 50);
  assert.equal(calm.level, 5);
  assert.equal(calm.xp, "10/20");
  assert.equal(calm.stage, "2-1");
  assert.deepEqual(calm.items.sort(), [
    "DA_Component_ChainVest",
    "DA_Component_ChainVest",
    "DA_Consumable_ItemRemover",
    "DA_Consumable_ItemRemover",
    "DA_Consumable_ItemRemover",
  ]);
  assert.equal(calm.removers, 3);
  assert.deepEqual(calm.shop, [
    { id: "DA_18_Leona", text: "DA_18_Leona" },
    { wisp: true, text: "DA_AbandonWisp18" },
    null,
    { id: "DA_18_Yorick", text: "DA_18_Yorick" },
    null,
  ]);
  // O ouro muda em t=20: um quadro em t=19 (ou 21) não sabe de que lado do evento está; os outros campos seguem valendo.
  const edge = truthAt(tl, START, 19);
  assert.equal(edge.gold, undefined);
  assert.equal(edge.level, 5);
  assert.equal(truthAt(tl, START, 30).gold, 54);
  // Passado o fim dos eventos (a gravação do vídeo pode ir além): sem verdade.
  assert.deepEqual(truthAt(tl, START, 70 + 60), {});
});

test("loja escondida (carrossel): ouro, nível, XP e loja saem de 'absent'; ler algo ali é falso", () => {
  const tl = timeline(),
    hidden = truthAt(tl, START, 55);
  assert.deepEqual(hidden.absent, ["gold", "level", "xp", "shop"]);
  assert.equal(hidden.gold, undefined);
  assert.equal(hidden.stage, "2-4");
  const ok = scoreFrame(
      {
        gold: null,
        level: null,
        xp: null,
        shop: [null, null, null, null, null],
        stage: "2-4",
      },
      hidden,
    ),
    bad = scoreFrame(
      {
        gold: 12,
        level: null,
        xp: null,
        shop: [null, null, null, null, null],
        stage: "2-4",
      },
      hidden,
    );
  assert.equal(ok.fields.gold.hit, 1);
  assert.equal(bad.fields.gold.wrong, 1);
  assert.deepEqual(
    bad.misses.find((m) => m.field === "gold"),
    { field: "gold", expected: "(oculto)", got: 12 },
  );
});

test("placar de um quadro: acerto, perda (não leu) e falso (leu outra coisa) por campo", () => {
  const truth = truthAt(timeline(), START, 10);
  const read = {
    gold: 52, // falso
    level: 5, // acerto
    xp: null, // perda
    stage: "2-1",
    // Leona acertada, o Wisp lido como texto sem campeão, a carta vendida lida como carta (falso), Yorick perdido
    shop: [
      { text: "Leona", id: "DA_18_Leona" },
      { text: "Poção", id: null },
      { text: "Yorik", id: "DA_18_Yorick" },
      null,
      null,
    ],
    bank: [
      "DA_Consumable_ItemRemover",
      "DA_Component_ChainVest",
      "DA_Component_ChainVest",
      "DA_Component_BFSword",
    ],
    removers: 1,
  };
  const { fields, misses } = scoreFrame(read, truth);
  assert.deepEqual(fields.gold, { n: 1, hit: 0, miss: 0, wrong: 1 });
  assert.deepEqual(fields.level, { n: 1, hit: 1, miss: 0, wrong: 0 });
  assert.deepEqual(fields.xp, { n: 1, hit: 0, miss: 1, wrong: 0 });
  assert.deepEqual(fields.stage, { n: 1, hit: 1, miss: 0, wrong: 0 });
  assert.deepEqual(fields.shop, { n: 5, hit: 3, miss: 1, wrong: 1 });
  // Itens montáveis: os 2 Coletes certos; o BF Sword lido a mais é falso; consumíveis ficam fora da lista de itens.
  assert.deepEqual(fields.items, {
    n: 2,
    hit: 2,
    miss: 0,
    wrong: 1,
    exact: 0,
    frames: 1,
  });
  assert.deepEqual(fields.removers, { n: 1, hit: 0, miss: 0, wrong: 1 });
  assert.ok(misses.some((m) => m.field === "items"));
  assert.ok(misses.some((m) => m.field === "xp" && m.got === null));
});

test("compareBags conta multiconjuntos: repetidos valem um a um", () => {
  assert.deepEqual(compareBags(["a", "a", "b"], ["a", "b", "b"]), {
    hit: 2,
    miss: 1,
    wrong: 1,
  });
  assert.deepEqual(compareBags([], []), { hit: 0, miss: 0, wrong: 0 });
});

test("resumo e relatório: soma os quadros, recall = acertos/casos e precisão = acertos/(acertos+falsos)", () => {
  const t1 = scoreFrame({ gold: 50 }, { gold: 50 }),
    t2 = scoreFrame({ gold: null }, { gold: 50 }),
    t3 = scoreFrame({ gold: 49 }, { gold: 50 }),
    sum = summarize([t1, t2, t3]);
  assert.deepEqual(sum.gold, { n: 3, hit: 1, miss: 1, wrong: 1 });
  assert.deepEqual(rates(sum.gold), { recall: 1 / 3, precision: 1 / 2 });
  const text = formatReport(sum, "Teste");
  assert.match(text, /^Teste\n/);
  assert.match(text, /gold\s+3\s+1\s+1\s+1\s+33\.3%\s+50\.0%/);
  assert.equal(rates({ n: 0, hit: 0, miss: 0, wrong: 0 }).recall, null);
});

test("readOf: o nível sai do número lido e do total do XP, como no servidor", () => {
  const champion = (t) => (t === "Leona" ? "DA_18_Leona" : null);
  const a = readOf(
    { level: 5, xp: "10/20", shop: ["Leona", ""], items: [], removers: 0 },
    champion,
  );
  assert.equal(a.level, 5);
  assert.deepEqual(a.shop, [{ text: "Leona", id: "DA_18_Leona" }, null]);
  // Sem o número, o total do XP diz o nível (4/10 -> nível 4).
  assert.equal(readOf({ level: null, xp: "4/10" }, champion).level, 4);
  assert.equal(readOf({ level: null, xp: null }, champion).level, null);
});
