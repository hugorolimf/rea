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

/**
 * Aparência de uma casa (`model.plan.cells[i]`):
 * - `sub` nulo: a própria casa (retrato, estrelas e custo dela), como sempre;
 * - `sub.swapped`: o retrato grande é de quem joga (`sub.playing`), com as estrelas e o custo dele, e o original
 *   vai pequeno no canto (`original`, com o custo dele para o contorno);
 * - `sub.buy`: a peça vem da loja de agora (selo de compra com o preço).
 * `badge` é o selo principal ("buy" vence "swap": comprar é a ação), `sub` é o `kind` quando há troca de peça e
 * `label` é o texto da dica e do rótulo acessível (com `sub.label` à frente quando há vaga).
 * Devolve `{ image, stars, cost, sub, buy, original, badge, label }`.
 */
export function cellLook(c) {
  const sub = c?.sub ?? null,
    swapped = !!(sub?.swapped && sub.playing),
    p = swapped ? sub.playing : null,
    buy = sub?.buy
      ? {
          cost: sub.buy.cost ?? p?.cost ?? c.cost ?? 0,
          slot: sub.buy.slot ?? null,
        }
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
  const base = `${c.name}${c.stars ? ` ${c.stars}★` : ""} · ${status}${swapText}${c.reason ? ` · ${c.reason}` : ""}`;
  return {
    image: swapped ? p.id : c.id,
    stars: Math.min(4, Math.max(0, stars)),
    cost: clampCost(swapped ? p.cost : c.cost),
    sub: swapped ? (sub.kind ?? "temporario") : null,
    buy,
    original:
      swapped && sub.original
        ? { id: sub.original.id, cost: clampCost(sub.original.cost) }
        : null,
    badge: buy ? "buy" : swapped ? "swap" : null,
    label: sub?.label ? `${sub.label} · ${base}` : base,
  };
}
