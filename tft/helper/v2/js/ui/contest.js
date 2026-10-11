import { esc } from "../dom.js";
import { getCatalog, glyph, portrait } from "./glyphs.js";
import { richText } from "./rich-text.js";

/** Rótulo do nível da disputa: o texto acompanha a cor (vermelho só na disputa alta). */
const LEVEL = { high: "Disputa alta", medium: "Disputa média" };

/**
 * Aviso de disputa: rival jogando as mesmas peças (as suas em campo e as da comp alvo) e, quando ainda dá
 * tempo, a comp menos disputada para onde ir. Só orienta: no automático o assistente já troca de comp
 * quando a disputa pesa. Some ao fechar, até a disputa mudar.
 */
export function mountContest(root) {
  let closed = "",
    shown = "",
    drawn = "";
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
      const html = `<span class="chip" data-tone="${contest.level === "high" ? "danger" : "amber"}">${glyph("swords")}${LEVEL[contest.level] ?? "Disputa"}</span>
        <p><b>${esc(top.name)}</b> joga ${top.shared.length} das suas peças${top.carry ? ", incluindo o carry" : ""}${others.length ? ` · ${others.map((r) => `${esc(r.name)} ${r.shared.length}`).join(" · ")}` : ""}</p>
        <span class="contest-units">${top.shared
          .slice(0, 6)
          .map((id) =>
            portrait(id, champions.get(id)?.name ?? id, { size: 24 }),
          )
          .join("")}</span>
        ${
          alt
            ? `<small>menos disputada: <b>${richText(alt.title)}</b> · você já tem ${alt.owned} de ${alt.size}</small>`
            : contest.late
              ? "<small>Do estágio 4 em diante trocar de comp custa mais do que a disputa: busque 2★ e itens.</small>"
              : ""
        }
        <button type="button" class="btn btn-quiet btn-icon contest-x" data-dismiss aria-label="Fechar aviso de disputa">${glyph("x")}</button>`;
      // Região viva: só reescreve quando o aviso mudou, para o leitor de tela não repetir a cada leitura.
      if (html === drawn) return;
      drawn = html;
      root.innerHTML = html;
    },
  };
}
