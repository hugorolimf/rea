// M4: pool e loja em core/pool. Uma regra de cópias por estrela, uma pool livre fracionária e UMA chance por slot de
// loja, lida igual pelo motor (pool[].chancePerShop), pela rolagem (roll/economy) e pelas cartas (stage).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  freeByCost,
  freeCopies,
  freeOf,
  starCopies,
  starsForCopies,
  upperCopies,
} from "../core/pool/copies.mjs";
import {
  chanceAtLeast,
  isBuyable,
  levelOdds,
  oddsAt,
  shopChance,
  slotChance,
  unlockLevel,
} from "../core/pool/shop.mjs";
import { closeCurve } from "../core/pool/curve.mjs";
import { BUYABLE_ODDS, ODDS, POOL, SHOP } from "../core/pool/tables.mjs";
import * as economy from "../economy.mjs";
import * as rules from "../rules.mjs";
import { teamOf } from "../roll.mjs";
import { makeState } from "./fixtures.mjs";

test("cópias por estrela: 1★ = 1, 2★ = 3, 3★ = 9, e a inversa", () => {
  assert.deepEqual([1, 2, 3, 4].map(starCopies), [1, 3, 9, 27]);
  // Entradas sem estrela legível contam como 1★ (era o `?? 1` de pool-tracker/contest e o `|| 1` do livro-razão).
  assert.deepEqual(
    [undefined, null, 0, 0.5, NaN, "2", 2.9].map(starCopies),
    [1, 1, 1, 1, 1, 3, 3],
  );
  assert.deepEqual(
    [0, 1, 2, 3, 8, 9, 10, 27].map(starsForCopies),
    [0, 1, 1, 2, 2, 3, 3, 3],
  );
  for (const stars of [1, 2, 3])
    assert.equal(starsForCopies(starCopies(stars)), stars);
});

test("pool livre fracionária: o teto observado menos o banco estimado, sem arredondar", () => {
  assert.equal(upperCopies(4, 3), POOL[4] - 3);
  assert.equal(upperCopies(4, 99), 0);
  assert.equal(freeCopies(4, 3, 1.5), POOL[4] - 3 - 1.5);
  assert.equal(freeCopies(4, 3, 99), 0);
  // `free` exato vence o valor exibido (arredondado a 0,1); sem ele, o exibido; sem os dois, o teto.
  assert.equal(
    freeOf({ free: 5.35, remainingLikely: 5.4, remainingUpper: 8 }),
    5.35,
  );
  assert.equal(freeOf({ remainingLikely: 5.4, remainingUpper: 8 }), 5.4);
  assert.equal(freeOf({ remainingUpper: 8 }), 8);
  assert.equal(freeOf({ free: -1 }), 0);
  assert.equal(freeOf(undefined), 0);
  const pool = [
    { cost: 2, free: 10.5 },
    { cost: 2, remainingLikely: 4.25 },
    { cost: 4, remainingUpper: 7 },
  ];
  assert.deepEqual(freeByCost(pool), { 1: 0, 2: 14.75, 3: 0, 4: 7, 5: 0 });
});

test("loja: odds por nível, comprável no nível e desbloqueio de custo", () => {
  assert.equal(levelOdds(0), ODDS[1], "abaixo do nível 1 usa o 1");
  assert.equal(levelOdds(12), ODDS[11], "acima do 11 usa o 11");
  assert.equal(oddsAt(8, 4), 30);
  assert.equal(oddsAt(8, 6), 0, "custo sem coluna não aparece");
  assert.equal(BUYABLE_ODDS, 10);
  assert.equal(isBuyable(6, 4), false, "5% por slot");
  assert.equal(isBuyable(7, 4), true, "10% por slot");
  // O laço que stage.mjs tinha antes (ODDS[level][cost-1] >= 10, do nível 1 ao 11).
  for (const cost of [1, 2, 3, 4, 5]) {
    let want = 11;
    for (let level = 1; level <= 11; level++)
      if (ODDS[level][cost - 1] >= 10) {
        want = level;
        break;
      }
    assert.equal(unlockLevel(cost), want, `custo ${cost}`);
  }
});

test("chance por slot: odds × livres ÷ livres do custo, fracionária e sem arredondar", () => {
  assert.equal(slotChance(8, 4, 5.5, 60.25), (30 / 100) * (5.5 / 60.25));
  assert.equal(slotChance(8, 4, 0, 60), 0);
  assert.equal(slotChance(8, 4, 3, 0), 0);
  assert.equal(slotChance(6, 5, 3, 30), 0, "custo 5 no nível 6 não aparece");
  // A fórmula do motor (odds/100 × livres) ÷ denom, com o mesmo resultado (a ordem das contas muda o último bit).
  for (const [level, cost, free, denom] of [
    [5, 3, 7.5, 88.25],
    [9, 4, 2.5, 41],
    [10, 5, 6, 30.75],
  ])
    assert.ok(
      Math.abs(
        slotChance(level, cost, free, denom) -
          ((ODDS[level][cost - 1] / 100) * free) / denom,
      ) < 1e-15,
    );
  // Por loja: 1 - (1 - p)^5, e em n lojas: ^(5n).
  const p = slotChance(8, 4, 5.5, 60.25);
  assert.equal(shopChance(p), 1 - (1 - p) ** SHOP.slots);
  assert.equal(shopChance(p, 3), 1 - (1 - p) ** (SHOP.slots * 3));
  assert.equal(shopChance(0, 4), 0);
});

test("cauda da binomial: ao menos k cópias em n vagas", () => {
  assert.equal(chanceAtLeast(10, 0.2, 0), 1);
  assert.equal(chanceAtLeast(10, 0, 1), 0);
  const p = 0.12,
    n = 15;
  assert.ok(Math.abs(chanceAtLeast(n, p, 1) - (1 - (1 - p) ** n)) < 1e-12);
  assert.ok(chanceAtLeast(n, p, 2) < chanceAtLeast(n, p, 1));
});

test("curva exata com pool fracionária: uma cópia faltando é 1-(1-p)^(5n)", () => {
  const args = {
      level: 8,
      cost: 4,
      own: 2,
      goal: 3,
      free: 7.5,
      denom: 80.25,
      maxGold: 60,
    },
    p = slotChance(8, 4, 7.5, 80.25),
    curve = closeCurve(args);
  for (const g of [0, 4, 6, 10, 20, 41]) {
    const shops = Math.max(0, Math.floor((g - args.cost) / SHOP.cost));
    assert.ok(
      Math.abs(curve[g] - (1 - (1 - p) ** (SHOP.slots * shops))) < 1e-12,
      `g=${g}`,
    );
  }
  // A versão da economia só acrescenta o teto de ouro da política: mesmos números.
  const viaEconomy = economy.closeCurve({ ...args, maxGold: undefined });
  assert.equal(viaEconomy.length, economy.POLICY.simulation.maxGold + 1);
  for (let g = 0; g <= 60; g++) assert.equal(viaEconomy[g], curve[g]);
});

test("quem reexporta não reimplementa: economy e rules apontam para core/pool", () => {
  assert.equal(economy.slotChance, slotChance);
  assert.equal(economy.freeByCost, freeByCost);
  assert.equal(economy.freeOf, freeOf);
  assert.equal(rules.POOL, POOL);
  assert.equal(rules.ODDS, ODDS);
  assert.equal(rules.GAME.shopSlots, SHOP.slots);
  assert.equal(rules.GAME.shopCost, SHOP.cost);
  assert.equal(economy.sellValue(4, 2), starCopies(2) * 4 - 1);
  assert.equal(economy.sellValue(1, 3), starCopies(3));
});

test("D3: a rolagem lê a mesma pool livre fracionária do motor e dá a mesma chance por slot e por loja", () => {
  const s = makeState({
    level: 8,
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  // Bancos rivais estimados com fração (o rastreador entrega meio em meio): 0,5 em todo campeão do tabuleiro.
  for (const p of s.analysis.pool) {
    const hidden = p.cost === 4 || p.cost === 3 ? 0.5 : 0.25;
    p.hidden = hidden;
    p.remainingLikely = Math.max(0, p.remainingUpper - hidden);
  }
  const denom = freeByCost(s.analysis.pool),
    team = teamOf(s.plan, s.analysis, s.options);
  assert.ok(team.pieces.length > 0);
  let fractional = 0;
  for (const piece of team.pieces) {
    const entry = s.analysis.pool.find((p) => p.name === piece.name),
      free = freeOf(entry);
    if (free % 1 !== 0) fractional++;
    // Sem compra na loja lida, o `free` da rolagem é o da pool, sem arredondar.
    assert.equal(piece.free, free, piece.name);
    assert.equal(
      piece.chancePerSlot,
      slotChance(8, piece.cost, free, denom[piece.cost]),
    );
    assert.equal(piece.chancePerShop, shopChance(piece.chancePerSlot));
    // E bate com a conta que o motor faz para pool[].chancePerSlot (mesmas odds, mesmo denominador).
    assert.ok(
      Math.abs(
        piece.chancePerSlot -
          ((ODDS[8][piece.cost - 1] / 100) * free) / denom[piece.cost],
      ) < 1e-15,
      piece.name,
    );
  }
  assert.ok(fractional > 0, "o cenário precisa exercitar frações");
  // Nível seguinte pelo mesmo caminho.
  for (const piece of team.pieces)
    assert.equal(
      piece.chancePerSlotNext,
      slotChance(9, piece.cost, piece.free, denom[piece.cost]),
    );
});

test("núcleo da pool é ESM puro: só importa de core/pool", () => {
  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../core/pool",
  );
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(/from\s+"([^"]+)"/g))
      assert.match(m[1], /^\.\/[\w-]+\.mjs$/, `${file} importa ${m[1]}`);
    assert.doesNotMatch(src, /node:|Date\.now|Math\.random|process\./, file);
  }
});
