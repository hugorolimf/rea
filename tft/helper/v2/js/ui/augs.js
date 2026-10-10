import { esc } from "../dom.js";
import { augPath, nextSlot } from "../augs.js";
import { glyph, traitIcon } from "./glyphs.js";
import { richText } from "./rich-text.js";

const plain = (html) =>
  String(html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
const traitChip = (name) => {
  const icon = traitIcon(name);
  return `<span class="chip aug-trait">${icon ? `<em class="trait-icon" style="--icon:url('${esc(icon)}')" aria-hidden="true"></em>` : ""}${esc(name)}</span>`;
};

/**
 * Seção "Aprimoramentos" do Ao vivo: a trilha 2-1 → 3-2 → 4-2 com o que você escolheu e, quando o jogo
 * mostra as cartas, a ordem sugerida para a sua comp. `onChoose(id)` marca a escolha; `onRemove(id)` desfaz.
 */
/** Colocação esperada do card: média medida (NoxuTFT) e tier na sua comp (MetaTFT). */
function measuredLine(c) {
  if (c.expected == null) return "";
  const n = (x) => x.toFixed(2).replace(".", ","),
    m = c.measured,
    parts = [];
  if (m?.avg != null)
    parts.push(
      `medido ${n(m.avg)}º${m.round ? ` quando pego no ${m.round}` : ""} em ${m.gamesEstimated ? "~" : ""}${m.games.toLocaleString("pt-BR")} partidas`,
    );
  if (c.tier) parts.push(`tier ${c.tier} na sua comp`);
  if (c.estimated) parts.push("sem dado medido: média geral");
  return `<p class="aug-measured"><b>${n(c.expected)}º</b> esperado${parts.length ? ` · ${esc(parts.join(" · "))}` : ""}</p>`;
}

export function mountAugs(root, { onChoose, onRemove }) {
  const trail = root.querySelector("#augs-path"),
    offers = root.querySelector("#augs-offers");
  root.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-choose]");
    if (pick) onChoose(pick.dataset.choose);
    const drop = e.target.closest("[data-drop]");
    if (drop) onRemove(drop.dataset.drop);
  });
  let drawn = "";
  return {
    /**
     * `advice` e `chosen` vêm de /api/recommend; `records` são as escolhas marcadas; `stage` é o lido da tela.
     * `readonly` (partida revista) esconde os botões de desmarcar e de escolher.
     */
    update({
      advice,
      chosen = [],
      records = [],
      stage = null,
      live = false,
      readonly = false,
    }) {
      const key = JSON.stringify([
        advice,
        chosen,
        records,
        stage,
        live,
        readonly,
      ]);
      if (key === drawn) return;
      drawn = key;
      const known = new Map(chosen.map((a) => [a.id, a])),
        slots = augPath(records, known),
        offering = !!advice?.choices?.length,
        next = offering ? nextSlot(slots, stage) : null;
      root.hidden = !live && !offering && !records.length;

      trail.innerHTML = slots
        .map((s, i) => {
          const a = s.aug,
            state = s.record ? "done" : i === next ? "now" : "todo";
          const body = s.record
            ? `<b>${esc(a?.name ?? s.record.name ?? s.record.id)}</b>${a?.traits?.length ? `<span class="aug-traits">${a.traits.map(traitChip).join("")}</span>` : ""}${readonly ? "" : `<button type="button" class="aug-drop" data-drop="${esc(s.record.id)}" aria-label="Desmarcar ${esc(a?.name ?? s.record.id)}">${glyph("x")}</button>`}`
            : `<small>${state === "now" ? "escolha agora" : "a escolher"}</small>`;
          return `<li class="aug-slot" data-state="${state}"${a?.desc ? ` title="${esc(plain(a.desc))}"` : ""}><span class="aug-stage">${s.stage}</span>${body}</li>`;
        })
        .join("");

      offers.hidden = !offering;
      if (!offering) {
        offers.innerHTML = "";
        return;
      }
      offers.innerHTML = `<p class="aug-head">Cartas na tela · ordem para <b>${advice.comp ? richText(advice.comp) : "sua comp"}</b></p><ol class="aug-cards">${advice.choices
        .map((c, i) => {
          const best = c.id === advice.pick;
          return `<li class="aug-card"${best ? ' data-pick=""' : ""}${c.reroll ? ' data-reroll=""' : ""}>
            <span class="aug-rank">${best ? `${glyph("check")} Recomendado` : `${i + 1}ª opção`}</span>
            <h3>${esc(c.name)}</h3>
            ${c.desc ? `<p class="aug-desc">${richText(plain(c.desc))}</p>` : ""}
            ${measuredLine(c)}
            <ul class="aug-why">${c.reasons.map((r) => `<li>${richText(r)}</li>`).join("")}</ul>
            ${c.reroll ? `<p class="aug-reroll">${glyph("roll")} Troque este card se ainda puder</p>` : ""}
            ${readonly ? "" : `<button type="button" class="btn${best ? " btn-go" : ""}" data-choose="${esc(c.id)}">Escolhi este</button>`}
          </li>`;
        })
        .join("")}</ol><p class="aug-note">${richText(advice.note ?? "")}</p>`;
    },
  };
}
