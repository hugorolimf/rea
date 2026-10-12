// Rodar com: node --test "tft/helper/tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { findIndicator, rollRows, rollRule, teamOf } from "../roll.mjs";
import { strategy } from "../strategy.mjs";
import { POLICY } from "../economy.mjs";
import { makeState } from "./fixtures.mjs";

const rivals = { count: 7, cost: 2, stars: 1, size: 6 };
const teamFor = (opts, tweak) => {
  const s = makeState({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    rivals,
    ...opts,
  });
  tweak?.(s);
  return { s, team: teamOf(s.plan, s.analysis, s.options) };
};
const piece = (team, name) => team.pieces.find((p) => p.name === name);

test("alvos: todo campeão do campo, do banco e da comp, cada um com a próxima estrela", () => {
  const { team } = teamFor({ reserve: [["Poppy", 1, 1]], extra: { Rakan: 2 } });
  const names = team.pieces.map((p) => p.name);
  for (const n of [
    "Aphelios",
    "Amumu",
    "Diana",
    "Rakan",
    "Vi",
    "Sentinel",
    "Varus",
    "Poppy",
  ])
    assert.ok(names.includes(n), n);
  // Peça da comp que não é sua e não está à venda neste nível (Xayah) não vira alvo.
  assert.ok(!names.includes("Xayah"));
  assert.deepEqual(
    ["Aphelios", "Rakan", "Amumu"].map((n) => [
      piece(team, n).goal,
      piece(team, n).goalStars,
    ]),
    [
      [3, 2],
      [9, 3],
      [9, 3],
    ],
  );
  assert.equal(piece(team, "Poppy").inBench, true);
  assert.equal(piece(team, "Poppy").inPlan, false);
  assert.equal(piece(team, "Aphelios").inPlan, true);
});

test("peso: carry > core > peça comum > peça fora da comp, com itens somando", () => {
  const { team } = teamFor(
    {
      reserve: [
        ["Poppy", 1, 1],
        ["Zed", 4, 1],
      ],
    },
    (s) => {
      s.plan.meta.builds = { TFT_Rakan: [] };
    },
  );
  const v = (n) => piece(team, n).value;
  // Mesmo degrau 1★→2★ (custo × 0,8): Aphelios 4 (carry, 3 itens), Zed 4 fora da comp, Rakan 3 core, Sentinel 2 comum.
  assert.ok(v("Aphelios") > v("Rakan") && v("Rakan") > v("Sentinel"));
  assert.ok(
    v("Zed") < 4 * 0.8 && v("Zed") > 0,
    "fora da comp vale menos que o custo cheio",
  );
  assert.equal(piece(team, "Rakan").core, true);
  assert.equal(piece(team, "Sentinel").core, false);
  assert.equal(piece(team, "Aphelios").carry, true);
});

test("inviável: sem cópias, bancos dos rivais, 3★ disputado e nível sem a loja do custo", () => {
  const { team } = teamFor(
    {
      level: 6,
      units: [
        ["Aphelios", 4, 1, 0],
        ["Diana", 3, 2, 0],
        ["Sion", 5, 1, 0],
        ["Rakan", 3, 1, 0],
      ],
      enemy: { Aphelios: 9, Diana: 7 },
    },
    (s) => {
      s.plan.meta.stars3 = ["TFT_Diana"];
      // 16 das 17 cópias livres de Rakan estão, provavelmente, nos bancos dos rivais.
      const rakan = s.analysis.pool.find((p) => p.name === "Rakan");
      rakan.hidden = 16;
      rakan.remainingLikely = rakan.remainingUpper - 16;
    },
  );
  assert.equal(piece(team, "Aphelios").why, "sem-copias");
  assert.equal(
    piece(team, "Rakan").why,
    "bancos",
    "o teto observado permite, o provável não",
  );
  assert.equal(
    piece(team, "Sion").why,
    "nivel",
    "custo 5 no nível 6 não aparece na loja",
  );
  assert.equal(
    piece(team, "Diana").why,
    "disputada",
    "3★ com 6+ cópias com rivais",
  );
  // Inviáveis ficam fora da simulação.
  assert.ok(!team.live.some((p) => p.why));
  assert.equal(piece(team, "Rakan").status, "inviavel");
});

test("buscar: no nível de rolagem, o carry que falta dispara a rolagem; antes dele e peça comum, não", () => {
  // Fast 8 Aphelios no 4-1, nível 8, sem nenhuma cópia do carry: rolar é para achá-lo.
  const missing = [
    ["Amumu", 4, 1, 2],
    ["Diana", 3, 1, 0],
    ["Rakan", 3, 1, 0],
    ["Vi", 2, 1, 1],
    ["Sentinel", 2, 1, 0],
    ["Varus", 1, 1, 0],
  ];
  const { team, s } = teamFor({ units: missing, stage: "4-1", gold: 80 });
  const aph = piece(team, "Aphelios");
  assert.ok(aph, "o carry que falta vira alvo");
  assert.equal(aph.seek, true);
  assert.equal(aph.goal, 1);
  assert.equal(aph.sim.evolve, true);
  // Peça comum da comp que falta (Xayah) continua de carona: não entra sozinha.
  assert.ok(!piece(team, "Xayah"));
  const r = strategy(s.plan, s.analysis, s.options);
  assert.equal(r.action, "ROLAR", r.headline);
  const t = r.panels.rolling.rollFor.targets.find((x) => x.name === "Aphelios");
  assert.ok(t, "Aphelios está entre os alvos da rolagem");
  assert.equal(t.goal, "falta");
  assert.equal(t.why, "buscar o carry");
  assert.ok(r.turn.steps.some((x) => x.kind === "roll"));
  // Abaixo do nível de rolagem (7 numa comp de nível 8), a peça cara do final não é buscada.
  const below = teamFor({
    units: missing,
    stage: "3-5",
    level: 7,
    xp: "10/56",
  });
  assert.ok(!piece(below.team, "Aphelios"));
});

test("peça nova da comp à venda entra, vale menos e não conta como evolução", () => {
  const { team, s } = teamFor({
    buyNow: [{ id: "TFT_Xayah", name: "Xayah", cost: 4 }],
  });
  const xayah = piece(team, "Xayah");
  assert.equal(xayah.goal, 1);
  assert.equal(xayah.sim.evolve, false);
  assert.ok(xayah.value > 0 && xayah.value < 4 * 0.8);
  // Comprar peça nova rende força, mas não decide rolar por si só.
  s.analysis.self.units = [];
  const alone = teamOf(s.plan, s.analysis, s.options);
  assert.ok(!alone.live.some((p) => p.sim.evolve && p.name === "Xayah"));
});

test("regra: espera o nível de rolagem quando a peça principal fica bem mais provável lá", () => {
  const s = makeState({
    gold: 70,
    hp: 80,
    level: 7,
    xp: "10/56",
    stage: "4-1",
    units: [["Aphelios", 4, 1, 0]],
    extra: { Aphelios: 1 },
    rivals,
  });
  s.plan.meta = { levelling: "Standard", rerollLevel: null, stars3: [] };
  const r = strategy(s.plan, s.analysis, s.options),
    call = r.panels.rolling.call;
  assert.equal(r.panels.rolling.at, 8);
  assert.equal(call.kind, "wait");
  assert.equal(call.go, false);
  assert.ok(call.at.level === 8 && call.at.chance > call.mainChance + 0.15);
  assert.equal(r.action, "ECONOMIZAR");
  assert.equal(r.headline, "Espere o nível 8 para rolar");
});

test("regra: sem ouro acima do piso não rola e diz que os juros caem", () => {
  const s = makeState({
      gold: 52,
      hp: 80,
      level: 8,
      stage: "4-2",
      extra: { Aphelios: 1 },
      rivals,
    }),
    team = teamOf(s.plan, s.analysis, s.options),
    verdict = rollRule(team, team.simulate(), {
      level: 8,
      cash: 52,
      floor: 50,
      planned: 0,
      danger: false,
      rollAt: 8,
    });
  assert.equal(verdict.go, false);
  assert.equal(verdict.kind, "hold");
  assert.match(verdict.reason, /Ouro no piso \(50g\)/);
  // Perigo dispensa os 50%: com chance alta de upgrade do plano e ganho que paga o ouro, rola para estabilizar.
  const danger = rollRule(team, team.simulate(), {
    level: 8,
    cash: 52,
    floor: 10,
    planned: 30,
    danger: true,
    rollAt: 8,
  });
  assert.equal(danger.kind, "danger");
  assert.equal(danger.spend, 30);
});

// Golden danger-hp27 (tft-pressao-vida): em perigo, "basta ganho positivo" mandava rolar 8 g com ~0% de achar upgrade.
// Agora o perigo exige POLICY.roll.dangerChance de fechar upgrade do plano e dangerGainPerGold de força por ouro.
test("perigo: rolar exige chance mínima de upgrade do plano e ganho que pague o ouro; abaixo disso diz por quê", () => {
  const R = POLICY.roll,
    G = POLICY.simulation.maxGold + 1;
  // Time sintético: uma peça do plano com chance `p` de fechar o 2★ e ganho `g` em qualquer orçamento.
  const rule = ({ p, g, planned = 8, inPlan = true }) => {
    const curve = new Float64Array(G).fill(p),
      main = {
        id: "TFT_X",
        name: "X",
        cost: 3,
        own: 2,
        goal: 3,
        goalStars: 2,
        free: 5,
        value: 4,
        prior: 1,
        inPlan,
        curve,
        status: "ok",
        sim: { evolve: true },
      };
    return rollRule(
      { live: [main], pieces: [main], denom: { 3: 50 } },
      {
        mix: {
          any: Float64Array.from(curve),
          gain: new Float64Array(G).fill(g),
        },
      },
      { level: 8, cash: 18, floor: 10, planned, danger: true, rollAt: 8 },
    );
  };
  // ~0% (o caso do golden): não rola e o motivo diz a chance e o mínimo.
  const none = rule({ p: 0.003, g: 0.5 });
  assert.equal(none.go, false);
  assert.equal(none.spend, 0);
  assert.equal(none.kind, "hold");
  assert.match(
    none.reason,
    /^Vida em risco, mas só 0% de fechar upgrade do plano com 8g \(mínimo 10%\)/,
  );
  // Chance boa, mas o ganho esperado não paga o ouro (30 g rendendo menos de ~1 de força).
  const cheap = rule({ p: 0.3, g: 0.1, planned: 30 });
  assert.equal(cheap.go, false);
  assert.match(
    cheap.reason,
    /30g renderiam só \+0\.1 de força esperada \(mínimo \+1\)/,
  );
  // 12% de upgrade do plano e ganho acima do mínimo: rola para estabilizar.
  const go = rule({ p: 0.12, g: 0.6, planned: 14 });
  assert.equal(go.kind, "danger");
  assert.equal(go.go, true);
  assert.equal(go.spend, 14);
  assert.match(
    go.reason,
    /^Vida em risco: 12% de fechar upgrade do plano com 14g/,
  );
  // Os limiares: um pouco abaixo de cada um não rola.
  assert.equal(rule({ p: R.dangerChance - 0.01, g: 5, planned: 14 }).go, false);
  assert.equal(
    rule({ p: 0.5, g: R.dangerGainPerGold * 14 - 0.01, planned: 14 }).go,
    false,
  );
  // Sem peça do plano evoluindo, a régua é a de 2★ do time.
  assert.match(rule({ p: 0.003, g: 0.5, inPlan: false }).reason, /2★ do time/);
});

test("a simulação do time é reaproveitada quando só o ouro muda e refeita quando a pool muda", () => {
  const a = teamFor({ gold: 90 }).team.simulate(),
    b = teamFor({ gold: 60 }).team.simulate(),
    c = teamFor({ gold: 90, enemy: { Rakan: 4 } }).team.simulate();
  assert.equal(a.gain, b.gain, "mesmo nível, alvos e pool: a mesma simulação");
  assert.notEqual(a.gain, c.gain);
  // O melhor de dois mundos nunca fica abaixo da conta exata de uma peça sozinha.
  const team = teamFor({}).team,
    sim = team.simulate(),
    aph = team.live.find((p) => p.name === "Aphelios");
  for (const g of [10, 30, 60])
    assert.ok(sim.mix.any[g] >= aph.curve[g] - 1e-12);
});

test("indicador verde 'achar rolando': só informa, vem de todas as peças e depende das odds do nível", () => {
  const piece = (over) => ({
    status: "ok",
    chancePerShop: 0.1,
    chancePerShopNext: 0.05,
    ...over,
  });
  // 10 lojas com 10% por loja: 1 - 0,9^10 ≈ 65% → verde; o nível seguinte (5% por loja → 40%) tira do verde.
  const down = findIndicator(piece({}), 10);
  assert.equal(down.go, true);
  assert.equal(down.levelDown, true);
  assert.equal(down.levelUp, false);
  assert.equal(down.now, 0.65);
  // Hoje fora do verde e o nível seguinte leva a ele.
  const up = findIndicator(
    piece({ chancePerShop: 0.02, chancePerShopNext: 0.2 }),
    10,
  );
  assert.deepEqual([up.go, up.levelUp, up.levelDown], [false, true, false]);
  // Inviável nunca é verde.
  const bad = findIndicator(piece({ status: "inviavel" }), 50);
  assert.deepEqual([bad.go, bad.levelUp, bad.now], [false, false, 0]);
  // Sem orçamento: conta 5 lojas.
  const s = makeState({ gold: 60, hp: 60, level: 8, stage: "4-2" });
  const team = teamOf(s.plan, s.analysis, s.options);
  const rows = rollRows(team, { budget: 0 });
  assert.ok(rows.length && rows.every((r) => r.find && r.find.shops === 5));
  assert.ok(rows.every((r) => r.find.now >= 0 && r.find.now <= 1));
});
