/**
 * Selos ancorados nos controles do próprio TFT (modo integrado): o veredito de rolagem sobre o botão "Atualizar"
 * (reroll), o de nível sobre o botão "Comprar XP" e o ouro que convém ter guardado ao lado do número de ouro do jogo.
 * Substituem o cartão "Vale rolar?" e a faixa de estado da coluna: a decisão fica onde o jogador clica.
 *
 * Não decide nada: o veredito de rolagem (`strategy.panels.rolling.call`), o de nível (`strategy.panels.leveling`) e o
 * piso de ouro (`strategy.panels.economy`: `keep`/`floor` e a faixa de vida) vêm prontos da análise pelo modelo de tela
 * (`view.mjs`). A curva padrão de nível (`POLICY.curve`, core/economy/policy.mjs) e os juros (`interestOf`,
 * core/economy/gold.mjs) entram por injeção, só para escrever "espere 4-1" e "50g dá +5". Puro: sem DOM e sem imports
 * (as posições vêm de `geometry.mjs` pelo chamador). A explicação de cada selo vai no `title` (dica do mouse, visível no
 * modo de edição) e no painel "?". Nada aqui clica ou digita no jogo.
 */

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Onde cada selo mora (`resolveAnchor` de geometry.mjs) e de que lado do alvo ele fica. */
export const BADGE_ANCHORS = Object.freeze({
  roll: Object.freeze({ kind: "reroll", side: "left" }),
  level: Object.freeze({ kind: "xpButton", side: "left" }),
  gold: Object.freeze({ kind: "gold", side: "right" }),
});

/** Medidas do selo na escala base (multiplicadas por `--k`). */
export const BADGE = Object.freeze({
  padX: 6,
  padY: 3,
  line: 15,
  subLine: 13,
  charW: 6.6,
  gap: 6,
});

const pct = (v) => {
  const n = num(v);
  if (n === null) return null;
  return Math.round(n <= 1 ? n * 100 : n);
};

/** Estágio `{ stage, round }` (o relógio da partida já lido, `view.bar.at`) em número comparável; null sem ele. */
const stageKey = (at) =>
  num(at?.stage) !== null && num(at?.round) !== null
    ? at.stage * 100 + at.round
    : null;

/** Custo de uma rolagem da loja (ouro). */
const REROLL_COST = 2;
/** "role 1 vez" / "role 12 vezes". */
const rollsText = (n) => `role ${n} ${n === 1 ? "vez" : "vezes"}`;

/**
 * Selo do botão "Atualizar": o veredito único do servidor em poucas palavras, na cor dele. Quando o veredito é rolar,
 * diz POR QUEM rolar: os alvos (retratos com a estrela-alvo, o primeiro em destaque) e o orçamento ("↻ [Kayle 3★]
 * [Azir 2★] role 12×"); a dica lista cada alvo com as cópias, a chance com o orçamento e os rivais. `roll`: `view.roll`.
 * O orçamento vira número de rolagens (cada uma custa 2g): `spend.shops` do servidor ou o ouro ÷ 2.
 * Devolve `{ id: "roll", text, sub, tone, why, targets, budget, rolls }` ou null.
 */
export function rollBadge(roll) {
  if (!roll) return null;
  const gold = num(roll.spend?.gold) ?? num(roll.budget);
  const rolls =
    num(roll.spend?.shops) ??
    (gold !== null ? Math.floor(gold / REROLL_COST) : null);
  const main =
    roll.main && str(roll.main.name) && pct(roll.mainChance) !== null
      ? `${roll.main.stars ? `${roll.main.stars}★ ` : ""}${roll.main.name} ${pct(roll.mainChance)}%`
      : null;
  const rolling = roll.kind === "go" || roll.kind === "danger";
  const list = rolling
    ? (Array.isArray(roll.targets) ? roll.targets : []).filter((t) =>
        str(t?.id),
      )
    : [];
  // A estrela-alvo do retrato: "3★", ou "novo" para peça que falta.
  const goalOf = (t) =>
    str(t.goalText) === "falta"
      ? "novo"
      : (str(t.goalText) ?? (num(t.goal) ? `${t.goal}★` : null));
  const targets = list.map((t) => ({
    id: t.id,
    name: str(t.name) ?? t.id,
    goal: goalOf(t),
  }));
  const tail = rolls ? rollsText(rolls) : "";
  const named = () =>
    `↻ ${targets.map((t) => `${t.name}${t.goal ? ` ${t.goal}` : ""}`).join(" ")}${tail ? ` ${tail}` : ""}`;
  let text, tone;
  switch (roll.kind) {
    case "go":
      text = targets.length
        ? named()
        : gold !== null
          ? `↻ ${tail || "role"}`
          : "↻ role";
      tone = "go";
      break;
    case "danger":
      text = targets.length
        ? named()
        : gold !== null
          ? `↻ ${tail || "role"}`
          : "↻ estabilize";
      tone = "danger";
      break;
    case "wait":
      text = roll.at != null ? `↻ espere o nível ${roll.at}` : "↻ espere";
      tone = "info";
      break;
    case "hold":
      text = "↻ não role";
      tone = "info";
      break;
    case "blocked":
      text = "↻ sem peça viável";
      tone = "info";
      break;
    case "none":
      text = "↻ nada a evoluir";
      tone = "info";
      break;
    case "unknown":
      text = "↻ ouro ?";
      tone = "info";
      break;
    default:
      if (!roll.pill) return null;
      text = `↻ ${roll.pill}`;
      tone = "info";
  }
  // Cada alvo na dica: a frase do servidor ou a montada (estrela, chance com o orçamento), as cópias, os rivais e o motivo.
  const targetLines = list.map((t) =>
    [
      str(t.text) ??
        [
          `${t.name ?? t.id}${goalOf(t) ? ` ${goalOf(t)}` : ""}`,
          pct(t.chance) !== null
            ? `${pct(t.chance)}%${gold !== null ? ` com ${gold}g` : ""}`
            : null,
        ]
          .filter(Boolean)
          .join(", "),
      str(t.haveText) ? `${t.haveText} cópias` : null,
      num(t.rivals) !== null
        ? `${t.rivals} ${t.rivals === 1 ? "rival" : "rivais"}`
        : null,
      str(t.why),
    ]
      .filter(Boolean)
      .join(", "),
  );
  const why = [
    str(roll.title),
    rolling ? str(roll.forText) : null,
    str(roll.reason),
    ...targetLines,
    rolls ? `${rollsText(rolls)} (${rolls * REROLL_COST}g)` : null,
    roll.spend?.keep != null ? `pare em ${roll.spend.keep}g` : null,
    roll.interest
      ? `rolar derruba os juros de +${roll.interest.from} para +${roll.interest.to}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Sem a lista de alvos, a peça que a rolagem busca e a chance dela vêm embaixo.
  const sub = rolling && !targets.length ? main : null;
  return {
    id: "roll",
    text,
    sub,
    tone,
    why,
    targets,
    budget: rolling ? gold : null,
    rolls: rolling ? rolls : null,
  };
}

/**
 * Cartas de alvos da rolagem que estão na loja agora ("achou: Kayle"), uma por carta, ancoradas no cartão da loja. Só
 * quando o veredito é rolar (go/danger). `roll`: `view.roll` (`found`: `[{ id, name, slots }]`).
 */
export function foundBadges(roll) {
  if (!roll || (roll.kind !== "go" && roll.kind !== "danger")) return [];
  const out = [];
  for (const h of Array.isArray(roll.found) ? roll.found : [])
    for (const slot of Array.isArray(h?.slots) ? h.slots : [])
      if (Number.isInteger(slot) && slot >= 1 && slot <= 5)
        out.push({
          id: `found:${slot}`,
          text: `achou: ${h.name ?? h.id}`,
          sub: null,
          tone: "go",
          why: `${h.name ?? h.id} é alvo da rolagem e está na loja (slot ${slot}): compre`,
          anchor: { kind: "shop", slot },
          side: "top",
          unit: { id: h.id, name: h.name ?? h.id },
        });
  return out;
}

/**
 * Próximo estágio da curva padrão em que o nível passa de `level` (`curve`: `POLICY.curve`, `[estágio, rodada,
 * nível]`), como `{ stage, round, text: "4-1" }`; null se não houver.
 */
export function curveStageFor(level, curve = []) {
  const lv = num(level);
  if (lv === null) return null;
  for (const e of Array.isArray(curve) ? curve : [])
    if (Array.isArray(e) && num(e[2]) !== null && e[2] >= lv + 1)
      return { stage: e[0], round: e[1], text: `${e[0]}-${e[1]}` };
  return null;
}

/**
 * Selo do botão "Comprar XP": "↑ suba agora" com o custo, ou "↑ espere 4-1" (o estágio em que a curva padrão chega ao
 * próximo nível). `level`: `view.level`; `stage`: estágio lido (`{ stage, round }`, `view.bar.at`); `curve`: `POLICY.curve`. Devolve o selo ou null.
 */
export function levelBadge(level, { stage = null, curve = [] } = {}) {
  if (!level || num(level.level) === null) return null;
  const cost = num(level.cost);
  const costText = cost !== null ? ` · ${cost}g` : "";
  const why = [str(level.verdict), str(level.text)].filter(Boolean).join(" · ");
  if (level.go)
    return {
      id: "level",
      text: `↑ suba agora${costText}`,
      sub: null,
      tone: "go",
      why,
    };
  // Decisão da rodada (core/turn): o "não suba" e o "espere quando" vêm dela, não da curva calculada aqui.
  if (level.turn) {
    if (level.turn.done)
      return {
        id: "level",
        text: "↑ não suba",
        sub: null,
        tone: "info",
        why: why || `Nível final desta comp: ${level.finalLevel}.`,
      };
    const next = level.turn.next;
    return {
      id: "level",
      text: `↑ espere${next?.when ? ` ${next.when}` : ""}`,
      sub: null,
      tone: "info",
      why: [why, next?.why ?? null].filter(Boolean).join(" · "),
    };
  }
  if (num(level.finalLevel) !== null && level.level >= level.finalLevel)
    return {
      id: "level",
      text: "↑ não suba",
      sub: null,
      tone: "info",
      why: why || `Nível final desta comp: ${level.finalLevel}.`,
    };
  if (level.passive)
    return {
      id: "level",
      text: "↑ espere: XP passivo",
      sub: null,
      tone: "info",
      why,
    };
  const at = curveStageFor(level.level, curve);
  const later =
    at && (stageKey(stage) === null || stageKey(at) > stageKey(stage));
  return {
    id: "level",
    text: `↑ espere${later ? ` ${at.text}` : ""}${costText}`,
    sub: null,
    tone: "info",
    why: [
      why,
      later
        ? `Na curva padrão o nível ${level.level + 1} vem em ${at.text}.`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * Selo do ouro: o ouro que convém ter guardado agora (o piso da decisão: `economy.keep`, ou o piso da faixa de vida
 * `economy.floor`), verde no piso ou acima e âmbar abaixo. A dica diz o motivo: juros ou vida em perigo. `economy`:
 * `view.economy`; `gold`: ouro lido; `interestOf`: juros por ouro (core/economy/gold.mjs). Devolve o selo ou null.
 */
export function goldBadge(economy, { gold = null, interestOf = null } = {}) {
  if (!economy) return null;
  const floor = num(economy.keep) ?? num(economy.floor);
  if (floor === null) return null;
  const have = num(gold) ?? num(economy.gold);
  const danger =
    economy.pressure === "danger" || economy.pressure === "critical";
  const interest =
    typeof interestOf === "function" ? num(interestOf(floor)) : null;
  const why = danger
    ? `vida em perigo: gaste até ${floor}g`
    : `juros: ${floor}g dá +${interest ?? "?"}`;
  return {
    id: "gold",
    text: `⚑ ${floor}g`,
    sub: null,
    tone: have === null ? "info" : have >= floor ? "go" : "amber",
    why: [
      why,
      have !== null
        ? have >= floor
          ? `você tem ${have}g: no piso ou acima`
          : `você tem ${have}g: abaixo do piso`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * Selos do modelo de tela, na ordem rolar, nível, ouro. Só com a partida ao vivo e a análise pronta (`view.status`
 * "ready" e a faixa "ao vivo"); fora disso, nenhum. `opts`: `{ curve, interestOf }`. Cada selo ganha a âncora
 * (`BADGE_ANCHORS`). Nunca lança.
 */
export function buildBadges(view, opts = {}) {
  try {
    if (view?.status !== "ready" || view.bar?.live?.kind !== "live") return [];
    const list = [
      rollBadge(view.roll),
      ...foundBadges(view.roll),
      levelBadge(view.level, { stage: view.bar?.at, curve: opts.curve }),
      goldBadge(view.economy, {
        gold: view.bar?.gold?.value,
        interestOf: opts.interestOf,
      }),
    ].filter(Boolean);
    return list.map((b) => ({
      ...b,
      anchor: b.anchor ?? { kind: BADGE_ANCHORS[b.id].kind },
      side: b.side ?? BADGE_ANCHORS[b.id].side,
    }));
  } catch {
    return [];
  }
}

/** Tamanho do selo em px do palco (já com `k`). `measure(texto)`: largura na escala base. */
export function badgeSize(
  badge,
  k = 1,
  measure = (t) => String(t ?? "").length * BADGE.charW,
) {
  // Com alvos, cada nome vira um retrato (~22 px) mais a estrela.
  const main = badge.targets?.length
    ? measure(`↻ ${badge.rolls ? rollsText(badge.rolls) : ""}`) +
      badge.targets.length * (22 + 3 * BADGE.charW)
    : measure(badge.text);
  const w = Math.max(main, badge.sub ? measure(badge.sub) : 0);
  const h = BADGE.line + (badge.sub ? BADGE.subLine : 0);
  return {
    width: (w + BADGE.padX * 2) * k,
    height: (h + BADGE.padY * 2) * k,
  };
}

/**
 * Posição de cada selo junto ao seu alvo: `rects` de `anchorRects`, `stage` `{width,height}`; `opts`: `{ k, measure,
 * resolveAnchor, placeLabel }` (as duas últimas de geometry.mjs, injetadas). Selo sem alvo fica de fora. Devolve
 * `[{ ...selo, x, y, width, height, target }]`.
 */
export function placeBadges(badges, rects, stage, opts = {}) {
  const { k = 1, measure, resolveAnchor, placeLabel } = opts;
  if (
    !rects ||
    typeof resolveAnchor !== "function" ||
    typeof placeLabel !== "function"
  )
    return [];
  const out = [];
  for (const b of Array.isArray(badges) ? badges : []) {
    const target = resolveAnchor(b.anchor, rects);
    if (!target) continue;
    const size = badgeSize(b, k, measure);
    const p = placeLabel(target, size, stage, b.side, BADGE.gap * k);
    out.push({ ...b, x: p.x, y: p.y, side: p.side, ...size, target });
  }
  return out;
}

/**
 * HTML dos selos posicionados. `ui`: `{ esc, richText }` (o nome da peça buscada vira retrato). Cada selo leva a
 * explicação no `title` e para o leitor de tela.
 */
export function drawBadges(placed, ui) {
  const { esc, richText, portrait } = ui;
  const px = (v) => `${Math.round(v * 10) / 10}px`;
  // Alvos da rolagem: retratos pequenos com a estrela-alvo, o primeiro em destaque.
  const targetsHtml = (b) =>
    b.targets
      .map(
        (t, i) =>
          `<span class="badge-t" data-first="${i === 0 ? 1 : 0}" title="${esc(t.name)}${t.goal ? ` ${esc(t.goal)}` : ""}">${typeof portrait === "function" ? portrait(t.id, t.name, { size: i === 0 ? 22 : 18, hidden: true }) : esc(t.name)}${t.goal ? `<i class="badge-st">${esc(t.goal)}</i>` : ""}</span>`,
      )
      .join("");
  const label = (b) =>
    b.targets?.length
      ? `↻ ${targetsHtml(b)}${b.rolls ? ` ${esc(rollsText(b.rolls))}` : ""}`
      : b.unit && typeof richText === "function"
        ? richText(b.text, { size: 16 })
        : esc(b.text);
  return (Array.isArray(placed) ? placed : [])
    .map(
      (b) =>
        `<div class="badge" data-id="${esc(b.id)}" data-tone="${esc(b.tone)}" data-side="${esc(b.side)}" style="left:${px(b.x)};top:${px(b.y)}" title="${esc(b.why)}"><b class="badge-tx">${label(b)}</b>${b.sub ? `<small class="badge-sub">${typeof richText === "function" ? richText(b.sub, { size: 14 }) : esc(b.sub)}</small>` : ""}<span class="sr">${esc(b.text)}: ${esc(b.why)}</span></div>`,
    )
    .join("");
}

/** Lista dos selos de agora para o painel "?": o texto e a explicação de cada um. */
export function badgesHelpHtml(badges, esc) {
  const list = Array.isArray(badges) ? badges : [];
  const where = {
    roll: "Botão Atualizar",
    level: "Botão Comprar XP",
    gold: "Ouro",
  };
  return `<h4>Selos nos botões do jogo</h4>${
    list.length
      ? `<ul class="hp-badges">${list.map((b) => `<li data-tone="${esc(b.tone)}"><b>${esc(where[b.id] ?? (String(b.id).startsWith("found") ? "Loja" : b.id))}: ${esc(b.text)}</b>${b.sub ? ` <span>${esc(b.sub)}</span>` : ""}${b.why ? `<small>${esc(b.why)}</small>` : ""}</li>`).join("")}</ul>`
      : '<p class="hp-note">Aparecem sobre os botões Atualizar e Comprar XP e ao lado do ouro durante a partida ao vivo.</p>'
  }`;
}
