/**
 * O que a casa da Formação desenha (sem DOM; ui/board.js só aplica). Importável no Node para os testes: não importa
 * `dom.js` (que lê `matchMedia` ao carregar).
 */

/** Rótulo do estado de uma troca do painel (`cell.swap.kind`). */
export const SWAP_KIND_LABEL = {
  ready: "trocar agora",
  hold: "segure",
  blocked: "não troque",
  slot: "vaga livre",
};

const clampCost = (c) => Math.min(5, Math.max(1, Number(c) || 1));
/** Porcentagem curta, como `pct` de ui/glyphs.js (que não dá para importar aqui: ele carrega dom.js). */
const pctText = (v) =>
  typeof v === "number" ? `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%` : "—";

/** Onde a peça comprada entra (`row.how` da lista Comprar): na vaga livre, no lugar de outra ou guardada no banco. */
export function wantWhere(r) {
  return r.how === "copy"
    ? (r.copy?.text ?? "cópia")
    : r.how === "replace"
      ? `entra no lugar de ${r.replaces}`
      : r.how === "bank"
        ? "guardar no banco"
        : "vaga livre";
}

/**
 * O que a Formação marca em cada casa além da vaga (o antigo "Agora" e as "Substituições", agora no tabuleiro), só para
 * a comp padrão (a outra do seletor não tem decisões):
 * - `want`: a linha da lista Comprar da peça (`plan.steps`, id "buy"): na loja agora, cópia que sobe a estrela ou a
 *   chance por loja e onde ela entra;
 * - `flex`: a substituição da peça da comp (`plan.subs`): a sugerida, as alternativas e a pressão;
 * - `applied`: a troca já aplicada que pôs esta peça na comp (`{ out, in }`, `out` é a original).
 * Devolve `{ marks: Map id → { want, flex, applied }, loose }`; `loose` são as compras sem casa nesta formação.
 */
export function cellMarks(plan, cells = [], swaps = []) {
  const marks = new Map(),
    at = (id) => {
      if (!marks.has(id))
        marks.set(id, { want: null, flex: null, applied: null });
      return marks.get(id);
    },
    ids = new Set(cells.map((c) => c.id)),
    loose = [];
  for (const r of plan?.steps?.find((s) => s.id === "buy")?.rows ?? [])
    if (r.unit?.id && ids.has(r.unit.id)) at(r.unit.id).want = r;
    else loose.push(r);
  for (const f of plan?.subs ?? []) if (ids.has(f.id)) at(f.id).flex = f;
  for (const s of swaps) if (ids.has(s.in)) at(s.in).applied = s;
  return { marks, loose };
}

/**
 * Aparência de uma casa (`model.plan.cells[i]`):
 * - `sub` nulo: a própria casa (retrato, estrelas e custo dela), como sempre;
 * - `sub.swapped`: o retrato grande é de quem joga (`sub.playing`), com as estrelas e o custo dele, e o original
 *   vai pequeno no canto (`original`, com o custo dele para o contorno);
 * - `sub.buy`: a peça vem da loja de agora (selo de compra com o preço).
 * `badge` é o selo principal ("buy" vence "swap": comprar é a ação), `sub` é o `kind` quando há troca de peça e
 * `label` é o texto da dica e do rótulo acessível (com `sub.label` à frente quando há vaga).
 * Com as marcas da casa (`m`, de `cellMarks`):
 * - a peça da lista Comprar que está na loja agora ganha o selo de compra (o preço, ou "→2★" quando a cópia sobe a
 *   estrela); fora da loja, `want` é a chance por loja (selo âmbar no mesmo canto);
 * - `alt` é o selo de troca no alto da casa: a alternativa sugerida (`suggest`, com o retrato dela), peça sob pressão
 *   sem alternativa clara (`stuck`) ou troca já aplicada (`applied`).
 * Devolve `{ image, stars, cost, sub, buy, want, alt, original, badge, label }`.
 */
export function cellLook(c, m = null) {
  const sub = c?.sub ?? null,
    swapped = !!(sub?.swapped && sub.playing),
    p = swapped ? sub.playing : null,
    w = m?.want ?? null,
    buy = sub?.buy
      ? {
          cost: sub.buy.cost ?? p?.cost ?? c.cost ?? 0,
          slot: sub.buy.slot ?? null,
        }
      : w?.shop
        ? {
            cost: w.copy ? `→${w.copy.next}★` : (w.unit?.cost ?? c.cost ?? 0),
            slot: null,
          }
        : null,
    want = w && !buy ? { text: pctText(w.chance), broke: !!w.broke } : null,
    f = m?.flex ?? null,
    alt = f
      ? f.pick
        ? { kind: "suggest", id: f.pick.id, cost: clampCost(f.pick.cost) }
        : { kind: "stuck", id: null, cost: null }
      : m?.applied
        ? { kind: "applied", id: m.applied.out, cost: null }
        : null;
  // Estrelas: quem joga (não da loja: ainda não é sua); sem troca, a casa (nada enquanto a peça só está a comprar).
  const stars = swapped
    ? p.source === "loja"
      ? 0
      : (p.stars ?? 0)
    : c.status === "incoming"
      ? 0
      : (c.stars ?? 0);
  const status =
    c.own ||
    (c.status === "owned"
      ? "em campo"
      : c.status === "reserve"
        ? "na reserva"
        : "a comprar");
  const s = c.swap ?? null;
  const swapText = s
    ? ` · ${SWAP_KIND_LABEL[s.kind]}${s.exit ? `: ${s.exit.name} sai` : ""}${s.kind === "hold" ? ` (${s.have}/${s.need})` : ""}${s.held ? ` · preserve ${s.held} item(ns)` : ""}`
    : "";
  const wantText = w
    ? ` · ${w.shop ? "na loja agora: compre" : `comprar (${pctText(w.chance)} por loja)`}, ${wantWhere(w)}${w.broke ? " · sem ouro agora" : ""}`
    : "";
  const altText = f
    ? f.pick
      ? ` · troca sugerida: ${f.pick.name} (clique para ver)`
      : " · sob pressão, sem alternativa clara"
    : m?.applied
      ? " · troca aplicada (clique para desfazer)"
      : "";
  const base = `${c.name}${c.stars ? ` ${c.stars}★` : ""} · ${status}${swapText}${wantText}${altText}${c.reason ? ` · ${c.reason}` : ""}`;
  return {
    image: swapped ? p.id : c.id,
    stars: Math.min(4, Math.max(0, stars)),
    cost: clampCost(swapped ? p.cost : c.cost),
    sub: swapped ? (sub.kind ?? "temporario") : null,
    buy,
    want,
    alt,
    original:
      swapped && sub.original
        ? { id: sub.original.id, cost: clampCost(sub.original.cost) }
        : null,
    badge: buy ? "buy" : swapped ? "swap" : null,
    label: sub?.label ? `${sub.label} · ${base}` : base,
  };
}
