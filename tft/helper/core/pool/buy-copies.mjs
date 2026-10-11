// Cópias de peças do plano que você já tem: a regra de compra que vale quando uma delas aparece na loja.
// A lista "Comprar" do servidor (`stage.buyNow`) só traz peças que faltam; peça da comp que já está em campo ou na
// reserva (1★ ou 2★) também vale comprar quando a loja a mostra, porque cada cópia aproxima a próxima estrela.
// Função pura, sem imports de fora de `core/`: a interface e o overlay leem o mesmo resultado (`v2/js/model.js`).
import { freeOf, starCopies } from "./copies.mjs";

/** Estrela máxima do jogo: uma peça 3★ não ganha nada com mais cópias. */
const MAX_STARS = 3;

/**
 * Próximo marco de estrela de uma peça com `own` cópias (de 1★) somadas, ou `null` se já é 3★.
 * `{ next, need, closes }`: estrela que a próxima cópia constrói, cópias que ainda faltam e se UMA cópia fecha o marco.
 */
export function nextStar(own) {
  const have = Math.max(0, Math.floor(Number(own)) || 0);
  for (let next = 2; next <= MAX_STARS; next++) {
    const goal = starCopies(next);
    if (have < goal)
      return { next, need: goal - have, closes: goal - have === 1 };
  }
  return null;
}

/** Texto curto de uma cópia: "cópia · fecha o 2★" ou "cópia · sobe para 3★ (faltam 4)". */
export function copyText({ next, need, closes }) {
  return closes
    ? `cópia · fecha o ${next}★`
    : `cópia · sobe para ${next}★ (faltam ${need})`;
}

/** Estrela que a cópia de número `total` fecha: cada trio de 1★ vira um 2★ (3ª e 6ª cópias) e a 9ª fecha o 3★. */
function closesAt(total) {
  const full = starCopies(MAX_STARS);
  if (total === full) return "fecha 3★";
  return total < full && total % starCopies(2) === 0 ? "fecha um 2★" : null;
}

/**
 * Cartas iguais na mesma loja, em ordem de slot: o que CADA uma faz com a peça, descontando as cópias que as cartas
 * anteriores já trazem. Com 2 cópias suas e 2 cartas, a 1ª fecha o 2★ e a 2ª é cópia a mais rumo ao 3★ (não outro
 * "fecha um 2★"). Com 1 cópia sua e 2 cartas, as duas JUNTAS fecham o 2★: a 2ª fecha e a 1ª vai junto (`closer`).
 *
 * - `own`: cópias de 1★ que você tem (campo + reserva, inclusive a reserva lida do GEP);
 * - `count`: quantas cartas iguais a loja mostra.
 *
 * Cada passo, na ordem das cartas: `{ total, completes, closer, text }`:
 * - `total`: cópias depois de comprar esta carta e as anteriores;
 * - `completes`: "fecha um 2★" | "fecha 3★" | null (só a carta que fecha a estrela);
 * - `closer`: índice da carta que fecha a estrela contando com esta (as anteriores do mesmo trio), ou null;
 * - `text`: motivo da cópia que nem fecha nem ajuda a fechar nesta loja (cópia a mais / extra), ou null.
 */
export function shopCopies(own, count) {
  const have = Math.max(0, Math.floor(Number(own)) || 0),
    full = starCopies(MAX_STARS),
    steps = [];
  for (let i = 0; i < count; i++)
    steps.push({
      total: have + i + 1,
      completes: closesAt(have + i + 1),
      closer: null,
      text: null,
    });
  // A carta que fecha leva junto as anteriores desta loja desde o último fechamento: sem elas, ela não fecha.
  let open = [];
  for (const [i, s] of steps.entries()) {
    if (!s.completes) {
      open.push(i);
      continue;
    }
    for (const j of open) steps[j].closer = i;
    open = [];
  }
  for (const [i, s] of steps.entries()) {
    if (s.completes || s.closer !== null) continue;
    if (have >= full) s.text = "cópia extra: a peça já é 3★";
    else if (have + i >= full)
      s.text = "cópia extra: as cartas anteriores desta loja já fecham o 3★";
    else if (i > 0) {
      const star = nextStar(s.total - 1);
      s.text = `cópia a mais rumo ao ${star.next}★ (${s.total}/${starCopies(star.next)} com as cartas anteriores desta loja)`;
    }
  }
  return steps;
}

/**
 * Linhas de compra para as peças do plano que o jogador já tem (campo ou reserva) e ainda podem subir de estrela.
 *
 * - `board`: peças do plano exibido (`plan.board`: `{ id, name, cost, owned, stars }`); só entram as `owned`.
 * - `pool`: `analysis.pool` (`{ name, own, chancePerShop, ... }`); `own` = cópias de 1★ que você tem. Sem a entrada,
 *   vale o piso das estrelas lidas (`stars`).
 * - `carry`: nome do carry; `gold`: ouro lido (ou null: sem checagem).
 * - `skip`: ids que a lista de compra já traz como peça nova (a linha não se repete).
 *
 * Cada linha: `{ id, name, cost, stars, own, next, need, closes, text, carry, chancePerShop, broke, priority }`.
 * Não entra: peça 3★ (nada a ganhar) nem peça a que a pool não tem mais cópias para chegar ao marco (`need` maior que
 * as cópias livres). Ordem: a que fecha estrela primeiro, depois o carry, depois a chance de aparecer.
 */
export function copyBuys({
  board = [],
  pool = [],
  carry = null,
  gold = null,
  skip = new Set(),
} = {}) {
  const byName = new Map((pool ?? []).map((p) => [p.name, p]));
  const out = [];
  for (const u of board ?? []) {
    if (!u?.owned || skip.has(u.id)) continue;
    const p = byName.get(u.name),
      own =
        Number.isFinite(p?.own) && p.own > 0 ? p.own : starCopies(u.stars ?? 1),
      star = nextStar(own);
    if (!star) continue;
    if (p && freeOf(p) < star.need) continue;
    const isCarry = carry != null && u.name === carry;
    out.push({
      id: u.id,
      name: u.name,
      cost: u.cost,
      stars: u.stars ?? 1,
      own,
      ...star,
      text: copyText(star),
      carry: isCarry,
      chancePerShop: p?.chancePerShop ?? 0,
      broke: gold !== null && gold < u.cost,
      priority: (star.closes ? 4 : 0) + (isCarry ? 3 : 2),
    });
  }
  return out.sort(
    (a, b) => b.priority - a.priority || b.chancePerShop - a.chancePerShop,
  );
}
