// Fonte GEP (Overwolf Game Events Provider) lida do banco que o TFTAcademy grava: ouro, nível/XP, loja (campeões e Wisps),
// reserva (bench), banco de itens e aprimoramentos (oferta e escolhidos) DO PRÓPRIO jogador, sem leitura de tela.
// Esquema, mapeamento, frescor e limites: FONTES-DE-DADOS.md, seção "GEP / TFTAcademy".
//
// Regras desta fonte (não negociáveis):
//  - Somente leitura: o banco é aberto com `readOnly` quando existe `-wal`/`-shm` (alguém o tem aberto e as linhas
//    recentes só estão no WAL: `immutable=1` as perderia) e com `immutable=1` só quando nenhum processo o tem aberto, para
//    não criar arquivos -wal/-shm na pasta do TFTAcademy (ver `gepOpenMode`). Nunca se grava, nem se executa o Overwolf ou
//    o TFTAcademy, nem se liga a configuração dele.
//  - Só o jogador local: as consultas pedem apenas os pares `feature.key` abaixo (`KEYS`). Nunca se lê
//    `opponent_board_pieces`, `battle_stats`, `round_outcome`, `match_stats` nem nada de rivais. `item_bench` traz os 8
//    jogadores: só a linha do jogador local (identificado por `roster.player_status[].localplayer`) é guardada, o resto é
//    descartado na hora. Da tabela `settings` lê-se UMA chave (`record_games`), só para explicar por que não há eventos.
//  - Aprimoramentos (decisão do usuário, 2026-10-10, uso pessoal e local; o Overwolf os proíbe em apps PÚBLICOS):
//    `augments.me` (oferta, `augment_1..3`) e `augments.picked_augment` (escolhidos, cumulativo `slot_1..4`). Formato
//    OBSERVADO na partida completa de 2026-10-11 (`pesquisa/gep-validacao-partida.md`): leitura tolerante, nome fora do
//    catálogo vira desconhecido.
//  - Nada é inventado: valor ausente, inválido ou fora do catálogo vira desconhecido (null / contado em `unknown`).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { isConsumable } from "./core/catalog/items.mjs";
import { parseStage, stageText } from "./core/state/clock.mjs";

/** Silêncio máximo (ms) do banco da partida para a fonte ainda valer. Ver "Frescor" em FONTES-DE-DADOS.md. */
export const GEP_STALE_MS = 60_000;
const MIN_INTERVAL_MS = 1000,
  BUSY_TIMEOUT_MS = 150,
  ERROR_BACKOFF_MS = 5000,
  BATCH = 2000,
  SHOP_SLOTS = 5;
/** Eventos lidos (`feature.key`). Qualquer outra chave nunca é selecionada: os rivais ficam de fora. */
const KEYS = new Map([
  ["me.gold", "gold"],
  ["me.xp", "xp"],
  ["store.shop_pieces", "shop"],
  ["store.shop_visible", "shopVisible"],
  ["bench.bench_pieces", "bench"],
  ["bench.item_bench", "itemBench"],
  // O carrossel é compartilhado pela mesa inteira (as mesmas peças para todos): não é dado de rival.
  ["carousel.carousel_pieces", "carousel"],
  ["match_info.round_type", "roundType"],
  ["match_info.match_state", "matchState"],
  ["roster.player_status", "roster"],
  // Aprimoramentos: oferta (`augment_1..3.name`, uma linha a cada reroll) e escolhidos (`augments.picked_augment`, lista
  // cumulativa `slot_1..4.name`). As outras duas features são tolerância ao código do TFTAcademy, nunca vistas nos dados.
  ["augments.me", "augmentOffer"],
  ["augments.picked_augment", "augmentPicked"],
  ["match_info.picked_augment", "augmentPicked"],
  ["me.picked_augment", "augmentPicked"],
]);
/** Sem a coluna `feature` (esquema antigo) só se reconhece pela chave; `me` (oferta) é ambígua e fica de fora. */
const FALLBACK_KEYS = {
  gold: "me.gold",
  xp: "me.xp",
  shop_pieces: "store.shop_pieces",
  shop_visible: "store.shop_visible",
  bench_pieces: "bench.bench_pieces",
  item_bench: "bench.item_bench",
  carousel_pieces: "carousel.carousel_pieces",
  round_type: "match_info.round_type",
  match_state: "match_info.match_state",
  player_status: "roster.player_status",
  picked_augment: "augments.picked_augment",
};
const KEY_NAMES = Object.keys(FALLBACK_KEYS);
const REQUIRED = {
  events: ["id", "game_id", "timestamp", "key", "data"],
  games: ["id", "started_at"],
};
/** Única chave lida da tabela `settings`: com ela desligada o TFTAcademy não grava eventos (e apaga a partida no fim). */
const RECORD_SETTING = "record_games";
/** Motivos que a gravação desligada explica: sem partida, partida velha ou de outra, sem eventos recentes. */
const RECORDING_EXPLAINS = new Set([
  "sem-partida",
  "sem-eventos-recentes",
  "outra-partida",
  "partida-encerrada",
]);
/** Etiqueta (hash) que o catálogo de itens do Set 18 põe em todo Wisp (fogo-fátuo): `DA_AbandonShip18`, `DA_BeggarsWisp18`... */
export const WISP_TAG = "{5b609ae2}";
const MAX_PICKED = 8;

/** Caminho do banco do TFTAcademy (`TFT_GEP_DB` troca, para testes). */
export function defaultGepDb() {
  if (process.env.TFT_GEP_DB) return process.env.TFT_GEP_DB;
  const base =
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "TFTAcademy", "tft-events.db");
}

/**
 * Banco da ponte própria (`overwolf-bridge/`, app ow-electron do próprio helper): mesmo esquema do TFTAcademy, outro arquivo.
 * `TFT_BRIDGE_DB` troca o caminho. Precedência entre fontes de eventos: própria > TFTAcademy (e, abaixo delas, a tela).
 */
export function ownGepDb() {
  if (process.env.TFT_BRIDGE_DB) return process.env.TFT_BRIDGE_DB;
  const base =
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "TFT Helper Bridge", "tft-events.db");
}

/**
 * Como abrir o banco, só leitura. O TFTAcademy o grava em modo WAL: com `-wal`/`-shm` ao lado há um processo com o banco
 * aberto e as linhas mais recentes só existem no WAL, então a leitura é normal (`"compartilhado"`, enxerga o WAL).
 * `immutable=1` ignoraria o WAL e perderia esses dados; por isso só se usa (`"imutavel"`) quando os dois arquivos não
 * existem, e então não cria nada na pasta do TFTAcademy. `exists` é injetável para teste.
 */
export function gepOpenMode(file, exists = fs.existsSync) {
  return exists(`${file}-wal`) || exists(`${file}-shm`)
    ? "compartilhado"
    : "imutavel";
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing dos payloads (puros). O GEP grava texto JSON; alguns campos vêm em JSON dentro de JSON ("parse it twice").

/** JSON do texto; se o resultado for uma string que também é um objeto JSON, abre de novo. `undefined` se inválido. */
export function parseJson(text) {
  if (typeof text !== "string") return undefined;
  try {
    const value = JSON.parse(text);
    if (typeof value === "string" && /^\s*[{[]/.test(value)) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  } catch {
    return undefined;
  }
}

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => (typeof v === "string" ? v.trim() : "");
const int = (v) => {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^\s*\d+\s*$/.test(v)
        ? Number(v)
        : NaN;
  return Number.isInteger(n) ? n : null;
};

/**
 * `me.gold`: o jogo manda o número como texto ("2") e `{}` quando não há valor. `{}` aparece no começo da partida e
 * quando o ouro chega a 0 (observado: 2 → 1 → `{}` depois de duas compras de 1 ouro); o reducer decide qual dos dois é.
 * Devolve `{value}`, `{empty: true}` ou `null` (inválido).
 */
export function parseGold(data) {
  const v = parseJson(data);
  if (v === undefined) return null;
  if (v === null || v === "" || (isPlain(v) && !Object.keys(v).length))
    return { empty: true };
  const n = int(v);
  return n !== null && n >= 0 && n <= 999 ? { value: n } : null;
}

/** `me.xp` `{level, current_xp, xp_max}` → `{level, xp: "atual/total"|null}`; `xp_max` 0 ou ausente (nível máximo) = sem barra. */
export function parseXp(data) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const level = int(v.level),
    current = int(v.current_xp),
    max = int(v.xp_max);
  if (level === null || level < 1 || level > 11) return null;
  return {
    level,
    xp:
      current !== null && max !== null && max > 0 && current <= max
        ? `${current}/${max}`
        : null,
  };
}

/** `match_info.round_type` → `{stage: "1-2", name}`; estágio fora do formato S-R é ignorado. */
export function parseRoundType(data) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const at = parseStage(text(v.stage));
  return at && at.stage !== 0
    ? { stage: stageText(at), name: text(v.name) || null }
    : null;
}

const asBool = (v) =>
  v === true || v === "true"
    ? true
    : v === false || v === "false"
      ? false
      : null;

/**
 * Catálogo de Wisps (fogos-fátuos) para o leitor: `apiName → {name, nameEn}` dos itens do catálogo com a etiqueta
 * `WISP_TAG`. `names` (opcional) é a lista de itens traduzidos (`{id, name, nameEn}`) para o nome em português.
 */
export function wispCatalog(catalogItems = [], names = []) {
  const byId = new Map((names ?? []).map((n) => [n.id, n]));
  return new Map(
    (catalogItems ?? [])
      .filter((i) => i?.apiName && (i.tags ?? []).includes(WISP_TAG))
      .map((i) => {
        const n = byId.get(i.apiName);
        return [
          i.apiName,
          { name: n?.name ?? null, nameEn: n?.nameEn ?? i.name ?? null },
        ];
      }),
  );
}

/**
 * Decide se um nome de `shop_pieces` é um Wisp. O GEP o entrega como entrada comum da loja (`slot_5: {name:
 * "DA_AbandonShip18"}`), então só o catálogo o distingue de um campeão: `wisps` = Map `apiName → {name, nameEn}` (ou
 * Set/lista de ids). Sem catálogo, só o que traz "Wisp" no id. Devolve `{id, name, known}` ou null.
 */
export function wispLookup(wisps = null) {
  const map =
    wisps instanceof Map
      ? wisps
      : wisps
        ? new Map([...wisps].map((id) => [id, {}]))
        : null;
  return (name) => {
    const w = map?.get(name);
    if (w) return { id: name, name: w.name ?? w.nameEn ?? null, known: true };
    return /wisp/i.test(name) ? { id: name, name: null, known: false } : null;
  };
}

/**
 * `store.shop_pieces` → 5 espaços. Cada um: carta `{text, id, source}` (`id` null se o nome não é um campeão do catálogo),
 * `null` para vendida ("Sold") ou ausente. Um Wisp NÃO é campeão: a carta vem com `id: null`, `wisp: true` e `wispId`
 * (o motor e a rolagem só leem `id`, então o ignoram). Devolve null se o payload não é um objeto de espaços.
 */
export function parseShop(data, isChampion = () => true, wispOf = () => null) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const slots = [];
  for (let i = 1; i <= SHOP_SLOTS; i++) {
    const name = text(v[`slot_${i}`]?.name);
    if (!name || name === "Sold") {
      slots.push(null);
      continue;
    }
    if (isChampion(name)) {
      slots.push({ text: name, id: name, source: "gep" });
      continue;
    }
    const wisp = wispOf(name);
    slots.push(
      wisp
        ? {
            text: name,
            id: null,
            wisp: true,
            wispId: wisp.id,
            wispName: wisp.name,
            wispKnown: wisp.known,
            source: "gep",
          }
        : { text: name, id: null, source: "gep" },
    );
  }
  return slots;
}

/** Wisps da loja (cartas com `wisp: true`) como lista `{slot, id, name, known}`, slot de 1 a 5. */
export const shopWisps = (cards) =>
  (cards ?? []).flatMap((c, i) =>
    c?.wisp
      ? [
          {
            slot: i + 1,
            id: c.wispId,
            name: c.wispName ?? null,
            known: c.wispKnown === true,
          },
        ]
      : [],
  );

// Aprimoramentos. Formato só pelo código do TFTAcademy: oferta `{augment_1:{name}, augment_2:{name}, augment_3:{name}}`
// (vazia = tela de escolha fechada); escolhido = último nome não vazio do payload (objeto de slots, `{name}` ou texto).

/** Resolve um nome do GEP para o id do catálogo (`augments.json`): exato, sem caminho/extensão, sem diferenciar caixa. */
export function augmentResolver(ids = null) {
  if (!ids) return (name) => name;
  const exact = new Set(ids),
    lower = new Map();
  for (const id of exact) {
    const k = id.toLowerCase();
    lower.set(k, lower.has(k) ? null : id);
  }
  return (name) => {
    const raw = text(name)
      .replace(/^.*[\\/]/, "")
      .replace(/\..*$/, "");
    if (!raw) return null;
    return exact.has(raw) ? raw : (lower.get(raw.toLowerCase()) ?? null);
  };
}

/** Itens de campeão do anel de aprimoramentos ("ChampionItem") não são aprimoramentos: o TFTAcademy também os ignora. */
const notAugment = (name) => !name || /ChampionItem/.test(name);

/** Nomes de um payload de aprimoramentos, na ordem dos espaços `augment_N` (ou na ordem do objeto). */
function augmentNames(v) {
  if (typeof v === "string") return [text(v)].filter((n) => !notAugment(n));
  if (!isPlain(v)) return [];
  const slots = Object.entries(v)
    .filter(([key]) => /^augment_\d+$/.test(key))
    .sort((a, b) => Number(a[0].slice(8)) - Number(b[0].slice(8)))
    .map(([, entry]) => entry);
  // Espaços `augment_N`; senão um `{name}` solto; senão os valores na ordem do objeto (regra do TFTAcademy).
  const list = slots.length
    ? slots
    : typeof v.name === "string"
      ? [v]
      : Object.values(v);
  return list
    .map((entry) => text(typeof entry === "string" ? entry : entry?.name))
    .filter((n) => !notAugment(n));
}

/**
 * `augments.me`: oferta da rodada de aprimoramento. `{cards: [{text, id}], ids, unknown}`; `id` null = fora do catálogo.
 * Vazia (`{}` ou sem nome) = tela fechada (`cards: []`). null se o payload não é um objeto.
 */
export function parseAugmentOffer(data, resolve = (n) => n) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const cards = augmentNames(v)
    .slice(0, 3)
    .map((t) => ({ text: t, id: resolve(t) ?? null }));
  return {
    cards,
    ids: cards.flatMap((c) => (c.id ? [c.id] : [])),
    unknown: cards.filter((c) => !c.id).length,
  };
}

/**
 * `picked_augment`: o aprimoramento escolhido (último nome não vazio, como o TFTAcademy). `{text, id}`; `id` null =
 * fora do catálogo. null se o payload não traz nome.
 */
export function parseAugmentPicked(data, resolve = (n) => n) {
  let v = parseJson(data);
  if (
    v === undefined &&
    typeof data === "string" &&
    /^[\w./\\-]{3,120}$/.test(data.trim())
  )
    v = data.trim(); // texto puro, sem aspas
  const names = augmentNames(v);
  const last = names.at(-1);
  return last ? { text: last, id: resolve(last) ?? null } : null;
}

/**
 * `augments.picked_augment` observado (partida completa de 2026-10-11): é um retrato CUMULATIVO, `{slot_1..slot_4: {name}}`
 * com os escolhidos até agora na ordem da escolha (os espaços ainda vazios vêm com nome ""), reenviado a cada escolha. Esta
 * função devolve TODOS os nomes do payload, em ordem (`[{text, id}]`; vazia se não há nenhum): quem começa a ler no meio da
 * partida não perde os anteriores. Os formatos de um só nome (texto, `{name}`) dão uma lista de um item.
 */
export function parseAugmentPickedList(data, resolve = (n) => n) {
  let v = parseJson(data);
  if (
    v === undefined &&
    typeof data === "string" &&
    /^[\w./\\-]{3,120}$/.test(data.trim())
  )
    v = data.trim();
  return augmentNames(v).map((t) => ({ text: t, id: resolve(t) ?? null }));
}

/** `settings.record_games` guardado como texto ("true"/"false"), JSON ou 0/1 → boolean; null se ausente ou ilegível. */
export function parseRecordGames(value) {
  const v = typeof value === "string" ? (parseJson(value) ?? value) : value;
  if (v === 0 || v === 1) return v === 1;
  return asBool(typeof v === "string" ? v.trim().toLowerCase() : v);
}

/**
 * `bench.bench_pieces` (`cell_N: {name, level, item_1..3}`) → peças da reserva por célula. Nome fora do catálogo vai para
 * `unknown`. Payload vazio (`{}`) é reserva vazia, não desconhecida.
 */
export function parseBench(data, isChampion = () => true, isItem = () => true) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const units = [],
    unknown = [];
  for (const [cell, piece] of Object.entries(v)) {
    const at = /^cell_(\d+)$/.exec(cell)?.[1],
      name = text(piece?.name);
    if (at === undefined || !name) continue;
    if (!isChampion(name)) {
      unknown.push(name);
      continue;
    }
    const stars = int(piece.level);
    units.push({
      id: name,
      stars: stars !== null && stars >= 1 && stars <= 4 ? stars : null,
      items: [piece.item_1, piece.item_2, piece.item_3]
        .map(text)
        .filter((n) => n && isItem(n)),
      cell: Number(at),
      source: "gep",
    });
  }
  return { units: units.sort((a, b) => a.cell - b.cell), unknown };
}

/**
 * `carousel.carousel_pieces` (um evento no início de cada carrossel): `slot_N: {name, item_1, item_2}`, o campeão de cada
 * peça do carrossel e o item que ele traz (componente, item completo ou emblema; `item_2` nunca veio preenchido). Devolve
 * `{slots, unknown}`; cada espaço é `{slot, id, text, item, itemText, items}`: `id`/`item` são o campeão/primeiro item
 * quando estão no catálogo (senão null, com o texto original em `text`/`itemText`), `items` todos os itens conhecidos.
 * Payload vazio (`{}`) = carrossel sem peças; null se não é um objeto.
 */
export function parseCarouselPieces(
  data,
  isChampion = () => true,
  isItem = () => true,
) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const slots = [];
  let unknown = 0;
  for (const [key, piece] of Object.entries(v)) {
    const at = /^slot_(\d+)$/.exec(key)?.[1],
      name = text(piece?.name);
    if (at === undefined || !isPlain(piece) || !name) continue;
    const texts = [piece.item_1, piece.item_2, piece.item_3]
        .map(text)
        .filter(Boolean),
      items = texts.filter(isItem);
    if (!isChampion(name) || items.length < texts.length) unknown++;
    slots.push({
      slot: Number(at),
      id: isChampion(name) ? name : null,
      text: name,
      item: items[0] ?? null,
      itemText: texts[0] ?? null,
      items,
    });
  }
  return { slots: slots.sort((a, b) => a.slot - b.slot), unknown };
}

/** Identidade do jogador local no `roster.player_status` (`localplayer: true`); null se não há exatamente um. */
export function parseLocalIdentity(data) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const mine = Object.entries(v).filter(([, p]) => p?.localplayer === true);
  return mine.length === 1
    ? { name: mine[0][0], tag: text(mine[0][1].tag_line) }
    : null;
}

const same = (a, b) =>
  String(a ?? "")
    .normalize("NFC")
    .toLowerCase() ===
  String(b ?? "")
    .normalize("NFC")
    .toLowerCase();

/**
 * `bench.item_bench`: array com a linha de CADA jogador (`summoner`, `tag_line`, `bench_items: [{name, count}]`) em ordem
 * instável. Só a linha da identidade local é lida. `found` é false sem identidade ou sem uma única linha dela
 * (desconhecido: nunca vira "banco vazio"). `bank` repete o item `count` vezes, como o leitor de tela; `items` tira os
 * consumíveis; `removers` soma os removedores; `unknown` conta os nomes fora do catálogo.
 */
export function parseItemBench(data, identity, isItem = () => true) {
  const v = parseJson(data);
  if (!Array.isArray(v) || !identity) return { found: false };
  const rows = v.filter(
    (r) =>
      isPlain(r) &&
      same(r.summoner, identity.name) &&
      same(r.tag_line, identity.tag),
  );
  if (rows.length !== 1 || !Array.isArray(rows[0].bench_items))
    return { found: false };
  const bank = [];
  let unknown = 0,
    removers = 0;
  for (const entry of rows[0].bench_items) {
    const name = text(entry?.name),
      count = int(entry?.count);
    if (!name || count === null || count < 1 || count > 60) {
      unknown++;
      continue;
    }
    if (!isItem(name)) {
      unknown += count;
      continue;
    }
    for (let i = 0; i < count; i++) bank.push(name);
    if (/ItemRemover/.test(name)) removers += count;
  }
  return {
    found: true,
    bank,
    items: bank.filter((id) => !isConsumable(id)),
    removers,
    unknown,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Estado da partida: reduz os eventos (um por linha, em ordem de id) para o último valor de cada campo.

/** Estado vazio de uma partida. */
export function emptyGepState() {
  return {
    rows: 0,
    lastId: 0,
    roundSeen: false,
    ended: false,
    identity: null,
    pendingItemBench: null, // texto cru do último item_bench visto antes da identidade; descartado ao resolver
    gold: null,
    level: null,
    xp: null,
    stage: null,
    shop: null,
    shopVisible: null,
    bench: null,
    items: null,
    carousel: null, // peças do carrossel (`carousel_pieces`): {value: slots, stage, unknown}; fica até o próximo carrossel
    augmentOffer: null, // oferta atual (cartas do `augments.me`); lista vazia = tela de escolha fechada
    augmentPicked: null, // escolhidos nesta partida, em ordem, sem repetir
  };
}

/** Rodada "S-R" da coluna `round` do banco; "0-0" (antes da primeira rodada) e texto fora do formato não são rodada. */
const realStage = (value) => {
  const at = parseStage(text(value));
  return at && at.stage !== 0 ? stageText(at) : null;
};

const stamp = (value, ts, extra = {}) => ({ value, ts, ...extra });

function applyItemBench(state, data, ts, env) {
  const r = parseItemBench(data, state.identity, env.isItem);
  if (!r.found) return false;
  state.items = stamp(r.items, ts, {
    bank: r.bank,
    removers: r.removers,
    unknown: r.unknown,
  });
  return true;
}

/**
 * Aplica uma linha `{id, ts, feature, key, data}` ao estado. `env` = `{isChampion, isItem, wispOf, resolveAugment}`
 * (catálogo; sem ele aceita tudo). Linhas de chaves fora de `KEYS` são ignoradas aqui também (defesa em profundidade
 * além do filtro da consulta).
 */
export function applyGepEvent(state, row, env = {}) {
  const kind =
    KEYS.get(`${row.feature}.${row.key}`) ??
    (row.feature == null ? KEYS.get(FALLBACK_KEYS[row.key]) : undefined);
  state.lastId = Math.max(state.lastId, row.id);
  if (!kind) return state;
  state.rows++;
  const ts = row.ts;
  switch (kind) {
    case "gold": {
      const g = parseGold(row.data);
      if (g?.value !== undefined) state.gold = stamp(g.value, ts);
      // `{}` = 0 só com a partida em andamento (depois de uma rodada e antes do fim); no reset do começo/fim é desconhecido.
      else if (g?.empty)
        state.gold =
          state.roundSeen && !state.ended
            ? stamp(0, ts, { inferredZero: true })
            : null;
      break;
    }
    case "xp": {
      const x = parseXp(row.data);
      if (x) {
        state.level = stamp(x.level, ts);
        state.xp = x.xp ? stamp(x.xp, ts) : null;
      }
      break;
    }
    case "roundType": {
      const r = parseRoundType(row.data);
      if (r) {
        state.stage = stamp(r.stage, ts, { name: r.name });
        state.roundSeen = true;
      }
      break;
    }
    case "matchState": {
      const inProgress = asBool(parseJson(row.data)?.in_progress);
      if (inProgress === true) state.ended = false;
      else if (inProgress === false) state.ended = true;
      break;
    }
    case "carousel": {
      const c = parseCarouselPieces(row.data, env.isChampion, env.isItem);
      // A rodada é a do evento (coluna `round`); sem ela, a do último `round_type` (vem no mesmo segundo, com id menor).
      if (c)
        state.carousel = stamp(c.slots, ts, {
          unknown: c.unknown,
          stage: realStage(row.round) ?? state.stage?.value ?? null,
        });
      break;
    }
    case "shopVisible":
      state.shopVisible = asBool(parseJson(row.data)) ?? state.shopVisible;
      break;
    case "shop": {
      const shop = parseShop(row.data, env.isChampion, env.wispOf);
      if (shop) state.shop = stamp(shop, ts);
      break;
    }
    case "augmentOffer": {
      const o = parseAugmentOffer(row.data, env.resolveAugment);
      if (!o) break;
      // Rodada da oferta: a coluna `round` do evento; sem ela, a do último `round_type`.
      const stage = realStage(row.round) ?? state.stage?.value ?? null,
        last = state.augmentOffer?.last ?? null,
        // Troca (reroll): cada linha nova da MESMA rodada muda só a carta trocada (observado em tft-events.db); a carta
        // trocada fica marcada até a oferta da rodada seguinte. Oferta vazia (escolha feita) não apaga a última vista.
        sameRound = !!last && last.stage === stage,
        rerolled = o.cards.map(
          (c, i) =>
            sameRound &&
            (last.rerolled[i] === true ||
              (last.cards[i] !== undefined &&
                last.cards[i].text.toLowerCase() !== c.text.toLowerCase())),
        );
      state.augmentOffer = stamp(o.cards, ts, {
        ids: o.ids,
        unknown: o.unknown,
        stage,
        rerolled,
        last: o.cards.length
          ? { stage, cards: o.cards, rerolled }
          : last && { ...last },
      });
      break;
    }
    case "augmentPicked": {
      // O payload é cumulativo (todos os escolhidos até agora): entra cada nome ainda não visto, em ordem. O mesmo
      // aprimoramento reenviado não conta duas vezes; o estágio é o do evento (coluna `round`) ou o da hora em que o nome
      // apareceu.
      const list = [...(state.augmentPicked?.value ?? [])];
      let added = false;
      for (const p of parseAugmentPickedList(row.data, env.resolveAugment)) {
        if (list.some((x) => x.text.toLowerCase() === p.text.toLowerCase()))
          continue;
        list.push({
          ...p,
          stage: realStage(row.round) ?? state.stage?.value ?? null,
          ts,
        });
        added = true;
      }
      if (added) state.augmentPicked = stamp(list.slice(-MAX_PICKED), ts);
      break;
    }
    case "bench": {
      const b = parseBench(row.data, env.isChampion, env.isItem);
      if (b) state.bench = stamp(b.units, ts, { unknown: b.unknown.length });
      break;
    }
    case "roster": {
      const id = parseLocalIdentity(row.data);
      if (id) {
        const changed =
          !state.identity ||
          !same(state.identity.name, id.name) ||
          !same(state.identity.tag, id.tag);
        state.identity = id;
        if (changed && state.pendingItemBench) {
          const pending = state.pendingItemBench;
          if (applyItemBench(state, pending.data, pending.ts, env))
            state.pendingItemBench = null;
        }
      }
      break;
    }
    case "itemBench":
      if (!applyItemBench(state, row.data, ts, env)) {
        // Sem identidade ainda: guarda o texto só para tentar de novo quando o roster chegar.
        state.pendingItemBench = state.identity ? null : { data: row.data, ts };
      } else state.pendingItemBench = null;
      break;
  }
  return state;
}

// ---------------------------------------------------------------------------------------------------------------------
// Avaliação: dado o estado, a partida e o relógio, o que vale agora (puro).

/** Dígitos do id da partida em `match_id` ("BR1_3282025760" → "3282025760"); null se o formato é outro. */
export const matchIdDigits = (matchId) =>
  /^[A-Za-z0-9]+_(\d{5,})$/.exec(text(matchId))?.[1] ?? null;

const ageMs = (ts, now) =>
  Number.isFinite(ts) ? Math.max(0, now - ts * 1000) : null;

/**
 * Resultado público da fonte. `ctx` = `{gameId, inMatch, local: {name, tag}, set}` (tudo opcional):
 *  - `gameId`: partida em andamento (LCU/arquivo do jogo); com `match_id` gravado, os dois precisam coincidir;
 *  - `inMatch`: false fora de partida; null/undefined = fase desconhecida (não bloqueia);
 *  - `local`: nome e tag do jogador local conforme o servidor; se divergir do roster, o banco de itens fica desconhecido;
 *  - `set`: número do set esperado (18).
 * `state` ∈ ativo | obsoleto | ausente | esquema-desconhecido; `reason` diz o motivo. Só `ativo` traz `fields`.
 * `snap.recordGames` (a configuração `record_games` do TFTAcademy: true | false | null = desconhecida) vai em
 * `recordGames`; desligada, ela explica a falta de partida/eventos: `reason: "gravacao-desligada"` (o motivo original fica
 * em `was`). Com dados frescos (partida que já estava sendo gravada) o estado continua `ativo`.
 */
export function evaluateGep(
  snap,
  ctx = {},
  now = Date.now(),
  staleMs = GEP_STALE_MS,
) {
  const result = evaluateCore(snap, ctx, now, staleMs),
    recordGames = snap?.recordGames ?? null;
  if (
    recordGames === false &&
    result.state !== "ativo" &&
    RECORDING_EXPLAINS.has(result.reason)
  )
    return {
      ...result,
      recordGames,
      state: "ausente",
      reason: "gravacao-desligada",
      was: result.reason,
    };
  return { ...result, recordGames };
}

function evaluateCore(snap, ctx, now, staleMs) {
  const base = {
    source: "gep",
    confidence: "observed",
    state: "ausente",
    reason: null,
    available: false,
    staleMs,
    fields: null,
  };
  if (!snap || snap.error) {
    const e = snap?.error ?? { state: "ausente", reason: "ainda-nao-lido" };
    return {
      ...base,
      state: e.state,
      reason: e.reason,
      detail: e.detail ?? null,
    };
  }
  const g = snap.game,
    out = {
      ...base,
      gameId: matchIdDigits(g.matchId),
      binding: matchIdDigits(g.matchId) ? "match_id" : "recencia",
      setNumber: g.set ?? null,
      rows: snap.state.rows,
      catchingUp: snap.catchingUp === true,
      lastEventAt: snap.lastTs
        ? new Date(snap.lastTs * 1000).toISOString()
        : null,
      lastEventAgeMs: ageMs(snap.lastTs, now),
    };
  const reject = (reason) => ({ ...out, reason });
  if (ctx.inMatch === false) return reject("fora-de-partida");
  // Treino (sem rivais): o banco marca `ended_at` por heurística própria; com o cliente ainda mostrando a partida em
  // andamento (`inMatch` verdadeiro) ela segue valendo, e só a saída do cliente da partida a encerra (acima).
  if (g.endedAt && !(ctx.practice === true && ctx.inMatch === true))
    return reject("partida-encerrada");
  if (ctx.set != null && g.set != null && Number(g.set) !== Number(ctx.set))
    return reject("set-diferente");
  if (out.gameId && ctx.gameId != null && String(ctx.gameId) !== out.gameId)
    return reject("outra-partida");
  if (out.lastEventAgeMs === null || out.lastEventAgeMs > staleMs)
    return { ...out, state: "obsoleto", reason: "sem-eventos-recentes" };
  const s = snap.state,
    field = (f, value) => (f ? { value, ageMs: ageMs(f.ts, now) } : null);
  // O banco de itens só vale com a identidade local confirmada; se o servidor sabe quem é o jogador e o roster diz outro, não.
  const identityOk =
    !!s.identity &&
    (!ctx.local?.name ||
      (same(ctx.local.name, s.identity.name) &&
        (!ctx.local.tag || same(ctx.local.tag, s.identity.tag))));
  const fields = {
    gold: s.gold
      ? {
          ...field(s.gold, s.gold.value),
          ...(s.gold.inferredZero ? { inferredZero: true } : {}),
        }
      : null,
    level: field(s.level, s.level?.value),
    xp: field(s.xp, s.xp?.value),
    // Peças do carrossel da última rodada de carrossel (o GEP não as apaga): quem usa confere `stage` com a rodada atual.
    carousel: s.carousel
      ? {
          ...field(s.carousel, s.carousel.value),
          stage: s.carousel.stage,
          unknown: s.carousel.unknown,
        }
      : null,
    stage: s.stage
      ? { ...field(s.stage, s.stage.value), name: s.stage.name }
      : null,
    shop: s.shop
      ? {
          ...field(s.shop, s.shop.value),
          visible: s.shopVisible,
          wisps: shopWisps(s.shop.value),
        }
      : null,
    bench: s.bench
      ? { ...field(s.bench, s.bench.value), unknown: s.bench.unknown }
      : null,
    items:
      s.items && identityOk
        ? {
            ...field(s.items, s.items.value),
            bank: s.items.bank,
            removers: s.items.removers,
            unknown: s.items.unknown,
          }
        : null,
    // Oferta: `value` = só os ids do catálogo; `cards` = as cartas na ordem dos espaços (`{slot, id|null, text, rerolled}`),
    // com o nome cru do GEP; `unresolved` = nomes fora do catálogo (registrados, nunca descartados em silêncio).
    augmentOffer: s.augmentOffer
      ? {
          ...field(s.augmentOffer, s.augmentOffer.ids),
          count: s.augmentOffer.value.length,
          unknown: s.augmentOffer.unknown,
          stage: s.augmentOffer.stage ?? null,
          cards: s.augmentOffer.value.map((c, i) => ({
            slot: i + 1,
            id: c.id,
            text: c.text,
            rerolled: s.augmentOffer.rerolled?.[i] === true,
          })),
          unresolved: s.augmentOffer.value
            .filter((c) => !c.id)
            .map((c) => c.text),
        }
      : null,
    // Escolhidos: `{id, stage}` em ordem, só os do catálogo; `unknown` conta os que não bateram e `unresolved` os nomeia.
    augmentPicked: s.augmentPicked
      ? {
          ...field(
            s.augmentPicked,
            s.augmentPicked.value
              .filter((x) => x.id)
              .map((x) => ({ id: x.id, stage: x.stage })),
          ),
          count: s.augmentPicked.value.length,
          unknown: s.augmentPicked.value.filter((x) => !x.id).length,
          unresolved: s.augmentPicked.value
            .filter((x) => !x.id)
            .map((x) => x.text),
        }
      : null,
  };
  return {
    ...out,
    state: "ativo",
    available: true,
    // O que o GEP entregou de aprimoramentos e Wisps agora (contagens; os valores ficam em `screen`).
    coverage: {
      augmentOffer: fields.augmentOffer?.count ?? null,
      augmentPicked: fields.augmentPicked?.count ?? null,
      augmentUnknown:
        (fields.augmentOffer?.unknown ?? 0) +
        (fields.augmentPicked?.unknown ?? 0),
      // Nomes do GEP que não bateram com augments.json (catálogo desatualizado ou nome novo): ficam à vista.
      augmentUnresolved: [
        ...new Set([
          ...(fields.augmentOffer?.unresolved ?? []),
          ...(fields.augmentPicked?.unresolved ?? []),
        ]),
      ],
      wisps: fields.shop?.wisps?.length ?? null,
    },
    identity: s.identity
      ? identityOk
        ? "confirmada"
        : "divergente"
      : "desconhecida",
    fields,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Leitor incremental do SQLite (síncrono, curto, sem estado aberto entre leituras).

function loadSqlite() {
  try {
    const mod =
      process.getBuiltinModule?.("node:sqlite") ??
      createRequire(import.meta.url)("node:sqlite");
    return mod?.DatabaseSync ? mod : null;
  } catch {
    return null;
  }
}

/** Classifica um erro do SQLite: transitório (travado) mantém o que já foi lido; os demais derrubam a fonte. */
function classify(e) {
  const code = e?.errcode ?? null,
    msg = String(e?.message ?? e);
  if (e?.code === "ENOENT")
    return { state: "ausente", reason: "banco-ausente" };
  if (code === 5 || code === 6 || /locked|busy/i.test(msg))
    return {
      transient: true,
      state: "ausente",
      reason: "banco-travado",
      detail: msg,
    };
  if (code === 11 || code === 26 || /malformed|not a database/i.test(msg))
    return {
      state: "esquema-desconhecido",
      reason: "arquivo-invalido",
      detail: msg,
    };
  if (code === 14 || /unable to open/i.test(msg))
    return { state: "ausente", reason: "banco-inacessivel", detail: msg };
  return { state: "ausente", reason: "erro-de-leitura", detail: msg };
}

function columns(db, table) {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name),
  );
}

/**
 * Cria o leitor. `status(ctx)` lê o banco no máximo a cada `minIntervalMs` (a leitura é síncrona, de milissegundos, com
 * `busy_timeout` curto) e avalia o frescor a cada chamada. Nunca lança.
 * Opções: `file`, `now`, `staleMs`, `minIntervalMs`, `champions`/`items`/`augments` (conjuntos de ids do catálogo; sem eles
 * aceita tudo) e `wisps` (Map `apiName → {name}` de `wispCatalog`; sem ele só reconhece ids com "Wisp").
 */
function singleGepReader({
  file = defaultGepDb(),
  now = Date.now,
  staleMs = Number(process.env.TFT_GEP_STALE_MS) > 0
    ? Number(process.env.TFT_GEP_STALE_MS)
    : GEP_STALE_MS,
  minIntervalMs = MIN_INTERVAL_MS,
  champions = null,
  items = null,
  augments = null,
  wisps = null,
} = {}) {
  const env = {
    isChampion: champions ? (id) => champions.has(id) : () => true,
    isItem: items ? (id) => items.has(id) : () => true,
    wispOf: wispLookup(wisps),
    resolveAugment: augmentResolver(augments),
  };
  const sqlite = loadSqlite();
  let readAt = -Infinity,
    gameKey = null,
    state = emptyGepState(),
    game = null,
    lastTs = null,
    maxId = 0,
    catchingUp = false,
    error = null,
    retryAt = 0,
    recordGames = null; // `settings.record_games` do TFTAcademy (true | false | null = não lida)

  function open() {
    // Com -wal/-shm presentes alguém pode estar gravando: leitura normal (enxerga o WAL). Sem eles, ninguém tem o banco
    // aberto: `immutable=1` não cria arquivos novos na pasta do TFTAcademy.
    return gepOpenMode(file) === "compartilhado"
      ? new sqlite.DatabaseSync(file, {
          readOnly: true,
          timeout: BUSY_TIMEOUT_MS,
        })
      : new sqlite.DatabaseSync(`${pathToFileURL(file).href}?immutable=1`, {
          timeout: BUSY_TIMEOUT_MS,
        });
  }

  /** Lê SÓ `settings.record_games` (nenhuma outra configuração). Ausente ou ilegível = null; travado propaga. */
  function readRecordGames(db) {
    try {
      const have = columns(db, "settings");
      if (!have.has("key") || !have.has("value")) return null;
      const row = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(RECORD_SETTING);
      return row ? parseRecordGames(row.value) : null;
    } catch (e) {
      if (classify(e).transient) throw e;
      return null;
    }
  }

  function readOnce() {
    recordGames = null;
    if (!sqlite)
      return {
        state: "ausente",
        reason: "sqlite-indisponivel",
        detail: "node:sqlite não existe nesta versão do Node",
      };
    if (!fs.existsSync(file))
      return { state: "ausente", reason: "banco-ausente" };
    const db = open();
    try {
      for (const [table, needed] of Object.entries(REQUIRED)) {
        const have = columns(db, table),
          missing = needed.filter((c) => !have.has(c));
        if (!have.size || missing.length)
          return {
            state: "esquema-desconhecido",
            reason: have.size ? "colunas-ausentes" : "tabela-ausente",
            detail: `${table}: ${missing.join(", ") || "sem colunas"}`,
          };
      }
      recordGames = readRecordGames(db);
      const gcols = columns(db, "games"),
        ecols = columns(db, "events"),
        pick = (c) => (gcols.has(c) ? c : "NULL");
      const latest = db
        .prepare(
          `SELECT id, started_at AS startedAt, ${pick("ended_at")} AS endedAt, ${pick("match_id")} AS matchId, ${pick("set_number")} AS "set"
           FROM games ORDER BY started_at DESC, rowid DESC LIMIT 1`,
        )
        .get();
      if (!latest) return { state: "ausente", reason: "sem-partida" };
      const beat = db
        .prepare(
          "SELECT MAX(id) AS id, MAX(timestamp) AS ts FROM events WHERE game_id = ?",
        )
        .get(latest.id);
      if (latest.id !== gameKey || (beat.id ?? 0) < maxId) {
        // Partida nova (ou banco regravado): recomeça do zero.
        gameKey = latest.id;
        state = emptyGepState();
        maxId = 0;
      }
      // Só os pares `feature.key` de KEYS (a chave sozinha, `me`, também existe em `live_client_data`); sem a coluna
      // `feature`, ou com ela nula, só as chaves inequívocas.
      const hasFeature = ecols.has("feature"),
        featureCol = hasFeature ? "feature" : "NULL AS feature",
        pairs = [...KEYS.keys()],
        marks = (list) => list.map(() => "?").join(","),
        where = hasFeature
          ? `((feature || '.' || key) IN (${marks(pairs)}) OR (feature IS NULL AND key IN (${marks(KEY_NAMES)})))`
          : `key IN (${marks(KEY_NAMES)})`;
      const rows = db
        .prepare(
          `SELECT id, timestamp AS ts, ${featureCol}, ${ecols.has("round") ? "round" : "NULL AS round"}, key, data FROM events
           WHERE game_id = ? AND id > ? AND ${where} ORDER BY id LIMIT ${BATCH}`,
        )
        .all(
          latest.id,
          state.lastId,
          ...(hasFeature ? [...pairs, ...KEY_NAMES] : KEY_NAMES),
        );
      for (const row of rows) applyGepEvent(state, row, env);
      // Passou do lote: o resto vem na próxima leitura (o marcador só avança até onde foi lido).
      catchingUp = rows.length === BATCH;
      if (!catchingUp) state.lastId = Math.max(state.lastId, beat.id ?? 0);
      maxId = Math.max(maxId, state.lastId);
      game = latest;
      lastTs = beat.ts ?? null;
      return null;
    } finally {
      db.close();
    }
  }

  function refresh() {
    readAt = now();
    if (now() < retryAt) return;
    try {
      const failure = readOnce();
      error = failure;
      retryAt = failure && !failure.transient ? now() + ERROR_BACKOFF_MS : 0;
      if (failure && !failure.transient) {
        game = null;
        gameKey = null;
        state = emptyGepState();
        maxId = 0;
      }
    } catch (e) {
      error = classify(e);
      if (!error.transient) recordGames = null;
      retryAt = now() + (error.transient ? 1000 : ERROR_BACKOFF_MS);
    }
  }

  return {
    /** Lê (se já passou o intervalo) e avalia a fonte para a partida `ctx`. */
    status(ctx = {}) {
      if (now() - readAt >= minIntervalMs) refresh();
      // Travado de passagem: usa o que já foi lido (o frescor cuida de envelhecer); os demais erros não têm dados.
      const snap =
        error && !(error.transient && game)
          ? { error, recordGames }
          : { game, state, lastTs, catchingUp, recordGames };
      const result = evaluateGep(
        game || error ? snap : null,
        ctx,
        now(),
        staleMs,
      );
      return error?.transient && game
        ? { ...result, warning: error.reason }
        : result;
    },
  };
}

/**
 * Leitor de eventos GEP. Com `file` (ou `TFT_GEP_DB`) lê só esse arquivo, como sempre. Sem eles escolhe entre as duas fontes
 * locais, na ordem **ponte própria (`ownGepDb`) > TFTAcademy (`defaultGepDb`)**: vale a primeira com estado `ativo`; se
 * nenhuma está ativa, a primeira `obsoleta`; senão a primeira que existe (para o motivo ser o dela). O resultado traz
 * `origin` ("proprio" | "tftacademy") e `origins` (estado de cada fonte consultada), que o chip da interface mostra.
 * A segunda fonte só é lida quando a primeira não está ativa. Nunca lança.
 */
export function gepReader(options = {}) {
  if (options.file !== undefined || process.env.TFT_GEP_DB)
    return singleGepReader(options);
  const sources = [
    ["proprio", singleGepReader({ ...options, file: ownGepDb() })],
    ["tftacademy", singleGepReader({ ...options, file: defaultGepDb() })],
  ];
  return {
    status(ctx = {}) {
      const seen = [];
      for (const [origin, reader] of sources) {
        const result = reader.status(ctx);
        seen.push({ origin, result });
        if (result.state === "ativo") break;
      }
      const pick =
        seen.find((s) => s.result.state === "ativo") ??
        seen.find((s) => s.result.state === "obsoleto") ??
        seen.find((s) => s.result.reason !== "banco-ausente") ??
        seen[0];
      return {
        ...pick.result,
        origin: pick.origin,
        origins: seen.map((s) => ({
          origin: s.origin,
          state: s.result.state,
          reason: s.result.reason ?? null,
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Integração com o estado lido pelo servidor.

/** Resumo para `/api/state` (`gepStatus`): sem os valores, só o estado da fonte. */
export function gepSummary(gep) {
  if (!gep) return { state: "ausente", reason: "desligada", available: false };
  const { fields: _fields, ...rest } = gep;
  return rest;
}

/**
 * Precedência por campo: GEP fresco > leitor de tela > estimativa. `seen` é o estado já mesclado (tela + arquivos do
 * jogo + nível validado). Com a fonte ativa troca ouro, nível, XP, banco de itens e loja pelos do GEP; o estágio do
 * arquivo do jogo continua valendo (GEP só preenche se faltar). Sem GEP fresco devolve `seen` com `gepStatus` apenas.
 * `sources.<campo>` = origem ("gep", "screen", "game-log", "derived"|null); `sourcesDetail.<campo>` traz
 * `{source, ageMs, confidence}`. `gepBench` (reserva do GEP) só existe com a fonte ativa; o servidor o usa no motor.
 * Também só com a fonte ativa: `wisps` (`[{slot, id, name, known}]`, da loja do GEP; o Wisp nunca entra como campeão em
 * `shop`) e `pickedAugments` (`[{id, stage}]`). Aprimoramentos vêm SÓ do GEP, com ou sem ele: `augments` (ids da oferta
 * aberta, `[]` fechada, null sem fonte), `augmentOffer` (`{open, stage, cards: [{slot, id, text, rerolled}], unresolved,
 * ageMs}`) e `augmentSource` (`{state: "ativo"|"aguardando"|"sem-fonte", source, reason, held, picked, unresolved}`).
 * `pick(campo)` diz se o GEP vale para o campo agora (gold, level, xp, stage, shop, items, bench): a precedência com
 * histerese e divergência mora em core/state/precedence.mjs e o servidor passa a decisão; sem `pick` o GEP vale em tudo.
 */
export function mergeGep(seen, gep, pick = () => true) {
  const gepStatus = gepSummary(gep);
  if (!gep?.available)
    return { ...seen, ...augmentsWithoutSource(seen, gepStatus), gepStatus };
  const f = gep.fields,
    out = { ...seen, gepStatus },
    sources = { ...seen.sources },
    detail = {},
    stale = { ...seen.stale },
    // `forced`: campos que só o GEP observa (ou em que ele vence sempre) não passam pela precedência com histerese.
    take = (name, field, apply, forced = false) => {
      if (!field || field.value === null || field.value === undefined) return;
      if (!forced && !pick(name)) return;
      apply(field.value);
      sources[name] = "gep";
      detail[name] = {
        source: "gep",
        ageMs: field.ageMs,
        confidence: "observed",
        ...(field.inferredZero ? { inferred: true } : {}),
      };
    };
  take("gold", f.gold, (v) => {
    out.gold = v;
    stale.gold = false;
  });
  take("level", f.level, (v) => {
    out.level = v;
    out.levelSource = "gep";
    out.levelConflict = false;
    out.levelAmbiguous = false;
    out.levelInfo = {
      source: "gep",
      minimum: false,
      stale: false,
      rejected: null,
      conflict: false,
      ambiguous: false,
      read: v,
    };
    stale.level = false;
  });
  take("xp", f.xp, (v) => {
    out.xp = v;
    stale.xp = false;
  });
  // Sem XP no GEP (nível máximo): a barra antiga da tela seria de outro momento.
  if (f.level && !f.xp && out.xp != null && pick("level")) {
    out.xp = null;
    sources.xp = null;
  }
  if (seen.sources?.stage !== "game-log")
    take("stage", f.stage, (v) => {
      out.stage = v;
    });
  // O `round_type` do GEP (rodada e nome: "Carousel", "PVP"...) vai sempre para a detecção do carrossel, valha ou não o
  // estágio dele; as peças do carrossel só o GEP observa (core/state/carousel.mjs confere a rodada).
  if (f.stage)
    out.gepRound = {
      stage: f.stage.value,
      name: f.stage.name ?? null,
      ageMs: f.stage.ageMs,
    };
  if (f.carousel?.value?.length)
    take(
      "carousel",
      f.carousel,
      (v) =>
        (out.carouselOffer = {
          stage: f.carousel.stage,
          slots: v,
          unknown: f.carousel.unknown,
          ageMs: f.carousel.ageMs,
        }),
      true,
    );
  // Loja escondida (shop_visible false) não sobrescreve: o que a tela vê continua valendo.
  if (f.shop && f.shop.visible !== false) {
    let shopTaken = false;
    take("shop", f.shop, (v) => {
      out.shop = v;
      // Wisps da mesma loja: separados dos campeões (a carta do Wisp tem `id: null`). Só quando a loja é a do GEP.
      out.wisps = f.shop.wisps ?? [];
      shopTaken = true;
    });
    if (shopTaken) {
      sources.wisps = "gep";
      detail.wisps = detail.shop;
    }
  }
  take("items", f.items, (v) => {
    out.items = v;
    out.bank = f.items.bank;
    out.unknownItems = f.items.unknown;
    out.removers = f.items.removers;
  });
  if (f.bench)
    take("bench", f.bench, (v) => {
      out.gepBench = v;
    });
  else sources.bench = seen.sources?.bench ?? null;
  // Aprimoramentos: SÓ o GEP (nada de OCR; a oferta que o leitor de tela lia dos cards é descartada). `augments` = ids da
  // oferta aberta (cartas fora do catálogo ficam de fora e nomeadas em `augmentOffer.unresolved`), `[]` = escolha fechada,
  // null = nenhum evento de aprimoramento nesta partida ainda. Os escolhidos (`pickedAugments: [{id, stage}]`) o servidor
  // usa quando o usuário não corrigiu nada à mão. `augmentSource` diz à tela de onde vêm (ou que não há fonte).
  const offer = f.augmentOffer,
    seenAny = !!offer || !!f.augmentPicked;
  out.augments = null;
  out.augmentOffer = null;
  delete sources.augments;
  if (offer) {
    take("augments", offer, (v) => (out.augments = v), true);
    out.augmentOffer = {
      open: offer.cards.length > 0,
      stage: offer.stage,
      cards: offer.cards,
      unresolved: offer.unresolved,
      ageMs: offer.ageMs,
    };
  }
  if (f.augmentPicked?.value?.length)
    take(
      "pickedAugments",
      f.augmentPicked,
      (v) => (out.pickedAugments = v),
      true,
    );
  out.augmentSource = {
    state: seenAny ? "ativo" : "aguardando",
    source: "gep",
    reason: seenAny ? null : "sem-eventos-de-aprimoramento",
    held: false,
    picked: f.augmentPicked?.value?.length ?? 0,
    unresolved: gep.coverage?.augmentUnresolved ?? [],
  };
  return {
    ...out,
    stale,
    sources,
    sourcesDetail: { ...seen.sourcesDetail, ...detail },
  };
}

/**
 * Sem GEP fresco não há fonte de aprimoramentos: a oferta lida da tela (OCR dos cards) é descartada em vez de usada, e
 * `augmentSource.state` = "sem-fonte" com o motivo do GEP (a tela mostra "aprimoramentos: sem fonte"). Os escolhidos já
 * observados nesta partida o servidor mantém à parte (app/state.mjs).
 */
function augmentsWithoutSource(seen, gepStatus) {
  const sources = { ...seen.sources };
  delete sources.augments;
  return {
    augments: null,
    augmentOffer: null,
    ...(seen.sources ? { sources } : {}),
    augmentSource: {
      state: "sem-fonte",
      source: null,
      reason: gepStatus.reason ?? gepStatus.state ?? null,
      held: false,
      picked: 0,
      unresolved: [],
    },
  };
}

/**
 * Escolhidos da partida retidos entre leituras (puro). `memory` = `{gameId, value: [{id, stage}]}` ou null; `seen` = o
 * resultado de `mergeGep`. Com escolhidos do GEP agora, eles viram a memória. Sem eles (GEP obsoleto por um momento, banco
 * travado), na MESMA partida (`gameId` igual e não nulo) os últimos vistos continuam valendo, marcados `held` (a lista do
 * GEP é cumulativa: escolhido não se desfaz). Partida nova (ou sem id) zera. Devolve `{memory, seen}`.
 */
export function holdPickedAugments(memory, seen, gameId) {
  const id = gameId == null || gameId === "" ? null : String(gameId);
  if (!id) return { memory: null, seen };
  if (seen.pickedAugments?.length)
    return { memory: { gameId: id, value: seen.pickedAugments }, seen };
  if (memory?.gameId !== id || !memory.value?.length)
    return { memory: memory?.gameId === id ? memory : null, seen };
  return {
    memory,
    seen: {
      ...seen,
      pickedAugments: memory.value,
      sources: { ...seen.sources, pickedAugments: "gep" },
      sourcesDetail: {
        ...seen.sourcesDetail,
        pickedAugments: {
          source: "gep",
          ageMs: null,
          confidence: "observed",
          held: true,
        },
      },
      augmentSource: {
        ...seen.augmentSource,
        held: true,
        picked: memory.value.length,
      },
    },
  };
}

/**
 * Aprimoramentos escolhidos que a análise usa. O registro do usuário (marcado ou corrigido na tela: lista não vazia, ou
 * `known` com a lista vazia = remoção explícita) PREVALECE; sem ele valem os do GEP (`seen.pickedAugments`, observados),
 * só os que `valid` (catálogo) aceita. Devolve `{ids, source: "manual"|"gep"|null, stages: Map id → estágio da escolha}`.
 */
export function chosenAugmentIds({
  manual = [],
  known = false,
  gepPicked = [],
  valid = () => true,
} = {}) {
  if (manual.length || known)
    return { ids: manual, source: "manual", stages: new Map() };
  const stages = new Map();
  for (const p of gepPicked ?? [])
    if (p?.id && valid(p.id)) stages.set(p.id, p.stage ?? null);
  return stages.size
    ? { ids: [...stages.keys()], source: "gep", stages }
    : { ids: manual, source: null, stages };
}

/** Peças da reserva do GEP no formato que o motor lê em `options.bench` (só do jogador local). */
export function gepBenchUnits(seen, playerId) {
  return (seen?.gepBench ?? [])
    .filter((u) => u.id && u.stars !== null)
    .map((u) => ({
      playerId,
      championName: u.id,
      starLevel: u.stars,
      itemNames: u.items,
      source: "gep",
    }));
}
