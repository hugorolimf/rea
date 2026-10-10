// Valor MEDIDO de um item num campeão, a partir do que a MetaTFT publica: quanto a colocação média do campeão com o
// item (meta-stats.json, `unitItem`) fica melhor que a colocação média do próprio campeão (`unit`). Sem papel fixo:
// carry, tanque ou utilidade têm valor pelo mesmo número. Puro e sem I/O.
//
// Limites que ficam registrados (política deste helper, não medidos):
// - a diferença mistura o efeito do item com "partida rica" (campeão com item aparece em tabuleiros melhores), então o
//   valor ordena bem os itens de um mesmo campeão e é um piso otimista do ganho absoluto; o encolhimento por amostra e
//   o teto MAX_VALUE seguram os extremos;
// - a fonte não separa o 1º, 2º e 3º item de um campeão de modo monótono (contagens por quantidade de itens
//   misturam o nível da partida), então os valores são aditivos; o único rendimento decrescente é o limite de 3 itens.

import { baseItem } from "./v2/js/item-source.js";

/** Partidas que valem metade do peso: o valor medido é multiplicado por n / (n + SHRINK_K). */
export const SHRINK_K = 5000;
/** Teto do valor de um item num campeão, em colocações. */
export const MAX_VALUE = 0.5;
/** Confiança máxima do valor tirado só da lista de builds de meta (sem par campeão × item medido). */
export const META_BUILD_TRUST = 0.5;

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Item que entra no plano: completo e equipável (fora componentes, emblemas, artefatos, consumíveis e ferramentas). */
export const isPlanItem = (id) =>
  /^DA_/.test(id ?? "") &&
  !/Component|Emblem|Artifact|Consumable|Spatula|FryingPan|Upgrade/.test(id);

/**
 * Tabela de valores. `stats` = meta-stats.json (`unit`, `unitItem`); `itemStats` = meta-builds.json `items`
 * ({id: {count, avg, units}}); `metaBuilds` = Map ou objeto campeão → ids dos itens da build de meta; `baseAvg` =
 * colocação média de todos os tabuleiros (referência quando o campeão não tem média própria).
 * - `valueOf(champion, item)` → `{ value, confidence, samples, source, avg, ref }` ou null sem nenhum dado. `value`
 *   em colocações (positivo = melhora), já encolhido pela amostra; radiante vale o item base.
 * - `itemsOf(champion)` → ids dos itens com dado para o campeão (par medido ou build de meta).
 * - `rankedOf(champion)` → [{ id, m }] dos itens de valor positivo para o campeão, do maior para o menor (memoizado).
 */
export function itemValueTable({
  stats = null,
  itemStats = null,
  metaBuilds = null,
  baseAvg = 4.466,
} = {}) {
  const builds = (champion) =>
      (metaBuilds instanceof Map
        ? metaBuilds.get(champion)
        : metaBuilds?.[champion]) ?? [],
    byChampion = new Map();
  for (const key of Object.keys(stats?.unitItem ?? {})) {
    const [champion, item] = key.split("|");
    if (!byChampion.has(champion)) byChampion.set(champion, []);
    byChampion.get(champion).push(item);
  }
  // Cache por campeão e por id como veio (radiante incluso), para não refazer a conta nem o parse do id.
  const cache = new Map();
  function valueOf(champion, rawItem) {
    let memo = cache.get(champion);
    if (!memo) cache.set(champion, (memo = new Map()));
    if (memo.has(rawItem)) return memo.get(rawItem);
    const item = baseItem(rawItem),
      k = `${champion}|${item}`;
    let out = null;
    const pair = stats?.unitItem?.[k];
    if (pair) {
      const [avg, n] = pair,
        ref = stats?.unit?.[champion]?.[0] ?? baseAvg,
        confidence = n / (n + SHRINK_K),
        value = Math.max(
          -MAX_VALUE,
          Math.min(MAX_VALUE, (ref - avg) * confidence),
        );
      out = {
        value: round(value),
        confidence: round(confidence),
        samples: n,
        source: "par",
        avg,
        ref,
      };
    } else if (itemStats?.[item] && builds(champion).includes(item)) {
      // Sem par medido: o item está na build de meta do campeão; vale a colocação do item contra a base, com confiança baixa.
      const { avg, count } = itemStats[item],
        confidence = META_BUILD_TRUST * (count / (count + 10 * SHRINK_K)),
        value = Math.max(
          -MAX_VALUE,
          Math.min(MAX_VALUE, (baseAvg - avg) * confidence),
        );
      if (Number.isFinite(value))
        out = {
          value: round(value),
          confidence: round(confidence),
          samples: count,
          source: "build-meta",
          avg,
          ref: baseAvg,
        };
    }
    memo.set(rawItem, out);
    return out;
  }
  function itemsOf(champion) {
    return [
      ...new Set(
        [...(byChampion.get(champion) ?? []), ...builds(champion)].map(
          baseItem,
        ),
      ),
    ].filter(isPlanItem);
  }
  const rankedCache = new Map();
  function rankedOf(champion) {
    let list = rankedCache.get(champion);
    if (!list) {
      list = itemsOf(champion)
        .map((id) => ({ id, m: valueOf(champion, id) }))
        .filter((x) => x.m && x.m.value > 0)
        .sort((a, b) => b.m.value - a.m.value);
      rankedCache.set(champion, list);
    }
    return list;
  }
  const wantsCache = new Map();
  /** Conjunto dos ids de `rankedOf` (memoizado). */
  const wantsOf = (champion) => {
    let set = wantsCache.get(champion);
    if (!set)
      wantsCache.set(
        champion,
        (set = new Set(rankedOf(champion).map((x) => x.id))),
      );
    return set;
  };
  return { valueOf, itemsOf, rankedOf, wantsOf };
}
