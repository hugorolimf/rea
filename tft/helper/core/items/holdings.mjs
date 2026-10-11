/**
 * Posse de itens: onde está cada item do jogador (M6 da migração, ver ARQUITETURA.md). É a regra da Formação
 * (`locateItem`) e a sua aplicação comp a comp (`classifyHoldings`), uma só para a Formação, o motor de comps, o plano
 * de itens e a aba Comps. ESM puro, sem `node:*`, relógio ou aleatório: carrega igual no servidor e no navegador.
 *
 * Aqui mora a CLASSIFICAÇÃO (a situação de cada item). O que ela vale (`HOLD_VALUE`, custo de mover/montar) é política do
 * motor e fica em `item-holdings.mjs`.
 *
 * Regras que valem em todo lugar:
 * - radiante = item base (`baseItemId`);
 * - cada cópia de item e cada componente é gasto UMA vez (`stock.mjs`);
 * - ordem de gasto: o que a peça já usa fica com ela; depois o carry (e as peças na ordem recebida); depois as demais;
 * - quem sai da formação cede o item antes de quem fica; quem fica e usa o item na própria build só informa (`taken`).
 */
import { baseItemId, isComponent } from "../catalog/items.mjs";
import { takeItem, takeOne } from "./stock.mjs";

/** Id do item comum de um radiante ("DA_X_Radiant" e "DA_XRadiant" valem o item "DA_X"). */
export const baseItem = baseItemId;

/** Situações possíveis de um item pedido pela build (`classifyHoldings`), da melhor para a pior. */
export const HOLD_KINDS = [
  "on",
  "bank",
  "move",
  "moveStay",
  "craft",
  "craftMove",
  "half",
  "taken",
  "absent",
];

/** Situações em que o item está ao alcance (o jogador consegue ter o item pronto na peça só com ações dele). */
export const AVAILABLE_KINDS = new Set([
  "on",
  "bank",
  "move",
  "moveStay",
  "craft",
  "craftMove",
]);

/**
 * Situação de um item PRONTO que vem de `origin` ({ type: "bank" | "leaving" | "unit", unitId }) para a peça `unitId`:
 * no banco, em peça que sai (mover), já na própria peça ou em outra peça que fica (mover de quem fica).
 */
export function kindFromOrigin(origin, unitId) {
  return origin.type === "bank"
    ? "bank"
    : origin.type === "leaving"
      ? "move"
      : origin.unitId === unitId
        ? "on"
        : "moveStay";
}

/**
 * Situação de um item MONTADO com os componentes que vêm de `origins`: `craft` se cada um vem do banco ou da própria
 * peça; `craftMove` se algum vem de outra peça.
 */
export function craftKindFromOrigins(origins, unitId) {
  return origins.every(
    (o) => o.type === "bank" || (o.type === "unit" && o.unitId === unitId),
  )
    ? "craft"
    : "craftMove";
}

/**
 * Situação de um item-alvo de uma peça no checklist do plano (a mesma posse, com o vocabulário de quem acompanha o
 * progresso): `built` (já equipado na peça), `move` (existe em outra peça e o plano o passa para esta), `ready` (dá para
 * montar agora), `partial` (tem parte dos `parts` componentes) ou `null` (nada disso; quem chama decide o resto).
 * `missing` = componentes que ainda faltam (`undefined` se quem avaliou não sabe).
 */
export function progressStatus({
  built = false,
  moved = false,
  craftable = false,
  missing,
  parts = 0,
}) {
  if (built) return "built";
  if (moved) return "move";
  if (craftable) return "ready";
  if (Array.isArray(missing) && missing.length < parts) return "partial";
  return null;
}

/** Contagem por situação (`HOLD_KINDS`) de uma lista de entradas { kind }. */
export function countKinds(list) {
  const out = Object.fromEntries(HOLD_KINDS.map((k) => [k, 0]));
  for (const e of list) out[e.kind ?? "absent"]++;
  return out;
}

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
 * - `taken`: só existe em peça que fica e usa o item na própria build e não há como montar outro; não é para tirar sem
 *   ganho claro. Se o banco (ou os componentes soltos de outras peças) monta outro, vale `ready`/`move`/`half` (como no
 *   motor), não `taken`.
 * - `half` / `need`: componentes que existem (`have`) e o que falta de verdade (`missing`).
 * Prefere quem sai da formação; entre os que ficam, só quem não tem o item na própria build. Uma cópia a mais do que a
 * peça que fica usa (duas Infinity Edge numa peça que pede uma) sobra e pode ser cedida: é a mesma conta do motor
 * (`classifyHoldings` gasta primeiro a cópia que a peça usa).
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
    // Quanto da peça é "dela": cópias que ela tem do item e quantas a própria build pede.
    copies = (o) => o.items.filter((x) => x === id).length,
    uses = (o) => o.wants.filter((x) => x === id).length,
    // Quem sai primeiro; depois quem fica sem usar o item (ou com cópia sobrando); o resto (usa na própria build) só informa.
    rank = (o) => (!o.stays ? 0 : uses(o) === 0 || copies(o) > uses(o) ? 1 : 2),
    order = (a, b) => rank(a) - rank(b);
  const planned = moves.find((m) => m.itemId === id)?.fromId,
    holders = others.filter((o) => o.items.includes(id)).sort(order),
    from = holders.find((o) => o.unitId === planned) ?? holders[0];
  // Só existe em peça que fica e usa o item: não é para tirar de lá, mas ainda dá para montar outro (abaixo).
  let usedBy = null;
  if (from) {
    const asTaken = rank(from) === 2 && from.unitId !== planned;
    if (!asTaken) return { kind: "move", text: `mover de ${from.name}`, from };
    usedBy = from;
  }

  // Sem o item pronto: junta os componentes do banco e, se faltar, os soltos em outras peças.
  const parts = (item.components ?? []).map((c) => c.id),
    left = [...bank],
    // Componentes soltos de outras peças: de quem sai primeiro, depois de quem fica. A peça que fica e AINDA precisa deste
    // item (pede e não tem) guarda os componentes para montá-lo; a que já tem o item que usa pode ceder os soltos.
    pool = others
      .filter((o) => !(o.stays && uses(o) > copies(o)))
      .sort((a, b) => Number(a.stays) - Number(b.stays))
      .map((o) => ({ owner: o, items: [...o.items] })),
    have = [],
    got = [],
    fetched = [];
  for (const p of parts) {
    const inBank = takeOne(left, p) !== null;
    const src =
      !inBank && isComponent(p) ? pool.find((s) => s.items.includes(p)) : null;
    if (src) {
      takeOne(src.items, p);
      fetched.push({ id: p, from: src.owner });
    }
    got.push(inBank || !!src);
    if (inBank || src) have.push(p);
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
  // Sem como montar: o item que só existe numa peça que o usa só informa onde está.
  if (usedBy && !have.length)
    return { kind: "taken", text: `só em ${usedBy.name}`, from: usedBy };
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

/**
 * Situação dos até 3 itens ideais da peça `cell` (da Formação) dado o banco. Os componentes de um item não são gastos
 * para o seguinte (cada linha mostra o que dá para fazer por ela), mas cada CÓPIA de um item pronto conta uma vez: com
 * `Voto ×3` na build, um Voto equipado cobre uma linha, um Voto no banco outra, e a terceira segue pedindo o item.
 */
export function buildStates(cell, bank = []) {
  const b = cell?.build,
    equipped = [...(b?.equipped ?? [])],
    bankLeft = [...(bank ?? [])],
    owners = (b?.owners ?? []).map((o) => ({ ...o, items: [...o.items] }));
  return (b?.ideal ?? []).slice(0, 3).map((item) => {
    const state = locateItem(item, {
      cellId: cell.id,
      equipped,
      bank: bankLeft,
      owners,
      moves: b.moves ?? [],
    });
    const id = baseItem(item.id);
    if (state.kind === "on") takeOne(equipped, (e) => baseItem(e.id) === id);
    else if (state.kind === "ready" && !state.have) takeItem(bankLeft, id);
    else if (state.kind === "move" && !state.parts && state.from)
      takeOne(
        owners.find((o) => o.unitId === state.from.unitId)?.items ?? [],
        id,
      );
    return { item, state };
  });
}

/**
 * Situação de cada item das builds da comp, gastando cada item do jogador uma só vez (a classificação; o valor de cada
 * situação é política do motor: `item-holdings.mjs`).
 *
 * - `builds`: { idDaPeça: [ids dos itens da build] } da comp; `order`: peças em ordem de prioridade (o carry
 *   primeiro); só entram as que estão em `goalIds`.
 * - `units`: peças do jogador { unitId, name, stars, items, keeps? } (campo e reserva; `keeps` = fica na comp
 *   mesmo sem estar em `goalIds`, como o Avatar); `goalIds`: peças da comp (as que ficam).
 * - `bank`: ids do banco (completos e componentes); `compositionOf(id)`: componentes de um item completo.
 *
 * Ordem de gasto: primeiro o que já está na peça que o pede (posicionado), depois, peça a peça, o resto —
 * do banco, de quem sai, de quem fica sem usar o item, ou montando. Item que só existe numa peça que fica e que a
 * própria build dela pede NÃO sobra para outra peça (`taken`).
 * Devolve `{ entries, counts, carry }`: `entries` é Map peça → [{ unit, id, kind, from, available }] na ordem da
 * build (`kind` em `HOLD_KINDS`); `counts` e `carry` contam por situação (todas as peças e só a do carry).
 */
export function classifyHoldings({
  builds = {},
  order = null,
  units = [],
  goalIds = new Set(),
  bank = [],
  compositionOf = () => [],
  carryId = null,
}) {
  const plan = (order ?? Object.keys(builds)).filter(
      (u) => builds[u]?.length && goalIds.has(u),
    ),
    owners = ownersOf(
      units.map((u) => ({
        championName: u.unitId,
        name: u.name,
        starLevel: u.stars,
        itemNames: u.items ?? [],
      })),
      goalIds,
      (id) => builds[id] ?? [],
    ),
    byUnit = new Map(owners.map((o) => [o.unitId, o])),
    entries = new Map(
      plan.map((u) => [
        u,
        builds[u].map((id) => ({
          unit: u,
          id,
          kind: null,
          from: null,
          available: false,
        })),
      ]),
    ),
    bankLeft = [...bank],
    positioned = new Map();
  for (const u of units)
    if (u.keeps && byUnit.has(u.unitId)) byUnit.get(u.unitId).stays = true;
  const settle = (e, kind, from = null) => {
    e.kind = kind;
    e.available = AVAILABLE_KINDS.has(kind);
    e.from = from;
  };

  // 1) Posicionado: o item que a peça já usa fica com ela, antes de qualquer outra peça poder pedi-lo.
  for (const u of plan) {
    const o = byUnit.get(u);
    for (const e of entries.get(u)) {
      const id = baseItem(e.id);
      if (!o || takeItem(o.items, id) === null) continue;
      settle(e, "on", o.name);
      positioned.set(id, [...(positioned.get(id) ?? []), o.name]);
    }
  }
  // O que a peça ainda pede (e não tem) é o que sobra de "quer"; o que ela tem a mais é livre para outra peça.
  for (const o of owners)
    o.wants = (entries.get(o.unitId) ?? [])
      .filter((e) => !e.kind)
      .map((e) => baseItem(e.id));

  // 2) O resto, peça a peça: banco, peça que sai, peça que fica sem usar o item, ou montando.
  for (const u of plan) {
    const o = byUnit.get(u);
    const spendPart = (p) => {
      if (takeItem(bankLeft, p) === null && o) takeItem(o.items, p);
    };
    for (const e of entries.get(u)) {
      if (e.kind) continue;
      const id = baseItem(e.id),
        // Componentes soltos na própria peça também montam o item dela.
        own = o ? o.items.filter(isComponent) : [],
        res = locateItem(
          { id, components: compositionOf(id).map((c) => ({ id: c })) },
          { cellId: u, equipped: [], bank: [...bankLeft, ...own], owners },
        );
      if (res.kind === "ready" && !res.have) {
        takeItem(bankLeft, id);
        settle(e, "bank");
      } else if (res.kind === "ready") {
        for (const p of res.have) spendPart(p);
        settle(e, "craft");
      } else if (res.kind === "move" && res.parts) {
        const rest = [...res.have];
        for (const f of res.parts) {
          takeItem(rest, f.id);
          takeItem(f.from.items, f.id);
        }
        for (const p of rest) spendPart(p);
        settle(
          e,
          "craftMove",
          [...new Set(res.parts.map((f) => f.from.name))].join(" e "),
        );
      } else if (res.kind === "move") {
        takeItem(res.from.items, id);
        settle(e, res.from.stays ? "moveStay" : "move", res.from.name);
      } else if (res.kind === "half") settle(e, "half");
      else if (positioned.has(id)) settle(e, "taken", positioned.get(id)[0]);
      else
        settle(
          e,
          res.kind === "taken" ? "taken" : "absent",
          res.from?.name ?? null,
        );
    }
  }

  const all = [...entries.values()].flat();
  return {
    entries,
    counts: countKinds(all),
    carry: countKinds(entries.get(carryId) ?? []),
  };
}
