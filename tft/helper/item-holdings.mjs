// Itens do jogador DENTRO de cada comp candidata: para cada item que a build da comp pede, onde ele está (já na peça
// certa, no banco, equipado numa peça que sai da comp, numa peça que fica, montável com componentes ou ausente) e
// quanto vale por isso. A CLASSIFICAÇÃO de "onde está" é uma só e mora em core/items/holdings.mjs
// (`classifyHoldings`: a regra da Formação aplicada comp a comp, cada item gasto uma vez), a mesma que a Formação, a aba
// Comps e o plano de itens leem. Este módulo guarda só a POLÍTICA do motor: o valor de cada situação. Puro e sem I/O.
//
// Os valores são política deste helper (não medidos): custo pequeno e explícito de mover/montar, na ordem
// já posicionado > banco > mover > montar > ausente.

import { AVAILABLE_KINDS, classifyHoldings } from "./core/items/holdings.mjs";

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
export const AVAILABLE = AVAILABLE_KINDS;

/**
 * Situação de cada item das builds da comp, gastando cada item do jogador uma só vez (a classificação é de
 * `core/items/holdings.mjs:classifyHoldings`, que documenta os argumentos e a ordem de gasto; aqui entra o valor).
 * Devolve `{ entries, counts, carry }`: `entries` é Map peça → [{ unit, id, kind, value, from, available }] na ordem da
 * build; `counts` e `carry` contam por situação (todas as peças e só a do carry).
 */
export function resolveHoldings(args) {
  const { entries, counts, carry } = classifyHoldings(args);
  return {
    entries: new Map(
      [...entries].map(([unit, list]) => [
        unit,
        list.map((e) => ({
          unit: e.unit,
          id: e.id,
          kind: e.kind,
          value: HOLD_VALUE[e.kind],
          from: e.from,
          available: e.available,
        })),
      ]),
    ),
    counts,
    carry,
  };
}

/** Soma do valor dos itens de uma peça (itens ao alcance contam inteiros; metade de receita, 0,35). */
export const holdValue = (list = []) =>
  Math.round(list.reduce((n, e) => n + (e.value ?? 0), 0) * 100) / 100;

/**
 * Inventário que o motor recebe: o banco de itens observado agora (do GEP, já sem consumíveis, `seen.items`) vale mais
 * que o enviado pelo cliente (que pode ser de uma leitura anterior). Sem observação (GEP fora, partida revista), segue
 * o enviado. Ids fora do catálogo ficam de fora (o servidor valida a entrada; a leitura não passa por essa validação).
 */
export function recommendInventory(requested, seen, isKnown = () => true) {
  return Array.isArray(seen?.items)
    ? seen.items.filter((id) => typeof id === "string" && isKnown(id))
    : requested;
}
