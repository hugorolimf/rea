import { traitsWithEmblems } from "./traits.js";
/**
 * Histórico de partidas: funções puras sobre os registros de /api/history. Só apresentação;
 * os registros guardam fila, colocação, duração e o tabuleiro final do Hero.
 */
const QUEUES = {
  RANKED_TFT: "Ranqueada",
  NORMAL_TFT: "Normal",
  RANKED_TFT_DOUBLE_UP: "Dupla",
  NORMAL_TFT_DOUBLE_UP: "Dupla",
  RANKED_TFT_TURBO: "Hiper Rolagem",
  NORMAL_TFT_TURBO: "Hiper Rolagem",
  PVE_PUZZLE_TFT: "Desafio",
};
export const queueLabel = (queue) =>
  QUEUES[queue] ??
  (queue ? String(queue).replace(/_/g, " ").toLowerCase() : "fila não lida");

/** Tom da colocação: vitória, top 4, fora do top 4 ou não observada. */
export const placeTone = (p) =>
  !(p >= 1) ? "unknown" : p === 1 ? "win" : p <= 4 ? "top" : "bottom";

/** Totais das partidas com colocação observada; médias são null sem nenhuma. */
export function summarize(records) {
  const placed = records
    .map((r) => r.placement)
    .filter((p) => Number.isInteger(p) && p >= 1);
  return {
    games: records.length,
    placed: placed.length,
    average: placed.length
      ? placed.reduce((a, b) => a + b, 0) / placed.length
      : null,
    top4: placed.length
      ? placed.filter((p) => p <= 4).length / placed.length
      : null,
    wins: placed.filter((p) => p === 1).length,
  };
}

/**
 * Sinergias ativas no tabuleiro final: cada campeão conta uma vez por sinergia (cópias repetidas não somam).
 * `champions` é Map id→{traits}; `breakpoints` é Map nome→[mínimos]; `emblems` é Map item→sinergia: emblema equipado
 * num campeão que ainda não tem a sinergia soma 1 para ela (regra de traits.js).
 */
export function activeTraits(
  units,
  champions,
  breakpoints,
  limit = 4,
  emblems = new Map(),
) {
  const count = new Map(),
    items = new Map();
  for (const u of units)
    items.set(u.id, [...(items.get(u.id) ?? []), ...(u.items ?? [])]);
  for (const [id, equipped] of items)
    for (const t of traitsWithEmblems(
      champions.get(id)?.traits,
      equipped,
      emblems,
    ).traits)
      count.set(t, (count.get(t) ?? 0) + 1);
  return [...count]
    .map(([name, n]) => {
      const steps = breakpoints.get(name) ?? [];
      return { name, count: n, tier: steps.filter((m) => n >= m).length };
    })
    .filter((t) => t.tier > 0)
    .sort((a, b) => b.tier - a.tier || b.count - a.count)
    .slice(0, limit);
}

/** Tabuleiro ordenado para exibir: maior custo e mais estrelas primeiro. */
export const sortUnits = (units, champions) =>
  [...units].sort(
    (a, b) =>
      (champions.get(b.id)?.cost ?? 0) - (champions.get(a.id)?.cost ?? 0) ||
      (b.stars ?? 0) - (a.stars ?? 0),
  );

export const formatDuration = (seconds) =>
  Number.isFinite(seconds) && seconds > 0
    ? `${Math.round(seconds / 60)} min`
    : "";
