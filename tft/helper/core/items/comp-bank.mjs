/**
 * Aba Comps, cenário "Seus itens no carry" do motor único de itens (ver `scenarios.mjs`): itens do banco do jogador que
 * combinam com o carry (e com as outras peças) de uma comp de meta, sobre a build publicada (`builds.mjs:compBuild`).
 * Mora no núcleo para valer igual no servidor e no navegador; `v2/js/comp-items.js` só reexporta.
 * Puro: recebe a comp, o banco lido da tela e o catálogo; não decide a comp nem altera o motor.
 *
 * Cada item do banco cai em exatamente um destino (`spent` das linhas e dos emblemas, `unused` ou `excluded`):
 *  - consumível (Removedor, Duplicadores, Reforjador, Poções, Boosters, Melhoria do Mestre-Artesão, Baú da Sorte):
 *    `excluded`. Não é para montar nem equipar; fica fora da lista de sinergia (o catálogo diz quem é, `consumable`);
 *  - item da build publicada de um campeão da comp (o carry primeiro): `ready` (o próprio item), `radiant` (o radiante
 *    do item da build), `craft` (os dois componentes do banco montam o item), `half` (um componente; diz o que falta) ou
 *    `missing` (nada no banco; mostra a receita, vazia para artefato, que não se monta);
 *  - emblema que dá ao carry uma sinergia da comp que ele não tem e que, com ele, chega a um patamar (`emblems`): `ready` (o emblema), `craft`
 *    (Espátula/Frigideira + componente) ou `half` (só Espátula/Frigideira, que é a peça escassa dos emblemas);
 *  - o resto (componente sem receita útil, completo de outra build, artefato ou radiante sem uso, emblema que o carry
 *    não aproveita, item fora do catálogo): `unused`, com o motivo.
 * O item equipado no campeão (`equipped`) conta como `on` e não gasta o banco.
 */
import { countUnitTraits, firstBreakpoint } from "../catalog/traits.mjs";
import { recipeOf } from "../catalog/items.mjs";
import { spendBankHalves, spendBankOnBuilds } from "./bank.mjs";
import { compBuild } from "./builds.mjs";
import { takeAll, takeOne } from "./stock.mjs";

const REASONS = {
  component: "componente sem receita útil para esta comp",
  completed: "item fora da build desta comp",
  radiant: "radiante de um item fora da build desta comp",
  artifact: "artefato fora da build desta comp",
  emblem: "emblema cuja sinergia o carry não aproveita nesta comp",
  other: "item sem uso nesta comp",
  unknown: "item fora do catálogo",
};

/** Peças que entram em várias receitas de emblema (Espátula e Frigideira), derivadas do catálogo. */
export function emblemBases(items) {
  const count = new Map();
  for (const i of items.values())
    if (i.kind === "emblem" && recipeOf(i))
      for (const p of i.composition) count.set(p, (count.get(p) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n >= 5).map(([p]) => p));
}

/**
 * Sinergias que o emblema dá ao carry com proveito: as que ele não tem e que, com ele, chegam ao primeiro patamar
 * (`breakpoints`: Map sinergia → patamares; sem o patamar conhecido, 2) contando os campeões da comp que já a têm.
 */
function traitsToGain(comp, carryTraits, champions, breakpoints) {
  const counts = countUnitTraits(comp.units, (id) => champions.get(id)?.traits);
  return new Set(
    [...counts]
      .filter(
        ([t, n]) =>
          !carryTraits.has(t) && n + 1 >= firstBreakpoint(breakpoints.get(t)),
      )
      .map(([t]) => t),
  );
}

/**
 * @param comp `{units, carry, builds}` (como /api/comps).
 * @param ctx `bank`: ids do banco (null = banco não lido); `equipped`: {idDoCampeão: [ids]}; `items`: Map id → item do
 *   catálogo (`kind`, `consumable`, `composition`, `trait`); `champions`: Map id → {traits}; `breakpoints`: Map sinergia → patamares.
 */
export function compItems(
  comp,
  { bank = [], equipped = {}, items, champions, breakpoints = new Map() },
) {
  const read = Array.isArray(bank),
    stock = [],
    excluded = [];
  for (const id of read ? bank : [])
    (items.get(id)?.consumable ? excluded : stock).push(id);
  const take = (match) => takeOne(stock, match);
  const units = [comp.carry, ...comp.units.filter((u) => u !== comp.carry)]
    .filter((u, i, all) => compBuild(comp, u) && all.indexOf(u) === i)
    .map((unit) => ({
      unit,
      isCarry: unit === comp.carry,
      // A build publicada da comp, lida pelo motor único de itens (builds.mjs), a mesma de "Builds e 3★".
      rows: compBuild(comp, unit).items.map((want) => ({
        want,
        state: "missing",
        spent: [],
        have: [],
        missing: [],
        recipe: items.get(want)?.composition ?? [],
      })),
      owned: [...(equipped[unit] ?? [])],
    }));
  // Passo 1: equipado, o próprio item, o radiante e a montagem completa (carry antes, cada item do banco uma vez só).
  // A regra de gastar o banco entre as builds é uma só: bank.mjs.
  spendBankOnBuilds(units, stock);
  // Emblemas que dão ao carry uma sinergia ativa da comp que ele ainda não tem.
  const carryTraits = new Set(champions.get(comp.carry)?.traits ?? []),
    wanted = traitsToGain(comp, carryTraits, champions, breakpoints),
    bases = emblemBases(items),
    emblems = [];
  for (const [id, item] of items)
    if (item.kind === "emblem" && wanted.has(item.trait)) {
      const bankId = take((x) => x === id);
      if (bankId)
        emblems.push({
          id,
          trait: item.trait,
          state: "ready",
          spent: [id],
          have: [],
          missing: [],
          recipe: item.composition ?? [],
        });
    }
  const inBuild = new Set(units.flatMap((u) => u.rows.map((r) => r.want)));
  for (const [id, item] of items)
    if (
      item.kind === "emblem" &&
      wanted.has(item.trait) &&
      recipeOf(item) &&
      !inBuild.has(id) &&
      !emblems.some((e) => e.trait === item.trait)
    ) {
      const parts = takeAll(stock, item.composition);
      if (parts) {
        emblems.push({
          id,
          trait: item.trait,
          state: "craft",
          spent: parts,
          have: parts,
          missing: [],
          recipe: item.composition,
        });
      }
    }
  // Passo 2: metade de uma receita (um componente no banco; diz o que falta). Emblema só com Espátula/Frigideira.
  spendBankHalves(units, stock);
  // A Espátula/Frigideira serve a qualquer emblema útil: cada um vira uma alternativa (`alt`) e só a primeira gasta a peça.
  const spentBase = new Set();
  for (const [id, item] of items)
    if (
      item.kind === "emblem" &&
      wanted.has(item.trait) &&
      recipeOf(item) &&
      !inBuild.has(id) &&
      !emblems.some((e) => e.trait === item.trait)
    ) {
      const part = item.composition.find(
        (p) => bases.has(p) && (stock.includes(p) || spentBase.has(p)),
      );
      if (!part) continue;
      const first = !spentBase.has(part);
      if (first) {
        take((x) => x === part);
        spentBase.add(part);
      }
      emblems.push({
        id,
        trait: item.trait,
        state: "half",
        alt: !first,
        spent: first ? [part] : [],
        have: [part],
        missing: item.composition.filter((p) => p !== part),
        recipe: item.composition,
      });
    }
  const unused = stock.map((id) => {
    const kind = items.get(id)?.kind;
    return {
      id,
      kind: kind ?? null,
      reason: REASONS[kind ? (REASONS[kind] ? kind : "other") : "unknown"],
    };
  });
  return { read, units, emblems, unused, excluded };
}

/** Linhas em que o banco ou o campeão tem algo (para listar peças que não são o carry sem ruído). */
export const touched = (u) => u.rows.some((r) => r.state !== "missing");

/** Quantos itens do banco entram na comp (linhas e emblemas que gastam algo do banco). */
export const spentCount = (r) =>
  r.units.flatMap((u) => u.rows).reduce((n, row) => n + row.spent.length, 0) +
  r.emblems.reduce((n, e) => n + e.spent.length, 0);

/** Itens equipados por campeão no seu tabuleiro (`self.units` do servidor: {championName, itemNames}); cópias do mesmo campeão somam. */
export function equippedBy(units = []) {
  const out = {};
  for (const u of units ?? [])
    if (u?.championName && Array.isArray(u.itemNames) && u.itemNames.length)
      out[u.championName] = [...(out[u.championName] ?? []), ...u.itemNames];
  return out;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Leitura do plano de itens do motor (`compRanking[].itemPlan`, item-plan.mjs) para a tela. Puro; não decide nada.
 * Devolve `null` sem plano; senão `{ read, total, groups, wishlist }`:
 *  - `read`: o banco foi lido. Sem leitura NUNCA há atribuição (mesmo que o plano traga alguma, é ignorada): só `wishlist`;
 *  - `groups`: um por campeão, do de maior impacto ao menor (ordem de `champions` do motor), com `items` (as atribuições dele,
 *    maior valor primeiro), `total` (soma do campeão) e `acc` (total acumulado até este campeão, inclusive);
 *  - `total`: soma do plano (`plan.total`; sem ele, a soma das atribuições);
 *  - `wishlist`: por campeão, os itens do meta que o jogador ainda não tem (separada das atribuições).
 */
export function planView(plan) {
  if (!plan || typeof plan !== "object") return null;
  const read = plan.bankRead !== false,
    list = read && Array.isArray(plan.assignments) ? plan.assignments : [],
    byChampion = new Map();
  for (const a of list) {
    const id = a?.champion?.id;
    if (id == null || !a.item?.id) continue;
    if (!byChampion.has(id))
      byChampion.set(id, { champion: a.champion, items: [] });
    byChampion.get(id).items.push(a);
  }
  const order = [
    ...(Array.isArray(plan.champions) ? plan.champions : []).map(
      (c) => c?.champion?.id,
    ),
    ...byChampion.keys(),
  ].filter((id, i, all) => byChampion.has(id) && all.indexOf(id) === i);
  let acc = 0;
  const groups = order.map((id) => {
    const g = byChampion.get(id),
      items = [...g.items].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
      total = round3(items.reduce((n, a) => n + (a.value ?? 0), 0));
    acc = round3(acc + total);
    return { champion: g.champion, items, total, acc };
  });
  return {
    read,
    total: read
      ? Number.isFinite(plan.total)
        ? plan.total
        : (groups.at(-1)?.acc ?? 0)
      : 0,
    groups,
    wishlist: Array.isArray(plan.wishlist)
      ? plan.wishlist.filter((w) => w?.champion?.id && w.items?.length)
      : [],
  };
}
