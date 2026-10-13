// Comp ajustada ao nível: no nível alto, a vaga de apoio da comp cuja peça original rende menos que uma alternativa achável
// no seu nível passa a ser da alternativa (troca da comp automática, `by: "nivel"`). A comp (identidade, carry, peças e
// sinergias-chave) não muda; muda quem ocupa a vaga. Loja, Formação, overlay e motor leem a troca como qualquer troca
// aceita da comp (app/recommend-facts.mjs, fato `comps.swapped`).
//
// Força medida: os tabuleiros da própria comp no seu nível (MetaTFT `comp_options`, gravados em meta-comps.json como
// `options`; sem amostra no nível, o nível abaixo mais próximo; nos níveis 5–6, os tabuleiros do nível 7 como referência): colocação média dos tabuleiros com a original × dos que
// trocaram a original pela alternativa. A média geral da peça (meta-stats.json `unit["id|estrela"]`) só entra para a peça
// que você já tem 2★/3★: ela sai apenas se, na sua estrela, rende menos que a alternativa (a média geral favorece peças
// caras, que aparecem nos tabuleiros de quem sobreviveu mais; por isso não propõe troca sozinha).
// A força sempre decide: vale também para comp de reroll; o que protege a peça barata é você já tê-la forte (a sua
// estrela entra na conta). Carry e peças-chave (`key`) nunca saem; sinergia-chave (`key`) nunca cai de patamar.
//
// Determinística em (nível, peças suas): não oscila com a loja. ESM puro, sem I/O.
import { POLICY } from "../economy/policy.mjs";
import { isBuyable } from "../pool/shop.mjs";
import { isAvatar, unitSlots } from "../catalog/champions.mjs";

const PLACEMENT_SD = 2.29;

/**
 * Nível de `options` usado: o seu, ou o mais próximo abaixo dele (até `refLevel`) com amostra. A MetaTFT só publica
 * tabuleiros a partir do nível 7: abaixo dele (nível 5–6) a referência é o nível `refLevel`.
 */
function boardsAt(options, level, refLevel, minGames) {
  for (let l = Math.min(10, Math.max(level, refLevel)); l >= refLevel; l--) {
    const list = options?.[l] ?? options?.[String(l)];
    if (!Array.isArray(list)) continue;
    const games = list.reduce((n, b) => n + (b.n ?? 0), 0);
    if (games >= minGames) return { level: l, boards: list };
  }
  return null;
}

/** Colocação média ponderada e partidas dos tabuleiros que passam no filtro. */
function weighted(boards, pick) {
  let n = 0,
    sum = 0;
  for (const b of boards)
    if (pick(b)) {
      n += b.n;
      sum += b.n * b.avg;
    }
  return n ? { avg: sum / n, n } : null;
}

const statOf = (unitStats, id, stars) => {
  const s = unitStats?.[`${id}|${stars}`];
  return Array.isArray(s) && Number.isFinite(s[0])
    ? { avg: s[0], n: s[1] ?? 0 }
    : null;
};

/**
 * Trocas da comp pelo nível. `comp`: `{ units, carry, key, options? }`. `ctx`:
 * - `level`: nível do jogador; `owned`: Map apiName → estrela (campo e reserva);
 * - `byId`: Map apiName → campeão do catálogo; `book`: `traitBook`; `traitName`: Map apiName da sinergia → nome;
 * - `unitStats`: `meta-stats.json` `unit`.
 * Devolve `[{ out, in, by: "nivel", why, gain, source, level }]` (vazio abaixo de `minLevel`).
 */
export function levelFitSwaps(comp, ctx) {
  const P = POLICY.levelFit,
    level = ctx.level;
  if (!Number.isFinite(level) || level < P.minLevel) return [];
  const { byId, book, owned, unitStats } = ctx,
    units = comp.units.filter((id) => byId.has(id)),
    keyTraits = (comp.key ?? [])
      .filter((k) => !byId.has(k))
      .map((k) => ctx.traitName?.get(k) ?? k),
    protectedIds = new Set([comp.carry, ...(comp.key ?? [])].filter(Boolean));
  const tiers = (ids) => {
    const { counts } = book.tally(
      ids.map((id) => ({ traits: byId.get(id)?.traits ?? [], items: [] })),
    );
    const out = new Map();
    for (const [name, count] of counts) {
      const s = book.status(name, count);
      if (!s.solo) out.set(name, s.tier);
    }
    return out;
  };
  const keysHold = (before, after) =>
    keyTraits.every((t) => (after.get(t) ?? 0) >= (before.get(t) ?? 0));
  // Alternativa achável e que não é caçar peça barata fora de hora: sua, ou comprável no nível e de custo acima do
  // barato para o nível (custo > nível − `cheapGap`), nunca mais barata que a original.
  // Vagas: a alternativa não pode ocupar mais vagas que a original (o Elder Dragon ocupa 2).
  const reachable = (c, o) =>
    !!c &&
    !isAvatar(c) &&
    unitSlots(c) <= unitSlots(o) &&
    (owned.has(c.apiName) ||
      (isBuyable(level, c.cost) &&
        c.cost >= o.cost &&
        c.cost > level - P.cheapGap));
  const sample = boardsAt(comp.options, level, P.refLevel, P.minBoardGames);
  const pairs = sample ? [] : fallbackPairs();
  // Sem tabuleiros da comp no nível (amostra pequena na MetaTFT): a peça BARATA para o nível (custo ≤ nível − cheapGap) dá
  // lugar à alternativa comprável, mais cara, que divide uma sinergia com ela e tem média geral publicada melhor em 2★
  // (`unitStats`). O ganho não foi medido na comp: não entra na força dela (`gain` 0; a estimativa vai em `estimate`).
  function fallbackPairs() {
    const out = [];
    for (const id of units) {
      const o = byId.get(id);
      if (!o || protectedIds.has(id) || isAvatar(o)) continue;
      if (o.cost > level - P.cheapFallback) continue;
      // Alvo de 3★ de comp de reroll: a peça barata É o plano.
      if ((comp.stars3 ?? []).includes(id)) continue;
      const outStars = owned.get(id) ?? null;
      if (outStars >= 2) continue; // a sua peça forte fica (a estrela decide no substituto)
      const mine = statOf(unitStats, id, 2);
      if (!mine || mine.n < P.minUnitGames) continue;
      for (const c of byId.values()) {
        if (units.includes(c.apiName) || !(c.cost > o.cost) || !reachable(c, o))
          continue;
        if (!(c.traits ?? []).some((t) => (o.traits ?? []).includes(t)))
          continue;
        const alt = statOf(unitStats, c.apiName, owned.get(c.apiName) ?? 2);
        if (!alt || alt.n < P.minUnitGames) continue;
        const gain = mine.avg - alt.avg;
        if (gain > P.margin)
          out.push({
            out: id,
            in: c.apiName,
            gain,
            sampleLevel: null,
            outStars,
          });
      }
    }
    return out;
  }
  for (const out of sample ? units : []) {
    const o = byId.get(out);
    if (!o || protectedIds.has(out) || isAvatar(o)) continue;
    const outStars = owned.get(out) ?? null;
    const withOut = weighted(sample.boards, (b) => b.u.includes(out));
    if (!withOut || withOut.n < P.minPairGames) continue;
    const seen = new Set();
    for (const b of sample.boards)
      for (const id of b.u) {
        if (units.includes(id) || seen.has(id)) continue;
        seen.add(id);
        const c = byId.get(id);
        if (!reachable(c, o)) continue;
        // Tabuleiros da comp no nível que trocaram a original por esta peça × os que mantiveram a original.
        const withIn = weighted(
          sample.boards,
          (x) => x.u.includes(id) && !x.u.includes(out),
        );
        if (!withIn || withIn.n < P.minPairGames) continue;
        const gain = withOut.avg - withIn.avg,
          se = PLACEMENT_SD * Math.sqrt(1 / withOut.n + 1 / withIn.n);
        if (!(gain > P.margin && gain > se)) continue;
        // Peça sua já com 2★/3★: os tabuleiros da comp não dizem a estrela; ela só sai se a média geral da peça na sua
        // estrela for pior que a da alternativa na estrela dela (sua, ou 1★ comprada agora). Sem medida, fica.
        if (outStars >= 2) {
          const mine = statOf(unitStats, out, outStars),
            alt = statOf(unitStats, id, owned.get(id) ?? 1);
          if (
            !mine ||
            !alt ||
            mine.n < P.minUnitGames ||
            alt.n < P.minUnitGames ||
            !(mine.avg - alt.avg > P.margin)
          )
            continue;
        }
        pairs.push({ out, in: id, gain, sampleLevel: sample.level, outStars });
      }
  }
  // Maior ganho primeiro; cada peça sai e entra uma vez; a sinergia-chave não cai de patamar.
  pairs.sort((a, b) => b.gain - a.gain || a.in.localeCompare(b.in));
  let board = [...units];
  const used = new Set(),
    swaps = [];
  for (const p of pairs) {
    if (used.has(p.out) || used.has(p.in) || board.includes(p.in)) continue;
    const next = board.map((id) => (id === p.out ? p.in : id)),
      before = tiers(board),
      after = tiers(next);
    if (!keysHold(before, after)) continue;
    board = next;
    used.add(p.out).add(p.in);
    const o = byId.get(p.out),
      c = byId.get(p.in),
      measured = p.sampleLevel !== null,
      gain = Math.round(p.gain * 100) / 100;
    swaps.push({
      out: p.out,
      in: p.in,
      by: "nivel",
      source: "comp",
      level,
      // Só o ganho medido nos tabuleiros da comp entra na força dela; o da média geral é estimativa.
      gain: measured ? gain : 0,
      estimate: measured ? null : gain,
      why: measured
        ? `nível ${level}: ${c.name} (custo ${c.cost}) no lugar de ${o.name}${p.outStars ? ` ${p.outStars}★` : ""} (custo ${o.cost}), ` +
          `${gain} colocação melhor nos tabuleiros desta comp no nível ${p.sampleLevel}`
        : `nível ${level}: ${c.name} (custo ${c.cost}) no lugar de ${o.name} (custo ${o.cost}, barato para o nível), ` +
          `mesma sinergia e ${gain} colocação melhor na média geral em 2★ (a comp não tem tabuleiros no nível ${level})`,
    });
  }
  return swaps;
}
