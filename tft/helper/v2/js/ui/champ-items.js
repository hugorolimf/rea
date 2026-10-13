import { esc } from "../dom.js";
import { glyph, itemPortrait, pct, portrait, stars } from "./glyphs.js";
import { nameChip, richText } from "./rich-text.js";
import { appliedRowHtml, subRowHtml } from "./subs.js";
import { wantWhere } from "../board-look.js";
import { buildStates } from "../../../core/items/holdings.mjs";
import { buildSourceNote } from "../../../core/items/scenarios.mjs";

const chip = (u) => nameChip("champion", u.id, u.name, { size: 18 });

/**
 * O que fazer nesta vaga agora (o antigo "Agora", por peça): comprar (na loja agora ou a chance por loja, e onde a peça
 * entra), a troca da vaga (trocar agora, segure até fechar as cópias, não troque, vaga livre) e o temporário que joga
 * no lugar dela. `m`: as marcas da casa (board-look.js `cellMarks`).
 */
function actsHtml(cell, m) {
  const out = [],
    w = m?.want,
    sw = cell.swap;
  if (w) {
    const s = w.shop,
      tone = s ? "go" : w.broke ? "danger" : "amber";
    out.push(
      `<li data-tone="${tone}">${glyph(s ? "coin" : "eye")}<span>${s ? `<b>Na loja agora</b> ${esc(s.mark)}` : `<b>Comprar</b> ${pct(w.chance)} por loja`} · ${richText(wantWhere(w), { size: 18 })}${w.broke ? " · sem ouro agora" : ""}</span></li>`,
    );
  }
  if (sw?.kind === "ready")
    out.push(
      `<li data-tone="go">${glyph("swap")}<span><b>Trocar agora</b> ${chip(sw.exit)} sai${sw.held ? ` · preserve ${sw.held} ${sw.held === 1 ? "item" : "itens"}` : ""}</span></li>`,
    );
  else if (sw?.kind === "hold")
    out.push(
      `<li data-tone="amber">${glyph("pause")}<span><b>Segure</b> ${chip(sw.exit)}${sw.exitStars ? ` ${stars(sw.exitStars)}` : ""} até juntar as cópias de ${chip(cell)} · ${sw.have}/${sw.need}</span></li>`,
    );
  else if (sw?.kind === "blocked")
    out.push(
      `<li data-tone="danger">${glyph("no")}<span><b>Não troque</b> ${chip(sw.exit)} ainda</span></li>`,
    );
  else if (sw?.kind === "slot")
    out.push(
      `<li data-tone="blue">${glyph("plus")}<span><b>Vaga livre</b> ${sw.fromReserve ? "a peça já está na reserva" : "a peça entra ao subir de nível"}</span></li>`,
    );
  if (cell.sub?.label)
    out.push(
      `<li data-tone="violet">${glyph("swap")}<span>${richText(cell.sub.label, { size: 18 })}</span></li>`,
    );
  return out.length
    ? `<h3 class="ci-sec">Agora</h3><ul class="ci-acts">${out.join("")}</ul>`
    : "";
}

/** A troca sugerida para a peça da comp e a troca já aplicada nesta casa (ui/subs.js), com Usar e Desfazer. */
function subsHtml(m, canUse) {
  const rows = [
    m?.applied ? appliedRowHtml(m.applied) : "",
    m?.flex ? subRowHtml(m.flex, canUse) : "",
  ].join("");
  return rows
    ? `<h3 class="ci-sec">Substituição</h3><ul class="subs">${rows}</ul>`
    : "";
}

/**
 * Detalhe da peça clicada na Formação: o que fazer nesta vaga agora, a substituição (com Usar/Desfazer), o que está
 * equipado e os itens recomendados com a receita. Cada recomendado diz se já está equipado, se dá para montar agora
 * com o banco ou o que falta. `onUse(outId, inId)` aplica uma troca; `onUndo(outId)` desfaz uma aplicada.
 */
export function mountChampItems(
  root,
  { onClose, onUse = () => {}, onUndo = () => {} },
) {
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return onClose();
    const use = e.target.closest("[data-use]");
    if (use && !use.disabled) return onUse(use.dataset.out, use.dataset.use);
    const undo = e.target.closest("[data-undo]");
    if (undo) onUndo(undo.dataset.undo);
  });
  return {
    /** `extra`: `{ mark, canUse }`, as marcas da casa (board-look.js `cellMarks`) e se as trocas valem agora. */
    update(cell, inventory = [], { mark = null, canUse = false } = {}) {
      root.hidden = !cell;
      if (!cell) return;
      const b = cell.build,
        equipped = b?.equipped ?? [];
      // Banco, itens equipados em outras peças (inclusive as que saem) e componentes: só falta o que não existe.
      const rec = buildStates(cell, inventory).map(({ item: it, state: s }) => {
        // O dono vira imagem dentro da frase; se o nome do snapshot não casar com o catálogo, o retrato dele vem antes.
        const said = s.text ? richText(s.text, { size: 18 }) : "",
          note =
            s.from && !said.includes('class="rt')
              ? `<span class="ci-from">${portrait(s.from.unitId, s.from.name, { size: 18 })}</span>${said}`
              : said;
        return `<li data-state="${s.kind}" title="${esc(it.name)}${s.text ? ` · ${esc(s.text)}` : ""}">${itemPortrait(it, { size: 34 })}<span class="ci-recipe">${(
          it.components ?? []
        )
          .map(
            (c, i) =>
              `<span class="${s.got?.[i] ? "got" : ""}">${itemPortrait(c, { size: 18 })}</span>`,
          )
          .join("")}</span>${s.text ? `<small>${note}</small>` : ""}</li>`;
      });
      root.innerHTML = `
        <div class="ci-head">${portrait(cell.id, cell.name, { size: 30 })}<b>${esc(cell.name)}</b>${cell.stars > 0 ? `<i title="${cell.stars} ${cell.stars === 1 ? "estrela" : "estrelas"}"><span aria-hidden="true">${stars(cell.stars)}</span><span class="sr">${cell.stars} ${cell.stars === 1 ? "estrela" : "estrelas"}</span></i>` : ""}
          ${equipped.length ? `<span class="ci-equipped" role="group" aria-label="Itens equipados" title="equipados">${equipped.map((e) => itemPortrait(e, { size: 20 })).join("")}</span>` : ""}
          <button type="button" class="btn btn-quiet btn-icon ci-close" data-close aria-label="Fechar o detalhe da peça" title="Fechar (Esc)">${glyph("x")}</button></div>
        ${actsHtml(cell, mark)}${subsHtml(mark, canUse)}<h3 class="ci-sec">Itens</h3>
        ${rec.length ? `<ul class="ci-list" aria-label="Itens recomendados">${rec.join("")}</ul>${buildSourceNote(b) ? `<p class="ci-src"${b?.reserve ? ' data-reserve="1"' : ""}>${esc(buildSourceNote(b))}</p>` : ""}` : '<p class="ci-empty">Sem build recomendada para este campeão.</p>'}`;
    },
  };
}
