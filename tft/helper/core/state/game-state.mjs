// `GameState` normalizado: o que se sabe agora da partida, campo a campo, cada um com valor, fonte, confiança e idade.
// ESM puro. Só descreve a partida (sem conclusões); os fatos derivados e os motores leem daqui.
import { confidenceOf, field, unknownField } from "./field.mjs";

/** Nome da origem no estado mesclado (`sources`) -> origem do `Field`. */
const SOURCE = {
  gep: "gep",
  "game-log": "sentry",
  derived: "derived",
};

/**
 * Estado da partida a partir do que o servidor leu (`seen`: arquivos do jogo + GEP, já com uma fonte só por
 * campo). `now` (epoch ms) só serve para datar as observações; ele entra como argumento.
 */
export function buildGameState(seen, { now = null, gameId = null } = {}) {
  const make = (name, value, from = name) => {
    const raw = seen?.sources?.[from] ?? null,
      source = SOURCE[raw] ?? null;
    if (value === undefined || value === null) {
      // Desconhecido explícito: o motivo que o servidor deu (`noSource`, de gep-reader.mjs), quando há um.
      const reason = seen?.noSource?.[from] ?? null;
      return reason ? { ...unknownField(), reason } : unknownField();
    }
    return field(value, source, confidenceOf(source), {
      ageMs: seen?.sourcesDetail?.[name]?.ageMs ?? null,
      now,
      stale: seen?.stale?.[name] === true,
    });
  };
  return {
    gameId,
    clock: {
      stage: make("stage", seen?.stage),
      phase: make("phase", seen?.phase),
      phaseKind: make("phaseKind", seen?.phaseKind, "phase"),
    },
    me: {
      gold: make("gold", seen?.gold),
      level: make("level", seen?.level),
      xp: make("xp", seen?.xp),
      shop: make("shop", seen?.shop),
      // Banco de itens sem consumíveis (os consumíveis ficam em `bank`, que é o banco inteiro como foi lido).
      itemBank: make("items", seen?.items),
      removers: make("removers", seen?.removers, "items"),
      // Reserva: só existe com GEP fresco; sem ele o campo é desconhecido (nunca uma lista vazia inventada).
      bench: make("bench", seen?.gepBench),
      // Wisps da loja e aprimoramentos escolhidos: só o GEP os observa; sem ele são desconhecidos.
      wisps: make("wisps", seen?.wisps),
      pickedAugments: make("pickedAugments", seen?.pickedAugments),
      // Oferta de aprimoramentos aberta agora (ids do catálogo; [] = escolha fechada): também só do GEP.
      augmentOffer: make("augments", seen?.augments),
    },
  };
}

/** Resumo para o /api/state: listas viram contagem (os valores já estão no estado visto); escalares ficam inteiros. */
export function summarizeState(state) {
  const brief = (f) =>
    Array.isArray(f.value)
      ? (({ value: _value, ...rest }) => ({ ...rest, count: f.value.length }))(
          f,
        )
      : f;
  const map = (obj) =>
    Object.fromEntries(Object.entries(obj).map(([k, f]) => [k, brief(f)]));
  return {
    gameId: state.gameId,
    clock: map(state.clock),
    me: map(state.me),
  };
}
