// Livro-razão das unidades do jogador, reconstruído dos eventos de unidade que o TFT.log grava (voz de compra e de
// subida de estrela, cada uma com o id estável da entidade `TFTCharacter_<n>`).
//
// O QUE O LOG TRAZ: uma entrada por compra e uma por fusão (3 cópias viram 1). O QUE NÃO TRAZ: venda, movimento
// tabuleiro<->reserva (só as tentativas RECUSADAS de arrastar são gravadas), entrada por carrossel/aprimoramento/prêmio,
// ouro, rerolagem e XP. Por isso o livro-razão fecha o que foi ADQUIRIDO, mas não a reserva: tudo o que sai do jogador por
// venda continua aparecendo como "sobra". Validação com 8 partidas reais em FONTES-DE-DADOS.md (`LEDGER_VALIDATION`).
//
// Contagem em "cópias": uma peça de `s` estrelas vale 3^(s-1) cópias de 1 estrela, o que torna a fusão neutra e dispensa
// seguir as estrelas uma a uma.

import { starCopies } from "./core/pool/copies.mjs";

/** Tamanho da reserva do jogo (9 vagas). A sobra acima disso prova que houve vendas. */
export const BENCH_CAPACITY = 9;

/** Cópias de 1 estrela que uma peça de `star` estrelas representa. */
export const copies = starCopies;

/**
 * Resultado medido da validação do livro-razão contra o jogo real (8 partidas de 2026-10-09/10, 197 retratos do
 * tabuleiro do jogador em `TFTEoGStats.json`). Fica no estado para que ninguém trate a sobra como reserva sem ler isto.
 */
export const LEDGER_VALIDATION = Object.freeze({
  verifiedAt: "2026-10-10",
  games: 8,
  boardSnapshots: 197,
  // Retratos em que o adquirido cobre todo o tabuleiro (as peças vindas de carrossel/prêmio não têm compra no log).
  snapshotsCoveredByAcquired: 62,
  // Partidas cujo último retrato do tabuleiro é inteiramente explicado pelas compras do log (as demais têm 1 a 3 cópias
  // vindas de carrossel/prêmio, sem compra).
  gamesWithFullBoardExplained: 4,
  // Sobra média (adquirido menos tabuleiro, em cópias) por partida [mín, máx], e reserva PROVADA (peça fora do tabuleiro
  // que volta a campo depois, sem nova compra): a sobra é de 5 a 25 vezes a reserva provável, pois vendas não são gravadas.
  meanSurplusPerGame: [5.8, 21.5],
  meanProvableBenchPerGame: [0.5, 3.4],
  // Sobra no último retrato (cópias) contra a capacidade da reserva (9): só dá para explicar com vendas.
  finalSurplusPerGame: [16, 48],
  benchReconstructable: false,
  missingEvents: [
    "venda",
    "movimento tabuleiro<->reserva",
    "entrada por carrossel/aprimoramento/prêmio",
    "reroll",
    "compra de XP",
  ],
});

/** Livro-razão vazio. `actors` guarda as entidades já vistas (`corrida:id`), `bought` e `unseen` contam cópias por campeão. */
export function emptyLedger() {
  return {
    actors: new Set(),
    bought: new Map(),
    unseen: new Map(),
    purchases: 0,
    fusions: 0,
    unseenActors: 0,
  };
}

const bump = (map, key, by) => map.set(key, (map.get(key) ?? 0) + by);

/**
 * Soma um evento (`purchase`/`starUp` de `parseLogLine`) ao livro-razão. `run` separa as execuções do jogo dentro da mesma
 * partida (queda e reconexão): os ids de entidade recomeçam em cada execução.
 *
 * - Compra: cada entidade nova é uma cópia comprada. A mesma entidade repetida (a voz "bloqueada" que acompanha a tocada)
 *   não conta duas vezes.
 * - Subida de estrela: a entidade citada é a que sobrevive. Se ela nunca apareceu numa compra, a cópia que a originou
 *   (carrossel, prêmio, compra anterior à leitura) entra como "sem compra" (`unseen`).
 */
export function applyUnitEvent(ledger, event, run = 0) {
  if (!event?.actor || !event.id) return ledger;
  const key = `${run}:${event.actor}`;
  if (event.type === "purchase") {
    if (ledger.actors.has(key)) return ledger;
    ledger.actors.add(key);
    bump(ledger.bought, event.id, 1);
    ledger.purchases++;
  } else if (event.type === "starUp") {
    ledger.fusions++;
    if (!ledger.actors.has(key)) {
      ledger.actors.add(key);
      const origin = copies(event.star - 1);
      bump(ledger.unseen, event.id, origin);
      ledger.unseenActors++;
    }
  }
  return ledger;
}

/**
 * Confronta o adquirido com as peças em campo (`boardPieces` do jogador em `TFTEoGStats.json`).
 * - `surplus`: cópias adquiridas que não estão em campo = reserva + vendidas (indistinguíveis: o log não grava a venda).
 * - `deficit`: cópias em campo que o log não explica (vieram de carrossel, aprimoramento ou prêmio).
 * Devolve só números derivados; `benchUpperBound` é um teto, nunca a reserva.
 */
export function reconcileLedger(ledger, boardPieces = []) {
  const board = new Map();
  for (const p of boardPieces) {
    const id = p?.championName ?? p?.id;
    if (id) bump(board, id, copies(p.starLevel ?? p.stars));
  }
  const acquired = new Map(ledger.bought);
  for (const [id, n] of ledger.unseen) bump(acquired, id, n);
  const champions = [];
  let surplusTotal = 0,
    deficitTotal = 0,
    acquiredTotal = 0,
    boardTotal = 0;
  for (const id of new Set([...acquired.keys(), ...board.keys()])) {
    const a = acquired.get(id) ?? 0,
      b = board.get(id) ?? 0,
      surplus = Math.max(0, a - b),
      deficit = Math.max(0, b - a);
    acquiredTotal += a;
    boardTotal += b;
    surplusTotal += surplus;
    deficitTotal += deficit;
    champions.push({ id, acquired: a, board: b, surplus, deficit });
  }
  champions.sort(
    (x, y) =>
      y.surplus - x.surplus ||
      y.deficit - x.deficit ||
      x.id.localeCompare(y.id),
  );
  return {
    acquiredTotal,
    boardTotal,
    surplusTotal,
    deficitTotal,
    benchUpperBound: surplusTotal,
    // Sobra acima da capacidade da reserva: pelo menos esta quantidade de cópias foi vendida.
    soldAtLeast: Math.max(0, surplusTotal - BENCH_CAPACITY),
    boardExplained: deficitTotal === 0,
    champions,
  };
}

/**
 * Livro-razão de uma partida a partir das execuções do jogo (cada uma com seus eventos de unidade, em ordem).
 * `runs`: `[{ events: [...] }]`.
 */
export function buildLedger(runs) {
  const ledger = emptyLedger();
  runs.forEach((run, index) => {
    for (const event of run.events) applyUnitEvent(ledger, event, index);
  });
  return ledger;
}

/** Estado do livro-razão para o servidor: contagens + o que se sabe e o que não se sabe. */
export function ledgerStatus(ledger, boardPieces) {
  const rec = reconcileLedger(ledger, boardPieces);
  return {
    source: "tft-log",
    // Compras e fusões são observadas; a conta contra o tabuleiro é derivada; a reserva NÃO sai daqui (ver abaixo).
    purchases: {
      reliability: "observed",
      count: ledger.purchases,
      fusions: ledger.fusions,
      withoutPurchase: ledger.unseenActors,
    },
    reconciliation: { reliability: "derived", ...rec },
    bench: {
      reliability: "estimated",
      reconstructable: false,
      upperBound: rec.benchUpperBound,
      reason:
        "o TFT.log não grava venda nem movimento tabuleiro<->reserva: a sobra mistura reserva e peças vendidas",
    },
    validation: LEDGER_VALIDATION,
  };
}
