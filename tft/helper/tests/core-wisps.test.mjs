// Rodar com: node --test tft/helper/tests/core-wisps.test.mjs
// Wisps (fogos-fátuos) do Set 18: catálogo real (wisps.json, gerado por build-wisps.mjs), identificação na loja,
// regra de compra (core/catalog/wisps.mjs) e a garantia de que um Wisp nunca vira alvo de rolagem (a loja que o
// motor lê só tem ids de campeões).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  WISP_CATEGORIES,
  WISP_CONDITIONS,
  WISP_TYPES,
  WISP_VERDICTS,
  classifyWisp,
  createWispBook,
  decideWisp,
  inZeroCostWindow,
  isWisp,
  resolveWisp,
  withoutWisps,
  wispsInShop,
  wispsOfScreen,
} from "../core/catalog/wisps.mjs";
import { analysisInputs } from "../core/state/inputs.mjs";
import { parseShop } from "../gep-reader.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
const file = readJson("wisps.json"),
  wisps = file.wisps,
  byId = new Map(wisps.map((w) => [w.id, w])),
  book = createWispBook(wisps),
  catalog = readJson("catalog.json"),
  champions = new Set(catalog.champions.map((c) => c.apiName));
const wisp = (id) => {
  const w = byId.get(id);
  assert.ok(w, `${id} deveria estar em wisps.json`);
  return w;
};

/* ---------- Catálogo real e classificação ---------- */

test("wisps.json: só Wisps do Set 18, com identidade, descrição e tipo válidos", () => {
  assert.ok(
    wisps.filter((w) => !w.melhorado).length >= 150,
    "cerca de 170 Wisps base",
  );
  assert.equal(new Set(wisps.map((w) => w.id)).size, wisps.length);
  for (const w of wisps) {
    assert.match(w.id, /^DA_/, w.id);
    assert.ok(w.name && w.desc, `${w.id}: nome e descrição do catálogo`);
    assert.ok(!/TFT16_|TFT15_/.test(w.id), "nada dos zaps de outros sets");
    assert.ok(WISP_TYPES.includes(w.tipo), `${w.id}: tipo ${w.tipo}`);
    assert.ok(
      w.categoria === null || WISP_CATEGORIES.includes(w.categoria),
      `${w.id}: categoria ${w.categoria}`,
    );
    assert.equal(w.naoClassificado, w.categoria === null, w.id);
    assert.ok(
      w.condicaoTipo === null || WISP_CONDITIONS.includes(w.condicaoTipo),
      `${w.id}: condição ${w.condicaoTipo}`,
    );
    assert.equal(w.condicional, w.condicaoTipo !== null, w.id);
    assert.equal(w.exigePosicao, w.condicaoTipo === "posicao", w.id);
    if (w.melhorado) assert.ok(byId.has(w.baseId), `${w.id}: base ${w.baseId}`);
  }
  // O que não foi classificado fica listado (e declarado), não escondido.
  assert.deepEqual(
    file.naoClassificados.slice().sort(),
    wisps
      .filter((w) => w.naoClassificado)
      .map((w) => w.id)
      .sort(),
  );
  assert.equal(file.counts.entradas, wisps.length);
});

test("wisps.json: a classificação gravada é a da regra do núcleo (sem deriva entre script e regra)", () => {
  for (const w of wisps) {
    const c = classifyWisp({ desc: w.desc });
    assert.equal(c.categoria, w.categoria, w.id);
    assert.equal(c.condicaoTipo, w.condicaoTipo, w.id);
    assert.equal(c.condicao, w.condicao, w.id);
    assert.equal(c.exigePosicao, w.exigePosicao, w.id);
  }
});

test("classificação: exemplos conferidos com a descrição real do catálogo", () => {
  // Custo 0 (notas 18.4): Drizzle, Grove Armor e Returning Friend; Room for a Shroom não está no catálogo.
  for (const id of [
    "DA_18_Drizzle",
    "DA_18_GroveArmor",
    "DA_FoundBigFriend18",
  ]) {
    assert.equal(wisp(id).tipo, "custo0", id);
    assert.equal(wisp(id).custo.ouro, 0, id);
  }
  assert.ok(file.ausentesNoCatalogo.includes("Room for a Shroom"));
  // Condicional por posição (obriga a entortar o tabuleiro).
  for (const id of [
    "DA_18_Fellowship",
    "DA_StandAlone18",
    "DA_SolitudesCloak18",
  ]) {
    assert.equal(wisp(id).condicaoTipo, "posicao", id);
    assert.equal(wisp(id).exigePosicao, true, id);
    assert.equal(wisp(id).tipo, "condicional", id);
  }
  // Condicional por classe/traço, por evento de combate e por estado.
  assert.equal(wisp("DA_MarksmensGale18").condicaoTipo, "traco");
  assert.equal(wisp("DA_18_Payday").condicaoTipo, "combate");
  assert.equal(wisp("DA_18_LifeDebt").condicaoTipo, "estado");
  // Categorias.
  assert.equal(wisp("DA_AbandonShip18").categoria, "arriscada");
  assert.equal(wisp("DA_Grandmaster18").categoria, "campeao");
  assert.equal(wisp("DA_18_AllFives").categoria, "loja");
  assert.equal(wisp("DA_Cutpurse18").categoria, "ouro-xp");
  assert.equal(wisp("DA_KnickKnackSack18").categoria, "item");
  assert.equal(wisp("DA_18_Tremors").categoria, "combate");
  assert.equal(wisp("DA_18_Tremors").tipo, "combate");
  assert.equal(wisp("DA_Cutpurse18").tipo, "comum");
  // Preços só onde as notas de patch trazem um valor único; o resto fica nulo (o tooltip do jogo manda).
  assert.equal(wisp("DA_18_Payday").custo.ouro, 3);
  assert.equal(wisp("DA_Cutpurse18").custo.ouro, 2);
  assert.equal(wisp("DA_Grandmaster18").custo.ouro, 18);
  assert.equal(wisp("DA_Smurfing18").custo, null);
  assert.ok(wisp("DA_Smurfing18").custoNota);
  assert.equal(wisp("DA_18_Freeroller").custo, null);
});

test("wisps com vida mínima (Knickknacks, Thingamajigs, Doodads, Golden Goose, Barter) trazem o piso de 20", () => {
  for (const id of [
    "DA_KnickKnackSack18",
    "DA_ThingamajigBag18",
    "DA_DoodadJar18",
    "DA_GoldenGoose18",
    "DA_Barter18",
  ])
    assert.equal(wisp(id).somePorVida, 20, id);
  assert.equal(wisp("DA_Cutpurse18").somePorVida, null);
});

/* ---------- Identificação ---------- */

test("isWisp/resolveWisp: apiName do GEP, nome em inglês e em português; campeão nunca é Wisp", () => {
  assert.equal(resolveWisp("DA_AbandonShip18", book).id, "DA_AbandonShip18");
  assert.equal(
    resolveWisp({ text: "DA_AbandonShip18", id: null }, book).id,
    "DA_AbandonShip18",
  );
  // O nome da tela resolve para a versão base (a melhorada tem o mesmo nome).
  assert.equal(resolveWisp("Abandon Ship", book).id, "DA_AbandonShip18");
  assert.equal(
    resolveWisp({ text: "Abandonar Navio", id: null }, book).id,
    "DA_AbandonShip18",
  );
  assert.equal(
    resolveWisp("DA_AbandonShip18_Upgrade", book).id,
    "DA_AbandonShip18_Upgrade",
  );
  // Campeão (a carta já tem id do catálogo de campeões) e vazio.
  assert.equal(isWisp({ text: "Xayah", id: "DA_18_Xayah" }, book), false);
  assert.equal(isWisp("DA_18_Xayah", book), false);
  assert.equal(isWisp(null, book), false);
  assert.equal(isWisp("", book), false);
  // Wisp novo, que o catálogo não conhece, mas o leitor GEP marcou: continua fora dos campeões.
  const flagged = {
    text: "DA_Novo18",
    id: null,
    wisp: true,
    wispId: "DA_Novo18",
  };
  assert.equal(resolveWisp(flagged, book), null);
  assert.equal(isWisp(flagged, book), true);
});

test("nenhum id nem nome de Wisp é de campeão: o catálogo de campeões nunca reconhece um Wisp", () => {
  const fold = (s) =>
    String(s)
      .normalize("NFD")
      .replace(new RegExp("[\u0300-\u036f]", "g"), "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const names = new Set(catalog.champions.map((c) => fold(c.name)));
  for (const w of wisps) {
    assert.ok(!champions.has(w.id), `${w.id} é id de campeão`);
    for (const n of [w.name, w.namePt])
      if (n)
        assert.ok(!names.has(fold(n)), `${w.id}: "${n}" é nome de campeão`);
  }
});

test("loja: wispsInShop e wispsOfScreen acham o Wisp no slot certo (screen.wisps do GEP ou a loja lida)", () => {
  const shop = [
    { text: "DA_18_Xayah", id: "DA_18_Xayah", source: "gep" },
    null,
    { text: "Cutpurse", id: null },
    { text: "DA_18_Ezreal", id: "DA_18_Ezreal", source: "gep" },
    {
      text: "DA_AbandonShip18",
      id: null,
      wisp: true,
      wispId: "DA_AbandonShip18",
      source: "gep",
    },
  ];
  assert.deepEqual(
    wispsInShop(shop, book).map((w) => [w.slot, w.wisp.id]),
    [
      [3, "DA_Cutpurse18"],
      [5, "DA_AbandonShip18"],
    ],
  );
  // screen.wisps (leitor GEP) vence a loja; o desconhecido vira Wisp sem catálogo, nunca é descartado nem adivinhado.
  const fromReader = wispsOfScreen(
    {
      shop,
      wisps: [
        {
          slot: 5,
          id: "DA_AbandonShip18",
          name: "Abandonar Navio",
          known: true,
        },
        { slot: 4, id: "DA_Novo18", name: "Novo", known: false },
      ],
    },
    book,
  );
  assert.deepEqual(
    fromReader.map((w) => [w.slot, w.wisp.id, w.wisp.desconhecido === true]),
    [
      [5, "DA_AbandonShip18", false],
      [4, "DA_Novo18", true],
    ],
  );
  // Sem screen.wisps, cai para a loja lida identificada pelo catálogo.
  assert.equal(wispsOfScreen({ shop }, book).length, 2);
  assert.deepEqual(wispsOfScreen({}, book), []);
  assert.deepEqual(wispsOfScreen(null, book), []);
});

/* ---------- Wisp não é campeão: nada disso chega à rolagem ---------- */

test("a loja que o motor lê (analysisInputs) não tem Wisp: só ids de campeões e null", () => {
  const data = JSON.stringify({
    slot_1: { name: "DA_18_Xayah" },
    slot_2: { name: "Sold" },
    slot_3: { name: "DA_AbandonShip18" },
    slot_4: { name: "DA_18_Drizzle" },
    slot_5: { name: "DA_18_Payday" },
  });
  const cards = parseShop(data, (name) => champions.has(name));
  const inputs = analysisInputs(
    { shop: cards, augments: [], xp: null, removers: null, stage: "4-2" },
    { live: false },
  );
  assert.deepEqual(inputs.shop, ["DA_18_Xayah", null, null, null, null]);
  // Mesmo a loja lida da tela (nome de exibição, sem id) nunca vira id.
  const screen = [
    { text: "Abandon Ship", id: null },
    { text: "Payday", id: null },
  ];
  assert.deepEqual(
    analysisInputs({ shop: screen, augments: [] }, { live: false }).shop,
    [null, null],
  );
  // E withoutWisps tira de qualquer loja os Wisps reconhecidos (catálogo ou marca do leitor).
  assert.deepEqual(
    withoutWisps(
      [
        { text: "Payday", id: null },
        { text: "Xayah", id: "DA_18_Xayah" },
        { text: "DA_Novo18", id: null, wisp: true },
      ],
      book,
    ),
    [null, { text: "Xayah", id: "DA_18_Xayah" }, null],
  );
});

/* ---------- Regra de compra ---------- */

const decide = (id, ctx) => decideWisp(wisp(id), ctx);
const calm = { hp: 90, rolldown: false };

test("decideWisp: custo 0 na janela 4-1 a 5-7 com menos de 10 de ouro compra; fora dela não afirma custo 0", () => {
  assert.equal(inZeroCostWindow("4-1"), true);
  assert.equal(inZeroCostWindow("5-7"), true);
  assert.equal(inZeroCostWindow("5-8"), false);
  assert.equal(inZeroCostWindow("3-7"), false);
  assert.equal(inZeroCostWindow(null), null);
  const inside = decide("DA_18_Drizzle", { ...calm, stage: "4-3", gold: 5 });
  assert.equal(inside.veredito, "comprar");
  assert.equal(inside.regra, "custo0");
  const outside = decide("DA_18_Drizzle", { ...calm, stage: "5-8", gold: 5 });
  assert.notEqual(outside.regra, "custo0");
  assert.ok(outside.incertezas.some((t) => /custo 0/.test(t)));
  // Sem estágio: compra pelo custo 0, mas diz que o estágio não foi lido.
  const unknown = decide("DA_18_Drizzle", { ...calm });
  assert.equal(unknown.regra, "custo0");
  assert.ok(unknown.incertezas.some((t) => /estágio não lido/.test(t)));
});

test("decideWisp: no meio de um rolldown comprometido não compra Wisp que não é o alvo", () => {
  const r = decide("DA_Cutpurse18", {
    stage: "3-2",
    gold: 40,
    hp: 80,
    rolldown: true,
  });
  assert.equal(r.veredito, "pular");
  assert.equal(r.regra, "rolldown");
  // Exceção: vida crítica e efeito de combate pede avaliação, não compra automática.
  const critical = decide("DA_18_Tremors", {
    stage: "5-2",
    gold: 40,
    hp: 15,
    rolldown: true,
  });
  assert.equal(critical.veredito, "avaliar");
  assert.equal(critical.regra, "rolldown-vida");
  // O custo 0 não gasta ouro: vale mesmo no rolldown.
  assert.equal(
    decide("DA_18_Drizzle", { stage: "4-3", gold: 5, hp: 80, rolldown: true })
      .veredito,
    "comprar",
  );
});

test("decideWisp: Wisp condicional que obriga a entortar o tabuleiro (posição) é ignorado", () => {
  const ctx = { ...calm, stage: "3-2", gold: 30 };
  const r = decide("DA_18_Fellowship", ctx);
  assert.equal(r.veredito, "pular");
  assert.equal(r.regra, "condicao-posicao");
  assert.match(r.motivo, /entortar/);
  // Se o tabuleiro já cumpre a condição, a regra de posição não decide mais.
  assert.notEqual(
    decide("DA_18_Fellowship", { ...ctx, boardFit: true }).regra,
    "condicao-posicao",
  );
  // Condição de classe: não atendida -> pula; sem verificar -> nunca vira "comprar" (fica incerta, e diz o que faltou).
  assert.equal(
    decide("DA_MarksmensGale18", { ...ctx, boardFit: false }).regra,
    "condicao-falha",
  );
  const late = { stage: "5-2", gold: 30, hp: 25, rolldown: false };
  const unverified = decide("DA_MarksmensGale18", late);
  assert.equal(unverified.veredito, "avaliar");
  assert.ok(
    unverified.incertezas.some((t) => /condição não verificada/.test(t)),
  );
  assert.equal(
    decide("DA_MarksmensGale18", { ...late, boardFit: true }).veredito,
    "comprar",
  );
});

test("decideWisp: Wisp de combate depende do estágio e da vida; sem leitura é incerto", () => {
  assert.equal(
    decide("DA_18_Tremors", { stage: "5-2", gold: 40, hp: 25, rolldown: false })
      .veredito,
    "comprar",
  );
  assert.equal(
    decide("DA_18_Tremors", { stage: "5-2", gold: 40, hp: 90, rolldown: false })
      .veredito,
    "avaliar",
  );
  assert.equal(
    decide("DA_18_Tremors", { stage: "2-5", gold: 40, hp: 90, rolldown: false })
      .veredito,
    "pular",
  );
  assert.equal(
    decide("DA_18_Tremors", { hp: 90, rolldown: false }).veredito,
    "incerto",
  );
  assert.equal(
    decide("DA_18_Tremors", { stage: "5-2", rolldown: false }).veredito,
    "incerto",
  );
});

test("decideWisp: economia pelo preço e pelos juros; preço desconhecido é incerto e avalia, não compra", () => {
  const base = { hp: 90, rolldown: false };
  // 2g com 35: continua no patamar de 30.
  const keeps = decide("DA_Cutpurse18", { ...base, stage: "4-2", gold: 35 });
  assert.equal(keeps.veredito, "comprar");
  assert.equal(keeps.regra, "juros-mantem");
  // 2g com 30 no estágio 4: derruba o patamar e não é decisivo.
  const drops = decide("DA_Cutpurse18", { ...base, stage: "4-2", gold: 30 });
  assert.equal(drops.veredito, "pular");
  assert.equal(drops.regra, "juros-derruba");
  // Mesmo caso nos estágios 2-3: ouro/XP barato quase sempre vale.
  assert.equal(
    decide("DA_Cutpurse18", { ...base, stage: "2-5", gold: 30 }).regra,
    "barato-cedo",
  );
  // Sem preço no catálogo.
  const unknown = decide("DA_18_Freeroller", {
    ...base,
    stage: "2-5",
    gold: 30,
  });
  assert.equal(unknown.veredito, "avaliar");
  assert.ok(unknown.incertezas.some((t) => /preço/.test(t)));
  // Arriscada nunca é "comprar".
  assert.equal(
    decide("DA_AbandonShip18", { ...base, stage: "3-2", gold: 40 }).veredito,
    "avaliar",
  );
});

test("decideWisp: casos de incerteza (vida abaixo do piso, consolo, Wisp fora do catálogo)", () => {
  const sumiu = decide("DA_KnickKnackSack18", { hp: 15, stage: "5-2" });
  assert.equal(sumiu.veredito, "incerto");
  assert.equal(sumiu.regra, "some-por-vida");
  assert.equal(decide("DA_BeggarsWisp18", calm).veredito, "incerto");
  const [novo] = wispsOfScreen(
    { wisps: [{ slot: 5, id: "DA_Novo18", name: "Novo", known: false }] },
    book,
  );
  const r = decideWisp(novo.wisp, calm);
  assert.equal(r.veredito, "incerto");
  assert.equal(r.regra, "desconhecido");
  assert.equal(decideWisp(null, calm), null);
});

test("decideWisp: nunca compra no automático. Sem contexto só o custo 0 compra, e sempre com motivo", () => {
  for (const w of wisps) {
    const r = decideWisp(w, {});
    assert.ok(WISP_VERDICTS.includes(r.veredito), w.id);
    assert.ok(r.motivo.length > 10, `${w.id}: motivo curto e presente`);
    if (r.veredito === "comprar") assert.equal(w.tipo, "custo0", w.id);
  }
});
