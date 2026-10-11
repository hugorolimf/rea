import { esc } from "../dom.js";
import { glyph, itemPortrait, portrait, stars } from "./glyphs.js";
import { richText } from "./rich-text.js";
import { buildStates } from "../../../core/items/holdings.mjs";

/**
 * Itens do campeão clicado na Formação: o que está equipado e os itens recomendados com a receita.
 * Cada recomendado diz se já está equipado, se dá para montar agora com o banco ou o que falta.
 */
export function mountChampItems(root, { onClose }) {
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) onClose();
  });
  return {
    update(cell, inventory = []) {
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
          <button type="button" class="btn btn-quiet btn-icon ci-close" data-close aria-label="Fechar itens do campeão" title="Fechar (Esc)">${glyph("x")}</button></div>
        ${rec.length ? `<ul class="ci-list" aria-label="Itens recomendados">${rec.join("")}</ul>` : '<p class="ci-empty">Sem build recomendada para este campeão.</p>'}`;
    },
  };
}
