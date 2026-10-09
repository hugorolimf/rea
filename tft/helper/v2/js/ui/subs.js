import { esc } from "../dom.js";
import { getCatalog, portrait, stars } from "./glyphs.js";

const unit = (id, name, cost, size = 32) =>
  `<span class="sub-pt" style="--ring-c:var(--cost-${cost ?? 1})">${portrait(id, name, { size })}</span>`;

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
  if (o.owned) out.push(`já é sua ${stars(o.stars)}`);
  out.push(
    o.enemyCopies ? `${o.enemyCopies}/${o.total} com rivais` : "sem disputa",
  );
  if (o.lost.length) out.push(`perde ${o.lost.join(", ")}`);
  if (o.gained.length) out.push(`ganha ${o.gained.join(", ")}`);
  if (!o.lost.length && !o.gained.length) out.push("mantém as sinergias");
  return out;
}

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
          `<li class="sub is-applied">${unit(s.out, name(s.out), cost(s.out), 26)}<span class="sub-arrow" aria-hidden="true">→</span>${unit(s.in, name(s.in), cost(s.in), 26)}<p><b>${esc(name(s.out))} → ${esc(name(s.in))}</b><small>substituição aplicada</small></p><button type="button" class="btn" data-undo="${esc(s.out)}">Desfazer</button></li>`,
      );
      const rows = subs.map((f) => {
        const o = f.pick,
          others = f.options.filter((x) => x !== o);
        const why = `<small class="sub-why" data-tone="${f.contested || f.unreachable ? "warn" : "info"}">${esc(f.name)}: ${esc(pressure(f))}</small>`;
        if (!o)
          return `<li class="sub is-stuck">${unit(f.id, f.name, f.cost)}<p><b>${esc(f.name)}</b>${why}<small>Nenhuma alternativa mantém as sinergias; siga com ela ou repense a comp.</small></p></li>`;
        return `<li class="sub">${unit(f.id, f.name, f.cost)}<span class="sub-arrow" aria-hidden="true">→</span>${unit(o.id, o.name, o.cost)}<p><b>${esc(f.name)} → ${esc(o.name)}</b>${why}<small>${gains(o).map(esc).join(" · ")}</small>${
          others.length
            ? `<small class="sub-others">ou ${others
                .map(
                  (x) =>
                    `<button type="button" class="link" data-out="${esc(f.id)}" data-use="${esc(x.id)}"${canUse ? "" : " disabled"} title="${esc(gains(x).join(" · "))}">${esc(x.name)}</button>`,
                )
                .join(", ")}</small>`
            : ""
        }</p><button type="button" class="btn btn-go" data-out="${esc(f.id)}" data-use="${esc(o.id)}"${canUse ? "" : ' disabled title="Disponível para comps de meta"'}>Usar</button></li>`;
      });
      list.innerHTML = [...applied, ...rows].join("");
      root.hidden = !applied.length && !rows.length;
    },
  };
}
