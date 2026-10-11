/**
 * Visão do checklist do plano em andamento (`planProgress` de /api/recommend): converte o estado do servidor em
 * textos e estados que a seção "Plano" desenha. Pura: não decide nada de jogo, só apresenta o que o servidor guardou.
 */
import { ownership } from "./roster.js";

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

/**
 * Texto da peça: "Cinderling 1→2★ · 2/3 cópias", ou "2★ · feito". `own` (opcional) é `ownership` de roster.js (campo e
 * reserva lidos agora): com cópia na reserva, a linha diz onde ("na reserva", "2 cópias: 1 em campo, 1 na reserva").
 */
export function unitLine(u, own = null) {
  const where =
    own?.state === "reserve" || own?.state === "both" ? own.label : "";
  if (u.status === "done")
    return `${u.stars}★ feito${where ? ` · ${where}` : ""}`;
  const goal = `${u.stars > 0 ? u.stars : 0}→${u.targetStars}★`;
  if (u.status === "missing")
    return where
      ? `${goal} · ${where}`
      : u.boughtUpTo
        ? `${goal} · comprada ${u.boughtUpTo}×${own?.state === "absent" ? " (não está em campo nem na reserva)" : " (pode estar na reserva)"}`
        : `${goal} · falta`;
  return `${goal} · ${u.copies}/${u.need} cópias${where ? ` · ${where}` : ""}`;
}

/**
 * Por que o plano segue no Ao vivo mesmo com outra comp à frente, em uma linha, ou null (plan-state.mjs):
 * - `pending: false`: a outra lidera em colocação esperada (E), mas não passa do custo de trocar + a margem fixa;
 * - `pending` (true): passou, e espera um fato novo (loja, compra, rodada, nível...) para confirmar; reler não conta.
 * Os números são colocações esperadas (a medida que ordena a lista). Nota antiga (sem `unit: "placement"`) mostra só a
 * vantagem.
 */
export function challengerNote(c) {
  if (!c) return null;
  const pos = (x) => (typeof x === "number" ? n1(x) : "?"),
    exp = c.unit === "placement" && typeof c.expectedTo === "number",
    margin = typeof c.cost === "number" ? c.cost + (c.hysteresis ?? 0) : null,
    lead = exp
      ? `${c.title} espera ${pos(c.expectedTo)}º contra ${pos(c.expectedFrom)}º do plano (${pos(c.gain)} melhor)`
      : `${c.title} lidera por ${pos(c.gain)}`,
    need =
      margin === null
        ? ""
        : ` · trocar custa ${pos(c.cost)}${c.hysteresis ? ` + margem ${pos(c.hysteresis)}` : ""}`;
  if (c.pending === false) return `Mantido: ${lead}${need}.`;
  return `Mantido: ${lead}${need} · troca no próximo fato novo (loja, compra, rodada ou nível) se continuar à frente.`;
}

/** Quando o plano foi adotado: "desde 2-3 (nível 4)" ou "nesta partida" sem estágio lido. */
export function sinceText(since) {
  if (!since) return "";
  const where = since.stage ? `desde ${since.stage}` : "nesta partida";
  return since.level ? `${where} · nível ${since.level}` : where;
}

/**
 * Modelo da seção. `null` quando não há plano; `live` esmaece as ações quando a leitura não é de partida em andamento.
 * `roster` (opcional, `rosterOf` de roster.js): onde estão as suas peças agora, para a linha de cada peça.
 */
export function planView(progress, live = true, roster = null) {
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
    // Alcance do plano em uma linha (servidor: core/comps/reach.mjs), ou null.
    reach: typeof progress.reach === "string" ? progress.reach : null,
    next: (progress.next ?? []).map((s) => ({ kind: s.kind, text: s.text })),
    units: (progress.units ?? []).map((u) => {
      const own = roster ? ownership(roster, u.id) : null;
      return {
        id: u.id,
        name: u.name,
        cost: u.cost,
        carry: u.carry,
        status: u.status,
        statusText: STATUS_TEXT[u.status] ?? u.status,
        line: unitLine(u, own),
        fraction: u.need ? Math.min(1, u.copies / u.need) : 0,
        lost: !!u.lost,
        where: u.where,
        own: own?.state ?? null,
      };
    }),
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
