/**
 * Onde está cada item que a Formação pede. Um item só "falta" quando não existe em lugar nenhum: nem completo
 * (banco ou equipado em qualquer peça do tabuleiro ou da reserva), nem como componentes que dá para juntar.
 * Função pura, sem DOM: usada pela faixa de itens da peça clicada na Formação.
 */

/** Id do item comum de um radiante ("DA_X_Radiant" e "DA_XRadiant" valem o item "DA_X"). */
export const baseItem = (id) => String(id ?? "").replace(/_?Radiant$/, "");

const isComponent = (id) => id.startsWith('DA_Component_');

/**
 * Itens de cada peça sua (campo e reserva), com o que a Formação precisa saber de cada dono.
 * `units`: { championName, name, starLevel, itemNames } do snapshot; `goalIds`: peças da comp alvo (ficam);
 * `wants(unitId)`: ids dos itens que a build da própria peça pede (não se tira sem ganho claro).
 */
export function ownersOf(units, goalIds, wants = () => []) {
  return units
    .filter((u) => (u.itemNames ?? []).length)
    .map((u) => ({
      unitId: u.championName,
      name: u.name ?? u.championName,
      stars: u.starLevel ?? 1,
      zone: u.zone ?? "board",
      stays: goalIds.has(u.championName),
      items: (u.itemNames ?? []).map(baseItem),
      wants: wants(u.championName).map(baseItem),
    }));
}

/**
 * Situação de um item pedido pela build de `cellId`.
 * - `on`: já equipado nesta peça.
 * - `ready`: completo no banco, ou monta agora com os componentes do banco.
 * - `move`: já existe equipado em outra peça (`from`), ou falta só mover componentes soltos dela (`parts`):
 *   desequipar de lá e equipar aqui, sem fabricar nada.
 * - `taken`: só existe em peça que fica e usa o item na própria build; não é para tirar sem ganho claro.
 * - `half` / `need`: componentes que existem (`have`) e o que falta de verdade (`missing`).
 * Prefere quem sai da formação; entre os que ficam, só quem não tem o item na própria build.
 */
export function locateItem(
  item,
  { cellId, equipped = [], bank = [], owners = [], moves = [] },
) {
  const id = baseItem(item.id);
  if (equipped.some((e) => baseItem(e.id) === id))
    return { kind: "on", text: "equipado" };
  if (bank.some((b) => baseItem(b) === id))
    return { kind: "ready", text: "pronto no banco" };

  const others = owners.filter((o) => o.unitId !== cellId),
    // Quem sai primeiro; depois quem fica sem usar o item; o resto (usa na própria build) só informa.
    rank = (o) => (!o.stays ? 0 : !o.wants.includes(id) ? 1 : 2),
    order = (a, b) => rank(a) - rank(b);
  const planned = moves.find((m) => m.itemId === id)?.fromId,
    holders = others.filter((o) => o.items.includes(id)).sort(order),
    from = holders.find((o) => o.unitId === planned) ?? holders[0];
  if (from) {
    const asTaken = rank(from) === 2 && from.unitId !== planned;
    return asTaken
      ? { kind: "taken", text: `só em ${from.name}`, from }
      : { kind: "move", text: `mover de ${from.name}`, from };
  }

  // Sem o item pronto: junta os componentes do banco e, se faltar, os soltos em outras peças.
  const parts = (item.components ?? []).map((c) => c.id),
    left = [...bank],
    pool = others
      .filter((o) => rank(o) < 2)
      .sort(order)
      .map((o) => ({ owner: o, items: [...o.items] })),
    have = [],
    got = [],
    fetched = [];
  for (const p of parts) {
    const at = left.indexOf(p);
    const src =
      at < 0 && isComponent(p) ? pool.find((s) => s.items.includes(p)) : null;
    if (at >= 0) left.splice(at, 1);
    else if (src) {
      src.items.splice(src.items.indexOf(p), 1);
      fetched.push({ id: p, from: src.owner });
    }
    got.push(at >= 0 || !!src);
    if (at >= 0 || src) have.push(p);
  }
  const full = parts.length > 0 && have.length === parts.length;
  if (full && fetched.length) {
    const names = [...new Set(fetched.map((f) => f.from.name))].join(" e ");
    return {
      kind: "move",
      text: `mover componente de ${names} e montar`,
      from: fetched[0].from,
      parts: fetched,
      have,
      got,
    };
  }
  if (full) return { kind: "ready", text: "monta agora", have, got };
  const missing = parts.length - have.length;
  return {
    kind: have.length ? "half" : "need",
    text: have.length ? `falta ${missing}` : "",
    have,
    got,
    missing,
    ...(fetched.length ? { parts: fetched } : {}),
  };
}

/** Situação dos até 3 itens ideais da peça `cell` (da Formação) dado o banco; o primeiro item não consome o do seguinte. */
export function buildStates(cell, bank = []) {
  const b = cell?.build;
  return (b?.ideal ?? []).slice(0, 3).map((item) => ({
    item,
    state: locateItem(item, {
      cellId: cell.id,
      equipped: b.equipped ?? [],
      bank,
      owners: b.owners ?? [],
      moves: b.moves ?? [],
    }),
  }));
}
