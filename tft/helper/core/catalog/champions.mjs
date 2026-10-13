/**
 * Catálogo de campeões: papel, Avatar e o nome sob o qual a pool os conta (M2 da migração, ver ARQUITETURA.md).
 *
 * Reúne `engine.computeRole` e `tactics.role` (heurísticas quase iguais) e o teste de Avatar escrito em oito lugares.
 * ESM puro: carrega igual no servidor e no navegador (nada de `node:*`, relógio ou aleatório).
 */

/** O Avatar (Lux) é o campeão-jogador: não é comprado na loja e entra na pool como a Lux. */
const avatarMemo = new WeakMap();
export const isAvatar = (champion) => {
  if (!champion || typeof champion !== "object") return false;
  let v = avatarMemo.get(champion);
  if (v === undefined)
    avatarMemo.set(champion, (v = !!champion.traits?.includes("Avatar")));
  return v;
};

/** Nome sob o qual a pool conta o campeão (o Avatar divide as cópias da Lux). */
export const poolName = (champion) =>
  isAvatar(champion) ? "Lux" : champion.name;

/**
 * Papel do campeão: "tank" | "ad" | "ap". O papel publicado pela meta (`metaRoles`: campeão → papel, deduzido dos
 * itens das builds) vale primeiro; sem ele, a heurística pela habilidade: corpo a corpo (alcance <= 2) cuja habilidade
 * dá escudo, vida, cura, durabilidade ou resistência é tanque; só dano físico é AD; o resto é AP. A heurística é a do
 * motor (inclui "resist"); a do plano não incluía, e só a Leona mudava de papel (ap -> tank) no catálogo atual.
 */
export function championRole(champion, metaRoles = null) {
  const known = metaRoles?.get(champion.apiName);
  if (known) return known;
  const desc = (champion.ability?.desc ?? "").toLowerCase();
  if (
    (champion.stats?.range ?? Infinity) <= 2 &&
    /shield|health|heal|durability|resist/.test(desc)
  )
    return "tank";
  return /physical damage/.test(desc) && !/magic damage/.test(desc)
    ? "ad"
    : "ap";
}

/**
 * Vagas do tabuleiro que o campeão ocupa (regra do jogo): o Elder Dragon ocupa 2; os demais, 1. Aceita o campeão do
 * catálogo, uma peça (`{ id }`/`{ championName }`) ou o id.
 */
const DOUBLE_SLOT = /ElderDragon/,
  slotsMemo = new Map();
export const unitSlots = (u) => {
  const id =
    typeof u === "string" ? u : (u?.apiName ?? u?.id ?? u?.championName ?? "");
  let v = slotsMemo.get(id);
  if (v === undefined) slotsMemo.set(id, (v = DOUBLE_SLOT.test(id) ? 2 : 1));
  return v;
};

/** Vagas que uma lista de campeões/peças ocupa no tabuleiro. */
export const slotsUsed = (list = []) =>
  [...list].reduce((n, u) => n + unitSlots(u), 0);
