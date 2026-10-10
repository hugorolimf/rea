// Disputa da comp alvo: quem no lobby está jogando as mesmas peças e, se a disputa for séria, qual comp de
// meta parecida e menos disputada vale a troca. Usa só tabuleiros observados (bancos rivais não aparecem),
// então a disputa real costuma ser maior que a medida.

const copies = (stars) => 3 ** Math.max(0, (stars ?? 1) - 1);

/**
 * `plan`: comp exibida ({board:[{id,name}], carry}); `opponents`: rivais vivos ({name, units:[{id,stars}]});
 * `ranking`: compRanking do motor ({id, dispute, total, owned, size, evidence});`comps`: comps de meta ({id, title,
 * carry, units}); `mine`: ids das suas peças em campo (o investimento já feito); `stage`: {stage, round} lido
 * (troca tardia custa caro).
 * Devolve null quando não há disputa relevante, ou {level, rivals, alternative}.
 */
export function contestAlert({
  plan,
  opponents = [],
  ranking = [],
  comps = [],
  mine = [],
  stage = null,
}) {
  const board = plan?.board ?? [];
  if (board.length < 4 && mine.length < 4) return null;
  // Peças disputáveis: as da comp alvo e as que você já tem em campo (é nelas que a disputa dói).
  const ids = new Set([...board.map((u) => u.id), ...mine]),
    carryId = board.find((u) => u.name === plan.carry)?.id ?? null;
  const rivals = opponents
    .map((o) => {
      const shared = new Map();
      for (const u of o.units ?? [])
        if (ids.has(u.id))
          shared.set(u.id, (shared.get(u.id) ?? 0) + copies(u.stars));
      return {
        name: o.name,
        shared: [...shared.keys()],
        copies: [...shared.values()].reduce((a, b) => a + b, 0),
        carry: carryId !== null && shared.has(carryId),
      };
    })
    .filter((r) => r.shared.length)
    .sort(
      (a, b) =>
        Number(b.carry) - Number(a.carry) || b.shared.length - a.shared.length,
    );
  const top = rivals[0];
  if (!top) return null;
  // Alta: alguém joga o seu carry e pelo menos 3 peças, ou 4+ peças; média: carry ou 3 peças.
  const level =
    (top.carry && top.shared.length >= 3) || top.shared.length >= 4
      ? "high"
      : top.carry ||
          top.shared.length >= 3 ||
          rivals.filter((r) => r.shared.length >= 2).length >= 2
        ? "medium"
        : null;
  if (!level) return null;
  // Troca só faz sentido até o meio da partida; depois disso a sugestão é segurar e buscar 2★.
  const late = (stage?.stage ?? 0) >= 4;
  const contested = new Set(rivals.flatMap((r) => r.shared));
  // Com evidência, o total das comps medidas está noutra escala (colocação esperada) e só elas concorrem,
  // como no motor; offline vale o total heurístico. A ordem do ranking não é a do total: usa o máximo.
  const measured = ranking.some((r) => r.evidence);
  const pool = measured ? ranking.filter((r) => r.evidence) : ranking;
  const best = pool.length ? Math.max(...pool.map((r) => r.total)) : 0;
  const alternative = late
    ? null
    : (pool
        .map((r) => {
          const comp = comps.find((c) => c.id === r.id);
          if (!comp || comp.carry === carryId) return null;
          const overlap = comp.units.filter((u) => contested.has(u)).length;
          return { r, comp, overlap };
        })
        .filter(
          (x) =>
            x &&
            x.overlap <= 1 &&
            !contested.has(x.comp.carry) &&
            x.r.total >= best - Math.max(15, Math.abs(best) * 0.2),
        )
        .sort((a, b) => b.r.owned - a.r.owned || b.r.total - a.r.total)[0] ??
      null);
  return {
    level,
    late,
    rivals: rivals.slice(0, 3),
    alternative: alternative && {
      id: alternative.comp.id,
      title: alternative.comp.title,
      carry: alternative.comp.carry,
      owned: alternative.r.owned,
      size: alternative.r.size,
      overlap: alternative.overlap,
    },
  };
}
