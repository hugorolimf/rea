/**
 * O que o jogador tem, sem a localização (M6 da migração): a lista de itens dele (equipados + banco), a partição em
 * completos e componentes, as receitas que o banco fecha e o que dá para pôr numa peça de uma comp (o banco e o que está
 * em peça que sai dela). A localização peça a peça é de `holdings.mjs`; aqui só entram as contas que não dependem dela.
 */
import { baseItemId, isComponent, standardRecipes } from "../catalog/items.mjs";
import { hasAll } from "./stock.mjs";

/** Todos os itens do jogador: os equipados (de qualquer peça) e os do banco. */
export const ownedItems = (equipped = [], bank = []) => [...equipped, ...bank];

/** Estoque para medir builds: itens completos e componentes (componente equipado ainda vira metade de um item). */
export const itemStock = (ids = []) => ({
  completed: ids.filter((id) => !isComponent(id)),
  components: ids.filter(isComponent),
});

/** Receitas comuns (sem emblema nem radiante) que os componentes do banco fecham agora. Cada receita é uma alternativa. */
export const readyRecipes = (catalogItems, bank = []) =>
  standardRecipes(catalogItems).filter((i) => hasAll(bank, i.composition));

/**
 * Itens que dá para pôr numa peça de uma comp: o banco e o que está equipado em peça que SAI dela. Cada item leva de onde
 * vem (`leaving`: o de peça que sai custa mover). `leavingItems`: ids equipados nas peças que saem (radiante = base).
 */
export const movableItems = (bank = [], leavingItems = []) => [
  ...bank.map((id) => ({ id, leaving: false })),
  ...leavingItems.map((id) => ({ id: baseItemId(id), leaving: true })),
];
