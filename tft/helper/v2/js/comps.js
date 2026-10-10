/**
 * Seleção de comp: funções puras sobre as comps de meta (/api/comps) e o encaixe calculado pelo motor
 * para a partida atual (`compRanking` de /api/recommend). Não decide nada novo; só junta, filtra e ordena.
 */

/** Estilo de nível da comp: reroll em um nível, Fast 8 ou Fast 9. */
export function styleOf(comp) {
  if (comp.rerollLevel)
    return { key: "reroll", label: `Reroll nível ${comp.rerollLevel}` };
  const fast = /^Fast (\d+)$/i.exec(comp.levelling ?? "");
  if (fast) return { key: `fast${fast[1]}`, label: `Fast ${fast[1]}` };
  if (/^standard$/i.test(comp.levelling ?? ""))
    return { key: "standard", label: "Nível padrão" };
  return { key: "other", label: comp.levelling || "Estilo não informado" };
}
export const STYLES = [
  { key: "", label: "Todas" },
  { key: "reroll", label: "Reroll" },
  { key: "fast8", label: "Fast 8" },
  { key: "fast9", label: "Fast 9" },
  { key: "standard", label: "Padrão" },
];
export const SORTS = [
  { key: "score", label: "Score (melhor para você)" },
  { key: "fit", label: "Encaixe na partida" },
  { key: "items", label: "Com seus itens" },
  { key: "avg", label: "Colocação média" },
  { key: "top4", label: "Top 4" },
];

/** Ganho mínimo (em colocações) para anunciar "com seus itens": abaixo disso é ruído de fronteira. */
export const ITEM_EDGE_MIN = 0.05;
/** Comp que melhora de forma relevante com os seus itens: {avg, gain} (colocação média com os itens e o ganho) ou null. */
export function itemUpgrade(comp) {
  const f = comp.fit;
  if (!f || !(f.itemGain >= ITEM_EDGE_MIN)) return null;
  return { avg: f.adjustedAvg, gain: f.itemGain };
}

/**
 * Score da comp para a partida (0 a 100, do motor: itens, o que você tem, força, chance de montar no seu nível, loja e
 * disputa) e a chance de montar em %. null sem encaixe calculado. `band` agrupa só para a cor: alto ≥ 60, médio ≥ 40.
 */
export function scoreOf(comp) {
  const f = comp.fit;
  if (!f || !Number.isFinite(f.score)) return null;
  return {
    score: Math.round(f.score),
    chance: Number.isFinite(f.chance) ? Math.round(f.chance * 100) : null,
    chancePlan: Number.isFinite(f.chancePlan)
      ? Math.round(f.chancePlan * 100)
      : null,
    level: f.level ?? null,
    best: f.best === true,
    band: f.score >= 60 ? "high" : f.score >= 40 ? "mid" : "low",
  };
}

/** Disputa da pool: soma, por unidade da comp, da fração das cópias com rivais (escala do motor). */
export const disputeLevel = (d) =>
  d == null ? null : d < 2 ? "baixa" : d < 5 ? "média" : "alta";

/** Junta cada comp ao encaixe da partida; comps sem encaixe (motor não as avaliou) ficam com `fit: null`. */
export function mergeComps(comps, ranking = []) {
  const byId = new Map(ranking.map((r) => [r.id, r]));
  return comps.map((c) => ({
    ...c,
    style: styleOf(c),
    fit: byId.get(c.id) ?? null,
  }));
}

const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Sinergias da comp que estão de fato ativas: conta os campeões da comp com cada sinergia e só vale quem chega ao
 * primeiro patamar (`breakpoints`: Map nome → patamares; sem o patamar conhecido, 2 campeões). Devolve
 * [{name, count}] com a maior contagem primeiro. Um campeão solto com a sinergia não a ativa.
 */
export function activeTraits(comp, champions, breakpoints = new Map()) {
  const counts = new Map();
  for (const id of new Set(comp.units))
    for (const t of new Set(champions.get(id)?.traits ?? []))
      counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .filter(
      ([name, n]) =>
        n >=
        Math.min(
          ...(breakpoints.get(name)?.length ? breakpoints.get(name) : [2]),
        ),
    )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Filtra por texto e estilo. O texto casa o nome de um campeão da comp ou uma SINERGIA ATIVA dela ("carrasco" traz as
 * comps que de fato têm Carrasco ativo, não as que só têm a palavra no título nem as com um campeão solto da sinergia).
 * Quando o texto é uma sinergia, a comp ganha `match: {name, count}` (a contagem para exibir). `champions` é Map
 * id→{name,traits}; `breakpoints`, Map sinergia→patamares (catálogo).
 */
export function filterComps(
  list,
  { query = "", style = "" },
  champions,
  breakpoints = new Map(),
) {
  const q = fold(query).trim();
  return list.reduce((out, c) => {
    if (style && c.style.key !== style) return out;
    if (!q) return (out.push(c), out);
    const trait = activeTraits(c, champions, breakpoints).find((t) =>
      fold(t.name).includes(q),
    );
    if (trait) return (out.push({ ...c, match: trait }), out);
    if (c.units.some((id) => fold(champions.get(id)?.name ?? id).includes(q)))
      out.push({ ...c, match: null });
    return out;
  }, []);
}

/** Ordena: score, encaixe (ordem final de escolha do motor), colocação média ou top 4; empates pela colocação média. */
export function sortComps(list, by = "score") {
  const key =
    {
      score: (c) => (Number.isFinite(c.fit?.score) ? -c.fit.score : Infinity),
      fit: (c) => c.fit?.rank ?? Infinity,
      items: (c) => c.fit?.adjustedAvg ?? c.avg,
      avg: (c) => c.avg,
      top4: (c) => -c.top4,
    }[by] ?? ((c) => c.fit?.rank ?? Infinity);
  return [...list].sort((a, b) => key(a) - key(b) || a.avg - b.avg);
}

/**
 * Substituições no automático, por partida: {idDaComp: [{out, in}]}. Valem quando aquela comp é a sugerida,
 * sem fixá-la.
 */
export function swapStore(storage, name = "tft-compass-swaps") {
  const read = () => {
    try {
      const v = JSON.parse(storage.getItem(name) ?? "null");
      return v &&
        typeof v.match === "string" &&
        v.comps &&
        typeof v.comps === "object"
        ? v
        : null;
    } catch {
      return null;
    }
  };
  return {
    all(matchKey) {
      const v = read();
      return matchKey !== "lobby" && v?.match === matchKey ? v.comps : {};
    },
    get(matchKey, compId) {
      return this.all(matchKey)[compId] ?? [];
    },
    set(matchKey, compId, swaps) {
      if (matchKey === "lobby") return;
      // A comp editada vai para o fim (ordem = recência); o servidor aceita no máximo 10 comps.
      const comps = { ...this.all(matchKey) };
      delete comps[compId];
      if (swaps.length) comps[compId] = swaps;
      const kept = Object.fromEntries(Object.entries(comps).slice(-10));
      try {
        storage.setItem(name, JSON.stringify({ match: matchKey, comps: kept }));
      } catch {}
    },
  };
}

/**
 * Comp fixada, guardada por partida, com as substituições aplicadas sobre ela (`swaps`: [{out, in}]).
 * Vale só na partida em que foi escolhida: escolhida fora de partida ("lobby"), é descartada quando uma
 * partida começa; escolhida numa partida, some quando ela termina. `storage` segue a interface de localStorage.
 */
export function goalStore(storage, name = "tft-compass-goal") {
  const read = () => {
    try {
      const v = JSON.parse(storage.getItem(name) ?? "null");
      if (!v || typeof v.id !== "string" || typeof v.match !== "string")
        return null;
      const swaps = Array.isArray(v.swaps)
        ? v.swaps.filter(
            (s) => s && typeof s.out === "string" && typeof s.in === "string",
          )
        : [];
      return { match: v.match, id: v.id, swaps };
    } catch {
      return null;
    }
  };
  const write = (v) => {
    try {
      if (v) storage.setItem(name, JSON.stringify(v));
      else storage.removeItem(name);
    } catch {}
  };
  return {
    /** Comp fixada para esta partida (`matchKey`): {id, swaps}, ou null. */
    get(matchKey) {
      const v = read();
      if (!v) return null;
      // Vale só na partida (ou no lobby) em que foi escolhida: o automático volta na partida seguinte.
      if (v.match !== matchKey) {
        write(null);
        return null;
      }
      return { id: v.id, swaps: v.swaps };
    },
    set(matchKey, id, swaps = []) {
      write({ match: matchKey, id, swaps });
    },
    clear() {
      write(null);
    },
  };
}
/** Chave da partida para a comp fixada: a partida em andamento, ou "lobby" fora dela. */
export const matchKeyOf = (state) =>
  state?.match?.status === "live" && state.match.id != null
    ? String(state.match.id)
    : "lobby";
