// Rodar com: node --test tft/helper/v2/js/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCurve,
  buildModel,
  findStrip,
  gepNote,
  pickRows,
  rollPill,
  starTag,
} from "./model.js";
import { strategy } from "../../strategy.mjs";
import { makeState } from "../../tests/fixtures.mjs";
import { binomialTail } from "./math.js";

const { state, rec } = JSON.parse(
  readFileSync(new URL("../../live-mock-base.json", import.meta.url), "utf8"),
);
const live = () => {
  const s = structuredClone(state),
    r = structuredClone(rec);
  s.screen = {
    running: true,
    stage: "4-2",
    gold: 54,
    level: 8,
    xp: "23/68",
    items: [],
  };
  r.metadata.actionable = true;
  r.self.health = 58;
  return { state: s, rec: r };
};

test("modelo ao vivo: números do HUD vêm da tela e a fase é interpretada", () => {
  const m = buildModel(live());
  assert.equal(m.status.live, true);
  assert.deepEqual(m.hero.stage, { stage: 4, round: 2 });
  assert.deepEqual(m.hero.xp, { have: 23, total: 68 });
  assert.equal(m.hero.gold, 54);
  assert.equal(m.hero.level, 8);
  assert.equal(m.hero.levelSource, "tela");
});

test("partida encerrada nunca é considerada ao vivo", () => {
  const input = live();
  input.rec.self.health = 0;
  const m = buildModel(input);
  assert.equal(m.status.live, false);
  assert.equal(m.status.ended, true);
});

test("partida acompanhada: -1 de vida no primeiro tabuleiro não encerra; resultado e espera vêm do servidor", () => {
  const input = live();
  input.rec.self.health = -1;
  input.state.match = { id: 2, status: "live", boardReady: true };
  let m = buildModel(input);
  assert.equal(m.status.ended, false);
  assert.equal(m.status.live, false);
  input.state.match = {
    id: 2,
    status: "ended",
    placement: 3,
    boardReady: true,
  };
  m = buildModel(input);
  assert.equal(m.status.ended, true);
  assert.equal(m.status.placement, 3);
  input.state.match = { id: 3, status: "live", boardReady: false };
  input.rec.self.health = 58;
  m = buildModel(input);
  assert.equal(m.status.waiting, true);
  assert.equal(m.status.live, false);
});

test("formação: cada posição vira uma célula única com status e custo", () => {
  const m = buildModel(live()),
    ids = m.plan.cells.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of m.plan.cells) {
    assert.ok(c.row >= 0 && c.row < 4 && c.col >= 0 && c.col < 7);
    assert.ok(["owned", "incoming", "reserve"].includes(c.status));
    assert.ok(c.cost >= 1 && c.cost <= 5);
  }
  assert.equal(m.plan.cells.filter((c) => c.carry).length <= 1, true);
});

test("trocas: classificação ready/hold/slot e passos agrupados sem duplicar", () => {
  const input = live();
  input.rec.recommendations[0].transitions = [
    {
      enter: { id: "DA_18_Aphelios", name: "Aphelios" },
      exit: { id: "DA_Vi18", name: "Vi", items: ["x", "y"] },
      ready: true,
      enterCopies: 3,
      requiredStars: 2,
    },
    {
      enter: { id: "DA_18_Rakan", name: "Rakan" },
      exit: { id: "DA_Nidalee18_AP", name: "Nidalee", items: [] },
      ready: false,
      enterCopies: 1,
      requiredStars: 2,
    },
    {
      enter: { id: "DA_18_Xayah", name: "Xayah" },
      exit: null,
      source: "reserve",
    },
    {
      enter: { id: "DA_Krug18", name: "Krug" },
      exit: { id: "DA_Sentinel18", name: "Sentinel", items: [] },
      ready: false,
      requiredStars: null,
    },
  ];
  const m = buildModel(input);
  assert.deepEqual(
    m.plan.dock.map((d) => d.kind),
    ["ready", "hold", "slot", "blocked"],
  );
  assert.equal(m.plan.dock[0].held, 2);
  assert.equal(m.plan.dock[1].need, 3);
  assert.equal(m.plan.dock[1].have, 1);
  assert.deepEqual(m.plan.counts, { ready: 1, hold: 2 });
  const byId = Object.fromEntries(m.plan.steps.map((s) => [s.id, s]));
  assert.equal(byId.swap.rows.length, 1);
  assert.equal(byId.hold.rows.length, 2, "hold inclui as bloqueadas");
  assert.equal(byId.slot.rows.length, 1);
  assert.ok(m.plan.steps.every((s) => ["now", "items"].includes(s.group)));
  const keys = m.plan.steps.flatMap((s) =>
    s.rows.map((r) => `${s.id}:${r.key}`),
  );
  assert.equal(new Set(keys).size, keys.length, "chaves de linha únicas");
});

test("trilho de nível marca nível atual, próximo (quando sobe) e níveis de roll/final", () => {
  const input = live(),
    p = input.rec.recommendations[0];
  p.strategy = {
    action: "SUBIR NÍVEL",
    headline: "Suba",
    steps: [],
    reasons: [],
    panels: {
      economy: { gold: 44, interest: 4, next: 50, keep: 10 },
      leveling: {
        level: 7,
        xp: { have: 40, total: 68 },
        cost: 4,
        go: true,
        curve: 7,
        finalLevel: 9,
      },
      rolling: {
        level: 7,
        at: 8,
        go: false,
        spend: 0,
        shops: 0,
        keep: null,
        targets: [],
      },
    },
  };
  const { panel } = buildModel(input).plan,
    byN = Object.fromEntries(panel.level.nodes.map((n) => [n.n, n]));
  assert.equal(byN[7].state, "now");
  assert.equal(byN[8].next, true);
  assert.equal(byN[8].roll, true);
  assert.equal(byN[9].final, true);
  assert.deepEqual(
    panel.economy,
    { keep: 10, interest: 4 },
    "o medidor de ouro do HUD lê piso e juros",
  );
});

test("curva de chance sem dados do servidor: binomial por loja, eixo em ouro, quantil 80%", () => {
  const target = {
    id: "a",
    name: "Aphelios",
    goalStars: 2,
    own: 1,
    goal: 3,
    need: 3,
    chancePerShop: 0.12,
  };
  const c = buildCurve(target, 30);
  assert.equal(c.k, 2);
  assert.equal(c.exact, false);
  for (let i = 1; i < c.points.length; i++) {
    assert.ok(c.points[i].v >= c.points[i - 1].v);
    assert.equal(c.points[i].g - c.points[i - 1].g, 2);
  }
  assert.ok(Math.abs(c.plannedValue - binomialTail(2, 15, 0.12)) < 1e-12);
  const shops = c.q80 / 2;
  assert.ok(
    binomialTail(2, shops, 0.12) >= 0.8 &&
      binomialTail(2, shops - 1, 0.12) < 0.8,
  );
  assert.equal(buildCurve(null, 3), null);
});

test("curva de chance do servidor: usa a curva exata e a chance desta rolagem", () => {
  const c = buildCurve(
    {
      name: "Aphelios",
      goalStars: 2,
      own: 1,
      need: 3,
      chancePerShop: 0.12,
      chanceInRoll: 0.4321,
      curve: {
        level: 8,
        step: 2,
        p: [0, 0, 0.05, 0.12, 0.25, 0.4, 0.55],
        q50: 12,
        q80: 30,
        q95: 44,
      },
    },
    9,
  );
  assert.equal(c.exact, true);
  assert.equal(c.level, 8);
  assert.equal(c.maxG, 12);
  assert.deepEqual(c.points[3], { g: 6, v: 0.12 });
  assert.equal(c.q80, 30);
  assert.equal(c.planned, 9);
  assert.equal(c.plannedValue, 0.4321);
});

test("sem recomendação o modelo ainda devolve HUD e status", () => {
  const m = buildModel({
    state,
    rec: { recommendations: [], metadata: {}, self: { health: 10 } },
  });
  assert.equal(m.plan, null);
  assert.equal(m.hero.hp, 10);
});

/* ----- Roll do time inteiro: o servidor decide, o modelo só organiza ----- */

const withStrategy = (opts, tweak) => {
  const input = live(),
    s = makeState(opts);
  tweak?.(s);
  input.rec.recommendations[0].strategy = strategy(
    s.plan,
    s.analysis,
    s.options,
  );
  return buildModel(input).plan.panel.roll;
};
const rivals = { count: 7, cost: 2, stars: 1, size: 6 };

test("roll: veredito do servidor vira selo, orçamento e curva do time", () => {
  const go = withStrategy({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    extra: { Aphelios: 1 },
    rivals,
  });
  assert.equal(go.go, true);
  assert.deepEqual(go.pill, { text: "rolar", tone: "go" });
  assert.equal(go.call.kind, "go");
  assert.equal(go.curve.team, true, "curva de 'pelo menos uma peça evolui'");
  assert.equal(go.curve.planned, go.spend);
  assert.ok(
    Math.abs(go.curve.plannedValue - go.call.any) < 0.02,
    "a curva acende a chance do veredito",
  );
  assert.equal(go.interest, null);
  const hold = withStrategy({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    rivals,
  });
  assert.equal(hold.go, false);
  assert.deepEqual(hold.pill, { text: "não rolar", tone: "wait" });
  assert.equal(hold.curve.planned, null);
  const danger = withStrategy({
    gold: 24,
    hp: 25,
    level: 8,
    stage: "4-2",
    rivals,
  });
  assert.deepEqual(danger.pill, { text: "estabilizar", tone: "danger" });
});

test("roll: linha por peça com estrela alvo, cópias, motivo de inviável e peça da loja", () => {
  const r = withStrategy({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    enemy: { Rakan: 16 },
    rivals,
    shop: [
      {
        slot: 2,
        id: "TFT_Sentinel",
        name: "Sentinel",
        cost: 2,
        action: "comprar",
        reason: "peça da meta",
      },
    ],
  });
  const by = Object.fromEntries(r.targets.map((t) => [t.name, t]));
  assert.equal(by.Aphelios.tag, "1→2★");
  assert.equal(by.Aphelios.pips, true);
  assert.match(by.Aphelios.title, /Aphelios 2★ · 1\/3 cópias \(faltam 2\)/);
  assert.equal(by.Rakan.status, "inviavel");
  assert.match(by.Rakan.title, /inviável: faltam 2 cópias e só 1/);
  assert.equal(by.Sentinel.shop.buy, 1);
  assert.match(by.Sentinel.title, /na loja \(slot 2\): compre 1/);
  assert.deepEqual(
    r.shop.map((s) => s.name),
    ["Sentinel"],
  );
  // Inviáveis ficam no fim da lista; a 3★ distante (Amumu 3/9) mostra a fração, não nove pips.
  assert.equal(r.targets.at(-1).status, "inviavel");
  assert.equal(r.blocked, 1);
});

test("roll: o painel não rola — mostra as melhores peças, até duas inviáveis e conta o resto", () => {
  const row = (name, status = "ok") => ({ name, status });
  const rows = [
    ...["a", "b", "c", "d", "e", "f", "g"].map((n) => row(n)),
    row("x", "inviavel"),
    row("y", "inviavel"),
    row("z", "inviavel"),
  ];
  assert.deepEqual(
    pickRows(rows).map((r) => r.name),
    ["a", "b", "c", "d", "x", "y"],
  );
  assert.deepEqual(
    pickRows(rows.slice(0, 3)).map((r) => r.name),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    pickRows([row("a"), row("x", "inviavel")]).map((r) => r.name),
    ["a", "x"],
  );
  const r = withStrategy({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    rivals,
    reserve: [
      ["Poppy", 1, 1],
      ["Zed", 2, 1],
      ["Jinx", 3, 1],
    ],
  });
  assert.equal(r.targets.length, 6);
  assert.ok(r.more >= 3, `${r.more} fora da lista`);
});

test("roll: selo e etiquetas dos estados sem ouro, esperar o nível e peça nova", () => {
  assert.deepEqual(
    rollPill({ call: { kind: "wait", at: { level: 9 } }, at: 9 }, true),
    { text: "no nível 9", tone: "wait" },
  );
  assert.deepEqual(rollPill({ call: { kind: "unknown" } }, true), {
    text: "ouro ?",
    tone: "wait",
  });
  assert.deepEqual(
    rollPill({ call: { kind: "go" } }, false),
    { text: "", tone: "wait" },
    "fora de partida não há veredito",
  );
  assert.equal(starTag({ kind: "nova", stars: 0, goalStars: 1 }), "nova");
  assert.equal(starTag({ kind: "upgrade", stars: 2, goalStars: 3 }), "2→3★");
});

test("roll: nota de juros só aparece quando rolar derruba o patamar", () => {
  const drop = withStrategy({ gold: 53, hp: 25, level: 8, stage: "4-2" });
  assert.equal(drop.interest.from, 5);
  assert.ok(drop.interest.to < 5);
  const keep = withStrategy({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    extra: { Aphelios: 1 },
    rivals,
  });
  assert.equal(keep.interest, null);
});

test("nível: lido, derivado (piso) e estimado pelo tabuleiro são distinguidos", () => {
  const read = buildModel(live());
  assert.equal(read.hero.levelSource, "tela");
  const derived = live();
  derived.state.screen = {
    ...derived.state.screen,
    level: 5,
    sources: { level: "derived" },
  };
  assert.equal(buildModel(derived).hero.levelSource, "derivado");
  const estimated = live();
  estimated.state.screen = { ...estimated.state.screen, level: null };
  estimated.state.estimatedLevel = 6;
  const m = buildModel(estimated);
  assert.equal(m.hero.level, 6);
  assert.equal(m.hero.levelSource, "estimado");
  // Leitura em conflito com o XP ou velha avisa; o nível usado pela análise aparece à parte.
  const stale = live();
  stale.state.screen.stale = { level: true };
  stale.rec.currentLevel = 7;
  const s = buildModel(stale);
  assert.equal(s.hero.levelStale, true);
  assert.equal(s.hero.levelUsed, 7);
});

test("plano ao vivo: score e chance vêm do ranking de comps (melhor comp) ou do próprio plano", () => {
  const input = live();
  input.rec.recommendations[0].meta = {
    ...input.rec.recommendations[0].meta,
    id: "c1",
  };
  input.rec.compRanking = [
    {
      id: "c1",
      score: 71.6,
      expected: 3.84,
      top4: 61.2,
      chance: 0.42,
      chancePlan: 0.8,
      best: true,
      level: 6,
    },
  ];
  const s = buildModel(input).plan.score;
  assert.deepEqual(s, {
    value: 72,
    expected: 3.84,
    top4: 61.2,
    chance: 0.42,
    chancePlan: 0.8,
    best: true,
    level: 6,
  });
  const own = live();
  own.rec.recommendations[0].compScore = {
    score: 30,
    chance: 0.1,
    chancePlan: null,
  };
  assert.deepEqual(buildModel(own).plan.score, {
    value: 30,
    expected: null,
    top4: null,
    chance: 0.1,
    chancePlan: null,
    best: false,
    level: 8,
  });
  assert.equal(buildModel(live()).plan.score, null);
});

test("achar rolando: peças viáveis, verde a partir de 50%, com a subida de nível; inviáveis ficam de fora", () => {
  const find = (now, over = {}) => ({
    go: now >= 0.5,
    levelUp: false,
    levelDown: false,
    now,
    next: now,
    shops: 5,
    ...over,
  });
  const strip = findStrip([
    {
      id: "a",
      name: "A",
      cost: 2,
      own: 2,
      status: "ok",
      find: find(0.3, { levelUp: true }),
    },
    {
      id: "b",
      name: "B",
      cost: 4,
      own: 0,
      status: "ok",
      find: find(0.7),
      hidden: 2.4,
    },
    { id: "c", name: "C", cost: 5, own: 0, status: "inviavel", find: find(0) },
    {
      id: "d",
      name: "D",
      cost: 1,
      own: 1,
      status: "ok",
      find: find(0.6, { levelDown: true }),
      inBench: true,
    },
  ]);
  assert.deepEqual(
    strip.map((f) => f.id),
    ["d", "b", "a"],
    "verdes primeiro, depois as suas",
  );
  assert.ok(
    strip[0].go &&
      strip[0].levelDown &&
      strip[0].title.includes("no seu banco"),
  );
  assert.ok(strip[1].title.includes("estimativa, não leitura"));
  assert.equal(strip[2].levelUp, true);
});

test("fonte GEP: o modelo traz a origem de ouro/nível e o estado da fonte para o tooltip", () => {
  const s = structuredClone(state);
  s.screen = {
    stage: "1-3",
    gold: 0,
    level: 2,
    xp: "0/2",
    items: [],
    sources: { gold: "gep", level: "gep" },
  };
  s.gepStatus = { state: "ativo", reason: null, lastEventAgeMs: 4200 };
  const { hero, status } = buildModel({ state: s, rec: null });
  assert.equal(hero.goldFrom, "gep");
  assert.equal(hero.levelFrom, "gep");
  assert.equal(hero.levelSource, "tela");
  assert.equal(status.gep.label, "GEP ativo · último evento há 4s");
  s.screen.sources = { gold: "screen", level: "screen" };
  assert.equal(buildModel({ state: s, rec: null }).hero.goldFrom, null);
  assert.equal(
    buildModel({ state: { ...s, gepStatus: undefined }, rec: null }).status.gep,
    null,
  );
});

test("fonte GEP: obsoleto, ausente e esquema desconhecido dizem que a tela assumiu", () => {
  assert.match(
    gepNote({
      state: "obsoleto",
      reason: "sem-eventos-recentes",
      lastEventAgeMs: 90000,
    }).label,
    /obsoleto.*90s.*leitura de tela/,
  );
  assert.match(
    gepNote({ state: "ausente", reason: "banco-ausente" }).label,
    /ausente: banco do TFTAcademy não encontrado.*leitura de tela/,
  );
  assert.match(
    gepNote({ state: "esquema-desconhecido", detail: "events: key" }).label,
    /esquema.*events: key/,
  );
  assert.equal(gepNote(null), null);
  // Chip curto do HUD: ativo mostra a idade; os demais avisam que caiu para a leitura de tela.
  assert.equal(
    gepNote({ state: "ativo", lastEventAgeMs: 4200 }).short,
    "GEP ativo · 4s",
  );
  assert.equal(gepNote({ state: "ativo" }).short, "GEP ativo");
  assert.equal(
    gepNote({ state: "obsoleto", reason: "sem-eventos-recentes" }).short,
    "GEP parado",
  );
  assert.equal(
    gepNote({ state: "ausente", reason: "banco-ausente" }).short,
    "GEP off",
  );
  assert.equal(gepNote({ state: "esquema-desconhecido" }).short, "GEP ?");
});

test("fonte GEP: sem GEP o chip diz que a tela assumiu e a dica lista os campos que ela lê", () => {
  const sources = {
    gold: "screen",
    level: "screen",
    xp: "screen",
    shop: "screen",
    items: "screen",
    bench: null,
  };
  const off = gepNote({ state: "ausente", reason: "banco-ausente" }, sources);
  assert.equal(off.short, "GEP off · tela");
  assert.match(off.label, /Lendo da tela: ouro, nível, XP, loja, itens/);
  assert.deepEqual(off.screen, ["ouro", "nível", "XP", "loja", "itens"]);
  // Parte dos campos vindo do arquivo do jogo ou do GEP: só os da tela entram.
  const part = gepNote(
    { state: "obsoleto", reason: "sem-eventos-recentes" },
    { ...sources, gold: "gep", items: "screen", shop: null, xp: null },
  );
  assert.equal(part.short, "GEP parado · tela");
  assert.deepEqual(part.screen, ["nível", "itens"]);
  // A tela também não leu nada (janela fechada): o aviso é honesto e o chip não promete leitura.
  const none = gepNote({ state: "ausente", reason: "sem-partida" }, {});
  assert.equal(none.short, "GEP off");
  assert.match(none.label, /Nada lido da tela agora/);
  // GEP ativo: nada muda; sem as origens do servidor, o texto é o de antes.
  assert.equal(gepNote({ state: "ativo" }, sources).short, "GEP ativo");
  assert.equal(gepNote({ state: "ativo" }, sources).screen, undefined);
  assert.equal(
    gepNote({ state: "ausente", reason: "banco-ausente" }).screen,
    undefined,
  );
  // O modelo repassa as origens da tela ao chip.
  const s = structuredClone(state);
  s.screen = { stage: "2-1", gold: 3, level: 2, sources };
  s.gepStatus = { state: "ausente", reason: "banco-ausente" };
  assert.equal(
    buildModel({ state: s, rec: null }).status.gep.short,
    "GEP off · tela",
  );
});

test("fonte GEP: gravação desligada no TFTAcademy diz como ligar, no chip e na dica", () => {
  const off = gepNote({
    state: "ausente",
    reason: "gravacao-desligada",
    recordGames: false,
    was: "sem-partida",
  });
  assert.match(
    off.label,
    /ausente: gravação de partidas desligada no TFTAcademy/,
  );
  assert.match(
    off.label,
    /Ligue "gravar partidas" nas configurações do TFTAcademy/,
  );
  assert.match(off.label, /leitura de tela/);
  assert.equal(off.short, "GEP off · ligar gravação");
  assert.match(off.hint, /gravar partidas/);
  // Fora de partida (motivo próprio) com a gravação desligada: o motivo fica, a instrução também.
  const outside = gepNote({
    state: "ausente",
    reason: "fora-de-partida",
    recordGames: false,
  });
  assert.match(outside.label, /fora de partida.*gravar partidas/);
  assert.equal(outside.short, "GEP off");
  // Ativo (partida que já estava sendo gravada) ou configuração desconhecida/ligada: sem a instrução.
  assert.equal(gepNote({ state: "ativo", recordGames: false }).hint, undefined);
  assert.equal(
    gepNote({ state: "ausente", reason: "sem-partida", recordGames: true })
      .hint,
    undefined,
  );
  assert.doesNotMatch(
    gepNote({ state: "ausente", reason: "sem-partida" }).label,
    /gravar partidas/,
  );
});
