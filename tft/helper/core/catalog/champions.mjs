/**
 * Catálogo de campeões: papel, Avatar e o nome sob o qual a pool os conta (M2 da migração, ver ARQUITETURA.md).
 *
 * Reúne `engine.computeRole` e `tactics.role` (heurísticas quase iguais) e o teste de Avatar escrito em oito lugares.
 * ESM puro: carrega igual no servidor e no navegador (nada de `node:*`, relógio ou aleatório).
 */

/** O Avatar (Lux) é o campeão-jogador: não é comprado na loja e entra na pool como a Lux. */
export const isAvatar = (champion) => !!champion?.traits?.includes("Avatar");

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
