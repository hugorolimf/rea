import { esc } from "../dom.js";
import { getCatalog, stars, unitPortrait } from "./glyphs.js";
import { nameChip } from "./rich-text.js";

// Retrato de campeão com o anel do custo: o padrão compartilhado (glyphs.js) que a interface toda usa.
const unit = unitPortrait;

/** Por que trocar a peça da comp: disputa, pool esgotada ou loja fora de alcance no nível alvo. */
function pressure(f) {
  if (f.contested)
    return `${f.enemyCopies}/${f.total} cópias com rivais${f.rivals.length ? ` (${f.rivals.slice(0, 3).join(", ")})` : ""}`;
  if (f.unreachable)
    return f.remaining > 0
      ? "fora da loja no nível alvo"
      : "sem cópias livres na pool";
  return "ainda não é sua";
}
/** O que a alternativa traz: posse, disputa e efeito nas sinergias da comp. */
function gains(o) {
  const out = [];
  if (o.owned)
    out.push(`já é sua ${stars(o.stars)}${o.where ? ` (${o.where})` : ""}`);
  out.push(
    o.enemyCopies ? `${o.enemyCopies}/${o.total} com rivais` : "sem disputa",
  );
  if (o.lost.length) out.push(`perde ${o.lost.join(", ")}`);
  if (o.gained.length) out.push(`ganha ${o.gained.join(", ")}`);
  if (!o.lost.length && !o.gained.length) out.push("mantém as sinergias");
  // Medido com o seu trunfo: colocação média dos tabuleiros que tinham os dois.
  if (o.withAsset != null)
    out.push(`com seu trunfo: ${o.withAsset.toFixed(1).replace(".", ",")}º`);
  return out;
}
/** Resumo visível de uma alternativa (o detalhe completo fica na dica): posse e disputa. */
const altNote = (o) =>
  o.owned
    ? o.where === "na reserva"
      ? "sua, na reserva"
      : "já é sua"
    : o.enemyCopies
      ? `${o.enemyCopies}/${o.total} rivais`
      : "sem disputa";

/**
 * Seção "Substituições" do Ao vivo. `onUse(outId, inId)` aplica uma troca na comp seguida;
 * `onUndo(outId)` desfaz uma aplicada.
 */
export function mountSubs(root, list, { onUse, onUndo }) {
  root.addEventListener("click", (e) => {
    const use = e.target.closest("[data-use]");
    if (use) onUse(use.dataset.out, use.dataset.use);
    const undo = e.target.closest("[data-undo]");
    if (undo) onUndo(undo.dataset.undo);
  });
  let drawn = "";
  return {
    update(plan, swaps = []) {
      const subs = plan?.subs ?? [],
        key = JSON.stringify([subs, swaps, plan?.compId]);
      if (key === drawn) return;
      drawn = key;
      const { champions } = getCatalog(),
        name = (id) => champions.get(id)?.name ?? id,
        cost = (id) => champions.get(id)?.cost ?? 1,
        canUse = !!plan?.compId;
      const applied = swaps.map(
        (s) =>
          `<li class="sub-row is-applied"><span class="sub-pair" aria-hidden="true">${unit(s.out, name(s.out), cost(s.out), 28)}<span class="sub-arrow">→</span>${unit(s.in, name(s.in), cost(s.in), 28)}</span><div class="sub-body"><b>${esc(name(s.out))} → ${esc(name(s.in))}</b><small>substituição aplicada</small></div><button type="button" class="btn" data-undo="${esc(s.out)}" aria-label="Desfazer a troca ${esc(name(s.out))} → ${esc(name(s.in))}">Desfazer</button></li>`,
      );
      const rows = subs.map((f) => {
        const o = f.pick,
          others = f.options.filter((x) => x !== o);
        const why = `<small class="sub-why" data-tone="${f.contested || f.unreachable ? "warn" : "info"}">${nameChip("champion", f.id, f.name, { size: 16 })}: ${esc(pressure(f))}</small>`;
        // Alternativas que o motor devolveu além da sugerida (ou todas, sem sugestão).
        const alts = others.length
          ? `<span class="sub-others"><small>ou</small>${others
              .map(
                (x) =>
                  `<button type="button" class="sub-alt" data-out="${esc(f.id)}" data-use="${esc(x.id)}"${canUse ? "" : " disabled"} title="${esc(`${x.name}: ${gains(x).join(" · ")}`)}"><span aria-hidden="true">${unit(x.id, x.name, x.cost, 30)}</span><span class="sub-alt-name">${esc(x.name)}<small>${esc(altNote(x))}</small></span></button>`,
              )
              .join("")}</span>`
          : "";
        if (!o)
          return `<li class="sub-row is-stuck"><span class="sub-pair" aria-hidden="true">${unit(f.id, f.name, f.cost)}</span><div class="sub-body"><b>${esc(f.name)}</b>${why}<small>Nenhuma alternativa claramente melhor; siga com ela ou repense a comp.</small>${alts}</div></li>`;
        return `<li class="sub-row"><span class="sub-pair" aria-hidden="true">${unit(f.id, f.name, f.cost)}<span class="sub-arrow">→</span>${unit(o.id, o.name, o.cost)}</span><div class="sub-body"><b>${esc(f.name)} → ${esc(o.name)}</b>${why}<small>${gains(o).map(esc).join(" · ")}</small>${alts}</div><button type="button" class="btn btn-go" data-out="${esc(f.id)}" data-use="${esc(o.id)}" aria-label="Usar a troca ${esc(f.name)} → ${esc(o.name)}"${canUse ? "" : ' disabled title="Disponível para comps de meta"'}>Usar</button></li>`;
      });
      // Sem comp de meta (ou revendo uma partida) as trocas só informam: diz por quê em texto, não só na dica do botão.
      const note =
        rows.length && !canUse
          ? [
              `<li class="sub-note">Trocas só podem ser aplicadas em comps de meta, na partida ao vivo.</li>`,
            ]
          : [];
      list.innerHTML = [...applied, ...note, ...rows].join("");
      root.hidden = !applied.length && !rows.length;
    },
  };
}
