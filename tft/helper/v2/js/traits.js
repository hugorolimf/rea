/**
 * Sinergias com emblemas: regra única usada pelo motor (engine/tactics/server) e pela interface.
 * Um emblema equipado dá ao campeão a sinergia do nome dele, se ele ainda não a tinha; o mesmo
 * emblema em quem já tem a sinergia (ou dois emblemas iguais) não soma de novo. Nada aqui toca o DOM.
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
  const counts = new Map();
  for (const { traits, items } of byId.values())
    for (const t of traitsWithEmblems(traits, items, emblems).traits)
      counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}
