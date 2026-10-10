import { esc } from "../dom.js";
import { sameItems, unknownNote } from "../items.js";
import { itemPortrait, portrait } from "./glyphs.js";

/** Espaço do banco ocupado cujo ícone o leitor não reconheceu (ainda não está no catálogo, ou algo o cobre). */
const UNKNOWN =
  '<span class="pt pt-item is-dashed" style="--s:26px" data-i="?" title="Item no banco que o leitor não reconheceu"></span>';

/**
 * Inventário lido da tela: o banco de itens, o que montar agora (componente + componente → item → quem
 * usa) e o que está a um componente. Dados de `ownedItemAdvice` do servidor; sem leitura, fica oculto.
 */
export function mountInventory(root) {
  let drawn = "";
  const recipe = (r) =>
    `<li title="${esc(`${r.item.name} em ${r.champion}`)}">${r.required
      .map((id) => itemPortrait({ id }, { size: 22 }))
      .join(
        '<span class="op">+</span>',
      )}<span class="op">→</span>${itemPortrait({ id: r.item.id, name: r.item.name }, { size: 26 })}${portrait(r.championId, r.champion, { size: 22 })}</li>`;
  return {
    /**
     * `reading` é o banco lido da tela (ver `bankReading`): aparece na hora, sem esperar a análise, com todo espaço
     * reconhecido e um marcador para cada espaço ocupado que não foi reconhecido. `advice` (montar agora, falta um
     * componente) e `emblems` só valem se a análise foi feita com este mesmo banco; senão esperam a próxima.
     */
    update(advice, emblemList = [], reading = null) {
      const bank = reading
          ? reading.bank.map((id) => ({ id }))
          : (advice?.inventory ?? []),
        unknown = reading?.unknown ?? 0,
        fresh =
          !!advice &&
          (!reading ||
            sameItems(
              (advice.inventory ?? []).map((i) => i.id),
              reading.items,
            )),
        ready = fresh ? (advice.ready ?? []) : [],
        near = fresh ? (advice.near ?? []).slice(0, 4) : [],
        emblems = fresh ? emblemList : [],
        note = unknownNote(reading),
        key = JSON.stringify([
          bank.map((i) => i.id),
          unknown,
          ready.map((r) => [r.item.id, r.championId]),
          near.map((r) => [r.item.id, r.championId]),
          emblems,
        ]);
      root.hidden = !bank.length && !unknown;
      if (key === drawn) return;
      drawn = key;
      root.innerHTML =
        bank.length || unknown
          ? `<div class="inv-bank" aria-label="Banco de itens">${bank.map((i) => itemPortrait(i, { size: 26 })).join("")}${Array.from({ length: unknown }, () => UNKNOWN).join("")}</div>
          ${note ? `<p class="inv-unknown" title="${esc(note)}">${unknown} não reconhecido${unknown === 1 ? "" : "s"}: fora da análise</p>` : ""}
          ${
            emblems.length
              ? `<ul class="inv-list inv-emblem" aria-label="Emblemas para a comp">${emblems
                  .map(
                    (e) =>
                      `<li title="${esc(`Emblema de ${e.trait}: dá a sinergia a ${e.holder ? e.holder.name : "uma peça da comp"}${e.ready ? "; monta agora" : "; falta o outro componente"}`)}">${e.ready ? "" : `<span class="miss">${itemPortrait({ id: e.other }, { size: 22 })}</span><span class="op">+</span>`}${itemPortrait({ id: e.id, name: e.name }, { size: 26 })}${e.holder ? `<span class="op">→</span>${portrait(e.holder.id, e.holder.name, { size: 22 })}` : ""}<small>${esc(e.trait)}</small></li>`,
                  )
                  .join("")}</ul>`
              : ""
          }
          ${ready.length ? `<ul class="inv-list" aria-label="Montar agora">${ready.map(recipe).join("")}</ul>` : ""}
          ${
            near.length
              ? `<ul class="inv-list inv-near" aria-label="Falta um componente">${near
                  .map(
                    (r) =>
                      `<li title="${esc(`Falta ${r.missing.length} componente para ${r.item.name} em ${r.champion}`)}">${r.required
                        .map(
                          (id) =>
                            `<span class="${r.missing.includes(id) ? "miss" : ""}">${itemPortrait({ id }, { size: 22 })}</span>`,
                        )
                        .join(
                          '<span class="op">+</span>',
                        )}<span class="op">→</span>${itemPortrait({ id: r.item.id, name: r.item.name }, { size: 26 })}${portrait(r.championId, r.champion, { size: 22 })}</li>`,
                  )
                  .join("")}</ul>`
              : ""
          }`
          : "";
    },
  };
}
