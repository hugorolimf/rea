// Rodar com: node --test "tft/helper/tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { strategy } from "../strategy.mjs";
import { stagePlan } from "../stage.mjs";
import { closeCurve, freeByCost } from "../economy.mjs";
import { makeState } from "./fixtures.mjs";

const run = (opts) => {
  const s = makeState(opts);
  return { s, r: strategy(s.plan, s.analysis, s.options) };
};
const card = (name, cost) => ({
  slot: 1,
  id: `TFT_${name}`,
  name,
  cost,
  action: "comprar",
  reason: "peça da meta",
});
const rivals = { count: 7, cost: 2, stars: 1, size: 6 };

test("compras da loja saem do ouro antes da rolagem e não furam o piso", () => {
  const base = {
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    extra: { Aphelios: 1 },
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  };
  const plain = run(base).r,
    shopping = run({ ...base, shop: [card("Xayah", 4)] }).r;
  assert.equal(plain.action, "ROLAR");
  assert.equal(shopping.action, "ROLAR");
  assert.equal(shopping.cash, 71);
  assert.ok(
    shopping.spend <= plain.spend - 4,
    `${shopping.spend} vs ${plain.spend}`,
  );
  assert.ok(shopping.keep >= 50, "piso de 50g respeitado depois da loja");
  assert.ok(shopping.steps[0].startsWith("Compre na loja"));
});

test("o ganho esperado mostrado é o da rolagem recomendada", () => {
  const { r } = run({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    extra: { Aphelios: 1 },
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  assert.equal(r.action, "ROLAR");
  assert.equal(r.ev.roll.gold, r.spend);
  assert.equal(r.panels.rolling.spend, r.spend);
  assert.ok(r.reasons.some((t) => t.includes(`rolar ${r.spend}g`)));
});

test("rolar 2g sem ouro para comprar a cópia achada não é recomendado", () => {
  const { r } = run({
    gold: 52,
    hp: 80,
    level: 8,
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  assert.equal(r.action, "ECONOMIZAR");
  assert.equal(r.keep, 52);
});

test("chance desta rolagem é de fechar o 2★ (cópias + preço + pool), não de ver uma cópia", () => {
  const { s, r } = run({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    extra: { Aphelios: 1 },
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  const roll = r.panels.rolling,
    t = roll.targets.find((x) => x.name === "Aphelios");
  assert.ok(roll.go && roll.call.main.name === "Aphelios");
  const seeOne = 1 - (1 - t.chancePerShop) ** roll.shops;
  const exact = closeCurve({
    level: 8,
    cost: 4,
    own: t.own,
    goal: 3,
    free: t.left,
    denom: freeByCost(s.analysis.pool)[4],
  })[r.spend];
  assert.ok(Math.abs(t.chance - exact) < 1e-12);
  assert.ok(t.chance < seeOne, `${t.chance} < ${seeOne}`);
  assert.ok(t.gold50 > 0, "ouro para 50% da peça sozinha");
  // A curva do painel é a de "pelo menos uma peça do time evolui", a mesma que decide rolar.
  assert.equal(roll.curve.team, true);
  assert.equal(roll.curve.summary.step, 2);
  assert.ok(roll.curve.summary.q80 > 0 && roll.curve.summary.p.length > 4);
  assert.ok(
    roll.curve.at >= t.chance - 1e-9,
    "alguma peça evoluir é pelo menos tão provável quanto o core",
  );
});

test("XP passivo: faltando 2 XP não compra XP fora de perigo, mas compra em perigo", () => {
  const healthy = run({
    gold: 60,
    hp: 80,
    level: 7,
    xp: "54/56",
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  }).r;
  assert.equal(healthy.action, "ECONOMIZAR");
  assert.equal(healthy.headline, "Suba de graça na próxima rodada");
  assert.equal(healthy.panels.leveling.passive, true);
  assert.equal(healthy.panels.leveling.go, false);
  const hurt = run({ gold: 60, hp: 25, level: 6, xp: "34/36", stage: "4-2" }).r;
  assert.ok(hurt.steps.some((t) => t.startsWith("Suba para o nível 7")));
});

test("nível máximo não sugere comprar XP", () => {
  const { r } = run({
    gold: 90,
    hp: 80,
    level: 10,
    xp: "0/0",
    stage: "5-5",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  assert.notEqual(r.action, "SUBIR NÍVEL");
  assert.equal(r.panels.leveling.cost, null);
  assert.equal(r.panels.leveling.xp.max, true);
});

test("vida crítica: all-in vende o banco fora da comp quando o ouro não basta", () => {
  const { r } = run({
    gold: 12,
    hp: 12,
    level: 8,
    xp: "10/68",
    stage: "5-1",
    reserve: [
      ["Ezreal", 4, 2],
      ["Taric", 1, 1],
    ],
  });
  assert.equal(r.action, "ROLAR");
  assert.equal(r.sellable.gold, 12);
  assert.ok(r.spend > 12, `gasta além do ouro em mãos: ${r.spend}`);
  assert.ok(r.steps.some((t) => t.startsWith("Venda Ezreal 2★")));
  assert.ok(r.keep >= 0);
});

test("reroll: rápido com vida até 50 (piso 20), lento acima (piso 50)", () => {
  const base = {
    comp: "reroll",
    gold: 62,
    level: 6,
    xp: "2/36",
    stage: "3-2",
    extra: { Garen: 1 },
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  };
  const fast = run({ ...base, hp: 45 }).r,
    slow = run({ ...base, hp: 80 }).r;
  assert.ok(fast.headline.startsWith("Reroll rápido"));
  assert.ok(fast.keep >= 20 && fast.keep < 30);
  assert.ok(slow.headline.startsWith("Reroll lento"));
  assert.ok(slow.keep >= 50);
});

test("reroll disputado: desiste do 3★ com 6 cópias com rivais", () => {
  const { r } = run({
    comp: "reroll",
    gold: 62,
    hp: 80,
    level: 6,
    xp: "2/36",
    stage: "3-2",
    enemy: { Kayle: 6, Garen: 7 },
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  assert.equal(r.action, "SUBIR NÍVEL");
  assert.equal(r.headline, "3★ disputado: desista do reroll e suba de nível");
});

test("unidades repetidas em campo não contam o upgrade duas vezes", () => {
  const base = {
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  };
  const units = [
    ["Aphelios", 4, 1, 3],
    ["Amumu", 4, 2, 2],
    ["Sentinel", 2, 1, 0],
  ];
  const twice = run({ ...base, units: [...units, ["Sentinel", 2, 1, 0]] }).r,
    once = run({ ...base, units, extra: { Sentinel: 1 } }).r;
  assert.equal(twice.ev.roll.gainMax, once.ev.roll.gainMax);
});

test("painel de economia: ouro depois da ação, renda, projeção e sequência", () => {
  const s = makeState({
    gold: 44,
    hp: 80,
    level: 7,
    xp: "40/68",
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  s.options.streak = { kind: "loss", length: 3, inferred: true };
  const r = strategy(s.plan, s.analysis, s.options),
    eco = r.panels.economy;
  assert.equal(eco.after, r.keep ?? r.cash);
  assert.equal(eco.projection.length, 4);
  assert.equal(eco.projection[0].label, "4-3");
  assert.equal(eco.income.streak, 1);
  assert.equal(eco.income.total, 5 + Math.floor(eco.after / 10) + 1);
  assert.equal(eco.projection[0].gold, eco.after + eco.income.total);
  assert.equal(eco.streak.gold, 1);
  assert.ok(r.reasons.some((t) => t.startsWith("Sequência de 3 derrotas")));
});

test("comp Standard (sem rerollLevel nem Fast N): rola no nível do custo do carry, sem reroll de 3★", () => {
  const at = (carry, level) => {
    const s = makeState({
      gold: 54,
      hp: 80,
      level,
      xp: "10/48",
      stage: "4-2",
      rivals: { count: 7, cost: 2, stars: 1, size: 6 },
    });
    s.plan.meta = { levelling: "Standard", rerollLevel: null, stars3: [] };
    s.plan.carry = carry;
    return strategy(s.plan, s.analysis, s.options);
  };
  const four = at("Aphelios", 7);
  assert.equal(four.rollAt, 8);
  assert.equal(four.finalLevel, 8);
  assert.equal(four.style, "Standard");
  assert.notEqual(
    four.action,
    "ROLAR",
    "abaixo do nível do carry de custo 4 não rola",
  );
  const three = at("Diana", 7);
  assert.equal(three.rollAt, 7);
  assert.ok(
    !three.headline.startsWith("Reroll"),
    "sem alvos de 3★ não entra no reroll",
  );
  // Diana já é 2★: a próxima estrela que falta é o 3★ (se vale rolar por ela, decide a chance).
  const diana = three.panels.rolling.targets.find((t) => t.name === "Diana");
  assert.equal(diana.goal, 9, "carry 2★ mira o 3★");
  assert.equal(diana.carry, true);
});

// Catálogo mínimo para stagePlan: só os campeões usados no teste.
const catalog = {
  champions: [
    ["Aphelios", 4],
    ["Amumu", 4],
    ["Xayah", 4],
    ["Diana", 3],
    ["Rakan", 3],
    ["Vi", 2],
    ["Sentinel", 2],
    ["Varus", 1],
    ["Poppy", 1],
  ].map(([name, cost]) => ({ apiName: `TFT_${name}`, name, cost, traits: [] })),
  items: [],
};

// Mudança da regra de vida (tft-pressao-vida): antes, na faixa de perigo, a cópia fora do plano que não fecha estrela era
// comprada mesmo derrubando os juros. Ela não estabiliza agora (uma cópia solta não sobe estrela) e tira ouro das cópias
// e upgrades do plano; agora fica. A cópia que fecha estrela continua comprada em qualquer faixa.
test("loja: em perigo, a cópia fora do plano que não fecha estrela fica; a que fecha um 2★ é comprada", () => {
  const shopFor = (hp, stage, reserve = []) => {
    const s = makeState({
      gold: 30,
      hp,
      stage,
      // Lobby fraco: a board não conta como "abaixo da maioria", só a vida e o estágio definem a faixa.
      rivals: { count: 7, cost: 1, stars: 1, size: 2 },
      units: [
        ["Aphelios", 4, 1, 0],
        ["Poppy", 1, 1, 0],
      ],
      reserve,
    });
    s.options.shop = ["TFT_Poppy"];
    return stagePlan(s.plan, s.analysis, catalog, s.options).shop[0];
  };
  // HP 42: em perigo a partir do estágio 4 (mesma régua da estratégia), saudável o bastante no estágio 3.
  const danger = shopFor(42, "4-2");
  assert.equal(danger.action, "segurar");
  assert.match(danger.reason, /vida em perigo.*upgrades do plano/);
  assert.equal(shopFor(42, "3-2").action, "segurar");
  assert.match(shopFor(42, "3-2").reason, /juros/);
  assert.equal(shopFor(80, "4-2").action, "segurar");
  // Com duas cópias, a da loja fecha o 2★: força agora, comprada mesmo abaixo do patamar de juros.
  for (const [hp, stage] of [
    [42, "4-2"],
    [80, "4-2"],
  ])
    assert.equal(shopFor(hp, stage, [["Poppy", 1, 1]]).action, "comprar");
});

test("rolar pelo time: campo, banco e comp entram na lista e o banco estimado dos rivais derruba a chance", () => {
  const base = {
    gold: 70,
    hp: 40,
    level: 8,
    stage: "4-2",
    rivals,
    reserve: [["Poppy", 1, 1]],
  };
  const withHidden = (hidden) => {
    const s = makeState(base);
    s.plan.meta.builds = { TFT_Amumu: [], TFT_Xayah: [] };
    const aph = s.analysis.pool.find((p) => p.name === "Aphelios");
    aph.hidden = hidden;
    aph.remainingLikely = aph.remainingUpper - hidden;
    return strategy(s.plan, s.analysis, s.options).panels.rolling;
  };
  const free = withHidden(0),
    held = withHidden(4);
  const names = free.targets.map((t) => t.name);
  // Todo campeão do tabuleiro (7) e do banco (Poppy), não só até 4 cores.
  for (const n of [
    "Aphelios",
    "Rakan",
    "Sentinel",
    "Amumu",
    "Diana",
    "Vi",
    "Varus",
    "Poppy",
  ])
    assert.ok(names.includes(n), `${n} ausente: ${names}`);
  assert.equal(free.total, free.targets.length);
  const aph = (r) => r.targets.find((t) => t.name === "Aphelios");
  assert.equal(aph(free).carry, true);
  assert.ok(
    aph(held).chance < aph(free).chance,
    `${aph(held).chance} vs ${aph(free).chance}`,
  );
  assert.equal(aph(held).hidden, 4);
  assert.equal(
    aph(held).left,
    aph(free).left - 4,
    "provável = teto menos o banco dos rivais",
  );
  assert.equal(aph(held).upper, aph(free).upper, "o teto observado não muda");
  // Amumu já é 2★ e tem build de meta: mira o 3★ (9 cópias) como core.
  const amumu = free.targets.find((t) => t.name === "Amumu");
  assert.equal(amumu.goal, 9);
  assert.equal(amumu.goalStars, 3);
  assert.equal(amumu.core, true);
});

test("regra única: sem 50% de chance de evoluir alguma peça rolar vira guardar; com chance, guardar vira rolar", () => {
  // Nível 8, 25g acima do piso: o time todo junto não chega a 50% → guardar, dizendo quanto ouro passa na regra.
  const hold = run({ gold: 75, hp: 80, level: 8, stage: "4-2", rivals }).r,
    hc = hold.panels.rolling.call;
  assert.equal(hold.action, "ECONOMIZAR");
  assert.equal(hc.changed, "hold");
  assert.equal(hc.kind, "hold");
  assert.ok(
    hc.any < 0.5 && hc.need > hc.budget,
    `${hc.any} ${hc.need} ${hc.budget}`,
  );
  assert.match(hold.steps[0], /^Não role: Só \d+% de evoluir alguma peça/);
  // Com Aphelios 2/3 (falta uma cópia) a mesma situação passa na regra: rola.
  const roll = run({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    extra: { Aphelios: 1 },
    rivals,
  }).r;
  assert.equal(roll.action, "ROLAR");
  assert.ok(roll.panels.rolling.call.go && roll.panels.rolling.call.any >= 0.5);
});

test("regra única: guardar tira todos os passos de rolar; guardar→rolar tira os de economizar e cita o time", () => {
  // Rolar → guardar: nenhum passo além do "Não role" manda rolar, nem razão de quanto rolar.
  const hold = run({ gold: 52, hp: 55, level: 8, extra: { Aphelios: 3 } }).r;
  assert.equal(hold.panels.rolling.call.changed, "hold");
  assert.ok(
    hold.steps.slice(1).every((t) => !/\brole\b/i.test(t)),
    hold.steps.join(" | "),
  );
  assert.ok(
    hold.reasons.every((t) => !/^Pare em|^Rolar agora rende/.test(t)),
    hold.reasons.join(" | "),
  );
  // Guardar → rolar (XP passivo antes do nível de reroll, Garen 2/3): a peça principal é o Garen.
  const s = makeState({
      comp: "reroll",
      level: 5,
      xp: "34/36",
      gold: 90,
      hp: 80,
      stage: "3-2",
      extra: { Garen: 1 },
    }),
    roll = strategy(s.plan, s.analysis, s.options),
    call = roll.panels.rolling.call;
  assert.equal(call.changed, "roll");
  assert.ok(
    !/economi[sz]e|Mantenha a economia/i.test(roll.steps[0]),
    roll.steps.join(" | "),
  );
  assert.equal(call.kind, "go");
  assert.equal(call.main.name, "Garen");
  assert.match(
    roll.steps[0],
    new RegExp(`${Math.round(call.any * 100)}% de evoluir alguma peça`),
  );
  // O gasto é o menor que passa na regra, não o joelho da curva de ganho.
  assert.equal(roll.panels.rolling.stop, null);
  assert.equal(roll.panels.rolling.max, roll.spend);
  assert.equal(roll.spend, call.budget);
});

test("veredito e lista: mesma peça principal, mesma chance e o piso do reroll no orçamento", () => {
  const { r } = run({ gold: 44, hp: 55, level: 8 }),
    ro = r.panels.rolling,
    main = ro.targets.find((t) => t.id === ro.call.main.id);
  assert.ok(main);
  assert.equal(ro.call.mainChance, main.chance);
  // Reroll: o piso do reroll (50g lento) chega à regra e o orçamento avaliado é o que passa dele.
  const reroll = run({
    comp: "reroll",
    level: 6,
    gold: 60,
    hp: 55,
    extra: { Kayle: 2 },
  }).r;
  assert.equal(reroll.floor, 50);
  assert.equal(reroll.panels.rolling.call.budget, 10);
  // Meta é a próxima estrela: Garen 1★ de reroll mira 2★ na lista, como na regra.
  const garen = reroll.panels.rolling.targets.find((t) => t.name === "Garen");
  assert.equal(garen.goalStars, 2);
  assert.equal(garen.kind, "upgrade");
});

test("a soma do time decide: peça barata que fecha 2★ por pouco ouro vale rolar mesmo com o core inviável", () => {
  // Aphelios (carry) com 8 cópias nos rivais: faltam 2 e só sobra 1. Rakan (custo 3) está a uma cópia do 2★.
  const { r } = run({
      gold: 75,
      hp: 80,
      level: 8,
      stage: "4-2",
      extra: { Rakan: 1 },
      enemy: { Aphelios: 8 },
      rivals,
    }),
    ro = r.panels.rolling,
    aph = ro.targets.find((t) => t.name === "Aphelios"),
    rakan = ro.targets.find((t) => t.name === "Rakan");
  assert.equal(aph.status, "inviavel");
  assert.equal(aph.why, "sem-copias");
  assert.equal(aph.chance, 0);
  assert.equal(r.action, "ROLAR");
  assert.equal(ro.call.main.name, "Rakan");
  assert.ok(
    rakan.chance > 0.5 && rakan.value < aph.value,
    "peça barata e core caro",
  );
  assert.ok(ro.call.any >= 0.5);
  assert.match(r.steps[0], /Rakan 2★/);
  // A inviável fica marcada no fim da lista, depois das peças viáveis.
  assert.ok(ro.targets.indexOf(aph) > ro.targets.indexOf(rakan));
});

test("peça inviável é marcada com o motivo e sugere o substituto do plano", () => {
  const s = makeState({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    enemy: { Rakan: 16 },
    rivals,
  });
  s.plan.flex = [
    {
      id: "TFT_Rakan",
      suggest: "TFT_Vi",
      options: [
        { id: "TFT_Poppy", name: "Poppy", cost: 3, owned: false },
        { id: "TFT_Vi", name: "Vi", cost: 3, owned: true },
      ],
    },
  ];
  const ro = strategy(s.plan, s.analysis, s.options).panels.rolling,
    rakan = ro.targets.find((t) => t.name === "Rakan");
  assert.equal(rakan.status, "inviavel");
  assert.equal(rakan.why, "sem-copias");
  assert.match(rakan.whyText, /faltam 2 cópias e só 1/);
  assert.equal(
    rakan.substitute.name,
    "Vi",
    "a troca sugerida pelo plano, não a primeira da lista",
  );
  // Sem opções no plano (o carry, por exemplo), a peça fica marcada sem substituto.
  const carry = makeState({
      gold: 75,
      hp: 80,
      level: 8,
      stage: "4-2",
      enemy: { Aphelios: 9 },
      rivals,
    }),
    aph = strategy(
      carry.plan,
      carry.analysis,
      carry.options,
    ).panels.rolling.targets.find((t) => t.name === "Aphelios");
  assert.equal(aph.status, "inviavel");
  assert.equal(aph.substitute, null);
});

test("sem peça viável: só sobram inviáveis e o veredito diz qual trocar", () => {
  const s = makeState({
    gold: 90,
    hp: 80,
    level: 8,
    stage: "4-2",
    units: [
      ["Aphelios", 4, 1, 0],
      ["Rakan", 3, 1, 0],
    ],
    enemy: { Aphelios: 9, Rakan: 16 },
    rivals,
  });
  s.plan.flex = [
    {
      id: "TFT_Rakan",
      suggest: "TFT_Vi",
      options: [{ id: "TFT_Vi", name: "Vi", cost: 3, owned: true }],
    },
  ];
  const r = strategy(s.plan, s.analysis, s.options),
    call = r.panels.rolling.call;
  assert.notEqual(r.action, "ROLAR");
  assert.equal(call.kind, "blocked");
  assert.equal(call.go, false);
  assert.match(call.reason, /Rakan \(troque por Vi\)/);
});

test("nada perto de evoluir: 3★ distante não segura o veredito de inviável", () => {
  const s = makeState({
      gold: 90,
      hp: 80,
      level: 8,
      stage: "4-2",
      enemy: { Aphelios: 9, Rakan: 16, Sentinel: 24 },
      rivals,
    }),
    call = strategy(s.plan, s.analysis, s.options).panels.rolling.call;
  assert.equal(call.kind, "none");
  assert.match(call.reason, /3★ distante/);
  assert.match(call.reason, /inviável: /);
});

test("perigo: com a vida baixa rola para estabilizar mesmo abaixo de 50%; com vida cheia o mesmo ouro acima do piso é guardado", () => {
  const danger = run({ gold: 24, hp: 25, level: 8, stage: "4-2", rivals }).r,
    healthy = run({ gold: 64, hp: 80, level: 8, stage: "4-2", rivals }).r;
  // Mesmo ouro acima do piso (14g): a regra normal exige 50%; a de perigo, POLICY.roll.dangerChance (10%) de
  // upgrade do plano (aqui ~12%) e ganho que pague o ouro (+0,6 com 14g, acima de 14/30).
  assert.equal(danger.action, "ROLAR");
  assert.equal(danger.panels.rolling.call.kind, "danger");
  assert.ok(
    danger.panels.rolling.call.any < 0.5,
    `${danger.panels.rolling.call.any}`,
  );
  assert.ok(danger.panels.rolling.go);
  assert.equal(healthy.action, "ECONOMIZAR");
  assert.equal(healthy.panels.rolling.call.kind, "hold");
});

test("loja lida: peça do time na loja entra como suas cópias e aparece na lista com o que comprar", () => {
  const base = { gold: 75, hp: 80, level: 8, stage: "4-2", rivals };
  const plain = run(base).r.panels.rolling,
    s = makeState({
      ...base,
      shop: [
        { ...card("Rakan", 3), slot: 2 },
        { ...card("Xayah", 4), slot: 3 },
      ],
    });
  const shopping = strategy(s.plan, s.analysis, s.options).panels.rolling,
    rakan = shopping.targets.find((t) => t.name === "Rakan"),
    before = plain.targets.find((t) => t.name === "Rakan");
  assert.deepEqual(rakan.shop, {
    slots: [2],
    buy: 1,
    gold: 3,
    action: "comprar",
    closes: null,
  });
  assert.equal(rakan.own, before.own + 1, "a cópia da loja já conta");
  assert.equal(rakan.need, before.need - 1);
  assert.deepEqual(
    shopping.shop.map((x) => [x.name, x.buy, x.gold]),
    [["Rakan", 1, 3]],
  );
  // Xayah não é peça sua nem está em buyNow: fica na loja do plano, mas não vira linha de upgrade.
  assert.ok(!shopping.targets.some((t) => t.name === "Xayah"));
});

test("juros: rolar que derruba o patamar vira nota; sem queda, nenhuma nota", () => {
  const keep = run({
      gold: 75,
      hp: 80,
      level: 8,
      stage: "4-2",
      extra: { Aphelios: 1 },
      rivals,
    }).r,
    drop = run({ gold: 53, hp: 25, level: 8, stage: "4-2" }).r;
  assert.equal(keep.panels.rolling.interest, null, "piso de 50g preservado");
  assert.equal(drop.action, "ROLAR");
  assert.deepEqual(drop.panels.rolling.interest, {
    from: 5,
    to: drop.panels.economy.afterInterest,
  });
  assert.ok(drop.panels.rolling.interest.to < 5);
});

test("sem ouro lido: a lista continua com chance por loja e o veredito pede o ouro", () => {
  const s = makeState({ gold: 75, hp: 80, level: 8, stage: "4-2", rivals });
  s.options.gold = null;
  const r = strategy(s.plan, s.analysis, s.options),
    ro = r.panels.rolling;
  assert.equal(ro.call.kind, "unknown");
  assert.equal(ro.go, false);
  assert.ok(ro.targets.length >= 7);
  assert.ok(ro.targets.every((t) => t.chance == null && t.chancePerShop >= 0));
  assert.ok(ro.curve, "a curva não depende do ouro");
});

test("perigo: subir de nível junto da rolagem e venda do banco aparecem nos quadros", () => {
  const up = run({ hp: 25, gold: 60, level: 6, xp: "10/36", stage: "4-1" }).r;
  assert.equal(up.action, "ROLAR");
  assert.ok(up.levelUp > 0);
  assert.equal(up.panels.leveling.go, true);
  const sale = run({
    hp: 12,
    gold: 12,
    reserve: [
      ["Zed", 2, 2],
      ["Jinx", 1, 1],
      ["Kog", 2, 2],
    ],
  }).r;
  assert.ok(sale.panels.economy.sold > 0);
  assert.equal(
    sale.panels.rolling.spend - sale.panels.economy.sold,
    sale.panels.economy.gold - sale.panels.economy.after,
  );
});

test("nível só estimado pelo tabuleiro não vira leitura: sem rolagem, odds nem XP, o veredito pede o nível", () => {
  const read = run({ gold: 75, hp: 25, level: 8, stage: "4-2", rivals });
  assert.equal(read.r.action, "ROLAR", "com o nível lido a análise rola");
  const s = makeState({ gold: 75, hp: 25, level: 8, stage: "4-2", rivals });
  s.options.levelEstimated = true;
  const r = strategy(s.plan, s.analysis, s.options);
  assert.notEqual(r.action, "ROLAR");
  assert.equal(r.panels.rolling.call.kind, "unknown");
  assert.match(r.panels.rolling.call.reason, /Nível não lido/);
  assert.ok(r.reasons.some((t) => /Nível não lido/.test(t)));
});
