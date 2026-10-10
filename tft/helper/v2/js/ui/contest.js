import { esc } from "../dom.js";
import { getCatalog, glyph, portrait } from "./glyphs.js";
import { richText } from "./rich-text.js";

/**
 * Aviso de disputa: rival jogando as mesmas peças (as suas em campo e as da comp alvo) e, quando ainda dá
 * tempo, a comp menos disputada para onde ir. Só orienta: no automático o assistente já troca de comp
 * quando a disputa pesa. Some ao fechar, até a disputa mudar.
 */
export function mountContest(root) {
  let closed = "",
    shown = "";
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-dismiss]")) {
      closed = shown;
      root.hidden = true;
    }
  });
  return {
    update(contest, { canSwitch = true } = {}) {
      const top = contest?.rivals?.[0];
      shown = top
        ? JSON.stringify([top.name, top.shared, contest.alternative?.id])
        : "";
      root.hidden = !top || shown === closed;
      if (root.hidden) return;
      const { champions } = getCatalog(),
        alt = canSwitch ? contest.alternative : null,
        others = contest.rivals.slice(1).filter((r) => r.shared.length >= 2);
      root.dataset.level = contest.level;
      root.innerHTML = `${glyph("swords")}
        <p><b>${esc(top.name)}</b> joga ${top.shared.length} das suas peças${top.carry ? ", incluindo o carry" : ""}${others.length ? ` · ${others.map((r) => `${esc(r.name)} ${r.shared.length}`).join(" · ")}` : ""}</p>
        <span class="contest-units">${top.shared
          .slice(0, 6)
          .map((id) =>
            portrait(id, champions.get(id)?.name ?? id, { size: 22 }),
          )
          .join("")}</span>
        ${
          alt
            ? `<small title="Comp de meta forte com no máximo 1 peça em disputa; você já tem ${alt.owned} de ${alt.size}">menos disputada: <b>${richText(alt.title)}</b></small>`
            : contest.late
              ? '<small title="Do estágio 4 em diante trocar de comp custa mais do que a disputa">tarde para trocar: busque 2★ e itens</small>'
              : ""
        }
        <button type="button" class="contest-x" data-dismiss aria-label="Fechar aviso">${glyph("x")}</button>`;
    },
  };
}
