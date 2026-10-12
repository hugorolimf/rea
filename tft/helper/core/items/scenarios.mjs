/**
 * Fachadas do motor único de itens, uma por cenário (ver `../../planos/feitos/itens-motor-unico.md`). Cada uma recebe o estado/os
 * fatos daquele cenário e devolve um modelo pronto: a build de cada campeão (de `builds.mjs`, com a origem e, quando
 * publicada na comp, a variação e as partidas) e a situação de cada item do jogador (de `holdings.mjs`). A interface e o
 * overlay só apresentam. Puro; carrega igual no servidor e no navegador.
 *
 * Regra de alvo (do usuário): toda recomendação de item é só para os campeões da comp do plano (a fixada ou, sem ela, a
 * recomendada): `planTargetIds`, `planBuildsOnly`, `bankItemTargets` e, no plano de itens, `buildOf` (item-plan.mjs).
 *
 * Cenários:
 * - plano (Formação, Ao vivo, overlay, checklist): `tactics.mjs` → `championBuild` por peça (`itemPlans`); no navegador,
 *   `formationBuilds` + `championItemsView`;
 * - comp candidata no ranking (motor/score): `compBuildMap` + `compSpendOrder` → `classifyHoldings`;
 * - carrossel: `itemPlans[].ideal` (o mesmo `championBuild`) e `pendingItems` para as cópias;
 * - loja/compra e "Passar itens": `wantedItems` (a build publicada; sem ela, a reserva);
 * - campeão sem comp: `championBuild` com `comp = null` (reserva marcada em `origin`/`reserve`);
 * - aba Comps: `compBuildRows` ("Builds e 3★") e `compItems` (v2/js/comp-items.js) sobre `compBuild`.
 */
import { championItems } from "./champion-items.mjs";
import { ownersOf } from "./holdings.mjs";
import { movesInto } from "./moves.mjs";

/**
 * Build de cada peça do plano para a Formação (janela do campeão), o Ao vivo e o overlay.
 * - `itemPlans`: `plan.itemPlans` do servidor (uma `championBuild` por peça);
 * - `units`/`reserve`: peças do jogador (`self.units`, `self.reserve`: `{ championName, name, starLevel, itemNames }`);
 * - `goalIds`: Set das peças do plano (ficam); `itemMoves`: "Passar itens" do plano.
 * Devolve Map campeão → `{ origin, reserve, source, delta, n, equipped, ideal, slotsFree, owners, moves }`: `owners` diz
 * onde está cada item seu (campo e reserva), para "falta" só o que não existe em lugar nenhum; `moves`, de quem sai o
 * item que o plano passa para esta peça.
 */
export function formationBuilds({
  itemPlans = [],
  units = [],
  reserve = [],
  goalIds = new Set(),
  itemMoves = [],
} = {}) {
  const byId = new Map((itemPlans ?? []).map((b) => [b.championId, b]));
  const owners = ownersOf(
    [
      ...(units ?? []).map((u) => ({ ...u, zone: "board" })),
      ...(reserve ?? []).map((u) => ({ ...u, zone: "reserve" })),
    ],
    goalIds,
    (id) => (byId.get(id)?.ideal ?? []).slice(0, 3).map((i) => i.id),
  );
  return new Map(
    [...byId].map(([id, b]) => [
      id,
      {
        origin: b.origin ?? null,
        reserve: b.reserve === true,
        source: b.source ?? "",
        delta: Number.isFinite(b.delta) ? b.delta : null,
        n: Number.isFinite(b.n) ? b.n : null,
        equipped: b.equipped ?? [],
        ideal: b.ideal ?? [],
        slotsFree: b.slotsFree ?? 0,
        owners,
        moves: movesInto(itemMoves, id).map(({ itemId, fromId }) => ({
          itemId,
          fromId,
        })),
      },
    ]),
  );
}

const thousands = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")} mil` : String(n);

/**
 * De onde vem a build (frase curta para a interface e o overlay): a publicada na comp, com a variação e as partidas
 * escritas como na aba Comps ("−0,50 · 2,9 mil partidas"), ou a reserva quando a comp não publica build para o campeão.
 */
export function buildSourceNote(b) {
  if (!b) return "";
  if (b.reserve)
    return b.origin === "heuristica"
      ? "Sem build publicada nesta comp nem dado de meta: reserva pela heurística de papel."
      : "Sem build publicada nesta comp: reserva (build geral da MetaTFT e medição).";
  if (Number.isFinite(b.delta))
    return `Build da comp: ${b.delta > 0 ? "+" : "−"}${Math.abs(b.delta).toFixed(2).replace(".", ",")}${Number.isFinite(b.n) ? ` · ${thousands(b.n)} partidas` : ""}.`;
  return b.origin === "comp" ? "Build da comp." : "";
}

/**
 * Itens de um campeão do plano prontos para desenhar (Ao vivo "Itens dos campeões", overlay, janela da Formação): a
 * origem da build e a situação de cada item segundo o banco. `cell`: `{ id, build }` (de `formationBuilds`); `bank`: ids
 * do banco lido. `{ origin, reserve, source, delta, n, note, items }` (`items`: `championItems`; `note`:
 * `buildSourceNote`).
 */
export function championItemsView(cell, bank = []) {
  const b = cell?.build ?? null;
  return {
    origin: b?.origin ?? null,
    reserve: b?.reserve === true,
    source: b?.source ?? "",
    delta: b?.delta ?? null,
    n: b?.n ?? null,
    note: buildSourceNote(b),
    items: b ? championItems(cell, bank) : [],
  };
}

/**
 * Alvo de TODA recomendação de item (regra do usuário): só os campeões da comp do plano, a fixada (`rec.preview`) ou,
 * sem ela, a recomendada (`rec.recommendations[0]`), com as trocas aceitas já aplicadas no tabuleiro do plano. Peça fora
 * da comp, em campo ou na reserva, não recebe build, "próximo item", item montado nem item do banco para si; ela só pode
 * ceder itens ("Passar itens") ou, se for o temporário de uma vaga, SEGURAR um item da build do titular (`bankItemTargets`).
 * Devolve o Set dos ids das peças do plano (vazio sem plano).
 */
export const planTargetIds = (plan) =>
  new Set((plan?.board ?? []).map((u) => u?.id).filter(Boolean));

/** As builds (`{ championId }`) só das peças da comp do plano: a de peça fora da comp sai da lista. */
export const planBuildsOnly = (builds = [], plan = null) => {
  const ids = planTargetIds(plan);
  return (builds ?? []).filter((b) => ids.has(b.championId));
};

/**
 * Item pronto do banco ("Equipar" da Formação e do overlay): para quem vai cada item completo do banco. Só peças da comp:
 * 1. a peça da comp em campo, com vaga, cuja build pede o item (melhor posição; o carry desempata);
 * 2. sem ela, o temporário que segura a vaga de um titular cuja build pede o item: ele SEGURA o item para o titular
 *    ("segure X em S para T"); o alvo continua sendo o titular (`for`);
 * 3. sem isso, a peça da comp em campo, com vaga, de papel compatível com o item;
 * 4. senão, guarde (para o titular que ainda não está em campo, se a build dele pede o item).
 * - `items`: ids completos do banco ainda não equipados (sem componentes nem consumíveis), na ordem do banco;
 * - `members`: peças da comp `[{ id, name, onField, room, role }]` (`room` = slots livres agora; 0 fora de campo);
 * - `holders`: temporários em campo `[{ id, name, room, for: { id, name } }]` (a vaga do titular `for`);
 * - `wish(id)`: itens que a peça pede (`wantedItems`); `fromComp(id)`: a build dela é a publicada na comp;
 * - `roleOf(itemId)`: papel do item ("ad" | "ap" | "tank" | "flex"); `carry`: nome do carry; `nameOf(itemId)`.
 * Devolve `[{ id, name, to, for, reason }]` (`to`: onde equipar agora, ou null = guardar; `for`: o titular, quando `to`
 * só segura o item). Não muta as entradas.
 */
export function bankItemTargets({
  items = [],
  members = [],
  holders = [],
  wish = () => [],
  fromComp = () => true,
  roleOf = () => "flex",
  carry = null,
  nameOf = (id) => id,
} = {}) {
  const room = new Map(
    [...members, ...holders].map((u) => [u.id, Math.max(0, u.room ?? 0)]),
  );
  const rankIn = (u, id) => wish(u.id).indexOf(id);
  const build = (u, rank) =>
    `${rank + 1}º item de ${u.name} na build ${fromComp(u.id) ? "da comp" : "geral (reserva)"}`;
  return (items ?? []).map((id) => {
    const name = nameOf(id),
      take = (u) => room.set(u.id, room.get(u.id) - 1),
      free = (u) => (room.get(u.id) ?? 0) > 0,
      field = members.filter((u) => u.onField !== false);
    // 1) A peça da comp em campo que pede o item.
    const wants = field
      .filter(free)
      .map((u) => ({ u, rank: rankIn(u, id) }))
      .filter((x) => x.rank >= 0)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          Number(b.u.name === carry) - Number(a.u.name === carry),
      )[0];
    if (wants) {
      take(wants.u);
      return {
        id,
        name,
        to: { id: wants.u.id, name: wants.u.name },
        for: null,
        reason: build(wants.u, wants.rank),
      };
    }
    // 2) O temporário segura o item para o titular da vaga dele.
    const held = holders
      .filter(free)
      .map((h) => ({ h, rank: h.for ? wish(h.for.id).indexOf(id) : -1 }))
      .filter((x) => x.rank >= 0)
      .sort((a, b) => a.rank - b.rank)[0];
    if (held) {
      take(held.h);
      return {
        id,
        name,
        to: { id: held.h.id, name: held.h.name },
        for: { id: held.h.for.id, name: held.h.for.name },
        reason: `segure ${name} em ${held.h.name} para ${held.h.for.name} (temporário na vaga dele): ${build(held.h.for, held.rank)}`,
      };
    }
    // 3) Papel compatível, só entre as peças da comp em campo.
    const fits = field
      .filter(
        (u) => free(u) && (roleOf(id) === "flex" || roleOf(id) === u.role),
      )
      .sort((a, b) => Number(b.name === carry) - Number(a.name === carry))[0];
    if (fits) {
      take(fits);
      return {
        id,
        name,
        to: { id: fits.id, name: fits.name },
        for: null,
        reason: `papel compatível com ${fits.name}`,
      };
    }
    // 4) Guarde: para o titular que ainda não está em campo, se a build dele pede o item.
    const later = members
      .map((u) => ({ u, rank: rankIn(u, id) }))
      .filter((x) => x.rank >= 0)
      .sort((a, b) => a.rank - b.rank)[0];
    return {
      id,
      name,
      to: null,
      for: later ? { id: later.u.id, name: later.u.name } : null,
      reason: later
        ? `guarde para ${later.u.name}: ${build(later.u, later.rank)}`
        : "nenhuma peça da comp com slot livre usa este item; guarde",
    };
  });
}
