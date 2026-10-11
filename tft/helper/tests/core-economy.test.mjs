// M5b: ouro e vida em core/economy. Uma política (POLICY), uma renda (incomeOf), uma pressão (pressureOf) e as lojas ao
// alcance do motor (shopsAhead). O passo NÃO muda regra de jogo: estes testes provam que os consumidores leem a política
// (perturbar um valor muda o resultado) e que a conta nova é a de antes. A prova de integração é o golden.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as economy from "../economy.mjs";
import * as gold from "../core/economy/gold.mjs";
import * as rounds from "../core/economy/rounds.mjs";
import { pressureOf } from "../core/economy/pressure.mjs";
import { POLICY } from "../core/economy/policy.mjs";
import { HP, INCOME, ROUND } from "../core/economy/tables.mjs";
import { SHOP } from "../core/pool/tables.mjs";
import { GAME } from "../rules.mjs";
import { streakTracker } from "../streak.mjs";
import { suggestTargetLevel } from "../target-level.mjs";

/** Perturba um valor da política só durante `fn` (o objeto é compartilhado: o resto do produto enxerga a mudança). */
function perturb(object, key, value, fn) {
  const was = object[key];
  object[key] = value;
  try {
    return fn();
  } finally {
    object[key] = was;
  }
}

test("quem reexporta não reimplementa: economy.mjs e rules.mjs apontam para core/economy", () => {
  for (const name of [
    "incomeOf",
    "interestOf",
    "interestTiers",
    "maxInterestGold",
    "nextTier",
    "projectGold",
    "shopsAhead",
    "streakGold",
    "tierFloor",
  ])
    assert.equal(economy[name], gold[name], name);
  for (const name of ["isPvp", "nextRound", "roundLabel"])
    assert.equal(economy[name], rounds[name], name);
  assert.equal(economy.pressureOf, pressureOf);
  // O MESMO objeto: o golden e os testes perturbam POLICY por economy.mjs e o núcleo enxerga.
  assert.equal(economy.POLICY, POLICY);
  // GAME não guarda mais a renda nem os juros; o calendário PVE vem da tabela do núcleo.
  for (const key of ["interestStep", "interestMax", "baseIncome", "streakGold"])
    assert.equal(key in GAME, false, key);
  assert.equal(GAME.pveRound, ROUND.pve);
  assert.equal(GAME.shopCost, SHOP.cost);
});

test("juros, renda e patamares: 1 g a cada 10 g guardados, no máximo 5", () => {
  assert.equal(gold.maxInterestGold(), 50);
  assert.equal(gold.interestTiers(), 5);
  assert.deepEqual(
    [0, 9, 10, 49, 50, 120].map(gold.interestOf),
    [0, 0, 1, 4, 5, 5],
  );
  assert.deepEqual([0, 9, 10, 49, 50].map(gold.nextTier), [
    10,
    10,
    20,
    50,
    null,
  ]);
  assert.deepEqual([9, 31, 77].map(gold.tierFloor), [0, 30, 50]);
  assert.equal(gold.interestOf(null), null);
  assert.deepEqual(gold.incomeOf(34, { kind: "loss", length: 5 }), {
    base: 5,
    interest: 3,
    streak: 2,
    total: 10,
  });
});

test("a tabela de renda é lida a cada chamada: perturbar o teto de juros muda juros, patamar e medidor", () => {
  perturb(INCOME, "interestMax", 3, () => {
    assert.equal(gold.interestOf(100), 3);
    assert.equal(gold.maxInterestGold(), 30);
    assert.equal(gold.interestTiers(), 3);
    assert.equal(gold.nextTier(30), null);
    assert.equal(gold.tierFloor(77), 30);
  });
  assert.equal(gold.interestOf(100), 5);
});

test("shopsAhead é a conta que o motor fazia dentro de analyze (renda sem sequência, 30 g quando o ouro não foi lido)", () => {
  const legacy = (goldNow) => {
    const income = 5 + Math.min(5, Math.floor(goldNow / 10));
    return 3 + Math.floor(Math.max(0, goldNow + 4 * income - 10) / 2);
  };
  for (let g = 0; g <= 150; g++)
    assert.equal(gold.shopsAhead(g), legacy(g), `${g}g`);
  assert.equal(gold.shopsAhead(null), legacy(30));
  assert.equal(gold.shopsAhead(undefined), legacy(30));
  // E vem da política: mudar a suposição para ouro não lido muda só o caso não lido.
  perturb(POLICY.shopsAhead, "assumedGold", 50, () => {
    assert.equal(gold.shopsAhead(null), legacy(50));
    assert.equal(gold.shopsAhead(30), legacy(30));
  });
});

test("calendário de rodadas da economia: rodada seguinte e rodada contra jogador", () => {
  assert.deepEqual(rounds.nextRound({ stage: 1, round: 4 }), {
    stage: 2,
    round: 1,
  });
  assert.deepEqual(rounds.nextRound({ stage: 3, round: 7 }), {
    stage: 4,
    round: 1,
  });
  assert.equal(rounds.roundLabel({ stage: 4, round: 3 }), "4-3");
  assert.equal(rounds.isPvp({ stage: 1, round: 2 }), false);
  assert.equal(rounds.isPvp({ stage: 2, round: 4 }), false); // carrossel
  assert.equal(rounds.isPvp({ stage: 2, round: ROUND.pve }), false); // monstros
  assert.equal(rounds.isPvp({ stage: 2, round: 5 }), true);
});

test("pressão: faixas, piso e tendência da vida saem da política", () => {
  // Cópias dos valores de fábrica: `perturb` altera o próprio POLICY, então ler POLICY dentro do callback daria o valor já mudado.
  const H = { ...POLICY.hp },
    T = { ...POLICY.trend };
  assert.ok(H.critical < H.danger && H.danger < H.hurt);
  assert.equal(pressureOf({ hp: H.critical }).band, "critical");
  assert.equal(pressureOf({ hp: H.danger }).band, "danger");
  assert.equal(pressureOf({ hp: H.hurt }).band, "hurt");
  assert.equal(pressureOf({ hp: H.hurt }).floor, POLICY.floor.hurt);
  assert.equal(pressureOf({ hp: H.hurt + 1 }).band, "healthy");
  assert.equal(pressureOf({ hp: H.hurt + 1 }).floor, POLICY.floor.healthy);
  // Tendência: no ritmo da queda média, chegar a `floorHp` de vida em `rounds` rodadas é perigo (e nem um pouco menos).
  const hp = T.floorHp + T.rounds * 10;
  assert.ok(hp > H.danger, "sem a tendência o HP não seria perigo");
  assert.equal(pressureOf({ hp, trend: { avgLoss: 10 } }).danger, true);
  assert.equal(pressureOf({ hp, trend: { avgLoss: 9 } }).danger, false);
  // `losses` perdas recentes com vida até `lossesHp` também; com um ponto a mais de vida, não.
  const recent = { avgLoss: 0, recentLosses: T.losses };
  assert.ok(T.lossesHp + 1 > H.danger, "sem as perdas o HP não seria perigo");
  assert.equal(pressureOf({ hp: T.lossesHp, trend: recent }).danger, true);
  assert.equal(pressureOf({ hp: T.lossesHp + 1, trend: recent }).danger, false);
  // Os limiares não são literais da função: perturbá-los muda a faixa.
  perturb(POLICY.hp, "danger", H.danger + 10, () =>
    assert.equal(pressureOf({ hp: H.danger + 5 }).band, "danger"),
  );
  assert.equal(pressureOf({ hp: H.danger + 5 }).band, "hurt");
  perturb(POLICY.trend, "lossesHp", T.lossesHp + 10, () =>
    assert.equal(
      pressureOf({ hp: T.lossesHp + 5, trend: recent }).danger,
      true,
    ),
  );
});

test("D4: um só piso de reroll rápido na política, abaixo do piso saudável", () => {
  assert.ok(POLICY.floor.fastReroll < POLICY.floor.healthy);
  assert.ok(POLICY.hp.fastReroll > POLICY.hp.danger);
});

test("streak.trend usa a janela e a quantidade de quedas da política; vida acima do máximo não é leitura", () => {
  const feedHp = (rows) => {
    const t = streakTracker();
    for (const [hp, now] of rows) t.observe({ gameId: 1, hp, now });
    return t;
  };
  const t = feedHp([
    [100, 0],
    [90, 1000], // -10
    [70, 2000], // -20
    [60, 3000], // -10
    [45, 4000], // -15
  ]);
  const losses = [10, 20, 10, 15],
    avg = (n) => losses.slice(-n).reduce((a, b) => a + b, 0) / n;
  // Média das últimas `POLICY.trend.drops` quedas.
  assert.equal(t.trend(4000).avgLoss, avg(POLICY.trend.drops));
  assert.equal(t.trend(4000).recentLosses, 4);
  perturb(POLICY.trend, "drops", 1, () =>
    assert.equal(t.trend(4000).avgLoss, avg(1)),
  );
  perturb(POLICY.trend, "drops", 2, () =>
    assert.equal(t.trend(4000).avgLoss, avg(2)),
  );
  // A janela de perdas recentes é `POLICY.trend.windowMs` e termina na última queda: enquanto a vida não muda, a
  // contagem não cai a cada leitura (antes caía de 4 para 1 só com o relógio e a faixa oscilava com a vida parada); uma
  // janela inteira sem queda (rodadas ganhas) zera.
  assert.equal(t.trend(4000 + POLICY.trend.windowMs).recentLosses, 4);
  assert.equal(t.trend(4000 + POLICY.trend.windowMs + 1).recentLosses, 0);
  assert.equal(t.trend(4000).samples, POLICY.trend.drops);
  // Acima do máximo do jogo é leitura inválida: não entra no registro de quedas.
  const u = feedHp([
    [80, 0],
    [HP.max + 1, 1000],
    [70, 2000],
  ]);
  assert.equal(u.trend(2000).recentLosses, 1);
  assert.equal(u.trend(2000).avgLoss, 10);
});

test("nível-alvo: os limiares de vida e de ouro vêm da política e do teto de juros", () => {
  // Cópia dos valores de fábrica (ver o teste de pressão): `perturb` muda o próprio POLICY.hp.
  const H = { ...POLICY.hp },
    cap = () => gold.maxInterestGold();
  assert.ok(H.low < H.hurt && H.hurt <= H.comfortable);
  const player = (id, health) => ({ playerId: id, health, boardPieces: [] });
  const snap = (hp) => ({
    statsBlock: {
      players: [
        player("1", hp),
        player("2", 80),
        player("3", 80),
        player("4", 80),
        player("5", 80),
      ],
    },
  });
  const first = (hp, goldNow) =>
    suggestTargetLevel(snap(hp), "1", 6, goldNow).reasons[0];
  // Vida baixa (HP <= POLICY.hp.low): o plano continua mirando o próximo nível, com ou sem o teto de juros. Antes o alvo
  // caía para o nível atual sem o teto e voltava com ele: a vida baixa (e o ouro passando de 50 g para lá e para cá)
  // trocava o tamanho do tabuleiro e, com ele, a comp inteira (tft-pressao-vida).
  const at = (hp, goldNow) =>
    suggestTargetLevel(snap(hp), "1", 6, goldNow).level;
  assert.match(first(H.low, cap()), /continua mirando o nível 7/);
  assert.equal(at(H.low, cap()), 7);
  assert.equal(at(H.low, cap() - 1), 7);
  assert.equal(at(H.danger, 0), 7);
  assert.match(first(H.low + 1, cap()), /próximo nível como meta/);
  // Saudável com o teto de juros: dois níveis acima, a partir de POLICY.hp.hurt.
  assert.match(first(H.hurt, cap()), /dois níveis acima/);
  assert.match(first(H.hurt - 1, cap()), /próximo nível como meta/);
  perturb(POLICY.hp, "hurt", H.hurt + 10, () =>
    assert.match(first(H.hurt, cap()), /próximo nível como meta/),
  );
  perturb(POLICY.hp, "low", H.low + 5, () =>
    assert.match(first(H.low + 5, cap() - 1), /continua mirando/),
  );
  // O teto de juros ainda decide o "dois níveis acima" com a vida saudável.
  perturb(INCOME, "interestMax", 3, () =>
    assert.match(first(H.hurt, cap()), /dois níveis acima/),
  );
});

test("núcleo da economia é ESM puro: só importa de core/ e não tem E/S nem relógio", () => {
  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../core/economy",
  );
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs"));
  assert.deepEqual(files.sort(), [
    "gold.mjs",
    "policy.mjs",
    "pressure.mjs",
    "rounds.mjs",
    "tables.mjs",
  ]);
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(/from\s+"([^"]+)"/g))
      assert.match(
        m[1],
        /^(?:\.\/[\w-]+\.mjs|\.\.\/(?:pool|state)\/[\w-]+\.mjs)$/,
        `${file} importa ${m[1]}`,
      );
    assert.doesNotMatch(src, /node:|Date\.now|Math\.random|process\./, file);
  }
});
