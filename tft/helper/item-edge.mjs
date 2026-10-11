// Itens dentro de cada comp: quanto a build publicada de cada campeão muda a colocação naquela comp e quanto
// os itens que você tem mudam a força esperada dela. Fonte: MetaTFT comps_data (builds por comp). Puro.
//
// Por que builds e não médias por item: partidas em que a comp acumulou mais itens já vão melhor, então a
// média de um item isolado mede sobretudo "partida rica" (tanques extras parecem os melhores itens, o item
// central do carry parece fraco). A variação publicada por build (`place_change`) compara a build com
// qualquer outra build de 3 itens no mesmo campeão daquela comp: a quantidade de itens fica controlada.

import { baseItemId } from "./core/catalog/items.mjs";
import { takeAll, takeOne } from "./core/items/stock.mjs";

// Encolhimento forte: a fonte publica só a melhor build de cada campeão, então a variação vem inflada
// (escolher a melhor entre várias exagera o efeito; 235 de 236 builds aparecem como ganho, mediana −1,07
// em ~100 partidas). Com K = 1500, a build do Rengar (2127 partidas, −0,24) fica em −0,14 e uma build
// de 22 partidas quase não conta.
const SHRINK_K = 1500;
// Builds não somam: a melhor conta inteira, as seguintes cada vez menos, e o total tem teto (em colocações).
const WEIGHTS = [1, 0.6, 0.35];
const MAX_GAIN = 0.4;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Faixas próprias deste helper sobre a colocação média (1 a 8, menor é melhor); não são os tiers da MetaTFT. */
export const tierOf = (avg) =>
  avg <= 4.25 ? "S" : avg <= 4.4 ? "A" : avg <= 4.6 ? "B" : "C";

/** Build de maior pontuação de cada campeão na comp, com média, variação e partidas. */
export function compBuildStats(cluster) {
  const builds = {};
  for (const b of [...(cluster?.builds ?? [])].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0),
  ))
    if (b.unit && Array.isArray(b.buildName) && !builds[b.unit])
      builds[b.unit] = {
        items: b.buildName,
        avg: round(Number(b.avg)),
        delta: round(Number(b.place_change ?? 0)),
        n: Number(b.count ?? 0),
      };
  return builds;
}

/** Variação encolhida pelo número de partidas: builds raras pesam pouco. */
export const shrunk = (b) =>
  Number.isFinite(b?.delta) && b.n > 0 ? (b.delta * b.n) / (b.n + SHRINK_K) : 0;

/**
 * Colocação esperada da comp com os itens que você tem. Para cada campeão da comp cuja build publicada melhora
 * a colocação, conta quantos itens dela você tem prontos ou consegue montar com os componentes livres (cada
 * item ou componente seu serve a uma build só) e aplica parte da variação encolhida: a fração de itens ao
 * quadrado (1 de 3 vale 1/9, a build completa vale tudo — um item solto é pouca evidência) vezes o peso do
 * campeão (`weightOf(unit)`: o motor dá 1 ao carry, 0,5 a outras unidades de dano e 0 a tanques, porque três
 * itens de tanque mostram mais "partida rica" do que item certo).
 * `have` = {completed: ids (radiantes aceitos), components: ids}; `recipes` = Map id→[componente, componente].
 * `resolved` (opcional) = Map campeão → [{id, kind, value, available}] da comp (item-holdings.mjs): cada item da
 * build já vem localizado e gasto uma só vez (banco, peça que sai, peça que fica, montando), com o valor que o custo
 * de mover/montar deixa; nesse caso `have` e `recipes` não são consultados para as builds que ele cobre.
 */
export function itemEdge(
  comp,
  have,
  recipes = new Map(),
  weightOf = () => 1,
  resolved = null,
) {
  // Radiante conta como o item base: os buildName publicados usam só o id comum.
  const completed = (have?.completed ?? []).map(baseItemId),
    components = [...(have?.components ?? [])];
  const candidates = Object.entries(comp.buildStats ?? {})
    .map(([unit, b]) => [unit, b, shrunk(b) * weightOf(unit)])
    .filter(([unit, , s]) => comp.units?.includes(unit) && s < 0)
    .sort(([, , a], [, , b]) => a - b);
  const gains = [];
  for (const [unit, b, weighted] of candidates) {
    const ready = [],
      craft = [],
      given = resolved ? (resolved.get(unit) ?? []) : null;
    let value = 0;
    if (given) {
      const left = [...given];
      for (const id of b.items) {
        const e = takeOne(left, (x) => x.id === id);
        if (!e?.available) continue;
        (/craft/i.test(e.kind) ? craft : ready).push(id);
        value += e.value;
      }
    } else
      // Sem localização (só o estoque agregado): item pronto, ou os dois componentes livres (gastos uma vez).
      for (const id of b.items) {
        if (takeOne(completed, id) !== null) ready.push(id);
        else {
          const parts = recipes.get(id) ?? [];
          if (parts.length === 2 && takeAll(components, parts) !== null)
            craft.push(id);
        }
      }
    const hits = ready.length + craft.length;
    if (!hits) continue;
    const share = (given ? value : hits) / b.items.length;
    gains.push({
      unit,
      items: b.items,
      ready,
      craft,
      share: round(share),
      delta: round(weighted * share ** 2, 3),
      buildDelta: b.delta,
      n: b.n,
    });
  }
  gains.sort((a, b) => a.delta - b.delta);
  const used = gains.slice(0, WEIGHTS.length);
  const gain = Math.min(
    MAX_GAIN,
    Math.max(0, -used.reduce((s, g, k) => s + g.delta * WEIGHTS[k], 0)),
  );
  return {
    adjustedAvg: round(comp.avg - gain),
    gain: round(gain),
    gains: used,
  };
}
