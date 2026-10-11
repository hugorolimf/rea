"use strict";
// Contrato da ponte com o Overwolf GEP para TFT: ids de jogo, features pedidas e o que pode ser guardado.
// Fonte dos nomes: documentacao publica do GEP de TFT (dev.overwolf.com, "Teamfight Tactics") e o que o helper le em
// gep-reader.mjs. Nada daqui vem de copiar codigo de outro app.

/** TFT cliente classico e TFT cliente UE5. O GEP pode reportar o id com sufixo (21570 -> 215701): ver `matchesGameId`. */
const GAME_IDS = Object.freeze([21570, 28164]);

/**
 * Features pedidas. Escolha minima de proposito:
 *  - sem `augments` (Riot proibe dados de aprimoramentos em apps de terceiros; o Overwolf avisa na pagina de TFT);
 *  - sem `board` (traz `opponent_board_pieces`), `match_stats` (`board_players`: todos os jogadores) e
 *    `live_client_data` (`all_players`): o helper nao precisa deles e nada de rival deve nem chegar ao app.
 * `roster` e `bench` chegam com linhas de todos os jogadores (`player_status`, `item_bench`); o filtro em sanitize.cjs
 * descarta tudo que nao e do jogador local antes de qualquer gravacao.
 */
const FEATURES = Object.freeze([
  "gep_internal",
  "me",
  "match_info",
  "roster",
  "store",
  "bench",
  "carousel",
]);

/** Pares `feature.key` de informacao que podem ser gravados (todos do jogador local ou da mesa inteira, nunca de rival). */
const INFO_KEYS = Object.freeze(
  new Set([
    "gep_internal.version_info",
    "me.gold",
    "me.xp",
    "me.health",
    "me.rank",
    "me.summoner_name",
    "match_info.round_type",
    "match_info.match_state",
    "match_info.battle_state",
    "match_info.game_mode",
    "roster.player_status", // reduzido a linha do jogador local
    "store.shop_pieces",
    "store.shop_visible",
    "bench.bench_pieces",
    "bench.item_bench", // reduzido a linha do jogador local
    // O carrossel e o mesmo para a mesa inteira (nao e dado de rival).
    "carousel.carousel_pieces",
  ]),
);

/** Eventos (canal `new-game-event`) que podem ser gravados, pela chave. */
const EVENT_KEYS = Object.freeze(
  new Set([
    "match_start",
    "match_end",
    "round_start",
    "round_end",
    "battle_start",
    "battle_end",
    "picked_item",
    "shop_visible",
  ]),
);

/** O id reportado pode ser o da classe vezes dez mais um sufixo. */
const matchesGameId = (reported, gameId) =>
  reported === gameId || Math.floor(Number(reported) / 10) === gameId;
const isTftGameId = (reported) =>
  GAME_IDS.some((id) => matchesGameId(reported, id));
const toConfiguredGameId = (reported) =>
  GAME_IDS.find((id) => matchesGameId(reported, id)) ?? reported;

module.exports = {
  GAME_IDS,
  FEATURES,
  INFO_KEYS,
  EVENT_KEYS,
  isTftGameId,
  toConfiguredGameId,
};
