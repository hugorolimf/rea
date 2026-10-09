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
export const TIERS = ["S", "A", "B", "C"];
export const SORTS = [
  { key: "fit", label: "Encaixe na partida" },
  { key: "items", label: "Com seus itens" },
  { key: "avg", label: "Colocação média" },
  { key: "top4", label: "Top 4" },
];

/** Ganho mínimo (em colocações) para anunciar "com seus itens": abaixo disso é ruído de fronteira. */
export const ITEM_EDGE_MIN = 0.05;
/** Comp que melhora de forma relevante com os seus itens: {from, to, avg, gain, tierUp} ou null. */
export function itemUpgrade(comp) {
  const f = comp.fit;
  if (!f || !(f.itemGain >= ITEM_EDGE_MIN)) return null;
  return {
    from: comp.tier,
    to: f.itemTier,
    avg: f.adjustedAvg,
    gain: f.itemGain,
    tierUp: f.itemTier !== comp.tier,
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

/** Filtra por texto (título, campeões e sinergias), estilo e tiers. `champions` é Map id→{name,traits}. */
export function filterComps(
  list,
  { query = "", style = "", tiers = [] },
  champions,
) {
  const q = fold(query).trim();
  return list.filter((c) => {
    if (style && c.style.key !== style) return false;
    if (tiers.length && !tiers.includes(c.tier)) return false;
    if (!q) return true;
    const words = [
      c.title,
      ...c.units.flatMap((id) => {
        const ch = champions.get(id);
        return [ch?.name ?? id, ...(ch?.traits ?? [])];
      }),
    ];
    return words.some((w) => fold(w).includes(q));
  });
}

/** Ordena: encaixe (posição no ranking do motor), colocação média ou top 4; empates pela colocação média. */
export function sortComps(list, by = "fit") {
  const key =
    {
      fit: (c) => c.fit?.rank ?? Infinity,
      items: (c) => c.fit?.adjustedAvg ?? c.avg,
      avg: (c) => c.avg,
      top4: (c) => -c.top4,
    }[by] ?? ((c) => c.fit?.rank ?? Infinity);
  return [...list].sort((a, b) => key(a) - key(b) || a.avg - b.avg);
}

/**
 * Comp fixada, guardada por partida, com as substituições aplicadas sobre ela (`swaps`: [{out, in}]).
 * Escolhida fora de partida ("lobby") vale para a próxima que começar; escolhida numa partida some quando
 * ela termina. `storage` segue a interface de localStorage.
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
      if (v.match !== matchKey) {
        if (v.match !== "lobby" || matchKey === "lobby") {
          write(null);
          return null;
        }
        write({ ...v, match: matchKey });
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
