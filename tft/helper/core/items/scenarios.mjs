/**
 * Fachadas do motor único de itens, uma por cenário (ver `../../planos/feitos/itens-motor-unico.md`). Cada uma recebe o estado/os
 * fatos daquele cenário e devolve um modelo pronto: a build de cada campeão (de `builds.mjs`, com a origem e, quando
 * publicada na comp, a variação e as partidas) e a situação de cada item do jogador (de `holdings.mjs`). A interface e o
 * overlay só apresentam. Puro; carrega igual no servidor e no navegador.
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
