const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pct = (v) =>
  typeof v === "number" ? `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%` : "—";
const dots = (have, total, tone = "") =>
  `<span class="pips ${tone}" role="img" aria-label="${have} de ${total}">${Array.from({ length: total }, (_, i) => `<i${i < have ? ' class="on"' : ""}></i>`).join("")}</span>`;
const COINS = 5,
  COIN_GOLD = 10;
/** Level track: past levels filled, current highlighted, roll level and final level flagged. */
function levelTrack(lv, go) {
  const from = Math.min(5, lv.level),
    to = Math.max(10, lv.finalLevel ?? 10, lv.level + 1);
  const nodes = [];
  for (let n = from; n <= to; n++) {
    const cls = [
      n < lv.level ? "past" : "",
      n === lv.level ? "now" : "",
      go && n === lv.level + 1 ? "next" : "",
      n === lv.at ? "roll" : "",
      n === lv.finalLevel ? "final" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const tip = [
      n === lv.level ? "nível atual" : "",
      n === lv.at ? "nível de rolagem" : "",
      n === lv.finalLevel ? "nível final da comp" : "",
      n === lv.curve ? "curva padrão" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    nodes.push(
      `<span class="lv-node ${cls}"${tip ? ` title="${esc(tip)}"` : ""}><b>${n}</b>${n === lv.at ? "<i>↻</i>" : n === lv.finalLevel ? "<i>⚑</i>" : ""}</span>`,
    );
  }
  return `<div class="lv-track">${nodes.join("")}</div>`;
}
/** Right-hand summary: action, level track + XP, roll, upgrade targets and gold, with numbers instead of sentences. */
export function strategyHTML(plan, { icon, actionable }) {
  const sx = plan?.strategy;
  if (!sx) return "";
  const P = sx.panels ?? {},
    lv = P.leveling,
    ro = P.rolling,
    eco = P.economy;
  const tone = actionable
    ? sx.action.toLowerCase().replace(/[^a-z]/g, "")
    : "planning";
  const meta = plan.meta
    ? `<b class="tier tier-${esc(plan.meta.tier)}" title="Tier da comp">${esc(plan.meta.tier)}</b>`
    : "";
  const head = `<div class="sx-head">${actionable ? `<span class="action-tag">${esc(sx.action)}</span>` : ""}${actionable ? `<strong>${esc(sx.headline)}</strong>` : ""}<span class="sx-meta" title="${esc(plan.title)}">${meta}${sx.style ? `<em>${esc(sx.style)}</em>` : ""}<span>${esc(plan.carry)}</span></span></div>`;

  const xpBar = lv?.xp
    ? `<div class="sx-xp" title="${lv.xp.have} de ${lv.xp.total} XP"><span class="bar"><i style="--p:${Math.min(1, lv.xp.have / (lv.xp.total || 1))}"></i></span><small>${lv.xp.have}/${lv.xp.total}</small>${lv.cost != null ? `<b class="coin" title="ouro para completar o nível">${lv.cost}g</b>` : ""}</div>`
    : '<div class="sx-xp is-unknown" title="XP não lido da tela"><span class="bar"><i style="--p:0"></i></span><small>XP ?</small></div>';
  const level = lv
    ? `<section class="sx-card sx-level${actionable && lv.go ? " is-go" : ""}" title="${esc(lv.text)}"><header><span>Nível</span>${actionable && lv.go ? '<b class="verdict go">▲ subir</b>' : ""}</header>${levelTrack({ ...lv, at: ro?.at }, actionable && lv.go)}${xpBar}</section>`
    : "";

  const roll = ro
    ? `<section class="sx-card sx-roll${actionable && ro.go ? " is-go" : ""}" title="${esc(ro.text)}"><header><span>Roll</span>${
        actionable && ro.go
          ? `<b class="verdict go">↻ rolar</b>`
          : ro.level < ro.at
            ? `<b class="verdict wait" title="faltam ${ro.at - ro.level} nível(is) para rolar">Nv ${ro.at}</b>`
            : '<b class="verdict wait">espere</b>'
      }</header>${
        actionable && ro.go
          ? `<div class="sx-spend"><b>${ro.spend}g</b><span>${ro.shops} lojas</span>${ro.keep != null ? `<span class="floor" title="pare quando chegar a ${ro.keep}g">⚑ ${ro.keep}g</span>` : ""}</div>`
          : ""
      }${
        ro.targets?.length
          ? `<div class="sx-targets">${ro.targets
              .map((t) => {
                const need = t.goal ?? 3,
                  own = Math.min(t.own ?? 0, need);
                return `<div class="sx-target${t.done ? " is-done" : ""}" title="${esc(`${t.name} ${t.goalStars}★ · ${t.own}/${t.goal} cópias · ${pct(t.chancePerShop)} por loja${t.chanceInRoll != null ? " · " + pct(t.chanceInRoll) + " nesta rolagem" : ""}${t.enemy ? " · " + t.enemy + " com rivais" : ""}`)}">${icon(t.id, t.name)}<span class="t-name">${esc(t.name)}</span>${dots(own, need, t.done ? "" : "amber")}<span class="t-chance">${pct(t.chancePerShop)}</span>${t.chanceInRoll != null ? `<span class="t-roll" title="chance nesta rolagem">→ ${pct(t.chanceInRoll)}</span>` : ""}${t.enemy ? `<span class="t-rivals" title="${t.enemy} cópia(s) com rivais">⚔${t.enemy}</span>` : ""}</div>`;
              })
              .join("")}</div>`
          : ""
      }</section>`
    : "";

  const gold = eco?.gold;
  const coins =
    gold == null
      ? ""
      : `<div class="sx-coins" role="img" aria-label="${gold} de ouro, juros de ${eco.interest}g">${Array.from({ length: COINS }, (_, i) => `<i style="--p:${Math.max(0, Math.min(1, (gold - i * COIN_GOLD) / COIN_GOLD))}"></i>`).join("")}${eco.keep != null && eco.keep <= COINS * COIN_GOLD ? `<b class="floor" style="--at:${eco.keep / (COINS * COIN_GOLD)}" title="piso desta decisão: ${eco.keep}g"></b>` : ""}</div>`;
  const economy = eco
    ? `<section class="sx-card sx-eco" title="${esc(eco.text)}"><header><span>Ouro</span>${actionable && sx.action === "ECONOMIZAR" ? '<b class="verdict go">⏸ poupar</b>' : eco.keep != null ? `<b class="verdict wait" title="piso desta decisão">⚑ ${eco.keep}g</b>` : ""}</header><div class="sx-gold"><strong>${gold == null ? "–" : gold + "g"}</strong>${gold == null ? "" : `<b class="interest" title="juros por rodada">+${eco.interest}</b>`}${eco.next ? `<small title="próximo patamar de juros">↗ ${eco.next}g</small>` : ""}</div>${coins}</section>`
    : "";

  const why = `<details class="sx-why"><summary>Por que esta decisão</summary>${sx.steps?.length ? `<ol>${sx.steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}${sx.reasons?.length ? `<ul>${sx.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}</details>`;
  return `<div class="core-action sx act-${tone}">${head}<div class="sx-grid">${level}${roll}${economy}</div>${why}</div>`;
}
