// Substituto temporário: quem joga AGORA em cada vaga da comp, até o titular ficar forte o bastante. Regra única (a
// Formação, a loja, a lista "Segure" e as trocas de `tactics.mjs` leem daqui); o plano e o ranking não mudam por ela.
//
// - Vaga: cada peça do plano (o "titular" T). Peça fora da comp em campo (o substituto S) ocupa a vaga de uma peça que
//   ainda não joga. Uma troca aceita da comp (goalSwaps/autoSwaps) é "troca-da-comp": a peça da comp já é o substituto.
// - Força na vaga: custo × star[estrela] + item × itens completos + peso × (patamares do tabuleiro com a peça − sem ela)
//   − papel (frente numa vaga de trás ou o contrário). Constantes em POLICY.interim (medidas e de política, marcadas lá).
// - Decisão: S joga no lugar de T só quando força(S) − força(T) > margem. Empate (ou diferença dentro da margem) fica com
//   o titular. Com a vida em perigo a margem é 0 (joga o mais forte agora). T entra com os itens de S (vender S os devolve).
// - Loja: as cartas da loja de agora são candidatas (`playing.source: "loja"`): peça da comp entra na vaga dela (ou vai
//   para a reserva: "compre os dois"); peça fora da comp só ocupa vaga vazia como temporária se render vida bastante
//   para pagar o ouro (juros perdidos) na pressão de vida atual. Quem decide se há ouro é o orçamento da loja
//   (stage.mjs): esta função recebe `buy` por carta.
//
// ESM puro, sem I/O: carrega igual no servidor e no navegador.
import { POLICY } from "../economy/policy.mjs";
import { interestOf } from "../economy/gold.mjs";
import { starCopies, starsForCopies } from "../pool/copies.mjs";
import { chanceAtLeast, slotsIn } from "../pool/shop.mjs";
import { isComponent, isConsumable } from "../catalog/items.mjs";
import { poolName, slotsUsed, unitSlots } from "../catalog/champions.mjs";

/** Contexto da régua: catálogo por apiName e o livro de sinergias (`traitBook`). */
export const interimContext = (catalog, book) => ({
  byId: new Map(catalog.champions.map((c) => [c.apiName, c])),
  champions: catalog.champions,
  book,
});

/**
 * Entradas de `interimSlots` lidas da análise (as MESMAS para a Formação e as trocas de tactics.mjs): campo, reserva
 * e a pool por apiName (cópias suas e chance por slot).
 */
export function analysisInput(analysis, ctx) {
  const idByPool = new Map(ctx.champions.map((c) => [poolName(c), c.apiName]));
  return {
    field: (analysis.self?.units ?? []).map((u) => ({
      id: u.championName,
      name: u.name,
      stars: u.starLevel,
      items: u.itemNames ?? [],
    })),
    reserve: (analysis.self?.reserve ?? []).map((u) => ({
      id: u.championName ?? u.id,
      name: u.name,
      stars: u.starLevel ?? u.stars ?? 1,
      items: u.itemNames ?? [],
    })),
    pool: new Map(
      (analysis.pool ?? [])
        .filter((p) => idByPool.has(p.name))
        .map((p) => [idByPool.get(p.name), p]),
    ),
  };
}

const clampStars = (s) => Math.max(1, Math.min(3, Math.floor(Number(s)) || 1));
const round1 = (x) => Math.round(x * 10) / 10;
const pctText = (p) => `${Math.round(p * 100)}%`;

/** Itens completos de uma peça (componente e consumível não contam). */
export const completedItems = (items) =>
  (items ?? []).filter((id) => id && !isComponent(id) && !isConsumable(id))
    .length;

/** Peso da sinergia no nível: as sinergias da comp pesam mais a partir de `synergy.lateLevel`. */
export function synergyWeight(level) {
  const S = POLICY.interim.synergy;
  return Number.isFinite(level) && level >= S.lateLevel ? S.late : S.early;
}

/** Vida por rodada que 1 ponto de força acima do lobby vale, pela faixa de nível (medido). */
export function hpPerPoint(level) {
  const H = POLICY.interim.hpPerPoint;
  return !Number.isFinite(level) || level <= 5
    ? H.early
    : level <= 7
      ? H.mid
      : H.late;
}

/** Peça de frente (alcance curto): a vaga de frente pede uma; a de trás, uma de alcance. */
const isFront = (c) => (c?.stats?.range ?? 1) < 3;

/** Patamares ativos (sem as sinergias solo) de um tabuleiro de peças distintas `[{ id, items }]`. */
function tiersOf(units, ctx) {
  const byId = new Map();
  for (const u of units) {
    const prev = byId.get(u.id);
    if (prev) prev.items.push(...(u.items ?? []));
    else
      byId.set(u.id, {
        traits: ctx.byId.get(u.id)?.traits ?? [],
        items: [...(u.items ?? [])],
      });
  }
  const { counts } = ctx.book.tally([...byId.values()]);
  let n = 0;
  for (const [name, count] of counts) {
    const s = ctx.book.status(name, count);
    if (!s.solo) n += s.tier;
  }
  return n;
}

/** Multiplicador de vida e dano por estrela (regra do jogo: 2★ = 1,8×, 3★ = 3,24×). */
const STAR_STATS = [0, 1, 1.8, 3.24];

/**
 * Atributos do campeão na estrela: raiz de (vida efetiva × dano por segundo). Vida efetiva = vida × (1 + (armadura +
 * resistência mágica) / 200); dano por segundo = dano × velocidade de ataque × (1 + chance de crítico × (multiplicador − 1)).
 * 0 sem atributos no catálogo.
 */
export function attrPower(c, stars) {
  const s = c?.stats ?? {},
    m = STAR_STATS[clampStars(stars)] ?? 1,
    ehp = (s.hp ?? 0) * m * (1 + ((s.armor ?? 0) + (s.magicResist ?? 0)) / 200),
    dps =
      (s.damage ?? 0) *
      m *
      (s.attackSpeed ?? 0) *
      (1 + (s.critChance ?? 0) * ((s.critMultiplier ?? 1) - 1));
  return Math.sqrt(Math.max(0, ehp * dps));
}

// Régua dos atributos: a mediana dos campeões de custo 1 em 1★ vale 1 (a mesma escala de antes, custo × estrela).
const attrRefMemo = new WeakMap();
function attrRef(byId) {
  let ref = attrRefMemo.get(byId);
  if (ref === undefined) {
    const ones = [...byId.values()]
      .filter((c) => c.cost === 1)
      .map((c) => attrPower(c, 1))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    ref = ones.length ? ones[Math.floor(ones.length / 2)] : 0;
    attrRefMemo.set(byId, ref);
  }
  return ref;
}

/**
 * Força da peça `u` (`{ id, stars, items, cost? }`) no tabuleiro `board` (as peças em campo; `u` entra se não estiver),
 * numa vaga de frente (`slotFront` true), de trás (false) ou sem papel (null). `ctx`: `{ byId, book, level }`.
 * Devolve `{ value, body, items, synergy, role, ruler }`; `ruler` = "medido" (régua de POLICY.interim) ou "politica"
 * (peça fora do catálogo: a régua do lobby, POLICY.star/itemMight).
 */
export function slotStrength(u, board, ctx, slotFront = null) {
  const I = POLICY.interim,
    c = ctx.byId.get(u.id),
    stars = clampStars(u.stars),
    items = Math.min(3, completedItems(u.items));
  if (!c?.cost) {
    const body = (u.cost ?? 1) * POLICY.star[stars],
      gear = POLICY.itemMight * items;
    return {
      value: body + gear,
      body,
      items: gear,
      synergy: 0,
      role: 0,
      ruler: "politica",
    };
  }
  // Corpo: os atributos do campeão na estrela (vida, resistências, dano), na régua do custo 1 1★; sem atributos no
  // catálogo, custo × estrela.
  const ref = attrRef(ctx.byId),
    power = attrPower(c, stars),
    body = ref > 0 && power > 0 ? power / ref : c.cost * I.star[stars],
    gear = I.item * items,
    others = board.filter((b) => b.id !== u.id),
    synergy =
      synergyWeight(ctx.level) *
      (tiersOf([...others, u], ctx) - tiersOf(others, ctx)),
    role = slotFront === null || isFront(c) === slotFront ? 0 : -I.role;
  return {
    value: body + gear + synergy + role,
    body,
    items: gear,
    synergy,
    role,
    ruler: "medido",
  };
}

/**
 * Vantagem de pôr o titular `t` (na estrela `stars`) no lugar de `s` no tabuleiro `board`: força de T (com os itens de S,
 * que passam para ele) no tabuleiro sem S, menos a força de S na vaga de T. Positivo = T rende mais.
 */
export function swapDelta(t, s, board, ctx, stars = t.stars) {
  const slotFront = isFront(ctx.byId.get(t.id)),
    items = [...(t.items ?? []), ...(s.items ?? [])],
    entering = { id: t.id, stars, items },
    without = board.filter((b) => b.id !== s.id && b.id !== t.id);
  return (
    slotStrength(entering, [...without, entering], ctx, slotFront).value -
    slotStrength(s, board, ctx, slotFront).value
  );
}

/** Melhor cópia por campeão (mais estrelas, depois mais itens). */
function bestById(list) {
  const out = new Map();
  for (const u of list ?? []) {
    if (!u?.id) continue;
    const prev = out.get(u.id);
    if (
      !prev ||
      clampStars(u.stars) > clampStars(prev.stars) ||
      (clampStars(u.stars) === clampStars(prev.stars) &&
        (u.items?.length ?? 0) > (prev.items?.length ?? 0))
    )
      out.set(u.id, u);
  }
  return out;
}

/** Ouro que comprar `cost` agora custa em juros nas `rounds` rodadas seguintes (ouro não lido: 0). */
export function interestCost(gold, cost, rounds) {
  if (!Number.isFinite(gold)) return 0;
  return (
    (interestOf(gold) - interestOf(Math.max(0, gold - cost))) *
    Math.max(0, rounds)
  );
}

/**
 * Vale comprar uma peça fora da comp da loja para jogar AGORA numa vaga vazia? `gain` é a força que ela soma ao tabuleiro;
 * o ganho em vida (`gain × hpPerPoint × rodadas`, convertido por `goldPerHp`) precisa pagar o ouro que ela custa em juros
 * (vendida de volta a 1★ ela devolve o custo) pesado pela pressão de vida (`POLICY.urgency[faixa]`: saudável 1, ferido
 * 0,6, perigo 0,25, crítico 0). Devolve `{ worth, gainHp, costGold, rounds }`.
 */
export function interimBuyWorth({ gain, cost, gold, level, band }) {
  const I = POLICY.interim,
    b = band in POLICY.urgency ? band : "healthy",
    rounds = (POLICY.horizon[b] ?? 0) + I.rounds,
    gainHp = Math.max(0, gain) * hpPerPoint(level) * rounds,
    costGold = interestCost(gold, cost, rounds);
  return {
    worth: gain > 0 && gainHp * I.goldPerHp >= costGold * POLICY.urgency[b],
    gainHp: round1(gainHp),
    costGold,
    rounds,
  };
}

const refOf = (u) => (u ? { id: u.id, name: u.name ?? u.id } : null);

/**
 * Quem joga agora em cada vaga do plano.
 *
 * `input`:
 * - `goal`: peças do plano `[{ id, name, cost }]` (plan.board, na ordem do plano); `carry`: nome ou id do carry;
 * - `swaps`: trocas aceitas da comp `[{ out, in }]` (o plano já tem `in` no lugar de `out`);
 * - `field`: em campo `[{ id, name, stars, items }]`; `reserve`: na reserva (mesmo formato); `benchKnown`: a reserva foi
 *   lida (true), não (false/null: sem sugestão de venda);
 * - `shop`: null (loja não lida: nada é inventado) ou `[{ slot, id, name, cost, buy }]`, `buy` = o orçamento da loja deixa
 *   comprar esta carta;
 * - `level` (vagas em campo; sem nível, as peças em campo), `gold` (null = não lido), `band` (faixa de vida de
 *   `pressureOf`; null = saudável), `pool`: Map id → `{ chancePerSlot, own }` (chance da volta), `positions`
 *   (`[{ championId, row, col }]`, opcional), `names`: Map id → nome.
 *
 * `ctx`: `{ byId, book }` (catálogo por apiName e `traitBook`).
 *
 * Devolve `{ slots, buys, margin, bench, note }`. Cada vaga:
 * `{ slot, unit, cell, original, playing, kind, why, until, replaces, delta, ifBought }`:
 * - `unit`: a peça do plano dona da vaga (`{ id, name }`); `original`: quem a comp põe ali (`{ id, name, cost, stars,
 *   have: "campo"|"reserva"|"falta", shop }`; na troca da comp, a peça da meta que saiu); null numa vaga extra;
 * - `playing`: quem joga agora (`{ id, name, cost, stars, source: "campo"|"reserva"|"loja", buy }`) ou null (vaga vazia);
 * - `kind`: "titular" | "temporario" | "troca-da-comp"; `why`: o motivo; `until`: a volta do titular (temporário);
 * - `replaces`: quem sai do campo quando o titular entra agora; `delta`: força(T) − força(S) da decisão;
 * - `ifBought`: para titular que falta, o que acontece ao comprá-lo: `{ place: "troca"|"vaga"|"banco", replaces }`.
 * `buys`: cartas da loja a comprar, com o motivo (`purpose`: "vaga" | "troca" | "reserva" | "temporario").
 */
export function interimSlots(input, ctx) {
  const I = POLICY.interim,
    band = input.band ?? null,
    danger = band === "danger" || band === "critical",
    // Quem entra precisa render mais que quem está (atributos na estrela, sinergia e itens); empate fica com o atual.
    margin = I.margin,
    level = Number.isFinite(input.level) ? input.level : null,
    sctx = { ...ctx, level },
    nameOf = (id) => input.names?.get?.(id) ?? ctx.byId.get(id)?.name ?? id,
    costOf = (id) => ctx.byId.get(id)?.cost ?? 0,
    goal = (input.goal ?? []).filter((u) => u?.id),
    goalIds = new Set(goal.map((u) => u.id)),
    carryOf = (u) => u.name === input.carry || u.id === input.carry,
    swapOut = new Map(
      (input.swaps ?? [])
        .filter((x) => goalIds.has(x.in))
        .map((x) => [x.in, x]),
    ),
    fieldBy = bestById(input.field),
    reserveBy = bestById(input.reserve),
    cap = level ?? fieldBy.size,
    positions = new Map(
      (input.positions ?? []).map((p) => [
        p.championId,
        { row: p.row, col: p.col },
      ]),
    );
  const shopKnown = Array.isArray(input.shop),
    cards = shopKnown ? input.shop.filter((c) => c?.id) : [],
    cardOf = (id) => cards.find((c) => c.id === id && c.buy) ?? null,
    anyCardOf = (id) => cards.find((c) => c.id === id) ?? null;
  // Cópias suas de cada peça (campo + reserva + o que a pool viu): base da volta pela estrela.
  const owned = (id) =>
    Math.max(
      input.pool?.get?.(id)?.own ?? 0,
      (fieldBy.has(id) ? starCopies(fieldBy.get(id).stars) : 0) +
        (reserveBy.has(id) ? starCopies(reserveBy.get(id).stars) : 0),
    );
  const unitOf = (u, source) => ({
    id: u.id,
    name: u.name ?? nameOf(u.id),
    cost: costOf(u.id) || u.cost || 0,
    stars: source === "loja" ? 1 : clampStars(u.stars),
    items: [...(u.items ?? [])],
    source,
  });

  let board = [...fieldBy.values()].map((u) => ({
    id: u.id,
    stars: clampStars(u.stars),
    items: [...(u.items ?? [])],
  }));
  const playing = new Map(), // id da peça do plano (ou "extra:n") → peça que joga
    decided = new Map(), // id da peça do plano → { why, delta, replaces }
    buys = [];
  // Vagas livres no nível: o Elder Dragon ocupa 2 (core/catalog/champions.mjs).
  let free = Math.max(0, cap - slotsUsed(fieldBy.values()));
  // Reserva: vagas ocupadas e as que as compras para a reserva vão ocupando.
  const benchKnown = input.benchKnown === true;
  // Vagas da reserva: as peças lidas e o que ocupa vaga sem ser campeão (bigornas: `benchTaken`).
  let benchUsed = benchKnown
    ? (input.reserve ?? []).length + (input.benchTaken ?? 0)
    : 0;
  const sold = new Set();

  // 1) Titulares já em campo jogam na vaga deles.
  for (const u of goal)
    if (fieldBy.has(u.id))
      playing.set(u.id, unitOf(fieldBy.get(u.id), "campo"));

  // Titulares que podem entrar agora: os da reserva, depois os da loja que o orçamento paga. Carry primeiro, depois custo.
  let avail = goal
    .filter((u) => !fieldBy.has(u.id))
    .map((u) =>
      reserveBy.has(u.id)
        ? { goal: u, unit: unitOf(reserveBy.get(u.id), "reserva") }
        : cardOf(u.id)
          ? {
              goal: u,
              unit: unitOf({ id: u.id, name: u.name }, "loja"),
              card: cardOf(u.id),
            }
          : null,
    )
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(carryOf(b.goal)) - Number(carryOf(a.goal)) ||
        Number(b.unit.source === "reserva") -
          Number(a.unit.source === "reserva") ||
        costOf(b.goal.id) - costOf(a.goal.id),
    );
  const enter = (a, replaced = null, delta = null, why = "") => {
    const items = replaced
      ? [...a.unit.items, ...replaced.items]
      : a.unit.items;
    playing.set(a.goal.id, { ...a.unit, items });
    board = board.filter((b) => b.id !== replaced?.id);
    board.push({ id: a.unit.id, stars: a.unit.stars, items });
    decided.set(a.goal.id, {
      why,
      delta,
      replaces: replaced
        ? {
            ...refOf(replaced),
            stars: clampStars(replaced.stars),
            items: [...(replaced.items ?? [])],
          }
        : null,
    });
    if (a.card)
      buys.push({
        slot: a.card.slot,
        id: a.card.id,
        name: a.unit.name,
        cost: a.card.cost ?? a.unit.cost,
        purpose: replaced ? "troca" : "vaga",
        for: refOf(a.goal),
        replaces: refOf(replaced),
      });
    avail = avail.filter((x) => x !== a);
  };

  // 2) Vaga livre no nível: o titular entra sem tirar ninguém.
  for (const a of [...avail]) {
    if (free < unitSlots(a.unit)) continue;
    free -= unitSlots(a.unit);
    enter(
      a,
      null,
      null,
      a.unit.source === "loja"
        ? `Na sua loja (slot ${a.card.slot}): compre para a vaga livre`
        : "Vaga livre no seu nível: coloque em campo",
    );
  }

  // 3) Titular × substituto em campo: o par de maior vantagem do titular primeiro. T só entra (e recebe os itens de S) se
  // render mais que S (atributos na estrela, sinergia que liga e itens); senão S fica e a troca espera a estrela de T.
  let subs = [...fieldBy.values()].filter((u) => !goalIds.has(u.id));
  for (;;) {
    let best = null;
    for (const a of avail)
      for (const s of subs) {
        // O titular que ocupa mais vagas que o substituto (Elder Dragon) só entra com a vaga que falta livre.
        if (unitSlots(a.unit) - unitSlots(s) > free) continue;
        const delta = swapDelta(a.unit, s, board, sctx);
        if (!best || delta > best.delta) best = { a, s, delta };
      }
    if (!best || !(best.delta > margin)) break;
    const { a, s, delta } = best,
      sName = s.name ?? nameOf(s.id);
    free -= unitSlots(a.unit) - unitSlots(s);
    enter(
      a,
      { ...s, name: sName },
      round1(delta),
      `${a.unit.name} ${a.unit.stars}★ já rende mais que ${sName} ${clampStars(s.stars)}★ (+${round1(delta)}, atributos, sinergia e itens): troque e passe os itens`,
    );
    subs = subs.filter((x) => x !== s);
  }

  // 4) Vaga livre sem titular para ela: a peça fora da comp mais forte da reserva, depois a da loja que paga o ouro.
  const fills = [];
  if (free > 0) {
    const reserveSubs = [...reserveBy.values()]
      .filter((u) => !goalIds.has(u.id))
      .map((u) => ({
        u: unitOf(u, "reserva"),
        gain: slotStrength(u, board, sctx).value,
      }))
      .sort((a, b) => b.gain - a.gain);
    for (const r of reserveSubs) {
      if (free < unitSlots(r.u)) continue;
      free -= unitSlots(r.u);
      fills.push({
        ...r.u,
        why: "Vaga livre: a peça mais forte da reserva joga até a comp chegar",
      });
      board.push({ id: r.u.id, stars: r.u.stars, items: r.u.items });
    }
    const shopSubs = cards
      .filter(
        (c) =>
          c.buy &&
          !goalIds.has(c.id) &&
          !fieldBy.has(c.id) &&
          !reserveBy.has(c.id),
      )
      .map((c) => {
        const u = { id: c.id, stars: 1, items: [] },
          gain = slotStrength(u, board, sctx).value,
          econ = interimBuyWorth({
            gain,
            cost: c.cost ?? costOf(c.id),
            gold: input.gold,
            level,
            band,
          });
        return { c, gain, econ };
      })
      .filter((x) => x.econ.worth)
      .sort((a, b) => b.gain - a.gain);
    const seen = new Set();
    for (const x of shopSubs) {
      if (free < unitSlots(x.c.id)) continue;
      if (seen.has(x.c.id)) continue;
      seen.add(x.c.id);
      free -= unitSlots(x.c.id);
      const u = unitOf({ id: x.c.id, name: x.c.name }, "loja");
      fills.push({
        ...u,
        buy: { cost: x.c.cost ?? u.cost, slot: x.c.slot },
        why: `Na sua loja (slot ${x.c.slot}): temporário para a vaga vazia, +${x.econ.gainHp} de vida em ${x.econ.rounds} rodadas contra ${x.econ.costGold}g de juros`,
        econ: x.econ,
      });
      board.push({ id: u.id, stars: 1, items: [] });
    }
  }

  // 5) Quem joga fora da própria vaga (substitutos em campo e as peças que encheram vagas livres) vai para as vagas do plano
  // ainda sem peça: primeiro a do titular que você já tem (ele espera na reserva), depois as que faltam (carry, custo).
  const players = [
    ...subs.map((s) => ({ ...unitOf(s, "campo"), why: null })),
    ...fills,
  ];
  const open = goal
    .filter((u) => !playing.has(u.id))
    .sort(
      (a, b) =>
        Number(reserveBy.has(b.id) || !!cardOf(b.id)) -
          Number(reserveBy.has(a.id) || !!cardOf(a.id)) ||
        Number(carryOf(b)) - Number(carryOf(a)) ||
        costOf(b.id) - costOf(a.id),
    );
  const holder = new Map(); // id da peça do plano → substituto
  for (const t of open) {
    if (!players.length) break;
    const tFront = isFront(ctx.byId.get(t.id)),
      tUnit = reserveBy.has(t.id)
        ? unitOf(reserveBy.get(t.id), "reserva")
        : { id: t.id, stars: 1, items: [] };
    const ranked = players
      .map((p) => ({
        p,
        match: isFront(ctx.byId.get(p.id)) === tFront,
        delta: swapDelta(tUnit, p, board, sctx),
      }))
      .sort((a, b) => Number(b.match) - Number(a.match) || b.delta - a.delta);
    const pick = ranked[0];
    players.splice(players.indexOf(pick.p), 1);
    holder.set(t.id, { ...pick.p, delta: round1(pick.delta) });
  }

  // A volta do titular: a menor estrela em que ele supera o substituto pela margem, com a chance de juntar as cópias nas
  // próximas lojas; senão o nível em que as sinergias pesam mais; senão os itens do carry.
  const until = (t, s) => {
    const have = owned(t.id),
      start = Math.max(
        1,
        reserveBy.has(t.id) ? clampStars(reserveBy.get(t.id).stars) : 1,
      ),
      tName = t.name ?? nameOf(t.id),
      sName = s.name ?? nameOf(s.id),
      tUnit = { id: t.id, items: reserveBy.get(t.id)?.items ?? [] };
    for (let k = start; k <= 3; k++) {
      if (k === start && reserveBy.has(t.id)) continue; // a estrela que ele já tem não vence (senão teria entrado)
      const d = swapDelta({ ...tUnit, stars: k }, s, board, sctx, k);
      if (!(d > margin)) continue;
      const need = Math.max(0, starCopies(k) - have),
        perSlot = input.pool?.get?.(t.id)?.chancePerSlot ?? null,
        chance =
          need > 0 && Number.isFinite(perSlot)
            ? chanceAtLeast(slotsIn(I.returnShops), perSlot, need)
            : null;
      if (k === 1)
        return {
          kind: "compra",
          stars: 1,
          need: have ? 0 : 1,
          have: Math.min(have, 1),
          chance: null,
          text: have
            ? `${tName} 1★ já vale a vaga: coloque-o em campo`
            : `${tName} entra assim que você o comprar`,
        };
      const odds =
        chance === null
          ? ""
          : chance >= I.returnChance
            ? `, ~${pctText(chance)} nas próximas ${I.returnShops} lojas`
            : `, pouco provável nas próximas ${I.returnShops} lojas (${pctText(chance)})`;
      return {
        kind: "estrela",
        stars: k,
        need,
        have: Math.min(have, starCopies(k)),
        chance,
        text: `volta quando ${tName} chegar a ${k}★ (faltam ${need} ${need === 1 ? "cópia" : "cópias"}${odds})`,
      };
    }
    if (level !== null && level < I.synergy.lateLevel) {
      const late = { ...sctx, level: I.synergy.lateLevel },
        d = swapDelta({ ...tUnit, stars: start }, s, board, late, start);
      if (d > margin)
        return {
          kind: "nivel",
          level: I.synergy.lateLevel,
          text: `volta no nível ${I.synergy.lateLevel} (as sinergias da comp passam a pesar mais)`,
        };
    }
    return {
      kind: "nenhum",
      text: `${sName} segue mais forte mesmo com ${tName} 3★: sem previsão de volta`,
    };
  };

  // 6) Compra dos dois: titular que aparece na loja e não entra agora vai para a reserva (cabe na reserva lida, ou a venda
  // do substituto mais fraco da reserva abre a vaga). As cópias do titular nunca são vendidas.
  for (const t of open) {
    if (reserveBy.has(t.id) || fieldBy.has(t.id)) continue;
    const card = cardOf(t.id);
    if (!card) continue;
    let sell = null;
    if (benchKnown && benchUsed >= I.bench) {
      const weakest = [...reserveBy.values()]
        .filter((u) => !goalIds.has(u.id) && !sold.has(u.id))
        .sort(
          (a, b) =>
            slotStrength(a, board, sctx).value -
            slotStrength(b, board, sctx).value,
        )[0];
      if (!weakest) continue;
      sell = refOf({
        id: weakest.id,
        name: weakest.name ?? nameOf(weakest.id),
      });
      sold.add(weakest.id);
    } else benchUsed++;
    buys.push({
      slot: card.slot,
      id: card.id,
      name: t.name ?? nameOf(t.id),
      cost: card.cost ?? costOf(t.id),
      purpose: "reserva",
      for: refOf(t),
      replaces: null,
      sell,
    });
  }
  for (const f of fills)
    if (f.source === "loja")
      buys.push({
        slot: f.buy.slot,
        id: f.id,
        name: f.name,
        cost: f.buy.cost,
        purpose: "temporario",
        for: null,
        replaces: null,
        gainHp: f.econ.gainHp,
        costGold: f.econ.costGold,
      });

  // 7) As vagas, na ordem do plano, e as vagas extras (substituto sem vaga do plano livre).
  let freeForBuy = Math.max(
    0,
    cap -
      slotsUsed([...playing.values()]) -
      slotsUsed(holder.values()) -
      slotsUsed(players),
  );
  const slots = goal.map((u, i) => {
    const swap = swapOut.get(u.id) ?? null,
      out = swap?.out ?? null,
      orig = out
        ? { id: out, name: nameOf(out), cost: costOf(out) }
        : {
            id: u.id,
            name: u.name ?? nameOf(u.id),
            cost: costOf(u.id) || u.cost || 0,
          },
      have = fieldBy.has(u.id)
        ? "campo"
        : reserveBy.has(u.id)
          ? "reserva"
          : "falta",
      shopCard = anyCardOf(u.id);
    const original = {
      ...orig,
      stars: fieldBy.has(u.id)
        ? clampStars(fieldBy.get(u.id).stars)
        : reserveBy.has(u.id)
          ? clampStars(reserveBy.get(u.id).stars)
          : 0,
      have,
      // Cópias suas (equivalentes de 1★: campo, reserva e o que a pool viu): o progresso da volta pela estrela.
      copies: owned(u.id),
      shop: shopCard
        ? {
            slot: shopCard.slot,
            cost: shopCard.cost ?? costOf(u.id),
            buy: !!shopCard.buy,
          }
        : null,
    };
    if (out) original.stars = 0;
    const base = {
      slot: i,
      unit: refOf(u),
      cell: positions.get(u.id) ?? null,
      original,
    };
    const p = playing.get(u.id);
    if (p) {
      const d = decided.get(u.id);
      const buy =
        p.source === "loja"
          ? {
              cost: buys.find((b) => b.id === p.id)?.cost ?? p.cost,
              slot: buys.find((b) => b.id === p.id)?.slot ?? null,
            }
          : null;
      return {
        ...base,
        playing: {
          id: p.id,
          name: p.name,
          cost: p.cost,
          stars: p.stars,
          source: p.source,
          items: p.items,
          buy,
        },
        kind: out ? "troca-da-comp" : "titular",
        why:
          d?.why ??
          (out
            ? (swap.why ?? `troca da comp: ${p.name} no lugar de ${orig.name}`)
            : "em campo"),
        until: null,
        replaces: d?.replaces ?? null,
        delta: d?.delta ?? null,
        ifBought: null,
      };
    }
    const h = holder.get(u.id);
    // O que comprar o titular que falta faria: entra no lugar do substituto (se o supera em 1★), na vaga livre, ou espera.
    let ifBought = null;
    if (have === "falta") {
      if (h) {
        const d1 = swapDelta(
          { id: u.id, stars: 1, items: [] },
          h,
          board,
          sctx,
          1,
        );
        ifBought =
          d1 > margin
            ? { place: "troca", replaces: refOf(h) }
            : { place: "banco", replaces: null };
      } else if (freeForBuy > 0) {
        freeForBuy--;
        ifBought = { place: "vaga", replaces: null };
      } else ifBought = { place: "banco", replaces: null };
    }
    if (h) {
      const tRef = { id: u.id, name: u.name ?? nameOf(u.id) },
        back = until(u, h),
        hBuy = h.source === "loja" ? h.buy : null;
      return {
        ...base,
        playing: {
          id: h.id,
          name: h.name,
          cost: h.cost,
          stars: h.stars,
          source: h.source,
          items: h.items,
          buy: hBuy,
        },
        kind: "temporario",
        why:
          h.why ??
          (have === "reserva"
            ? `${h.name} ${h.stars}★ supera ${tRef.name} ${original.stars}★ por mais que a margem (${h.delta}): guarde ${tRef.name} na reserva`
            : have === "falta" && shopCard?.buy
              ? `${h.name} ${h.stars}★ supera ${tRef.name} 1★ por mais que a margem: compre ${tRef.name} e guarde na reserva (compre os dois)`
              : `${h.name} ${h.stars}★ segura a vaga até ${tRef.name} chegar`),
        until: back,
        replaces: null,
        delta: h.delta,
        ifBought,
      };
    }
    return {
      ...base,
      playing: null,
      kind: out ? "troca-da-comp" : "titular",
      why:
        out && swap.by === "nivel" && have === "falta"
          ? `${swap.why}: compre quando aparecer`
          : have === "reserva"
            ? `sem vaga no nível ${cap}: guarde na reserva`
            : ifBought?.place === "vaga"
              ? "vaga livre: compre quando aparecer"
              : "falta: compre quando aparecer",
      until: null,
      replaces: null,
      delta: null,
      ifBought,
    };
  });
  players.forEach((p, n) =>
    slots.push({
      slot: goal.length + n,
      unit: null,
      cell: null,
      original: null,
      playing: {
        id: p.id,
        name: p.name,
        cost: p.cost,
        stars: p.stars,
        source: p.source,
        items: p.items,
        buy: p.source === "loja" ? p.buy : null,
      },
      kind: "temporario",
      why: p.why ?? "vaga extra: a comp não tem peça para ela agora",
      until: null,
      replaces: null,
      delta: null,
      ifBought: null,
    }),
  );
  const both = buys.filter((b) => b.purpose === "reserva");
  const note = both.length
    ? `Compre os dois: ${both.map((b) => `${b.name} (slot ${b.slot}) vai para a reserva`).join("; ")}; o temporário segue em campo.`
    : null;
  return {
    slots,
    buys,
    margin,
    shopKnown,
    bench: benchKnown
      ? { known: true, used: benchUsed, free: Math.max(0, I.bench - benchUsed) }
      : { known: false, used: null, free: null },
    note,
  };
}

/**
 * A troca de uma peça do plano que ainda não está em campo, no formato de `tactics.mjs` (`plan.transitions`), lida da vaga
 * dela em `interimSlots`: entra agora (`ready`; `exit` = quem sai, ou null numa vaga livre), espera com um temporário
 * segurando a vaga (`exit` = o temporário; `requiredStars` = a estrela da volta, null sem previsão) ou espera vaga.
 */
export function transitionOf(slot, u, inReserve, copies = 0) {
  const enter = { id: u.id, name: u.name },
    source = inReserve ? "reserve" : "shop",
    base = {
      enter,
      source,
      enterCopies: copies,
      enterStars: inReserve
        ? Math.max(1, starsForCopies(copies))
        : starsForCopies(copies),
    };
  const p = slot?.playing ?? null;
  if (!p)
    return {
      ...base,
      exit: null,
      reason: slot?.why ?? "Adicionar quando houver slot livre no seu nível.",
      requiredStars: null,
      ready: false,
    };
  if (p.id === u.id) {
    const out = slot.replaces;
    return {
      ...base,
      exit: out ? { id: out.id, name: out.name, items: out.items ?? [] } : null,
      exitStars: out?.stars ?? 0,
      enterStars: p.stars,
      reason: slot.why,
      requiredStars: p.stars,
      ready: true,
      // Entra comprando a carta da loja agora: é uma compra (lista Comprar), não uma troca do painel.
      fromShop: p.source === "loja",
      buy: p.buy ?? null,
      delta: slot.delta,
    };
  }
  const back = slot.until;
  return {
    ...base,
    exit: { id: p.id, name: p.name, items: p.items ?? [] },
    exitStars: p.stars,
    reason: `Segure ${p.name} ${p.stars}★ (temporário): ${back?.text ?? slot.why}.`,
    requiredStars:
      back?.kind === "estrela" || back?.kind === "compra" ? back.stars : null,
    ready: false,
    delta: slot.delta,
    until: back ?? null,
  };
}

/**
 * As trocas (`plan.transitions`) das vagas cujo titular ainda não está em campo, na ordem do plano: tactics.mjs (sem a
 * loja) e a análise final (com a loja e a faixa de vida da Formação) leem as MESMAS vagas, então nunca se contradizem.
 */
export const slotTransitions = (slots) =>
  (slots ?? [])
    .filter((s) => s.unit && s.original?.have !== "campo")
    .map((s) =>
      transitionOf(
        s,
        s.unit,
        s.original.have === "reserva",
        s.original.copies ?? 0,
      ),
    );
