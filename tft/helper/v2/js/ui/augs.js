import { esc } from "../dom.js";
import { augOfferView, augPath, nextSlot } from "../augs.js";
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

/** Uma carta da oferta (já ordenada por `augOfferView`). */
function card(c) {
  const rank = c.unknown
    ? "fora do catálogo"
    : c.best
      ? `${glyph("check")} Recomendado`
      : c.rank
        ? `${c.rank}ª opção`
        : "analisando";
  const swap = c.reroll
    ? `<p class="aug-reroll">${glyph("roll")} Troque este card antes de escolher</p>`
    : c.rerolled
      ? `<p class="aug-rerolled">já trocado</p>`
      : "";
  return `<li class="aug-card"${c.best ? ' data-pick=""' : ""}${c.reroll ? ' data-reroll=""' : ""}${c.unknown ? ' data-unknown=""' : ""}>
            <span class="aug-rank">${rank}</span>
            <h3>${esc(c.name)}</h3>
            ${c.desc ? `<p class="aug-desc">${richText(plain(c.desc))}</p>` : ""}
            ${measuredLine(c)}
            ${c.reasons.length ? `<ul class="aug-why">${c.reasons.map((r) => `<li>${richText(r)}</li>`).join("")}</ul>` : ""}
            ${swap}
          </li>`;
}

/**
 * Seção "Aprimoramentos" do Ao vivo: a trilha 2-1 → 3-2 → 4-2 com o que você escolheu (lido do jogo pelo GEP) e, enquanto a
 * escolha está aberta no jogo, as cartas na ordem sugerida para a sua comp. Nada precisa ser marcado: `onRemove(id)` só
 * corrige uma escolha lida errada. Sem GEP a seção diz "aprimoramentos: sem fonte".
 */
export function mountAugs(root, { onRemove }) {
  const trail = root.querySelector("#augs-path"),
    offers = root.querySelector("#augs-offers"),
    head = root.querySelector(".section-head");
  const sourceEl = document.createElement("span");
  sourceEl.className = "chip aug-source";
  sourceEl.hidden = true;
  head?.append(sourceEl);
  root.addEventListener("click", (e) => {
    const drop = e.target.closest("[data-drop]");
    if (drop) onRemove(drop.dataset.drop);
  });
  let drawn = "";
  return {
    /**
     * `screen` é o `state.screen` do servidor (oferta e fonte dos aprimoramentos); `advice` e `chosen` vêm de
     * /api/recommend; `records` são as escolhas (do GEP ou corrigidas à mão); `stage` é o estágio lido.
     * `readonly` (partida revista) esconde o botão de desmarcar.
     */
    update({
      screen = null,
      advice,
      chosen = [],
      records = [],
      stage = null,
      live = false,
      readonly = false,
    }) {
      const key = JSON.stringify([
        screen?.augmentOffer ?? null,
        screen?.augmentSource ?? null,
        advice,
        chosen,
        records,
        stage,
        live,
        readonly,
      ]);
      if (key === drawn) return;
      drawn = key;
      const view = augOfferView(readonly ? null : screen, advice),
        known = new Map(chosen.map((a) => [a.id, a])),
        slots = augPath(records, known),
        offering = view.open,
        next = offering ? nextSlot(slots, view.stage ?? stage) : null;
      root.hidden = !live && !offering && !records.length;

      const src = view.source;
      sourceEl.hidden =
        !src || (src.state === "ativo" && !view.unresolved.length);
      if (src) {
        sourceEl.dataset.state = src.state;
        sourceEl.textContent = view.unresolved.length
          ? `${src.text} · ${view.unresolved.length} nome${view.unresolved.length > 1 ? "s" : ""} fora do catálogo`
          : src.text;
        sourceEl.title = view.unresolved.length
          ? `${src.title} Não reconhecidos: ${view.unresolved.join(", ")}.`
          : src.title;
      }

      trail.innerHTML = slots
        .map((s, i) => {
          const a = s.aug,
            state = s.record ? "done" : i === next ? "now" : "todo";
          const body = s.record
            ? `<b>${esc(a?.name ?? s.record.name ?? s.record.id)}</b>${a?.traits?.length ? `<span class="aug-traits">${a.traits.map(traitChip).join("")}</span>` : ""}${readonly ? "" : `<button type="button" class="aug-drop" data-drop="${esc(s.record.id)}" title="Desmarcar esta escolha (só se o jogo a leu errado)" aria-label="Desmarcar ${esc(a?.name ?? s.record.id)}">${glyph("x")}</button>`}`
            : `<small>${state === "now" ? "escolha agora" : src?.state === "sem-fonte" ? "sem fonte" : "a escolher"}</small>`;
          return `<li class="aug-slot" data-state="${state}"${state === "now" ? ' aria-current="step"' : ""}${a?.desc ? ` title="${esc(plain(a.desc))}"` : ""}><span class="aug-stage">${s.stage}</span>${body}</li>`;
        })
        .join("");

      offers.hidden = !offering;
      if (!offering) {
        offers.innerHTML = "";
        return;
      }
      const headText = view.pending
        ? `Oferta aberta no jogo${view.stage ? ` (${esc(view.stage)})` : ""} · analisando para a sua comp…`
        : `Oferta aberta no jogo${view.stage ? ` (${esc(view.stage)})` : ""} · ordem para <b>${view.comp ? richText(view.comp) : "sua comp"}</b>`;
      offers.innerHTML = `<p class="aug-head">${headText}</p><ol class="aug-cards" aria-label="Cartas da oferta, da melhor opção para a pior">${view.cards
        .map(card)
        .join(
          "",
        )}</ol>${view.note ? `<p class="aug-note">${richText(view.note)}</p>` : ""}`;
    },
  };
}
