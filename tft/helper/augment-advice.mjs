// Classifica as opções de aprimoramento lidas da tela. Com dados (augment-stats.mjs), a ordem é a colocação
// esperada: a média medida do aprimoramento quando escolhido nesta rodada (NoxuTFT, encolhida para a média geral
// quando a amostra é pequena) mais o tier dele na comp do seu plano (MetaTFT). Sem dados, vale o encaixe na comp
// e no momento da partida (sinergia, campeões citados, HP, ouro, estágio, itens), que fica como explicação.
import { TIER_PLACE } from "./augment-stats.mjs";
import { POLICY } from "./core/economy/policy.mjs";
const BASE_PLACE = 4.47,
  SHRINK_GAMES = 300;
const fold = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
/** `choices` são entradas de augments.json; `plan` é a comp alvo; devolve as opções ordenadas com motivos. */
export function augmentAdvice(
  choices,
  plan,
  analysis,
  catalog,
  options,
  localNames = {},
) {
  if (!choices?.length || !plan) return null;
  const traitByApi = new Map(catalog.traits.map((t) => [t.apiName, t.name]));
  const goal = new Map((plan.traits ?? []).map((t) => [t.name, t])),
    field = new Map(
      (analysis.currentPlan?.traits ?? []).map((t) => [t.name, t]),
    );
  const tips = new Map((plan.synergyTips ?? []).map((t) => [t.trait, t]));
  // Caminho já escolhido nesta partida: sinergias dos aprimoramentos anteriores, para seguir a mesma linha.
  const picked = options.chosenAugments ?? [],
    pathTraits = new Map();
  for (const a of picked)
    for (const api of a.traits ?? []) {
      const name = traitByApi.get(api);
      if (name && !pathTraits.has(name)) pathTraits.set(name, a.name);
    }
  const hp = analysis.self.health,
    gold = options.gold,
    stage = options.stage?.stage ?? null,
    itemCount =
      analysis.self.units.reduce((n, u) => n + (u.itemNames?.length ?? 0), 0) +
      (options.inventory?.length ?? 0);
  // Colocação esperada medida: média na rodada (ou geral), encolhida pela amostra, mais o tier na comp do plano.
  const round = { 2: "2-1", 3: "3-2", 4: "4-2" }[stage] ?? null,
    cluster = plan.meta?.id ?? null;
  function measuredFor(id) {
    const m = options.augmentStats?.augments?.[id],
      tier = cluster
        ? (options.augmentStats?.compTiers?.[cluster]?.[id] ?? null)
        : null;
    if (!m && !tier) return { expected: null, measured: null };
    // Média geral encolhida pelo total; a da rodada entra como desvio sobre ela, encolhido pela amostra da rodada.
    // A Noxu não publica a contagem por rodada: divide o total igualmente entre as rodadas com média (aproximação).
    const avg = m?.avg ?? null,
      games = m?.games ?? 0,
      atR = round ? (m?.at?.[round] ?? null) : null,
      rounds = m?.at ? Object.values(m.at).filter((v) => v != null).length : 0,
      rGames = atR != null ? games / Math.max(1, rounds) : games,
      shrink = (v, n, to) => (v * n + to * SHRINK_GAMES) / (n + SHRINK_GAMES),
      base = avg != null ? shrink(avg, games, BASE_PLACE) : BASE_PLACE,
      place =
        atR == null
          ? base
          : avg != null
            ? base + ((atR - avg) * rGames) / (rGames + SHRINK_GAMES)
            : shrink(atR, rGames, BASE_PLACE),
      adj = tier ? (TIER_PLACE[tier] ?? 0) : 0;
    return {
      expected: Math.round((place + adj) * 100) / 100,
      measured: m
        ? {
            avg: atR ?? avg,
            games: Math.round(rGames),
            gamesEstimated: atR != null && rounds > 1,
            round: atR != null ? round : null,
            top4: m.top4,
          }
        : null,
      tier,
    };
  }
  const ranked = choices.map((a) => {
    let score = 0;
    const reasons = [],
      text = fold(a.name + " " + a.desc);
    for (const api of a.traits) {
      const name = traitByApi.get(api);
      if (!name) continue;
      const g = goal.get(name),
        f = field.get(name);
      if (g) {
        score += 6 + (g.active ? 2 : 0);
        reasons.push(
          `${name} está na sua comp alvo (${g.count} unidades${g.active ? ", ativa" : ""}).`,
        );
        if (f?.count) score += Math.min(4, f.count);
      } else {
        score -= 5;
        reasons.push(
          `Exige ${name}, que não está na sua comp alvo: só vale se você mudar de comp.`,
        );
      }
      const from = pathTraits.get(name);
      if (from) {
        score += 4;
        reasons.push(`Segue o seu caminho: ${from} já puxa ${name}.`);
      }
      const tip = tips.get(name);
      if (tip && /emblema|emblem/.test(text)) {
        score += 5;
        reasons.push(`Um emblema fecha ${name} ${tip.next}.`);
      }
    }
    const named = plan.board.filter((u) => {
      const pt = fold(localNames[u.id] ?? ""),
        en = fold(u.name);
      return (
        (pt.length > 2 && text.includes(pt)) ||
        (en.length > 2 && text.includes(en))
      );
    });
    if (named.length) {
      score += named.length * 2;
      reasons.push(
        "Cita campeões da sua comp: " +
          named.map((u) => u.name).join(", ") +
          ".",
      );
    }
    if (/\bouro\b|juros|gold/.test(text)) {
      const v =
        hp >= POLICY.hp.hurt && (stage === null || stage <= 3)
          ? 3
          : hp < POLICY.hp.shaky
            ? -2
            : 1;
      score += v;
      reasons.push(
        v > 0
          ? "Economia: você tem vida para aproveitar ouro extra."
          : "Economia rende pouco com a vida baixa.",
      );
    }
    if (/componente|item completo|forja|bigorna|component|anvil/.test(text)) {
      const v = itemCount < 6 ? 3 : 1;
      score += v;
      reasons.push(itemCount < 6 ? "Dá itens e você tem poucos." : "Dá itens.");
    }
    if (/\bvida\b|cura|escudo|heal|shield/.test(text) && hp < POLICY.hp.weak) {
      score += 2;
      reasons.push("Sustentação ajuda com a vida baixa.");
    }
    if (
      /experiencia|\bxp\b|nivel/.test(text) &&
      plan.strategy?.finalLevel >= 9
    ) {
      score += 2;
      reasons.push("Acelera nível numa comp que quer chegar ao 9.");
    }
    if (/atualizac(ao|oes) da loja|rolagens?|rerolls?|refresh/.test(text)) {
      const at = Number(/nivel (\d+)/.exec(text)?.[1] ?? 0),
        rollAt = Number(plan.strategy?.rollAt ?? 0);
      if (at && at === rollAt) {
        score += 7;
        reasons.push(
          `Rolagens grátis no nível ${at}, que é exatamente o nível de roll desta comp.`,
        );
      } else {
        score += 2;
        reasons.push(
          at
            ? `Rolagens grátis no nível ${at}; sua comp rola no nível ${rollAt || "?"}.`
            : "Dá rolagens de loja.",
        );
      }
    }
    if (!reasons.length)
      reasons.push("Sem ligação direta com a sua comp; efeito genérico.");
    return {
      id: a.id,
      name: a.name,
      desc: a.desc,
      score: Math.round(score * 10) / 10,
      reasons,
      ...measuredFor(a.id),
    };
  });
  // Com algum dado medido, quem não tem dado recebe o mesmo prior do encolhimento (média geral), marcado como
  // estimado; a ordem é toda pela colocação esperada e o encaixe só desempata. Sem dado, vale o encaixe.
  const measured = ranked.some((c) => c.expected != null);
  if (measured)
    for (const c of ranked)
      if (c.expected == null)
        Object.assign(c, { expected: BASE_PLACE, estimated: true });
  ranked.sort(
    measured
      ? (a, b) => a.expected - b.expected || b.score - a.score
      : (a, b) => b.score - a.score,
  );
  for (const c of ranked)
    c.reroll =
      c !== ranked[0] &&
      (measured ? c.expected >= BASE_PLACE + 0.1 : c.score <= 1);
  const tied =
    ranked.length > 1 &&
    (measured
      ? ranked[1].expected - ranked[0].expected < 0.05
      : ranked[0].score - ranked[1].score < 1);
  return {
    choices: ranked,
    pick: tied ? null : ranked[0].id,
    key: choices
      .map((c) => c.id)
      .sort()
      .join("|"),
    comp: plan.title,
    note:
      (tied ? "As melhores opções empatam; escolha pelo efeito. " : "") +
      (measured
        ? "Ordem pela colocação esperada: média medida do aprimoramento nesta rodada (NoxuTFT) mais o tier dele na sua comp (MetaTFT). "
        : "Ordem pelo encaixe na sua comp e no momento da partida, sem dado medido. ") +
      "Cada card pode ser trocado uma vez no jogo: troque os marcados antes de escolher; o popup se atualiza com o card novo.",
  };
}
