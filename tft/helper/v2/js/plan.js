/**
 * Visão do checklist do plano em andamento (`planProgress` de /api/recommend): converte o estado do servidor em
 * textos e estados que a seção "Plano" desenha. Pura: não decide nada de jogo, só apresenta o que o servidor guardou.
 */
const STATUS_TEXT = {
  done: "feito",
  partial: "em andamento",
  missing: "falta",
  built: "montado",
  ready: "montar agora",
  move: "já tem: passar",
};
const n1 = (x) =>
  typeof x === "number" ? x.toFixed(2).replace(".", ",") : "?";

/** Texto da peça: "Cinderling 1→2★ · 2/3 cópias", ou "2★ · feito". */
export function unitLine(u) {
  if (u.status === "done") return `${u.stars}★ feito`;
  const goal = `${u.stars > 0 ? u.stars : 0}→${u.targetStars}★`;
  if (u.status === "missing")
    return u.boughtUpTo
      ? `${goal} · comprada ${u.boughtUpTo}× (pode estar na reserva)`
      : `${goal} · falta`;
  return `${goal} · ${u.copies}/${u.need} cópias`;
}

/** Nota do desafiante que ainda não passou da confirmação, ou null. */
export function challengerNote(c) {
  if (!c) return null;
  const margin =
    typeof c.noise === "number" && typeof c.cost === "number"
      ? c.noise + c.cost
      : null;
  return `${c.title} lidera por ${n1(c.gain)}º${margin !== null ? ` (precisa passar de ${n1(margin)}º)` : ""} · confirmando ${c.readings}/${c.need.readings} leituras, ${c.rounds}/${c.need.rounds} rodadas. O plano atual segue até confirmar.`;
}

/** Quando o plano foi adotado: "desde 2-3 (nível 4)" ou "nesta partida" sem estágio lido. */
export function sinceText(since) {
  if (!since) return "";
  const where = since.stage ? `desde ${since.stage}` : "nesta partida";
  return since.level ? `${where} · nível ${since.level}` : where;
}

/**
 * Modelo da seção. `null` quando não há plano; `live` esmaece as ações quando a leitura não é de partida em andamento.
 */
export function planView(progress, live = true) {
  if (!progress?.plan) return null;
  const { plan, summary, level, gold } = progress;
  return {
    title: plan.title,
    pinned: !!plan.pinned,
    since: sinceText(plan.since),
    pct: summary?.pct ?? 0,
    done: summary?.done ?? 0,
    total: summary?.total ?? 0,
    live,
    challenger: challengerNote(progress.challenger),
    next: (progress.next ?? []).map((s) => ({ kind: s.kind, text: s.text })),
    units: (progress.units ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      cost: u.cost,
      carry: u.carry,
      status: u.status,
      statusText: STATUS_TEXT[u.status] ?? u.status,
      line: unitLine(u),
      fraction: u.need ? Math.min(1, u.copies / u.need) : 0,
      lost: !!u.lost,
      where: u.where,
    })),
    items: (progress.items ?? []).map((i) => ({
      key: i.key,
      unitId: i.unitId,
      unit: i.unit,
      itemId: i.itemId,
      name: i.name,
      status: i.status,
      statusText: STATUS_TEXT[i.status] ?? i.status,
      missing: i.missing ?? [],
      from: i.from ?? null,
    })),
    augments: (progress.augments ?? []).map((a) => ({
      round: a.round,
      name: a.name,
      status: a.status,
      text: a.name ?? (a.status === "now" ? "escolha agora" : "a escolher"),
    })),
    level: level && {
      status: level.status,
      text:
        level.now == null
          ? "nível não lido"
          : level.target == null
            ? `nível ${level.now}`
            : `nível ${level.now} de ${level.target}`,
    },
    gold: gold && {
      status: gold.status,
      text:
        gold.now == null
          ? "ouro não lido"
          : `${gold.now}g${gold.interestAt != null ? ` · próximo juros em ${gold.interestAt}g` : " · juros no máximo"}${gold.floor != null ? ` · piso ${gold.floor}g` : ""}`,
    },
    changes: (progress.changes ?? []).map((c) => ({
      text: c.text,
      stage: c.stage ?? null,
      type: c.type,
    })),
  };
}
