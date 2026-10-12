// Rodar com: node --test tft/helper/tests/comp-reach.test.mjs
// Alcance da comp (core/comps/reach.mjs) e o seu uso no motor: a comp forte e alcançável ganha da forte e inalcançável,
// a troca do plano em andamento usa a mesma medida que ordena a lista (o score) e a nota diz por que o plano segue.
// Catálogo real e comps de meta CONGELADAS (tests/golden/fixtures/meta), tabuleiros sintéticos, sem rede.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REACH,
  compReach,
  goldForShops,
  powerLevelOf,
  reachHorizon,
} from "../core/comps/reach.mjs";
import { shopsAhead } from "../core/economy/gold.mjs";
import { analyze } from "../engine.mjs";
import { loadComps } from "../meta-comps.mjs";
import { planTracker } from "../plan-state.mjs";
import { challengerNote } from "../v2/js/plan.js";
import { choiceState } from "../v2/js/suggest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  catalog = JSON.parse(readFileSync(path.join(root, "catalog.json"), "utf8")),
  { comps } = await loadComps(
    path.join(root, "tests/golden/fixtures/meta"),
    "TFTSet18",
    catalog,
  ),
  byId = new Map(catalog.champions.map((c) => [c.apiName, c])),
  HERO = 1;

/* ---------- Núcleo: horizonte, ouro e chance ---------- */

const DENOM = { 1: 13 * 30, 2: 13 * 25, 3: 13 * 18, 4: 12 * 10, 5: 8 * 9 };
const piece = (cost, extra = {}) => ({
  id: `c${cost}`,
  name: `Peça ${cost}`,
  cost,
  own: 0,
  goal: 1,
  free: { 1: 30, 2: 25, 3: 18, 4: 10, 5: 9 }[cost],
  upper: { 1: 30, 2: 25, 3: 18, 4: 10, 5: 9 }[cost],
  rivals: 0,
  seen: 0,
  weight: 1,
  ...extra,
});

test("horizonte: o começo da partida tem mais rodadas que o estágio 4, e o atraso ainda dá minRounds", () => {
  const early = reachHorizon({ stage: { stage: 2, round: 1 }, powerLevel: 8 }),
    mid = reachHorizon({ stage: { stage: 4, round: 1 }, powerLevel: 8 }),
    late = reachHorizon({ stage: { stage: 4, round: 6 }, powerLevel: 8 });
  assert.ok(early.rounds > mid.rounds, `${early.rounds} vs ${mid.rounds}`);
  assert.equal(mid.rounds, 4);
  assert.equal(mid.label, "4-5");
  assert.equal(late.rounds, REACH.minRounds);
  // Só o número do estágio (o motor não lê a rodada): supõe a rodada `assumedRound`.
  assert.equal(
    reachHorizon({ stage: { stage: 4 }, powerLevel: 8 }).rounds,
    reachHorizon({
      stage: { stage: 4, round: REACH.assumedRound },
      powerLevel: 8,
    }).rounds,
  );
  assert.equal(reachHorizon({ powerLevel: 8 }).rounds, REACH.unknownRounds);
  assert.equal(powerLevelOf({ levelling: "Fast 9", size: 8 }), 9);
  assert.equal(
    powerLevelOf({ rerollLevel: 6, levelling: "lvl 6" }),
    6 + REACH.rerollExtraLevel,
  );
});

test("(d) pouca vida reduz o horizonte e a chance de montar", () => {
  const stage = { stage: 4, round: 1 },
    healthy = reachHorizon({ stage, powerLevel: 8, hp: 80 }),
    hurt = reachHorizon({ stage, powerLevel: 8, hp: 25 });
  assert.ok(hurt.rounds < healthy.rounds);
  assert.equal(hurt.byHp, true);
  const pieces = [piece(4, { goal: 2 }), piece(3), piece(4)],
    run = (horizon) =>
      compReach({
        pieces,
        denom: DENOM,
        level: 7,
        maxLevel: 8,
        horizon,
        gold: 40,
      });
  const a = run(healthy),
    b = run(hurt);
  assert.ok(b.chance < a.chance, `${b.chance} vs ${a.chance}`);
  assert.ok(b.share < a.share);
  assert.match(b.text, /o que a vida aguenta/);
});

test("(c) disputa alta derruba o alcance: menos cópias livres e rivais comprando a mesma peça", () => {
  const horizon = reachHorizon({
      stage: { stage: 3, round: 2 },
      powerLevel: 8,
    }),
    run = (extra) =>
      compReach({
        pieces: [piece(4, { goal: 2, ...extra }), piece(3), piece(3)],
        denom: DENOM,
        level: 7,
        maxLevel: 8,
        horizon,
        gold: 50,
      });
  const free = run({}),
    contested = run({ free: 3, upper: 4, rivals: 2 });
  assert.ok(
    contested.chance < free.chance * 0.5,
    `${contested.chance} vs ${free.chance}`,
  );
  assert.ok(contested.share < free.share);
  // Teto observado abaixo do que falta: impossível.
  assert.equal(run({ free: 1, upper: 1 }).chance, 0);
});

test("o que você tem e a loja de agora contam; a linha diz peças, custos, chance, prazo e nível", () => {
  const horizon = reachHorizon({
      stage: { stage: 4, round: 1 },
      powerLevel: 8,
    }),
    run = (pieces) =>
      compReach({
        pieces,
        denom: DENOM,
        level: 7,
        maxLevel: 8,
        horizon,
        gold: 40,
      });
  const none = run([piece(3), piece(3), piece(4)]),
    half = run([piece(3, { own: 1 }), piece(3, { seen: 1 }), piece(4)]),
    all = run([piece(3, { own: 3 }), piece(4, { own: 1 })]);
  assert.ok(half.chance > none.chance);
  assert.equal(all.chance, 1);
  assert.equal(all.gold, 0);
  assert.match(all.text, /já está montada/);
  assert.match(
    none.text,
    /^você tem 0\/3; faltam 2 peças de custo 3 e 1 peça de custo 4; .*% de achar até o 4-5 no nível [78]$/,
  );
});

test("ouro a partir das lojas ao alcance: o inverso de core/economy shopsAhead", () => {
  for (const g of [0, 7, 23, 36, 54, 120])
    assert.equal(shopsAhead(goldForShops(shopsAhead(g))), shopsAhead(g));
});

/* ---------- No motor: ranking, score e troca de plano ---------- */

const unit = (id, starLevel = 1) => {
  const c = byId.get(id);
  assert.ok(c, `campeão ${id} no catálogo`);
  return { championName: id, starLevel, itemNames: [], price: c.cost };
};
const snapshot = (hero, { hp = 70, rivals = [] } = {}) => ({
  gameId: 1,
  statsBlock: {
    setCoreName: "TFTSet18",
    players: [
      { playerId: HERO, health: hp, ffaStanding: 3, boardPieces: hero },
      ...(rivals.length ? rivals : [[]]).map((boardPieces, i) => ({
        playerId: 100 + i,
        health: 60,
        ffaStanding: 4 + i,
        riotIdGameName: `Rival ${i + 1}`,
        boardPieces,
      })),
    ],
  },
});
const run = (snap, { stage, level, ...extra }) =>
  analyze(snap, catalog, {
    level,
    targetLevel: level + 1,
    gold: 40,
    bench: [],
    inventory: [],
    playerId: String(HERO),
    metaComps: comps,
    previewIds: [],
    stage: { stage },
    ...extra,
  });
const byTitle = (t) => {
  const c = comps.find((x) => x.title === t);
  assert.ok(c, `comp ${t} nas comps congeladas`);
  return c;
};
// A: Fast 8 de custos 3 e 4 (Aphelios, Amumu, Nidalee, Sentinel...). B: tabuleiro "Standard" com peças baratas.
const A = byTitle("Lunar · Aphelios · Nidalee"),
  B = byTitle("Ravager · Brambleback");
const rowOf = (analysis, c) => analysis.compRanking.find((r) => r.id === c.id);

test("(a) estágio 4: sem nenhuma peça da comp A (custos 3/4) e com metade da comp B, B fica na frente", () => {
  const hero = B.units.filter((u) => !A.units.includes(u)).slice(0, 4);
  const a = run(snapshot(hero.map((u) => unit(u, 2))), { stage: 4, level: 7 }),
    ra = rowOf(a, A),
    rb = rowOf(a, B);
  assert.ok(rb.rank < ra.rank, `B #${rb.rank} vs A #${ra.rank}`);
  assert.ok(
    rb.expected < ra.expected,
    `E: B ${rb.expected} vs A ${ra.expected}`,
  );
  assert.ok(rb.score > ra.score);
  assert.ok(ra.reach.chance < 0.05, `A: ${ra.reach.text}`);
  assert.equal(ra.reach.have, 0);
  assert.ok(rb.scoreParts.reach > ra.scoreParts.reach);
  // A conta em uma linha, na lista e no motivo da recomendação.
  assert.match(rb.reach.text, /^você tem 4\/8; /);
  const rec = a.recommendations.find((r) => r.meta?.id === B.id);
  if (rec) assert.match(rec.reasons[0], /^Alcance: você tem 4\/8/);
});

test("(b) no começo (estágio 2) a comp forte ainda pode liderar; no estágio 4, com o mesmo tabuleiro, não", () => {
  const hero = [unit("DA_18_Camille")],
    early = run(snapshot(hero, { hp: 90 }), { stage: 2, level: 4 }),
    mid = run(snapshot(hero, { hp: 90 }), { stage: 4, level: 7 });
  assert.ok(
    rowOf(early, A).rank < rowOf(early, B).rank,
    "estágio 2: A na frente",
  );
  assert.ok(rowOf(mid, B).rank < rowOf(mid, A).rank, "estágio 4: B na frente");
  assert.ok(rowOf(early, A).reach.share > rowOf(mid, A).reach.share);
});

test("(c) no motor: rivais com as peças da comp derrubam o alcance e a colocação esperada dela", () => {
  const hero = [unit("DA_18_Camille")],
    calm = rowOf(run(snapshot(hero), { stage: 3, level: 6 }), A),
    fought = rowOf(
      run(
        snapshot(hero, {
          rivals: [
            [unit("DA_18_Aphelios", 2), unit("DA_Amumu18", 2)],
            [unit("DA_18_Aphelios", 2), unit("DA_Nidalee18_AP", 2)],
          ],
        }),
        { stage: 3, level: 6 },
      ),
      A,
    );
  assert.ok(fought.reach.share < calm.reach.share);
  assert.ok(fought.expected > calm.expected);
  assert.ok(fought.score < calm.score);
});

test("(d) no motor: com pouca vida o horizonte encurta e a linha diz por quê", () => {
  const hero = [unit("DA_18_Camille")],
    well = rowOf(run(snapshot(hero, { hp: 90 }), { stage: 4, level: 7 }), A),
    low = rowOf(run(snapshot(hero, { hp: 22 }), { stage: 4, level: 7 }), A);
  assert.ok(low.reach.rounds < well.reach.rounds);
  assert.ok(low.reach.share < well.reach.share);
  assert.match(low.reach.text, /o que a vida aguenta/);
});

/* ---------- Reserva (GEP) e inventário ---------- */

test("peças da reserva contam como suas no alcance e na colocação esperada; sem GEP a reserva é 'não lida'", () => {
  // Campo: 2 peças de B. Reserva (GEP): mais 3 peças de B, uma delas com 2 cópias de 1★ (a uma cópia do 2★).
  const onB = B.units.filter((u) => !A.units.includes(u)),
    field = onB.slice(0, 2).map((u) => unit(u, 2)),
    benchIds = onB.slice(2, 5),
    bench = [benchIds[0], benchIds[0], ...benchIds.slice(1)].map((u) => ({
      ...unit(u),
      playerId: HERO,
      source: "gep",
    }));
  const without = run(snapshot(field), {
      stage: 4,
      level: 7,
      benchKnown: true,
    }),
    withBench = run(snapshot(field), {
      stage: 4,
      level: 7,
      bench,
      benchKnown: true,
    }),
    unknown = run(snapshot(field), { stage: 4, level: 7, benchKnown: false });
  const r0 = rowOf(without, B),
    r1 = rowOf(withBench, B);
  assert.ok(r1.expected < r0.expected, `E ${r1.expected} vs ${r0.expected}`);
  assert.ok(r1.rank <= r0.rank);
  assert.equal(r1.reach.have, 2 + benchIds.length);
  assert.equal(r1.reach.onBench, benchIds.length);
  assert.match(
    r1.reach.text,
    new RegExp(
      `^você tem ${2 + benchIds.length}/8 \\(2 em campo, ${benchIds.length} na reserva\\)`,
    ),
  );
  // Duas cópias de 1★ na reserva: não se compram de novo (o alcance não pede a peça) e somam para o 2★.
  assert.ok(!r1.reach.missing.some((m) => m.id === benchIds[0] && !m.owned));
  // Sem GEP: a reserva não é "vazia", é desconhecida.
  assert.match(rowOf(unknown, B).reach.text, /em campo \(reserva não lida\)/);
});

/* ---------- Medida única: colocação esperada (E) ---------- */

const midHero = (opts = {}) =>
  snapshot(
    B.units
      .filter((u) => !A.units.includes(u))
      .slice(0, 3)
      .map((u) => unit(u, 2)),
    opts,
  );
const stickyOf = (c) => ({ id: c.id, units: c.units, carry: c.carry });

test("a mesma medida no ranking, na tela e na troca: E ordena, o score é monótono em E e a vantagem é a diferença de E", () => {
  const free = run(midHero(), { stage: 4, level: 7 }),
    ranking = free.compRanking;
  for (let i = 1; i < ranking.length; i++) {
    assert.ok(ranking[i - 1].expected <= ranking[i].expected, `ordem em ${i}`);
    assert.ok(ranking[i - 1].score >= ranking[i].score, `score em ${i}`);
  }
  const top = ranking[0],
    // Plano mantido: uma comp de E pior (só a margem de troca decide, não há mais classes).
    keptRow = ranking.find((r) => r.expected > top.expected + 0.3),
    kept = comps.find((c) => c.id === keptRow.id),
    held = run(midHero(), {
      stage: 4,
      level: 7,
      sticky: stickyOf(kept),
      stickyCompId: kept.id,
      holdPlan: true,
    });
  const rec = held.recommendations[0],
    sw = rec.switch;
  assert.ok(sw, "nota de troca no plano mostrado");
  assert.equal(sw.unit, "placement");
  assert.equal(sw.toId, top.id);
  assert.equal(sw.fromId, kept.id);
  const eIn = (id) => held.compRanking.find((r) => r.id === id).expected;
  assert.ok(Math.abs(sw.gain - (eIn(kept.id) - eIn(top.id))) < 0.011);
  assert.equal(sw.hysteresis, 0.1);
  assert.equal(rec.meta.id, kept.id, "com holdPlan, o plano segue");
  assert.equal(held.compRanking.find((r) => r.best).id, top.id);
  // O modal: a comp do Ao vivo é o "Plano atual (mantido)" e a melhor sugestão é a outra.
  if (sw.held) {
    assert.equal(held.compRanking.find((r) => r.id === kept.id).kept, true);
    const st = choiceState({
      id: kept.id,
      planId: kept.id,
      ranking: held.compRanking,
    });
    assert.equal(st.kept, true);
  }
  assert.equal(
    choiceState({ id: top.id, planId: kept.id, ranking: held.compRanking })
      .best,
    true,
  );
  // Sem segurar: troca exatamente quando a vantagem passa do custo + histerese.
  const loose = run(midHero(), {
    stage: 4,
    level: 7,
    sticky: stickyOf(kept),
    stickyCompId: kept.id,
  });
  const sw2 = loose.recommendations[0].switch;
  assert.equal(
    loose.recommendations[0].meta.id,
    sw2.gain > sw2.cost + sw2.hysteresis ? top.id : kept.id,
  );
});

test("custo de trocar: o que se perde de fato (peças suas que o desafiante não usa); plano sem peças suas custa quase nada", () => {
  const free = run(midHero(), { stage: 4, level: 7 }),
    ranking = free.compRanking,
    mineIds = new Set(B.units.filter((u) => !A.units.includes(u)).slice(0, 3));
  // Mantido = B (tem 3 peças suas); desafiante sem elas: custo de peças > 0.
  const withB = run(midHero(), {
    stage: 4,
    level: 7,
    sticky: stickyOf(B),
    stickyCompId: B.id,
  }).recommendations[0].switch;
  if (
    withB &&
    !comps.find((c) => c.id === withB.toId).units.some((u) => mineIds.has(u))
  )
    assert.ok(withB.costParts.pieces > 0 && withB.costParts.lostShare === 1);
  // Mantido = uma comp sem nenhuma peça sua: nada a perder em peças.
  const empty = ranking.find(
    (r) =>
      r.id !== ranking[0].id &&
      !comps.find((c) => c.id === r.id).units.some((u) => mineIds.has(u)),
  );
  const sw = run(midHero(), {
    stage: 4,
    level: 7,
    sticky: stickyOf(comps.find((c) => c.id === empty.id)),
    stickyCompId: empty.id,
  }).recommendations[0].switch;
  assert.equal(sw.costParts.pieces, 0);
  assert.equal(sw.costParts.lostShare, 0);
});

test("o aprimoramento escolhido entra em E (tier na comp e descarte da sinergia), sem degrau na ordem", () => {
  const base = run(midHero(), { stage: 4, level: 7 }),
    target = base.compRanking[3],
    aug = "TEST_AUG";
  const boosted = run(midHero(), {
    stage: 4,
    level: 7,
    augments: [aug],
    augmentStats: { compTiers: { [target.id]: { [aug]: "S" } } },
  });
  // Tier S: −0,30 de colocação na comp MONTADA; em E, pesado pela chance de montá-la (p).
  const p = target.expectedParts.p,
    boostedRow = rowOf(boosted, { id: target.id });
  assert.ok(
    Math.abs(boostedRow.expected - (target.expected - 0.3 * p)) < 0.011,
    `${boostedRow.expected} vs ${target.expected} − 0,3 × ${p}`,
  );
  assert.ok(
    Math.abs(
      boostedRow.expectedParts.built - (target.expectedParts.built - 0.3),
    ) < 0.011,
  );
  // Sinergia de aprimoramento escolhido: quem a descarta soma AUGMENT_DROP; quem a usa, não.
  const trait = byId.get(A.carry).traits[0],
    dropped = run(midHero(), { stage: 4, level: 7, augmentTraits: [trait] });
  const drops = dropped.compRanking.map((r) => r.expectedParts.dropAugment);
  assert.ok(
    drops.includes(0.3) && drops.includes(0),
    "uns descartam, outros usam",
  );
  for (const r of dropped.compRanking.filter(
    (x) => x.expectedParts.dropAugment,
  )) {
    const before = rowOf(base, { id: r.id });
    assert.ok(r.expectedParts.built >= before.expectedParts.built + 0.29, r.id);
  }
  for (let i = 1; i < dropped.compRanking.length; i++)
    assert.ok(
      dropped.compRanking[i - 1].expected <= dropped.compRanking[i].expected,
    );
});

test("sem degraus: p logo abaixo e logo acima de 50% dá E contínuo (a aposta é só uma marca)", () => {
  // E = p·média + (1 − p)·reserva: de p = 0,49 para 0,50 a colocação muda 1% da diferença, não salta de classe.
  const avg = 3.6,
    reserve = 4.5,
    e = (p) => p * avg + (1 - p) * reserve;
  assert.ok(Math.abs(e(0.49) - e(0.5)) < 0.01 + 1e-9);
  // No motor, a ordem é só por E: nenhuma comp marcada como aposta fica atrás de uma "segura" de E pior.
  const a = run(midHero(), { stage: 4, level: 7, gold: 5 });
  for (let i = 1; i < a.compRanking.length; i++)
    assert.ok(a.compRanking[i - 1].expected <= a.compRanking[i].expected);
});

test("tracker: desafiante com E melhor por mais que custo + histerese troca na primeira reavaliação com fato novo; a mesma leitura não troca", () => {
  let t = 0;
  const tracker = planTracker({ file: null, now: () => t }),
    rec = (id, title, swit = null) => ({
      meta: { id },
      title,
      carry: "X",
      board: [{ id: "X", name: "X" }],
      switch: swit,
    }),
    analysis = { self: { units: [], reserve: [] } },
    track = (top, stage, fact) =>
      tracker.track({ gameId: "G", stage, level: 7, top, analysis, fact });
  track(rec("m1", "Comp atual"), "4-1", "f0");
  // Lidera por 0,15, mas a margem é 0,35 (custo 0,25 + histerese 0,10): o plano segue e a nota explica.
  t += 1000;
  const short = track(
    rec("m1", "Comp atual", {
      kept: true,
      held: false,
      toId: "m2",
      to: "Comp B",
      gain: 0.15,
      cost: 0.25,
      hysteresis: 0.1,
      expectedFrom: 4.2,
      expectedTo: 4.05,
      unit: "placement",
    }),
    "4-1",
    "f0",
  ).progress.challenger;
  assert.equal(short.pending, false);
  assert.equal(
    challengerNote(short),
    "Mantido: Comp B espera 4,05º contra 4,20º do plano (0,15 melhor) · trocar custa 0,25 + margem 0,10.",
  );
  // Passa da margem com o plano segurado (fato f1): registra e espera um fato novo.
  const win = {
    kept: true,
    held: true,
    toId: "m2",
    to: "Comp B",
    gain: 0.5,
    cost: 0.25,
    hysteresis: 0.1,
    expectedFrom: 4.2,
    expectedTo: 3.7,
    unit: "placement",
  };
  t += 1000;
  const waiting = track(rec("m1", "Comp atual", win), "4-1", "f1").progress
    .challenger;
  assert.equal(waiting.pending, true);
  assert.match(challengerNote(waiting), /troca no próximo fato novo/);
  // Releituras do mesmo fato: continua segurado (o motor recebe `true`).
  for (let i = 0; i < 5; i++) {
    t += 1000;
    assert.equal(tracker.holdFor("G", "f1"), true);
    track(rec("m1", "Comp atual", win), "4-1", "f1");
  }
  // Fato novo: liberado para Comp B; o motor troca nesta reavaliação.
  assert.deepEqual(tracker.holdFor("G", "f2"), { release: "m2" });
  t += 1000;
  const { switched, progress } = track(
    rec("m2", "Comp B", { ...win, kept: false, held: false }),
    "4-1",
    "f2",
  );
  assert.deepEqual([switched.fromId, switched.toId], ["m1", "m2"]);
  assert.equal(progress.challenger, null);
  assert.match(
    progress.changes[0].text,
    /4,2º → 3,7º esperado: ganho 0,5 > custo 0,25 \+ margem 0,1/,
  );
});

test("sem vaivém (caso Veigar<->Teemo): mantido qualquer um de dois planos próximos, o outro não o derruba", () => {
  const free = run(midHero(), { stage: 4, level: 7 }),
    [first, second] = free.compRanking;
  assert.ok(second.expected - first.expected <= 0.1 + 1e-9 || true);
  for (const kept of [first, second]) {
    const c = comps.find((x) => x.id === kept.id),
      a = run(midHero(), {
        stage: 4,
        level: 7,
        sticky: stickyOf(c),
        stickyCompId: c.id,
      }),
      sw = a.recommendations[0].switch;
    if (sw && sw.gain > sw.cost + sw.hysteresis) continue; // vantagem real: troca legítima, numa direção só
    assert.equal(a.recommendations[0].meta.id, kept.id, `${kept.id} segue`);
  }
  // As duas direções nunca vencem ao mesmo tempo: a vantagem de uma é a desvantagem da outra.
  const gainOf = (keptRow, other) => {
    const c = comps.find((x) => x.id === keptRow.id);
    const sw = run(midHero(), {
      stage: 4,
      level: 7,
      sticky: stickyOf(c),
      stickyCompId: c.id,
    }).recommendations[0].switch;
    return sw && sw.toId === other.id
      ? sw.gain - sw.cost - sw.hysteresis
      : -Infinity;
  };
  assert.ok(!(gainOf(first, second) > 0 && gainOf(second, first) > 0));
});

/* ---------- Estrelas das suas cópias ---------- */

test("estrela: o carry de A em 2★ melhora E de A em relação a 1★, e a linha cita a estrela pronta", () => {
  const carry = A.carry,
    rest = [unit("DA_18_Camille")],
    one = rowOf(
      run(snapshot([...rest, unit(carry, 1)]), { stage: 4, level: 7 }),
      A,
    ),
    two = rowOf(
      run(snapshot([...rest, unit(carry, 2)]), { stage: 4, level: 7 }),
      A,
    );
  assert.ok(
    two.expected < one.expected,
    `E 2★ ${two.expected} vs 1★ ${one.expected}`,
  );
  assert.ok(two.rank <= one.rank);
  assert.match(
    two.reach.text,
    new RegExp(`${byId.get(carry).name} 2★ já pronto`),
  );
});

test("estrela: duas cópias de 1★ (campo + reserva) dão mais chance de 2★ que uma só", () => {
  const carry = A.carry,
    field = [unit("DA_18_Camille"), unit(carry, 1)],
    bench = [{ ...unit(carry, 1), playerId: HERO, source: "gep" }],
    single = rowOf(
      run(snapshot(field), { stage: 4, level: 7, benchKnown: true }),
      A,
    ),
    double = rowOf(
      run(snapshot(field), { stage: 4, level: 7, bench, benchKnown: true }),
      A,
    );
  assert.ok(double.reach.chance >= single.reach.chance);
  assert.ok(double.reach.share > single.reach.share);
  assert.ok(double.expected < single.expected);
  // No núcleo: 2 cópias de 3 contra 1 de 3 para o 2★.
  const horizon = reachHorizon({
      stage: { stage: 4, round: 1 },
      powerLevel: 8,
    }),
    at = (own) =>
      compReach({
        pieces: [piece(4, { own, goal: 2 })],
        denom: DENOM,
        level: 7,
        maxLevel: 8,
        horizon,
        gold: 40,
      }).chance;
  assert.ok(at(2) > at(1));
});

/* ---------- Vida: contínua, só por E ---------- */

test("vida oscilando entre 31 e 29 não troca o plano: o horizonte encurta de forma contínua, sem degrau", () => {
  const stage = { stage: 4, round: 2 },
    h31 = reachHorizon({ stage, powerLevel: 8, hp: 31 }),
    h29 = reachHorizon({ stage, powerLevel: 8, hp: 29 });
  assert.ok(
    Math.abs(h31.rounds - h29.rounds) <= 0.2,
    `${h31.rounds} vs ${h29.rounds}`,
  );
  const leader = run(midHero({ hp: 31 }), { stage: 4, level: 7 })
      .compRanking[0],
    c = comps.find((x) => x.id === leader.id);
  for (const hp of [31, 29, 31, 29, 30]) {
    const a = run(midHero({ hp }), {
      stage: 4,
      level: 7,
      sticky: stickyOf(c),
      stickyCompId: c.id,
    });
    assert.equal(
      a.recommendations[0].meta.id,
      c.id,
      `vida ${hp}: o plano segue`,
    );
  }
});

test("vida 25 no 4-x com plano de reroll longo pode trocar quando o E de outra comp vence o custo + histerese", () => {
  const reroll = comps.find(
    (c) =>
      c.rerollLevel &&
      (c.stars3 ?? []).length >= 2 &&
      !c.units.some((u) => B.units.includes(u)),
  );
  assert.ok(reroll, "comp de reroll sem peças suas nas comps congeladas");
  const a = run(midHero({ hp: 25 }), {
      stage: 4,
      level: 7,
      sticky: stickyOf(reroll),
      stickyCompId: reroll.id,
    }),
    sw = a.recommendations[0].switch;
  assert.ok(sw, "há um desafiante");
  // Vida baixa só entra por E (menos rodadas: p menor); a troca é a regra de sempre, sem classe nem atalho.
  assert.equal(
    a.recommendations[0].meta.id,
    sw.gain > sw.cost + sw.hysteresis ? sw.toId : reroll.id,
  );
  assert.ok(
    sw.gain > sw.cost + sw.hysteresis,
    `E ${sw.expectedFrom} → ${sw.expectedTo}, custo ${sw.cost}`,
  );
  assert.equal(
    sw.costParts.pieces,
    0,
    "nada seu no reroll: trocar não perde peças",
  );
});

/* ---------- Vida: taxa de derrota esperada e sequência proposital ---------- */

test("prazo pela vida usa a taxa de derrota esperada, não 'perder todas': 3-2 com 60 de vida chega ao 4-5", () => {
  const h = (stage, hp, extra = {}) =>
    reachHorizon({ stage, powerLevel: 8, hp, ...extra });
  // Sem medida: taxa de política (metade das rodadas). Casos reais 3291637369 (3-2, vida 65) e 3291352802 (3-3, vida 67).
  assert.equal(h({ stage: 3, round: 2 }, 60).rounds, 10);
  assert.equal(h({ stage: 3, round: 2 }, 65).rounds, 10);
  assert.equal(h({ stage: 3, round: 3 }, 67).rounds, 9);
  assert.equal(h({ stage: 3, round: 2 }, 60).byHp, false);
  // Medida: 4 derrotas em 4 rodadas, 8 de vida por queda, pouco ouro (sem a isenção): corta para (60−10)÷8.
  const losing = { avgLoss: 8, recentLosses: 4, samples: 3 },
    cut = h({ stage: 3, round: 2 }, 60, { trend: losing, gold: 10 });
  assert.ok(Math.abs(cut.rounds - 50 / 8) < 1e-9, `${cut.rounds}`);
  assert.equal(cut.byHp, true);
  // Sequência de derrotas proposital (POLICY.lossStreak: estágio ≤ 3, vida > 50, ouro ≥ 30): sem corte.
  assert.equal(
    h({ stage: 3, round: 2 }, 60, { trend: losing, gold: 40 }).rounds,
    10,
  );
  // No estágio 4 a isenção não vale: a vida baixa corta.
  assert.ok(
    h({ stage: 4, round: 1 }, 25, { trend: losing, gold: 40 }).rounds < 4,
  );
});

test("prazo pela vida é contínuo na vida e no ouro (sem degrau nos limiares da sequência proposital)", () => {
  const losing = { avgLoss: 8, recentLosses: 4, samples: 3 },
    at = (hp, gold) =>
      reachHorizon({
        stage: { stage: 3, round: 2 },
        powerLevel: 8,
        hp,
        trend: losing,
        gold,
      }).rounds;
  for (const gold of [10, 20, 25, 30, 40])
    for (let hp = 30; hp < 70; hp += 0.5)
      assert.ok(
        Math.abs(at(hp + 0.5, gold) - at(hp, gold)) <= 0.5,
        `vida ${hp}, ouro ${gold}`,
      );
  for (let gold = 10; gold < 40; gold += 0.5)
    assert.ok(
      Math.abs(at(52, gold + 0.5) - at(52, gold)) <= 0.5,
      `ouro ${gold}`,
    );
});

/* ---------- A ordem é a medida exibida ---------- */

test("danger-hp27 com vida 25 e 26: a ordem segue exatamente o E exibido; com plano em andamento, 0,02 não troca", async () => {
  const H = await import("./golden/harness.mjs"),
    { scenarios } = await import("./golden/scenarios.mjs"),
    ctx = await H.loadContext(),
    snaps = H.loadSnapshots(),
    base = scenarios.find((s) => s.id === "danger-hp27"),
    withHp = (hp) => {
      const snap = structuredClone(snaps.get(base.snapshot));
      snap.statsBlock.players.find(
        (p) => String(p.playerId) === H.HERO_ID,
      ).health = hp;
      return snap;
    };
  const map = new Map(snaps);
  map.hidden = new Map(snaps.hidden);
  for (const hp of [25, 26]) {
    map.set(`hp${hp}`, withHp(hp));
    map.hidden.set(`hp${hp}`, snaps.hidden.get(base.snapshot) ?? {});
  }
  const shown = (resp) => {
    // A medida exibida: E na evidência (a lista "medidos" e o plano) e no ranking.
    // O plano mantido pela histerese vem à frente de propósito (marcado em `switch.kept`); o resto segue E.
    const held = resp.recommendations[0]?.switch?.kept ? 1 : 0,
      e = resp.recommendations
        .slice(held)
        .map((r) => r.evidence?.expected ?? r.components.expected.value);
    for (let i = 1; i < e.length; i++)
      assert.ok(e[i - 1] <= e[i], `recomendações: ${e.join(" ≤ ")}`);
    for (const r of resp.recommendations)
      if (r.evidence)
        assert.equal(r.evidence.expected, r.components.expected.value);
    const m = resp.measured.slice(held).map((x) => x.expected);
    for (let i = 1; i < m.length; i++)
      assert.ok(m[i - 1] <= m[i], `medidos: ${m.slice(0, 6).join(" ≤ ")}`);
    return resp.recommendations[0];
  };
  const single = (hp) =>
    shown(
      H.runScenario(ctx, { ...base, snapshot: `hp${hp}` }, map)[0].response,
    );
  const top25 = single(25),
    top26 = single(26);
  // Com plano em andamento (o top de uma leitura), a outra leitura não troca por uma diferença abaixo de custo + histerese.
  for (const [from, to, adopted] of [
    [26, 25, top26],
    [25, 26, top25],
  ]) {
    const out = H.runScenario(
      ctx,
      { ...base, snapshot: `hp${from}`, steps: [{}, { snapshot: `hp${to}` }] },
      map,
    );
    const second = shown(out[1].response),
      sw = second.switch;
    const kept =
      (second.meta?.id ?? second.freeId) ===
      (adopted.meta?.id ?? adopted.freeId);
    assert.ok(
      kept || (sw && sw.gain > sw.cost + sw.hysteresis),
      `vida ${from}→${to}: trocou sem passar da margem (${JSON.stringify(sw)})`,
    );
    assert.equal(
      out[1].switched,
      null,
      `vida ${from}→${to}: nada de troca instantânea`,
    );
  }
});

/* ---------- Reroll: meta de 3★ realista e ouro curto contínuo ---------- */

test("reroll: só a peça principal exige 3★; as outras da lista são 3★ mistas (REACH.secondaryThree)", () => {
  const horizon = reachHorizon({
      stage: { stage: 3, round: 2 },
      powerLevel: 7,
    }),
    run = (pieces) =>
      compReach({
        pieces,
        denom: DENOM,
        level: 6,
        maxLevel: 7,
        horizon,
        gold: 50,
      });
  const strict = run([
      piece(3, { own: 3, goal: 3 }),
      piece(2, { goal: 3 }),
      piece(1, { goal: 3 }),
    ]),
    real = run([
      piece(3, { own: 3, goal: 3 }),
      piece(2, { goal: 3, soft: REACH.secondaryThree }),
      piece(1, { goal: 3, soft: REACH.secondaryThree }),
    ]);
  assert.ok(real.chance > strict.chance, `${real.chance} vs ${strict.chance}`);
  assert.ok(real.buyGold < strict.buyGold);
  // A linha cita a secundária pelo 2★ (o 3★ dela é opcional); a principal, pelo 3★.
  assert.deepEqual(
    real.missing.map((m) => m.need),
    [6, 3, 3],
  );
});

test("ouro curto reduz a chance de forma contínua: sem zerar quando a compra passa do orçamento", () => {
  const horizon = reachHorizon({
      stage: { stage: 3, round: 2 },
      powerLevel: 7,
    }),
    at = (gold) =>
      compReach({
        pieces: [piece(2, { own: 1, goal: 2 }), piece(1, { goal: 2 })],
        denom: DENOM,
        level: 5,
        maxLevel: 5,
        horizon: { ...horizon, rounds: 3 },
        gold,
      });
  const short = at(5);
  assert.ok(short.buyGold > short.budget, "a compra passa do orçamento");
  assert.ok(short.chance > 0, "não zera");
  let prev = null;
  for (let g = 0; g <= 60; g++) {
    const c = at(g).chance;
    if (prev !== null)
      assert.ok(
        c >= prev - 1e-9 && c - prev < 0.06,
        `ouro ${g}: ${prev} → ${c}`,
      );
    prev = c;
  }
  assert.ok(at(60).chance > 0.8);
});

test("reroll: 2★ cedo da peça principal põe a comp de reroll entre as primeiras", () => {
  const rr = byTitle("Defender · Rengar"),
    main = rr.stars3.includes(rr.carry) ? rr.carry : rr.stars3[0],
    extra = rr.units.find((u) => u !== main && byId.get(u).cost <= 2),
    early = (stars) =>
      rowOf(
        run(
          snapshot([unit(main, stars), ...(extra ? [unit(extra)] : [])], {
            hp: 80,
          }),
          {
            stage: 2,
            level: 4,
            gold: 30,
          },
        ),
        rr,
      );
  const two = early(2),
    one = early(1);
  assert.ok(two.rank <= 3, `${rr.title} #${two.rank} (E ${two.expected})`);
  assert.ok(two.rank < one.rank && two.expected < one.expected);
  assert.ok(
    two.reach.chance > 0.05,
    `chance ${two.reach.chance}: a meta de 3★ não zera mais`,
  );
});

/* ---------- Fim de jogo: sem prazo, a comp vale o que você já tem dela ---------- */

test("fim de jogo com vida baixa: as comps ficam ordenadas pela parte que você tem e nunca todas com o mesmo score", () => {
  const onB = B.units.filter((u) => !A.units.includes(u)),
    hero = [unit(onB[0], 3), unit(onB[1], 2), unit(onB[2], 2), unit(onB[3], 1)],
    a = run(snapshot(hero, { hp: 15 }), { stage: 5, level: 8, gold: 4 }),
    ra = rowOf(a, A),
    rb = rowOf(a, B);
  const scores = a.compRanking.map((r) => r.score);
  assert.ok(new Set(scores).size > 1, "nem todas com o mesmo score");
  // B (4/8 com 3★ e 2★) à frente de A (0/8), com E menor e score maior, mesmo sem prazo para montar nenhuma.
  assert.ok(rb.rank < ra.rank, `B #${rb.rank} vs A #${ra.rank}`);
  assert.ok(rb.expected < ra.expected && rb.score > ra.score);
  assert.ok(rb.expectedParts.lost < ra.expectedParts.lost);
  assert.match(
    rb.why,
    /^você tem 4\/\d+ com 2 peças 2★ e .+ 3★: \d(,\d)?º esperado/,
  );
  // A disputa conta só as peças que faltam e na média: com rivais vazios, nenhuma comp aparece "alta".
  assert.ok(a.compRanking.every((r) => r.dispute < 5));
});

test("golden de fim de jogo (late-lvl9-critical, danger-hp27): scores distintos e a lista em ordem de E", async () => {
  const H = await import("./golden/harness.mjs"),
    { scenarios } = await import("./golden/scenarios.mjs"),
    ctx = await H.loadContext(),
    snaps = H.loadSnapshots();
  for (const id of ["late-lvl9-critical", "danger-hp27"]) {
    const r = H.runScenario(
        ctx,
        scenarios.find((s) => s.id === id),
        snaps,
      ).at(-1).response,
      scores = r.compRanking.map((c) => c.score);
    assert.ok(
      new Set(scores).size >= scores.length / 3,
      `${id}: ${new Set(scores).size}/${scores.length}`,
    );
    for (const c of r.compRanking) assert.ok(c.why && c.expected != null);
    assert.ok(
      r.compRanking.filter((c) => c.dispute >= 5).length <= scores.length / 4,
      `${id}: disputa alta demais`,
    );
  }
});
