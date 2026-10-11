/**
 * Sinergias (traços) e emblemas: a regra única do helper (M3 da migração, ver ARQUITETURA.md).
 *
 * Um emblema equipado dá ao campeão a sinergia do nome dele, se ele ainda não a tinha; o mesmo emblema em quem já tem a
 * sinergia (ou dois emblemas iguais) não soma de novo. Patamares (`minUnits`), traço solo ("Only active while fielding
 * 1") e a contagem por tabuleiro também moram aqui: motor, plano, servidor e interface chamam estas funções em vez de
 * reescrever o laço. ESM puro: carrega igual no servidor e no navegador (nada de `node:*`, relógio ou aleatório).
 */

/** Item de emblema do catálogo: id `…Emblem…` e nome "X Emblem" (a sinergia é o X). */
const isEmblem = (id, name) =>
  /Emblem/.test(id ?? "") && / Emblem$/.test(name ?? "");

/**
 * Mapa id do item → nome da sinergia, derivado do catálogo: todo item de emblema cujo "X" é uma sinergia do set.
 * `items` aceita o formato do catálogo ({apiName,name}) e o da API da interface ({id,name}).
 */
export function emblemTraitMap(items, traitNames) {
  const known = new Set(traitNames);
  const map = new Map();
  for (const i of items ?? []) {
    const id = i.apiName ?? i.id;
    if (!isEmblem(id, i.name)) continue;
    const trait = i.name.replace(/ Emblem$/, "");
    if (known.has(trait)) map.set(id, trait);
  }
  return map;
}

/** Itens de emblema do catálogo sem sinergia correspondente (ex.: emblema que copia a sinergia mais ativa). */
export const unmappedEmblems = (items, traitNames) => {
  const map = emblemTraitMap(items, traitNames);
  return (items ?? [])
    .map((i) => ({ id: i.apiName ?? i.id, name: i.name }))
    .filter((i) => /Emblem/.test(i.id ?? "") && !map.has(i.id));
};

/**
 * Emblemas que se montam de dois componentes (Espátula/Frigideira + outro): `[{ id, name, trait, parts }]` na ordem do
 * catálogo, só os de sinergia conhecida do set. `parts` são os dois componentes.
 */
export function emblemRecipes(items, traitNames) {
  const known = new Set(traitNames);
  return (items ?? [])
    .filter(
      (i) =>
        /Emblem/.test(i.apiName ?? "") &&
        i.composition?.length === 2 &&
        known.has(i.name.replace(/ Emblem$/, "")),
    )
    .map((i) => ({
      id: i.apiName,
      name: i.name,
      trait: i.name.replace(/ Emblem$/, ""),
      parts: i.composition,
    }));
}

/**
 * Sinergias de um campeão com os itens equipados: as dele mais as dos emblemas que ele ainda não tem.
 * `added` lista só as vindas de emblema, na ordem em que aparecem.
 */
export function traitsWithEmblems(base, itemIds, emblems) {
  const own = base ?? [],
    added = [];
  for (const id of itemIds ?? []) {
    const t = emblems.get(id);
    if (t && !own.includes(t) && !added.includes(t)) added.push(t);
  }
  return { traits: added.length ? [...own, ...added] : own, added };
}

/**
 * Contagem por sinergia de peças já distintas. `units` é [{ traits, items }]: cada peça conta uma vez por sinergia que
 * tem (as dela mais as de emblema equipado). Devolve `counts` (Map nome → quantidade) e `byEmblem` (Map nome → peças
 * que só contam por causa de um emblema), ambos na ordem em que a sinergia aparece.
 */
export function tallyTraits(units, emblems) {
  const counts = new Map(),
    byEmblem = new Map();
  for (const u of units) {
    const { traits, added } = traitsWithEmblems(u.traits, u.items, emblems);
    for (const t of traits) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      if (added.includes(t)) byEmblem.set(t, (byEmblem.get(t) ?? 0) + 1);
    }
  }
  return { counts, byEmblem };
}

/**
 * Contagem por sinergia de campeões distintos. `units` é [{id, traits, items}]; cópias do mesmo `id` contam uma vez
 * (os itens de todas as cópias valem para ela). Devolve Map nome → quantidade.
 */
export function countTraits(units, emblems) {
  const byId = new Map();
  for (const u of units) {
    const prev = byId.get(u.id);
    if (prev) prev.items = [...prev.items, ...(u.items ?? [])];
    else
      byId.set(u.id, { traits: u.traits ?? [], items: [...(u.items ?? [])] });
  }
  return tallyTraits([...byId.values()], emblems).counts;
}

/**
 * Contagem por sinergia dos campeões DISTINTOS de uma lista de ids, sem itens (uma comp de meta): `traitsOf(id)` dá as
 * sinergias do campeão; uma sinergia repetida no mesmo campeão conta uma vez. Devolve Map nome → quantidade.
 */
export const countUnitTraits = (ids, traitsOf) =>
  tallyTraits(
    [...new Set(ids)].map((id) => ({
      traits: [...new Set(traitsOf(id) ?? [])],
      items: [],
    })),
    new Map(),
  ).counts;

/** Primeiro patamar de uma sinergia (`steps`: seus patamares); sem patamar conhecido, `fallback` campeões. */
export const firstBreakpoint = (steps, fallback = 2) =>
  Math.min(...(steps?.length ? steps : [fallback]));

/** Patamares (`minUnits`) de uma sinergia do catálogo, na ordem do catálogo; `max` descarta os que passam do tabuleiro. */
export const traitThresholds = (trait, max = Infinity) =>
  (trait?.effects ?? []).map((e) => e.minUnits).filter((n) => n <= max);

/**
 * Situação de uma sinergia com `count` peças: `active` (algum patamar alcançado), `tier` (quantos), `solo` (o primeiro
 * patamar é 1) e `next` (o próximo patamar, ou null).
 */
export function traitStatus(thresholds, count) {
  const reached = thresholds.filter((n) => n <= count);
  return {
    active: reached.length > 0,
    solo: thresholds[0] === 1,
    tier: reached.length,
    next: thresholds.find((n) => n > count) ?? null,
  };
}

/**
 * Sinergias que só valem com uma peça delas em campo (texto do catálogo: "Only active while fielding 1"): duas no mesmo
 * tabuleiro as desligam, a menos que um aprimoramento escolhido as libere (`exempt`, ex.: Aminimigos → Rival).
 */
export const soloTraitNames = (traits, exempt = []) =>
  new Set(
    (traits ?? [])
      .filter((t) => /Only active while fielding 1\b/i.test(t.desc ?? ""))
      .map((t) => t.name)
      .filter((n) => !exempt.includes(n)),
  );

/**
 * Regra do emblema que um aprimoramento dá (M9 da migração). Aprimoramento do set atual (`DA_…`) que dá o emblema de uma
 * sinergia: pelo nome em inglês ("X Crest/Crown/Circlet/Emblem") ou pelo texto ("Recebe um Emblema de X."); sem nome
 * reconhecível, a única sinergia que ele lista. Devolve `(a) => { trait, item } | null`, com `trait` o apiName da sinergia
 * e `item` o id do item de emblema (ou null). Aprimoramentos de sets antigos têm nomes de sinergia que não são os do set
 * atual, por isso só os `DA_` valem. No Set 18 o item de emblema se chama "X Emblem" e vem sem traits; há outro item de
 * mesmo nome com o id do próprio aprimoramento (`…Augment`): o emblema é o outro.
 */
function augmentEmblemRule(catalog, nameByApi, apiByName) {
  return (a) => {
    if (!a.id.startsWith("DA_")) return null;
    const named = /^(.+) (?:Crest|Crown|Circlet|Emblem)$/.exec(
        a.nameEn ?? "",
      )?.[1],
      given = /Recebe um Emblema de (.+?)[.,]/.exec(a.desc ?? "")?.[1],
      trait =
        apiByName.get(named) ??
        apiByName.get(given) ??
        (given && a.traits.length === 1 ? a.traits[0] : null),
      name = nameByApi.get(trait),
      item = name
        ? (catalog.items ?? []).find(
            (i) =>
              i.name === `${name} Emblem` &&
              i.apiName.startsWith("DA_") &&
              !i.apiName.endsWith("Augment"),
          )?.apiName
        : null;
    return trait ? { trait, item: item ?? null } : null;
  };
}

/**
 * Sinergias que os aprimoramentos escolhidos (`chosen`: entradas de augments.json) concedem, na forma que o motor lê das
 * opções: as próprias sinergias do aprimoramento mais a do emblema que ele dá (`traitsOf`, apiNames, sem repetir).
 *  - `traits`: nomes das sinergias de todos os escolhidos (`options.augmentTraits`; libera o traço solo, ex. Rival);
 *  - `traitsById`: apiNames por aprimoramento (`options.augmentTraitsById`; o motor não soma o tier de quem a sinergia já mediu);
 *  - `emblems`: ids dos itens de emblema que o jogador passa a ter (`options.augmentEmblems`);
 *  - `emblemOf`: Map id do aprimoramento -> `{ trait, item }` ou null.
 */
function augmentGrants(chosen, augmentEmblem, nameByApi) {
  const emblemOf = new Map(chosen.map((a) => [a.id, augmentEmblem(a)])),
    traitsOf = (a) => [
      ...new Set([...a.traits, emblemOf.get(a.id)?.trait].filter(Boolean)),
    ];
  return {
    emblemOf,
    traitsOf,
    traits: [
      ...new Set(
        chosen.flatMap((a) =>
          traitsOf(a)
            .map((t) => nameByApi.get(t))
            .filter(Boolean),
        ),
      ),
    ],
    traitsById: Object.fromEntries(chosen.map((a) => [a.id, traitsOf(a)])),
    emblems: chosen.map((a) => emblemOf.get(a.id)?.item).filter(Boolean),
  };
}

/**
 * Livro de sinergias de um catálogo: tudo que o motor, o plano e o servidor precisam saber de traços e emblemas, num
 * objeto só. `maxUnits` limita os patamares considerados (o motor ignora patamares acima do tabuleiro); `exempt` lista
 * as sinergias solo liberadas por aprimoramento.
 */
export function traitBook(catalog, { maxUnits = Infinity, exempt = [] } = {}) {
  const traits = catalog.traits ?? [],
    byName = new Map(traits.map((t) => [t.name, t])),
    emblems = emblemTraitMap(catalog.items, byName.keys()),
    recipes = emblemRecipes(catalog.items, byName.keys()),
    solo = soloTraitNames(traits, exempt),
    cache = new Map();
  const thresholds = (name) => {
    let t = cache.get(name);
    if (!t) {
      t = traitThresholds(byName.get(name), maxUnits);
      cache.set(name, t);
    }
    return t;
  };
  /** Sinergias de uma peça com os itens dela (`traits` já inclui os emblemas; `added` lista só os vindos deles). */
  const of = (base, items) => traitsWithEmblems(base, items, emblems);
  // apiName <-> nome pt-BR da sinergia (apiName é único no catálogo; o primeiro vence, como o `find` de antes).
  const nameByApi = new Map(),
    apiByName = new Map();
  for (const t of traits) {
    if (!nameByApi.has(t.apiName)) nameByApi.set(t.apiName, t.name);
    if (!apiByName.has(t.name)) apiByName.set(t.name, t.apiName);
  }
  const augmentEmblem = augmentEmblemRule(catalog, nameByApi, apiByName),
    grants = (chosen) => augmentGrants(chosen, augmentEmblem, nameByApi);
  return {
    byName,
    emblems,
    recipes,
    solo,
    thresholds,
    of,
    /** Nome da sinergia a partir do apiName do catálogo (`undefined` se desconhecido). */
    nameOf: (api) => nameByApi.get(api),
    /** O que um aprimoramento dá em emblema: `{ trait (apiName), item (id do emblema ou null) }` ou null. */
    augmentEmblem,
    /** Sinergias e emblemas dos aprimoramentos escolhidos (ver `augmentGrants`). */
    grants,
    /** Situação da sinergia `name` com `count` peças (ver `traitStatus`). */
    status: (name, count) => traitStatus(thresholds(name), count),
    /** Contagem por sinergia de `[{ traits, items }]` (ver `tallyTraits`). */
    tally: (units) => tallyTraits(units, emblems),
    /** Sinergias do tabuleiro com contagem e situação; a solo com 2 ou mais peças não conta. */
    summary(units) {
      const { counts } = tallyTraits(units, emblems);
      for (const n of solo) if (counts.get(n) >= 2) counts.delete(n);
      return [...counts].map(([name, count]) => ({
        name,
        count,
        ...traitStatus(thresholds(name), count),
      }));
    },
    /** O tabuleiro não liga nenhuma sinergia solo duas vezes. */
    legal: (units) =>
      [...solo].every(
        (n) =>
          units.filter((u) => of(u.traits, u.items).traits.includes(n)).length <
          2,
      ),
  };
}
