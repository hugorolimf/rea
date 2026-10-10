import { esc } from "../dom.js";
import { glyph, itemPortrait, portrait } from "./glyphs.js";
import { nameChip, richText } from "./rich-text.js";

const MARK = {
  done: "check",
  built: "check",
  ready: "up",
  move: "swap",
  partial: "clock",
  missing: "plus",
  now: "up",
  later: "clock",
  pending: "clock",
  unknown: "clock",
};

const unitRow = (u) =>
  `<li class="plan-row" data-status="${u.status}"${u.lost ? ' data-lost=""' : ""}>${portrait(u.id, u.name, { size: 30 })}<span class="plan-main"><b>${esc(u.name)}${u.carry ? ' <em class="plan-carry">carry</em>' : ""}</b><small>${esc(u.line)}${u.lost ? " · já chegou mais longe" : ""}</small></span><span class="plan-bar" style="--p:${u.fraction}" aria-hidden="true"><i></i></span><i class="plan-mark">${glyph(MARK[u.status] ?? "plus")}</i></li>`;
const itemRow = (i) =>
  `<li class="plan-row" data-status="${i.status}">${itemPortrait({ id: i.itemId, name: i.name }, { size: 28 })}<span class="plan-main"><b>${esc(i.name)}</b><small>em ${i.unitId ? nameChip("champion", i.unitId, i.unit, { size: 16 }) : richText(i.unit, { size: 16 })} · ${esc(i.statusText)}${i.from ? ` de ${richText(i.from, { size: 16 })}` : ""}${i.missing.length ? ` · falta ${richText(i.missing.join(" + "), { size: 16 })}` : ""}</small></span><i class="plan-mark">${glyph(MARK[i.status] ?? "plus")}</i></li>`;

/**
 * Seção "Plano": o plano em andamento com o checklist do que já foi conquistado e o que falta (peças e estrelas, itens,
 * aprimoramentos, nível e ouro) e o próximo passo. Recebe o modelo de `planView` (../plan.js).
 */
export function mountPlan(root) {
  const body = root.querySelector("#plan-body"),
    chips = root.querySelector("#plan-chips");
  let drawn = "",
    open = false;
  // O detalhe aberto pelo jogador sobrevive às leituras seguintes.
  root.addEventListener(
    "toggle",
    (e) => {
      if (e.target.matches?.(".plan-changes")) open = e.target.open;
    },
    true,
  );
  return {
    update(view) {
      const key = JSON.stringify(view);
      if (key === drawn) return;
      drawn = key;
      root.hidden = !view;
      if (!view) {
        body.innerHTML = "";
        chips.innerHTML = "";
        return;
      }
      chips.innerHTML = `<span class="chip ${view.pct >= 100 ? "chip-go" : ""}" title="passos concluídos do plano">${view.done}/${view.total}</span>`;
      body.innerHTML = `
        <div class="plan-head"><h3>${richText(view.title)}</h3><small>${esc(view.pinned ? "comp fixada" : view.since)}</small><span class="plan-meter" style="--p:${view.pct / 100}" role="img" aria-label="${view.pct}% do plano"><i></i></span></div>
        ${view.challenger ? `<p class="plan-challenger">${glyph("pause")}<span>${richText(view.challenger)}</span></p>` : ""}
        ${view.next.length ? `<div class="plan-next"><h4>Próximo passo</h4><ol>${view.next.map((s) => `<li data-kind="${esc(s.kind)}">${richText(s.text)}</li>`).join("")}</ol></div>` : ""}
        <h4>Peças</h4><ul class="plan-list">${view.units.map(unitRow).join("")}</ul>
        ${view.items.length ? `<h4>Itens</h4><ul class="plan-list">${view.items.map(itemRow).join("")}</ul>` : ""}
        <h4>Aprimoramentos</h4><ul class="plan-augs">${view.augments.map((a) => `<li data-status="${a.status}"><b>${esc(a.round)}</b><span>${esc(a.text)}</span></li>`).join("")}</ul>
        <ul class="plan-state">
          ${view.level ? `<li data-status="${view.level.status}">${glyph("up")}${esc(view.level.text)}</li>` : ""}
          ${view.gold ? `<li data-status="${view.gold.status}">${glyph("coin")}${esc(view.gold.text)}</li>` : ""}
        </ul>
        ${view.changes.length ? `<details class="plan-changes"${open ? " open" : ""}><summary>O que mudou</summary><ul>${view.changes.map((c) => `<li>${c.stage ? `<b>${esc(c.stage)}</b> ` : ""}${richText(c.text)}</li>`).join("")}</ul></details>` : ""}`;
    },
  };
}
