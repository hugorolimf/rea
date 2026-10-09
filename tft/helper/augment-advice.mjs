// Classifica as opções de aprimoramento lidas da tela pelo encaixe na sua comp e no momento da partida.
// Não há taxa de vitória por aprimoramento aqui (a fonte de meta não respondeu para esse dado): a ordem vem
// só de sinergia com a comp, campeões citados e do estado lido (HP, ouro, estágio, itens). É regra de bolso.
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
  const hp = analysis.self.health,
    gold = options.gold,
    stage = options.stage?.stage ?? null,
    itemCount =
      analysis.self.units.reduce((n, u) => n + (u.itemNames?.length ?? 0), 0) +
      (options.inventory?.length ?? 0);
  const ranked = choices
    .map((a) => {
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
          hp >= 60 && (stage === null || stage <= 3) ? 3 : hp < 40 ? -2 : 1;
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
        reasons.push(
          itemCount < 6 ? "Dá itens e você tem poucos." : "Dá itens.",
        );
      }
      if (/\bvida\b|cura|escudo|heal|shield/.test(text) && hp < 50) {
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
        const at = Number(/nivel (d+)/.exec(text)?.[1] ?? 0),
          rollAt = Number(
            /(d+)/.exec(plan.strategy?.panels?.rolling?.value ?? "")?.[1] ?? 0,
          );
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
      };
    })
    .sort((a, b) => b.score - a.score);
  for (const c of ranked) c.reroll = c.score <= 1 && c !== ranked[0];
  const tied = ranked.length > 1 && ranked[0].score - ranked[1].score < 1;
  return {
    choices: ranked,
    pick: tied ? null : ranked[0].id,
    key: choices
      .map((c) => c.id)
      .sort()
      .join("|"),
    comp: plan.title,
    note:
      (tied
        ? "As melhores opções empatam pelo encaixe na comp; escolha pelo efeito. "
        : "") +
      "Ordem pelo encaixe na sua comp e no momento da partida, sem taxa de vitória. Cada card pode ser trocado uma vez no jogo: troque os marcados antes de escolher; o popup se atualiza com o card novo.",
  };
}
