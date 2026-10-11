// Rodar com: node --test tft/helper/tests/core-graph.test.mjs
// M8a: grafo de fatos derivados com memoização (core/graph/). Fixa: memoização por conteúdo das entradas declaradas,
// invalidação mínima com corte antecipado, ciclo recusado na criação, leitura de entrada não declarada falha (D1),
// chave determinística sem campos voláteis, tetos de memória e pureza do módulo. Nenhum consumidor usa o grafo ainda
// (a troca é o M8b); estes testes só dependem de core/graph/.
import test from "node:test";
import assert from "node:assert/strict";
import {
  GraphError,
  canonical,
  createGraph,
  defineFact,
  digestString,
  stableKey,
} from "../core/graph/index.mjs";
import { importsOf, read, stripNonCode } from "./architecture/scan.mjs";

const isCode = (code) => (error) =>
  error instanceof GraphError && error.code === code;

/** Grafo de exemplo com a forma do pipeline: ouro, nível e tabuleiro alimentam fatos em camadas. */
function pipeline(extra = {}) {
  const calls = {};
  const spy = (id, fn) => (inputs) => {
    calls[id] = (calls[id] ?? 0) + 1;
    return fn(inputs);
  };
  const facts = [
    defineFact({
      id: "income",
      inputs: ["gold"],
      compute: spy("income", ({ gold }) => Math.floor(gold / 10)),
    }),
    defineFact({
      id: "shopsAhead",
      inputs: ["gold", "income"],
      compute: spy("shopsAhead", ({ gold, income }) =>
        Math.floor((gold + 4 * income) / 2),
      ),
    }),
    defineFact({
      id: "odds",
      inputs: ["level"],
      compute: spy("odds", ({ level }) => level * 10),
    }),
    defineFact({
      id: "held",
      inputs: ["board"],
      compute: spy("held", ({ board }) => board.length),
    }),
    defineFact({
      id: "chance",
      inputs: ["odds", "held"],
      compute: spy("chance", ({ odds, held }) => odds + held),
    }),
    defineFact({
      id: "summary",
      inputs: ["chance", "shopsAhead"],
      compute: spy("summary", ({ chance, shopsAhead }) => ({
        chance,
        shopsAhead,
      })),
    }),
  ];
  const g = createGraph({
    facts,
    inputs: ["gold", "level", "board"],
    ...extra,
  });
  g.set({ gold: 54, level: 8, board: ["a", "b"] });
  return { g, calls };
}

/* ---------- chave estável ---------- */

test("chave estável: ordem das chaves, undefined, Map/Set, -0 e NaN não mudam a chave; ordem de array e tipo mudam", () => {
  assert.equal(stableKey({ a: 1, b: 2 }), stableKey({ b: 2, a: 1 }));
  assert.equal(stableKey({ a: 1, b: undefined }), stableKey({ a: 1 }));
  assert.notEqual(stableKey([undefined]), stableKey([]));
  assert.notEqual(stableKey([1, 2]), stableKey([2, 1]));
  assert.notEqual(stableKey(1), stableKey("1"));
  assert.notEqual(stableKey(null), stableKey(undefined));
  assert.notEqual(stableKey(["ab", "c"]), stableKey(["a", "bc"]));
  assert.equal(stableKey(0), stableKey(-0));
  assert.equal(stableKey(NaN), stableKey(NaN));
  assert.equal(
    stableKey(
      new Map([
        [1, "a"],
        [2, "b"],
      ]),
    ),
    stableKey(
      new Map([
        [2, "b"],
        [1, "a"],
      ]),
    ),
  );
  assert.equal(stableKey(new Set([1, 2])), stableKey(new Set([2, 1])));
  assert.notEqual(stableKey(new Set([1, 2])), stableKey(new Set([1, 3])));
  assert.equal(stableKey(new Date(5)), stableKey(new Date(5)));
  assert.notEqual(stableKey(new Date(5)), stableKey(new Date(6)));
  const deep = { rows: [{ id: 1, tags: ["x"], at: { t: 1 } }], n: 3 };
  assert.equal(stableKey(deep), stableKey(structuredClone(deep)));
  assert.match(digestString("a"), /^[0-9a-z]+-[0-9a-z]+\.[0-9a-z]+$/);
  assert.notEqual(digestString("a"), digestString("b"));
  assert.equal(
    canonical({ b: 1, a: [true, null] }),
    canonical({ a: [true, null], b: 1 }),
  );
});

test("chave estável: campos voláteis (ignore) saem em qualquer profundidade", () => {
  const a = {
    seenAt: 5,
    unit: { name: "Jinx", seenAt: 1, items: [{ x: 1, seenAt: 3 }] },
  };
  const b = {
    seenAt: 9,
    unit: { name: "Jinx", seenAt: 2, items: [{ x: 1, seenAt: 4 }] },
  };
  assert.notEqual(stableKey(a), stableKey(b));
  assert.equal(
    stableKey(a, { ignore: ["seenAt"] }),
    stableKey(b, { ignore: ["seenAt"] }),
  );
  const c = { seenAt: 9, unit: { name: "Ashe", seenAt: 2, items: [] } };
  assert.notEqual(
    stableKey(a, { ignore: ["seenAt"] }),
    stableKey(c, { ignore: ["seenAt"] }),
  );
});

test("chave estável: função, símbolo, Promise e ciclo falham com o caminho; referência repetida sem ciclo é aceita", () => {
  assert.throws(
    () => stableKey({ f() {} }),
    (e) => isCode("UNSERIALIZABLE")(e) && /f/.test(e.message),
  );
  assert.throws(() => stableKey([Symbol("x")]), isCode("UNSERIALIZABLE"));
  assert.throws(
    () => stableKey({ p: Promise.resolve(1) }),
    isCode("UNSERIALIZABLE"),
  );
  const o = { name: "o" };
  o.self = o;
  assert.throws(
    () => stableKey(o),
    (e) => isCode("UNSERIALIZABLE")(e) && /self/.test(e.message),
  );
  const shared = { x: 1 };
  assert.doesNotThrow(() => stableKey({ a: shared, b: shared }));
});

/* ---------- defineFact / createGraph: validação ---------- */

test("defineFact valida e congela; a lista de entradas usa o nome como apelido", () => {
  const f = defineFact({ id: "f", inputs: ["b", "a"], compute: () => 1 });
  assert.deepEqual(f.inputs, { a: "a", b: "b" });
  assert.ok(Object.isFrozen(f) && Object.isFrozen(f.inputs));
  assert.throws(
    () => defineFact({ inputs: [], compute: () => 1 }),
    isCode("INVALID"),
  );
  assert.throws(() => defineFact({ id: "f" }), isCode("INVALID"));
  assert.throws(
    () => defineFact({ id: "f", compute: () => 1, cutoff: "x" }),
    isCode("INVALID"),
  );
  assert.throws(
    () => defineFact({ id: "f", compute: () => 1, keep: 0 }),
    isCode("INVALID"),
  );
  assert.throws(
    () => defineFact({ id: "f", inputs: { a: "" }, compute: () => 1 }),
    isCode("INVALID"),
  );
  assert.throws(
    () => createGraph({ facts: [{ id: "f", inputs: {}, compute: () => 1 }] }),
    isCode("INVALID"),
    "um objeto que não veio de defineFact não entra no grafo",
  );
  assert.throws(() => createGraph({ keep: 0 }), isCode("INVALID"));
  assert.throws(() => createGraph({ clock: 5 }), isCode("INVALID"));
});

test("createGraph recusa nome repetido, dependência desconhecida e fato com o nome de uma entrada", () => {
  const f = defineFact({ id: "f", inputs: ["x"], compute: () => 1 });
  assert.throws(
    () => createGraph({ facts: [f, f], inputs: ["x"] }),
    isCode("DUPLICATE"),
  );
  assert.throws(
    () => createGraph({ facts: [f], inputs: ["f", "x"] }),
    isCode("DUPLICATE"),
  );
  assert.throws(
    () => createGraph({ facts: [f], inputs: [] }),
    (e) => isCode("UNKNOWN_NODE")(e) && /"x"/.test(e.message),
  );
});

/* ---------- ciclo ---------- */

test("ciclo de dependências é detectado na criação, com o caminho", () => {
  const a = defineFact({ id: "a", inputs: { v: "b" }, compute: () => 1 });
  const b = defineFact({ id: "b", inputs: { v: "a" }, compute: () => 1 });
  assert.throws(
    () => createGraph({ facts: [a, b] }),
    (e) =>
      isCode("CYCLE")(e) &&
      /a -> b -> a/.test(e.message) &&
      e.details.cycle.length === 3,
  );
  const self = defineFact({ id: "s", inputs: { v: "s" }, compute: () => 1 });
  assert.throws(() => createGraph({ facts: [self] }), isCode("CYCLE"));
  // um ciclo mais longo, com um ramo inocente na frente
  const ok = defineFact({ id: "ok", inputs: ["x"], compute: () => 1 });
  const c1 = defineFact({ id: "c1", inputs: { v: "c2" }, compute: () => 1 });
  const c2 = defineFact({
    id: "c2",
    inputs: { v: "c3", w: "ok" },
    compute: () => 1,
  });
  const c3 = defineFact({ id: "c3", inputs: { v: "c1" }, compute: () => 1 });
  assert.throws(
    () => createGraph({ facts: [ok, c1, c2, c3], inputs: ["x"] }),
    (e) => isCode("CYCLE")(e) && /c1 -> c2 -> c3 -> c1/.test(e.message),
  );
  // o contrário compila: diamante não é ciclo
  const d1 = defineFact({ id: "d1", inputs: ["x"], compute: () => 1 });
  const d2 = defineFact({ id: "d2", inputs: { a: "d1" }, compute: () => 1 });
  const d3 = defineFact({ id: "d3", inputs: { a: "d1" }, compute: () => 1 });
  const d4 = defineFact({
    id: "d4",
    inputs: { a: "d2", b: "d3" },
    compute: () => 1,
  });
  assert.doesNotThrow(() =>
    createGraph({ facts: [d4, d3, d2, d1], inputs: ["x"] }),
  );
});

/* ---------- memoização ---------- */

test("memoização: mesma entrada não recalcula; estrutura igual com referência nova não invalida; voltar a um valor visto reaproveita", () => {
  const { g, calls } = pipeline();
  assert.deepEqual(g.get("summary"), { chance: 82, shopsAhead: 37 });
  assert.equal(g.get("summary"), g.get("summary"), "mesmo objeto devolvido");
  assert.deepEqual(calls, {
    held: 1,
    odds: 1,
    chance: 1,
    income: 1,
    shopsAhead: 1,
    summary: 1,
  });

  assert.deepEqual(
    g.set({ board: ["a", "b"] }),
    [],
    "cópia estrutural igual não muda nada",
  );
  assert.deepEqual(g.set({ gold: 54 }), []);
  g.get("summary");
  assert.equal(calls.summary, 1);

  assert.deepEqual(g.set({ gold: 52 }), ["gold"]);
  assert.equal(g.get("summary").shopsAhead, 36);
  assert.equal(calls.shopsAhead, 2);
  // volta ao 54: a chave já foi vista, nada roda
  g.set({ gold: 54 });
  assert.equal(g.get("summary").shopsAhead, 37);
  assert.equal(calls.shopsAhead, 2);
  assert.equal(calls.summary, 2);
  assert.equal(g.stats().facts.shopsAhead.hits, 1);
});

test("memoização: get de uma entrada devolve o valor; nome desconhecido e entrada ausente têm erro próprio", () => {
  const { g } = pipeline();
  assert.deepEqual(g.get("board"), ["a", "b"]);
  assert.throws(() => g.get("nada"), isCode("UNKNOWN_NODE"));
  assert.throws(() => g.set({ nada: 1 }), isCode("UNKNOWN_INPUT"));
  assert.throws(() => g.set([1]), isCode("INVALID"));
  const f = defineFact({
    id: "f",
    inputs: ["x", "y"],
    compute: ({ x, y }) => x + y,
  });
  const h = createGraph({ facts: [f], inputs: ["x", "y"] });
  h.set({ x: 1 });
  assert.throws(
    () => h.get("f"),
    (e) => isCode("MISSING_INPUT")(e) && /"y"/.test(e.message),
  );
  h.set({ y: 2 });
  assert.equal(h.get("f"), 3);
});

test("set é atômico: uma entrada desconhecida ou não serializável não aplica as outras", () => {
  const { g } = pipeline();
  assert.throws(() => g.set({ gold: 99, nada: 1 }), isCode("UNKNOWN_INPUT"));
  assert.equal(g.get("gold"), 54);
  assert.throws(
    () => g.set({ gold: 99, board: [() => 1] }),
    (e) => isCode("UNSERIALIZABLE")(e) && /board/.test(e.message),
  );
  assert.equal(g.get("gold"), 54);
});

/* ---------- invalidação mínima ---------- */

test("invalidação mínima: ouro -2 recalcula só renda, lojas ao alcance e o resumo", () => {
  const { g } = pipeline();
  g.get("summary");
  assert.equal(g.stats({ reset: true }).computes, 6);
  g.set({ gold: 52 });
  g.get("summary");
  const s = g.stats();
  assert.deepEqual(s.recomputed, ["income", "shopsAhead", "summary"]);
  assert.equal(s.facts.chance.computes, 0);
  assert.equal(s.facts.held.computes, 0);
  assert.equal(s.facts.odds.computes, 0);
});

test("invalidação mínima: nível recalcula odds, chance e resumo; renda e lojas ficam", () => {
  const { g } = pipeline();
  g.get("summary");
  g.stats({ reset: true });
  assert.deepEqual(g.set({ level: 9 }), ["level"]);
  assert.deepEqual(g.get("summary"), { chance: 92, shopsAhead: 37 });
  assert.deepEqual([...g.stats().recomputed].sort(), [
    "chance",
    "odds",
    "summary",
  ]);
});

test("corte antecipado: fato recalculado com a mesma saída não roda os dependentes", () => {
  const { g } = pipeline();
  g.get("summary");
  g.stats({ reset: true });
  g.set({ board: ["a", "c"] }); // outro conteúdo, mesmo tamanho: held dá 2 de novo
  g.get("summary");
  const s = g.stats();
  assert.deepEqual(s.recomputed, ["held"]);
  assert.equal(s.facts.chance.reused, 1, "conferido e igual");
  assert.equal(s.facts.summary.reused, 1);
  assert.equal(s.facts.chance.computes, 0);
});

test("um fato que não foi pedido não roda: a invalidação é sob demanda", () => {
  const { g, calls } = pipeline();
  g.get("summary");
  g.set({ level: 9 });
  assert.equal(calls.odds, 1, "marcar como sujo não calcula");
  g.get("odds");
  assert.equal(calls.odds, 2);
  assert.equal(calls.chance, 1, "chance ainda não foi pedida");
});

test("corte antecipado em cadeia curta: paridade igual não invalida o rótulo", () => {
  const parity = defineFact({
    id: "parity",
    inputs: ["x"],
    compute: ({ x }) => x % 2,
  });
  const label = defineFact({
    id: "label",
    inputs: ["parity"],
    compute: ({ parity: p }) => (p ? "impar" : "par"),
  });
  const g = createGraph({ facts: [parity, label], inputs: ["x"] });
  g.set({ x: 2 });
  assert.equal(g.get("label"), "par");
  g.set({ x: 4 });
  assert.equal(g.get("label"), "par");
  const s = g.stats();
  assert.equal(s.facts.parity.computes, 2);
  assert.equal(s.facts.label.computes, 1);
  assert.equal(s.facts.label.reused, 1);
  g.set({ x: 3 });
  assert.equal(g.get("label"), "impar");
  assert.equal(g.stats().facts.label.computes, 2);
  assert.deepEqual(g.explain("label").last, {
    via: "computed",
    changed: ["parity"],
  });
});

test("describe: dependentes diretos e transitivos de cada entrada", () => {
  const { g } = pipeline();
  const d = g.describe();
  assert.deepEqual(d.inputs.gold.downstream, [
    "income",
    "shopsAhead",
    "summary",
  ]);
  assert.deepEqual(d.inputs.level.downstream, ["chance", "odds", "summary"]);
  assert.deepEqual(d.inputs.board.downstream, ["chance", "held", "summary"]);
  assert.deepEqual(d.facts.chance.inputs, { held: "held", odds: "odds" });
  assert.deepEqual(d.facts.summary.downstream, []);
});

test("D1: a loja só invalida o que a declara; o fato sem a loja não a enxerga", () => {
  const score = defineFact({
    id: "score",
    inputs: ["board", "shop"],
    compute: ({ board, shop }) => board.length + shop.length,
  });
  const held = defineFact({
    id: "held",
    inputs: ["board"],
    compute: ({ board }) => board.length,
  });
  const g = createGraph({ facts: [score, held], inputs: ["board", "shop"] });
  g.set({ board: [1], shop: [] });
  assert.equal(g.get("score"), 1);
  g.get("held");
  g.stats({ reset: true });
  g.set({ shop: ["x"] });
  assert.equal(
    g.get("score"),
    2,
    "a loja declarada muda o resultado (o cache antigo devolveria 1)",
  );
  g.get("held");
  assert.deepEqual(g.stats().recomputed, ["score"]);
});

/* ---------- entrada não declarada ---------- */

test("função que lê entrada não declarada falha, mesmo que a entrada exista no grafo", () => {
  const byRead = defineFact({
    id: "byRead",
    inputs: ["a"],
    compute: (inputs) => inputs.a + inputs.shop,
  });
  const byDestructure = defineFact({
    id: "byDestructure",
    inputs: ["a"],
    compute: ({ a, shop }) => a + shop,
  });
  const byIn = defineFact({
    id: "byIn",
    inputs: ["a"],
    compute: (inputs) => ("shop" in inputs ? 1 : 0),
  });
  const g = createGraph({
    facts: [byRead, byDestructure, byIn],
    inputs: ["a", "shop"],
  });
  g.set({ a: 1, shop: [1] });
  for (const id of ["byRead", "byDestructure", "byIn"])
    assert.throws(
      () => g.get(id),
      (e) =>
        isCode("UNDECLARED_INPUT")(e) &&
        e.details.fact === id &&
        e.details.input === "shop" &&
        /declarou|declarad/.test(e.message),
      id,
    );
  // a falha não deixa nada em cache: continua falhando, e o fato nunca ficou "fresco"
  assert.throws(() => g.get("byRead"), isCode("UNDECLARED_INPUT"));
  assert.equal(g.stats().facts.byRead.entries, 0);
});

test("o objeto de entradas é somente leitura e só lista o que foi declarado", () => {
  const seen = [];
  const write = defineFact({
    id: "write",
    inputs: ["a"],
    compute: (inputs) => {
      inputs.a = 2;
      return 1;
    },
  });
  const list = defineFact({
    id: "list",
    inputs: { z: "a", y: "a" },
    compute: (inputs) => {
      seen.push(Object.keys(inputs), JSON.stringify(inputs));
      return 1;
    },
  });
  const g = createGraph({ facts: [write, list], inputs: ["a"] });
  g.set({ a: 1 });
  assert.throws(() => g.get("write"), isCode("READONLY_INPUT"));
  g.get("list");
  assert.deepEqual(seen, [["y", "z"], '{"y":1,"z":1}']);
});

test("erro da função do fato vira COMPUTE_FAILED com a causa, e a falha não é memoizada", () => {
  let n = 0;
  const bad = defineFact({
    id: "bad",
    inputs: ["a"],
    compute: () => {
      n++;
      throw new Error("boom");
    },
  });
  const g = createGraph({ facts: [bad], inputs: ["a"] });
  g.set({ a: 1 });
  assert.throws(
    () => g.get("bad"),
    (e) =>
      isCode("COMPUTE_FAILED")(e) &&
      /boom/.test(e.message) &&
      e.cause.message === "boom",
  );
  assert.throws(() => g.get("bad"), isCode("COMPUTE_FAILED"));
  assert.equal(n, 2);
});

test("get/set de dentro de um fato e fato assíncrono são recusados", () => {
  let g;
  const sneaky = defineFact({
    id: "sneaky",
    inputs: ["a"],
    compute: () => g.get("a"),
  });
  const later = defineFact({
    id: "later",
    inputs: ["a"],
    compute: () => Promise.resolve(1),
  });
  g = createGraph({ facts: [sneaky, later], inputs: ["a"] });
  g.set({ a: 1 });
  assert.throws(() => g.get("sneaky"), isCode("REENTRANT"));
  assert.throws(() => g.get("later"), isCode("ASYNC_FACT"));
  assert.equal(g.get("a"), 1, "o grafo continua utilizável depois da falha");
});

/* ---------- determinismo da chave e campos voláteis ---------- */

test("a chave do fato não depende da ordem do set, da ordem das chaves dos objetos nem da ordem dos apelidos", () => {
  const build = (inputs) => {
    const f = defineFact({ id: "f", inputs, compute: ({ p, q }) => [p, q] });
    return createGraph({ facts: [f], inputs: ["a", "b"] });
  };
  const g1 = build({ p: "a", q: "b" });
  g1.set({
    a: {
      x: 1,
      y: [1, 2],
      z: new Map([
        [1, "u"],
        [2, "v"],
      ]),
    },
    b: 2,
  });
  g1.get("f");
  const g2 = build({ q: "b", p: "a" });
  g2.set({ b: 2 });
  g2.set({
    a: {
      z: new Map([
        [2, "v"],
        [1, "u"],
      ]),
      y: [1, 2],
      x: 1,
    },
  });
  g2.get("f");
  assert.equal(g1.explain("f").key, g2.explain("f").key);
  g2.set({ b: 3 });
  g2.get("f");
  assert.notEqual(g1.explain("f").key, g2.explain("f").key);
});

test("campos voláteis declarados na entrada ou no grafo não invalidam nada", () => {
  const f = defineFact({
    id: "f",
    inputs: ["board", "other"],
    compute: ({ board }) => board.units.length,
  });
  const g = createGraph({
    facts: [f],
    inputs: { board: { ignore: ["seenAt"] }, other: null },
    ignore: ["modifiedAt"],
  });
  g.set({
    board: { units: [1], seenAt: 1, modifiedAt: 1 },
    other: { seenAt: 1 },
  });
  assert.equal(g.get("f"), 1);
  assert.deepEqual(
    g.set({ board: { units: [1], seenAt: 2, modifiedAt: 2 } }),
    [],
  );
  assert.deepEqual(
    g.set({ other: { seenAt: 2 } }),
    ["other"],
    "ignore é por entrada: `other` não ignora seenAt",
  );
  g.get("f");
  assert.deepEqual(g.set({ board: { units: [1, 2], seenAt: 2 } }), ["board"]);
  assert.equal(g.get("f"), 2);
  assert.equal(g.stats().facts.f.computes, 3);
});

/* ---------- limites de memória ---------- */

test("limite de memória: o histórico de cada fato respeita `keep`, e o total respeita a soma dos tetos", () => {
  const f = defineFact({
    id: "f",
    inputs: ["x"],
    keep: 3,
    compute: ({ x }) => x * 2,
  });
  const g = createGraph({ facts: [f], inputs: ["x"] });
  for (let i = 1; i <= 10; i++) {
    g.set({ x: i });
    assert.equal(g.get("f"), i * 2);
    const s = g.stats();
    assert.ok(
      s.entries <= s.capacity,
      `entradas ${s.entries} > teto ${s.capacity}`,
    );
  }
  const s = g.stats();
  assert.equal(s.capacity, 3);
  assert.equal(s.entries, 3);
  assert.equal(s.facts.f.computes, 10);
  assert.equal(s.facts.f.evictions, 7);
  g.set({ x: 9 });
  assert.equal(g.get("f"), 18);
  assert.equal(g.stats().facts.f.computes, 10, "9 ainda estava no histórico");
  g.set({ x: 1 });
  g.get("f");
  assert.equal(g.stats().facts.f.computes, 11, "1 já tinha saído");
});

test("limite de memória: LRU, o valor reaproveitado volta ao fim da fila e o mais antigo é que sai", () => {
  const f = defineFact({
    id: "f",
    inputs: ["x"],
    keep: 2,
    compute: ({ x }) => x,
  });
  const g = createGraph({ facts: [f], inputs: ["x"] });
  for (const x of [1, 2, 1, 3]) {
    g.set({ x });
    g.get("f");
  }
  assert.equal(g.stats().facts.f.computes, 3);
  assert.equal(g.stats().facts.f.evictions, 1);
  g.set({ x: 1 });
  g.get("f");
  assert.equal(
    g.stats().facts.f.computes,
    3,
    "o 1 foi reaproveitado, então sobrou",
  );
  g.set({ x: 2 });
  g.get("f");
  assert.equal(g.stats().facts.f.computes, 4, "o 2 era o mais antigo e saiu");
});

test("limite de memória: o padrão é 8 por fato e a lista de recalculados tem teto", () => {
  const f = defineFact({ id: "f", inputs: ["x"], compute: ({ x }) => x });
  const g = createGraph({ facts: [f], inputs: ["x"] });
  for (let i = 0; i < 600; i++) {
    g.set({ x: i });
    g.get("f");
  }
  const s = g.stats();
  assert.equal(s.capacity, 8);
  assert.equal(s.entries, 8);
  assert.equal(s.computes, 600);
  assert.equal(s.recomputed.length, 512);
  assert.equal(s.recomputedDropped, 88);
  assert.equal(g.stats({ reset: true }).computes, 600);
  const after = g.stats();
  assert.equal(after.computes, 0);
  assert.deepEqual(after.recomputed, []);
  assert.equal(
    after.entries,
    8,
    "o histórico não é zerado pelo reset dos contadores",
  );
});

/* ---------- relógio injetado ---------- */

test("o relógio é injetado: mede o tempo de cada cálculo; sem relógio os tempos são null", () => {
  let t = 0;
  const f = defineFact({ id: "f", inputs: ["x"], compute: ({ x }) => x });
  const timed = createGraph({ facts: [f], inputs: ["x"], clock: () => ++t });
  timed.set({ x: 1 });
  timed.get("f");
  assert.equal(timed.stats().facts.f.lastMs, 1);
  assert.equal(timed.stats().facts.f.totalMs, 1);
  const plain = createGraph({ facts: [f], inputs: ["x"] });
  plain.set({ x: 1 });
  plain.get("f");
  assert.equal(plain.stats().facts.f.lastMs, null);
});

/* ---------- cutoff: "key" ---------- */

test('saída com funções exige cutoff "key"; os dependentes seguem a chave do fato', () => {
  const structural = defineFact({
    id: "idx",
    inputs: ["x"],
    compute: ({ x }) => ({ of: () => x }),
  });
  const g = createGraph({ facts: [structural], inputs: ["x"] });
  g.set({ x: 1 });
  assert.throws(
    () => g.get("idx"),
    (e) => isCode("UNSERIALIZABLE")(e) && /cutoff: "key"/.test(e.message),
  );

  let runs = 0;
  const idx = defineFact({
    id: "idx",
    inputs: ["x"],
    cutoff: "key",
    compute: ({ x }) => ({ of: () => x }),
  });
  const dep = defineFact({
    id: "dep",
    inputs: ["idx"],
    compute: ({ idx: i }) => {
      runs++;
      return i.of();
    },
  });
  const h = createGraph({ facts: [idx, dep], inputs: ["x"] });
  h.set({ x: 1 });
  assert.equal(h.get("dep"), 1);
  h.set({ x: 2 });
  assert.equal(h.get("dep"), 2);
  h.set({ x: 1 });
  assert.equal(h.get("dep"), 1);
  assert.equal(runs, 2, "voltar ao x=1 reaproveita o índice e o dependente");
});

/* ---------- modo verify (contrato de entradas, T7) ---------- */

test("verify: fato que muta a entrada, fato não determinístico e saída congelada", () => {
  const mutates = defineFact({
    id: "mutates",
    inputs: ["list"],
    compute: ({ list }) => {
      list[0] = 9;
      return 1;
    },
  });
  const g = createGraph({ facts: [mutates], inputs: ["list"], verify: true });
  g.set({ list: [1, 2] });
  assert.throws(
    () => g.get("mutates"),
    (e) => isCode("IMPURE")(e) && /mudou a entrada "list"/.test(e.message),
  );

  let n = 0;
  const counter = defineFact({
    id: "counter",
    inputs: ["list"],
    compute: () => ({ n: ++n }),
  });
  const h = createGraph({ facts: [counter], inputs: ["list"], verify: true });
  h.set({ list: [1] });
  assert.throws(() => h.get("counter"), isCode("IMPURE"));

  const clean = defineFact({
    id: "clean",
    inputs: ["list"],
    compute: ({ list }) => ({ copy: [...list], total: list.length }),
  });
  const k = createGraph({ facts: [clean], inputs: ["list"], verify: true });
  k.set({ list: [1, 2] });
  const out = k.get("clean");
  assert.deepEqual(out, { copy: [1, 2], total: 2 });
  assert.ok(Object.isFrozen(out) && Object.isFrozen(out.copy));
  assert.throws(() => {
    out.total = 5;
  }, TypeError);
});

/* ---------- identidade da entrada (M8b) ---------- */

test("identity: a chave da entrada é a da projeção, e o fato recebe o valor inteiro", () => {
  const seen = [];
  const lengths = defineFact({
    id: "lengths",
    inputs: ["board"],
    compute: ({ board }) => {
      seen.push(board);
      return board.pieces.length;
    },
  });
  const g = createGraph({
    facts: [lengths],
    // A identidade ignora o relógio do arquivo e a ordem das peças.
    inputs: {
      board: {
        identity: (b) => ({ pieces: [...b.pieces].sort(), health: b.health }),
      },
    },
  });
  g.set({ board: { pieces: ["b", "a"], health: 10, at: 1 } });
  assert.equal(g.get("lengths"), 2);
  // Outra ordem das peças e outro horário: mesma identidade, nada recalcula (a referência nova fica guardada para o
  // próximo cálculo, mas o resultado antigo continua valendo).
  assert.deepEqual(
    g.set({ board: { pieces: ["a", "b"], health: 10, at: 2 } }),
    [],
  );
  assert.equal(g.get("lengths"), 2);
  assert.equal(g.stats().facts.lengths.computes, 1);
  // Vida mudou: a identidade muda, o fato recalcula e recebe o snapshot inteiro (inclusive o campo fora da identidade).
  assert.deepEqual(g.set({ board: { pieces: ["a", "b"], health: 9, at: 3 } }), [
    "board",
  ]);
  g.get("lengths");
  assert.equal(g.stats().facts.lengths.computes, 2);
  assert.equal(seen.at(-1).at, 3);
});

test("identity: precisa ser função; no modo verify a identidade também vale para conferir que a entrada não foi mutada", () => {
  assert.throws(
    () => createGraph({ inputs: { x: { identity: "nao" } } }),
    isCode("INVALID"),
  );
  const f = defineFact({
    id: "f",
    inputs: ["x"],
    compute: ({ x }) => x.items.length,
  });
  const g = createGraph({
    facts: [f],
    inputs: { x: { identity: (x) => x.items.length } },
    verify: true,
  });
  g.set({ x: { items: [1, 2], volatile: 1 } });
  assert.equal(g.get("f"), 2);
  // Um fato que muda a parte da entrada que a identidade enxerga é pego.
  const mutates = defineFact({
    id: "mutates",
    inputs: ["x"],
    compute: ({ x }) => {
      x.items.push(3);
      return x.items.length;
    },
  });
  const h = createGraph({
    facts: [mutates],
    inputs: { x: { identity: (x) => x.items.length } },
    verify: true,
  });
  h.set({ x: { items: [1, 2], volatile: 1 } });
  assert.throws(() => h.get("mutates"), isCode("IMPURE"));
});

/* ---------- pureza do módulo ---------- */

test("core/graph é ESM puro: só importa de si mesmo e não usa relógio, aleatório nem E/S", () => {
  const files = ["errors", "stable-key", "graph", "index"].map(
    (n) => `core/graph/${n}.mjs`,
  );
  const impure =
    /\bDate\.now\b|\bnew Date\b|\bMath\.random\b|\bprocess\.|\bfetch\(|\brequire\(|\bglobalThis\./;
  for (const f of files) {
    for (const spec of importsOf(f))
      assert.ok(
        spec.startsWith("./") && !spec.startsWith("node:"),
        `${f} importa ${spec}`,
      );
    const hit = impure.exec(stripNonCode(read(f)));
    assert.equal(hit, null, `${f}: ${hit?.[0]}`);
  }
});
