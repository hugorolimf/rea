"use strict";
// Filtro de privacidade: decide, por evento, o que a ponte pode guardar. Politica do helper: so dados do PROPRIO
// jogador; nunca tabuleiros, bancos de itens, vida/colocacao ou nomes dos outros jogadores; sem aprimoramentos.
// Lista de permissao (nao de bloqueio): chave desconhecida e descartada.
const { INFO_KEYS, EVENT_KEYS } = require("./features.cjs");

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const same = (a, b) =>
  String(a ?? "")
    .normalize("NFC")
    .toLowerCase() ===
  String(b ?? "")
    .normalize("NFC")
    .toLowerCase();

/** Valor que o GEP entrega como texto JSON vira objeto; texto simples ("2") fica como esta; JSON invalido = undefined. */
function parseValue(value) {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return value;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** `roster.player_status`: so a entrada `localplayer: true`. Devolve `{value, identity}` ou null. */
function reduceRoster(value) {
  if (!isPlain(value)) return null;
  const mine = Object.entries(value).filter(([, p]) => p?.localplayer === true);
  if (mine.length !== 1) return null;
  const [name, entry] = mine[0];
  return {
    value: { [name]: entry },
    identity: { name, tag: str(entry.tag_line) ?? "" },
  };
}

/** `bench.item_bench`: so a linha da identidade local. null sem identidade ou sem uma unica linha dela. */
function reduceItemBench(value, identity) {
  if (!Array.isArray(value) || !identity) return null;
  const rows = value.filter(
    (r) =>
      isPlain(r) &&
      same(r.summoner, identity.name) &&
      same(r.tag_line, identity.tag),
  );
  return rows.length === 1 ? [rows[0]] : null;
}

/**
 * Avalia uma mensagem do GEP. `kind` = "info" (new-info-update) | "event" (new-game-event). `identity` = jogador local ja
 * conhecido ({name, tag}) ou null. Devolve:
 *  - `{drop: motivo}` se nao deve ser gravada;
 *  - `{pending: "item_bench", raw}` se precisa da identidade que ainda nao chegou (guardar so em memoria);
 *  - `{record: {feature, category, key, value}, identity?}` se pode ser gravada (`identity` quando o roster a revela).
 */
function sanitize(kind, info, identity = null) {
  if (!isPlain(info) || typeof info.key !== "string")
    return { drop: "malformada" };
  const feature = str(info.feature) ?? null;
  const category = str(info.category) ?? feature;
  const key = info.key;
  const pair = `${feature ?? category}.${key}`;
  const allowed =
    INFO_KEYS.has(pair) || (kind === "event" && EVENT_KEYS.has(key));
  if (!allowed) return { drop: "fora-da-lista" };
  const value = parseValue(info.value);
  if (value === undefined) return { drop: "json-invalido" };
  const base = { feature, category, key };

  if (pair === "roster.player_status") {
    const r = reduceRoster(value);
    return r
      ? { record: { ...base, value: r.value }, identity: r.identity }
      : { drop: "roster-sem-jogador-local" };
  }
  if (pair === "bench.item_bench") {
    if (!identity) return { pending: "item_bench", raw: info };
    const row = reduceItemBench(value, identity);
    return row
      ? { record: { ...base, value: row } }
      : { drop: "item_bench-sem-linha-local" };
  }
  return { record: { ...base, value } };
}

module.exports = { sanitize, parseValue, reduceRoster, reduceItemBench };
