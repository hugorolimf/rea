// Itens do jogador DENTRO de cada comp candidata: para cada item que a build da comp pede, onde ele está (já na peça
// certa, no banco, equipado numa peça que sai da comp, numa peça que fica, montável com componentes ou ausente) e
// quanto vale por isso. A regra de "onde está" é a da Formação (v2/js/item-source.js, locateItem): este módulo só
// a aplica comp a comp, gastando cada item uma vez, para o motor (engine.mjs) e o score (comp-score.mjs) verem os
// mesmos itens que a Formação mostra. Puro e sem I/O.
//
// Os valores são política deste helper (não medidos): custo pequeno e explícito de mover/montar, na ordem
// já posicionado > banco > mover > montar > ausente.

import { baseItem, locateItem, ownersOf } from "./v2/js/item-source.js";

/**
 * Valor de um item pedido pela build, de 0 a 1, conforme onde ele está. Cada degrau abaixo de 1 é o custo de ação:
 * equipar do banco, tirar de outra peça e pôr aqui, montar com componentes. `half` mantém o 0,35 de "tenho metade
 * da receita"; `taken` (só existe numa peça que fica e usa o item na própria build) e `absent` não valem nada.
 */
export const HOLD_VALUE = {
  on: 1,
  bank: 0.98,
  move: 0.95,
  moveStay: 0.9,
  craft: 0.9,
  craftMove: 0.85,
  half: 0.35,
  taken: 0,
  absent: 0,
};

/** Situações em que o item está ao alcance (o jogador consegue ter o item pronto na peça só com ações dele). */
export const AVAILABLE = new Set([
  "on",
  "bank",
  "move",
  "moveStay",
  "craft",
  "craftMove",
]);

const isComponent = (id) => id.startsWith('DA_Component_');

/** Tira da lista a primeira ocorrência de `id` (comparando pelo item base: o radiante vale o comum). */
function takeBase(list, id) {
  const at = list.findIndex((x) => baseItem(x) === id);
  if (at < 0) return false;
  list.splice(at, 1);
  return true;
}

/**
 * Situação de cada item das builds da comp, gastando cada item do jogador uma só vez.
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
 * Devolve `{ entries, counts, carry }`: `entries` é Map peça → [{ unit, id, kind, value, available, from }] na ordem
 * da build; `counts` e `carry` contam por situação (todas as peças e só a do carry).
 */
export function resolveHoldings({
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
          value: 0,
          from: null,
        })),
      ]),
    ),
    bankLeft = [...bank],
    positioned = new Map();
  for (const u of units)
    if (u.keeps && byUnit.has(u.unitId)) byUnit.get(u.unitId).stays = true;
  const settle = (e, kind, from = null) => {
    e.kind = kind;
    e.value = HOLD_VALUE[kind];
    e.available = AVAILABLE.has(kind);
    e.from = from;
  };

  // 1) Posicionado: o item que a peça já usa fica com ela, antes de qualquer outra peça poder pedi-lo.
  for (const u of plan) {
    const o = byUnit.get(u);
    for (const e of entries.get(u)) {
      const id = baseItem(e.id);
      if (!o || !takeBase(o.items, id)) continue;
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
      if (!takeBase(bankLeft, p) && o) takeBase(o.items, p);
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
        takeBase(bankLeft, id);
        settle(e, "bank");
      } else if (res.kind === "ready") {
        for (const p of res.have) spendPart(p);
        settle(e, "craft");
      } else if (res.kind === "move" && res.parts) {
        const rest = [...res.have];
        for (const f of res.parts) {
          takeBase(rest, f.id);
          takeBase(f.from.items, f.id);
        }
        for (const p of rest) spendPart(p);
        settle(
          e,
          "craftMove",
          [...new Set(res.parts.map((f) => f.from.name))].join(" e "),
        );
      } else if (res.kind === "move") {
        takeBase(res.from.items, id);
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

  const count = (list) => {
    const out = Object.fromEntries(Object.keys(HOLD_VALUE).map((k) => [k, 0]));
    for (const e of list) out[e.kind ?? "absent"]++;
    return out;
  };
  const all = [...entries.values()].flat();
  return {
    entries,
    counts: count(all),
    carry: count(entries.get(carryId) ?? []),
  };
}

/** Soma do valor dos itens de uma peça (itens ao alcance contam inteiros; metade de receita, 0,35). */
export const holdValue = (list = []) =>
  Math.round(list.reduce((n, e) => n + (e.value ?? 0), 0) * 100) / 100;

/**
 * Inventário que o motor recebe: o banco lido da tela agora (já sem consumíveis, `seen.items`) vale mais que o
 * enviado pelo cliente (que pode ser de uma leitura anterior). Sem leitura (tela fechada, partida revista), segue o
 * enviado. Ids fora do catálogo ficam de fora (o servidor valida a entrada; a leitura não passa por essa validação).
 */
export function recommendInventory(requested, seen, isKnown = () => true) {
  return Array.isArray(seen?.items)
    ? seen.items.filter((id) => typeof id === "string" && isKnown(id))
    : requested;
}
