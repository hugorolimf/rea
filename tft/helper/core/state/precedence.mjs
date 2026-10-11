// Precedência por campo entre o GEP e o resto (leitura de tela + arquivos do jogo), com histerese e divergência.
// ESM puro: recebe a memória anterior e devolve a nova (nada de relógio, de E/S nem de estado escondido).
//
// Regras (decisões do usuário, ARQUITETURA.md "Decisões do usuário" 7):
//  1. UM valor por campo na saída: GEP fresco e consistente > leitura de tela (ou arquivo do jogo) > estimativa (esta é
//     feita fora, sempre marcada). GEP e tela nunca saem discordando; a tela vira verificação cruzada do GEP.
//  2. Histerese: a fonte de um campo só troca para outra de menor ou maior prioridade depois de `readings` leituras
//     seguidas em que a outra é a preferida. Se a fonte ativa perde o valor (GEP velho, tela fechada), a troca é
//     imediata: não se segura um campo sem valor. O valor da fonte ativa continua atualizando a cada leitura.
//  3. Divergência: quando o GEP e a tela têm valor e discordam por `readings` leituras seguidas, conta-se UMA divergência
//     (por episódio, não por leitura: a tela atrasa o GEP por frações de segundo e isso não é divergência) e devolve-se
//     o evento para o chamador registrar (log). Os contadores ficam na memória e vão ao /api/state.
import { levelConsistent } from "./level.mjs";

/** Leituras seguidas para trocar de fonte e para contar uma divergência. */
export const HYSTERESIS_READINGS = 3;

/** Campos com mais de uma fonte. O XP acompanha o nível (a barra de XP é do nível mostrado); a reserva só existe no GEP. */
export const PRECEDENCE_FIELDS = ["gold", "level", "stage", "shop", "items"];

/** Memória inicial: nenhuma partida, nenhum campo escolhido, nenhuma divergência. */
export function initialPrecedence() {
  return {
    game: null,
    held: null,
    fields: {},
    divergence: { total: 0, byField: {}, last: null },
  };
}

const known = (v) => v !== null && v !== undefined;
const shopKey = (cards) => (cards ?? []).map((c) => c?.id ?? c ?? "").join("|");
const bagKey = (ids) => [...(ids ?? [])].sort().join("|");

/**
 * Candidatos de cada campo, em ordem de prioridade. `seen` = estado mesclado sem o GEP (tela + arquivos do jogo, com o
 * nível já validado); `gepFields` = `fields` do GEP ativo (ou null). `held` = maior nível já aceito do GEP nesta partida.
 * Cada candidato é `{ source: "gep"|"base", value, key }` (`value` null = sem valor; `key` compara os dois lados).
 */
export function candidatesFor(seen, gepFields, held) {
  const f = gepFields ?? {},
    has = (x) => !!x && known(x.value),
    pair = (name, gep, base, order = ["gep", "base"]) => {
      const byName = { gep, base };
      return [name, order.map((s) => ({ source: s, ...byName[s] }))];
    },
    stage = seen.stage ?? (has(f.stage) ? f.stage.value : null),
    gepLevel =
      has(f.level) &&
      levelConsistent({
        level: f.level.value,
        xp: has(f.xp) ? f.xp.value : null,
        stage,
        held,
      })
        ? f.level.value
        : null,
    one = (value, key = value) => ({
      value: known(value) ? value : null,
      key: String(key),
    });
  return Object.fromEntries([
    pair("gold", one(has(f.gold) ? f.gold.value : null), one(seen.gold)),
    pair("level", one(gepLevel), one(seen.level)),
    // O estágio do arquivo do jogo (Sentry) é observado pelo próprio jogo: vale mais que o GEP e a tela.
    pair(
      "stage",
      one(has(f.stage) ? f.stage.value : null),
      one(seen.stage),
      seen.sources?.stage === "game-log" ? ["base", "gep"] : ["gep", "base"],
    ),
    pair(
      "shop",
      has(f.shop) && f.shop.visible !== false
        ? one(f.shop.value, shopKey(f.shop.value))
        : one(null),
      Array.isArray(seen.shop) ? one(seen.shop, shopKey(seen.shop)) : one(null),
    ),
    pair(
      "items",
      has(f.items) ? one(f.items.value, bagKey(f.items.value)) : one(null),
      Array.isArray(seen.items)
        ? one(seen.items, bagKey(seen.items))
        : one(null),
    ),
  ]);
}

/** Escolhe a fonte ativa de um campo (histerese) e confere GEP x tela (divergência). Puro. */
function step(mem, list, readings) {
  const usable = list.filter((c) => known(c.value)),
    preferred = usable[0] ?? null;
  let { active = null, challenger = null, count = 0 } = mem;
  if (active === null || !usable.some((c) => c.source === active)) {
    // Sem fonte ativa, ou ela perdeu o valor: a preferida assume na hora.
    active = preferred?.source ?? null;
    challenger = null;
    count = 0;
  } else if (preferred.source === active) {
    challenger = null;
    count = 0;
  } else {
    count = challenger === preferred.source ? count + 1 : 1;
    challenger = preferred.source;
    if (count >= readings) {
      active = challenger;
      challenger = null;
      count = 0;
    }
  }
  const gep = usable.find((c) => c.source === "gep"),
    base = usable.find((c) => c.source === "base"),
    differs = !!gep && !!base && gep.key !== base.key;
  const diff = differs ? (mem.diff ?? 0) + 1 : 0,
    diverging = differs && (mem.diverging === true || diff >= readings),
    event =
      diverging && mem.diverging !== true
        ? { gep: gep.value, base: base.value }
        : null;
  return {
    mem: { active, challenger, count, diff, diverging },
    active,
    event,
    diverging,
  };
}

/**
 * Um passo de precedência. `input` = `{ gameId, seen, gep, readings }` (`gep` = resultado de `evaluateGep`; só vale
 * se `available`). Devolve `{ memory, picks, events, divergence }`:
 *  - `picks[campo]` = "gep" | "base" | null (null = nenhuma fonte tem valor). `picks.xp` repete o do nível;
 *  - `events` = divergências novas neste passo (`{ field, gep, base, active }`) para o chamador registrar;
 *  - `divergence` = `{ total, byField, last, current, readings }` (o que o /api/state expõe).
 * Mudar de partida (`gameId`) zera a escolha de fonte e o nível mais alto aceito; os contadores de divergência ficam.
 */
export function reduceSources(memory, input) {
  const {
      gameId = null,
      seen,
      gep = null,
      readings = HYSTERESIS_READINGS,
    } = input,
    fresh = gameId !== memory.game,
    prev = fresh ? {} : memory.fields,
    held = fresh ? null : memory.held,
    candidates = candidatesFor(seen, gep?.available ? gep.fields : null, held),
    fields = {},
    picks = {},
    events = [],
    current = [];
  let { total, byField, last } = memory.divergence;
  byField = { ...byField };
  for (const [name, list] of Object.entries(candidates)) {
    const out = step(prev[name] ?? {}, list, readings);
    fields[name] = out.mem;
    picks[name] = out.active;
    if (out.diverging) current.push(name);
    if (out.event) {
      const event = { field: name, ...out.event, active: out.active };
      total++;
      byField[name] = (byField[name] ?? 0) + 1;
      last = event;
      events.push(event);
    }
  }
  picks.xp = picks.level;
  const gepLevel = candidates.level.find((c) => c.source === "gep")?.value;
  return {
    memory: {
      game: gameId,
      held:
        picks.level === "gep" && known(gepLevel)
          ? Math.max(held ?? 0, gepLevel)
          : held,
      fields,
      divergence: { total, byField, last },
    },
    picks,
    events,
    divergence: { total, byField, last, current, readings },
  };
}
