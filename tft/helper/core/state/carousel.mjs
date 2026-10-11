// Carrossel no estado da partida: em que rodada estamos, de que fonte vem a resposta e o que o carrossel oferece.
// ESM puro (sem imports de fora de core/, sem tempo implícito). Só descreve a partida; quem recomenda o que pegar é
// `carousel.mjs` (raiz). Nada é inventado: sem sinal nenhum o carrossel é desconhecido (`active: null`), nunca "não".
import { parseStage, stageText } from "./clock.mjs";
import { XP } from "./level.mjs";

/**
 * Rodada do calendário em que há carrossel: a x-4 de cada estágio a partir do 2 (observado 2-4, 3-4, 4-4, 5-4 e 6-4 no
 * GEP, `round_type` "Carousel"). A 1-1 é `Encounter` (PVE): no Set 18 não há carrossel no estágio 1.
 */
export const isCarouselRound = (stage) => {
  const at = typeof stage === "string" ? parseStage(stage) : stage;
  return !!at && at.stage >= 2 && at.round === XP.carouselRound;
};

/** O `round_type.name` do GEP é o carrossel? ("Carousel"; qualquer outro nome é outra rodada). */
const gepNamesCarousel = (name) =>
  typeof name === "string" && name.trim().toLowerCase() === "carousel";

/**
 * Sinais independentes de que o carrossel está aberto agora; cada um é `true`, `false` ou `null` (sem informação):
 *  - `phase`: a fase do jogo no `__sentry-event` (`phaseKind`): `draft` é o carrossel; qualquer outra fase diz que não;
 *  - `gep`: o `round_type` do GEP (`gepRound` = `{stage, name}`); vale só se for a MESMA rodada que `stage` (um
 *    `round_type` de outra rodada é atraso ou adiantamento do GEP, não informação);
 *  - `schedule`: o calendário (x-4 a partir do estágio 2): só uma estimativa.
 */
export function carouselSignals({
  stage = null,
  phaseKind = null,
  gepRound = null,
} = {}) {
  const at = parseStage(stage),
    gepStage = parseStage(gepRound?.stage);
  const gepSame = !at || !gepStage || stageText(at) === stageText(gepStage);
  return {
    phase:
      phaseKind === "draft"
        ? true
        : typeof phaseKind === "string"
          ? false
          : null,
    gep:
      gepRound && gepSame && typeof gepRound.name === "string"
        ? gepNamesCarousel(gepRound.name)
        : null,
    schedule: at ? isCarouselRound(at) : null,
  };
}

/**
 * Detecção do carrossel. Ordem de confiança: fase do jogo (arquivo do jogo) > `round_type` do GEP > calendário. Devolve
 * `{ active, stage, round, source, confidence, signals, conflict }`:
 *  - `active`: `true` | `false` | `null` (nenhum sinal);
 *  - `source`: `"game-log"` | `"gep"` | `"schedule"` | null, o sinal que decidiu;
 *  - `confidence`: `"observed"` (jogo ou GEP) | `"estimated"` (só o calendário) | null;
 *  - `conflict`: os sinais disponíveis não concordam (o de maior confiança vale, mas a divergência fica visível).
 */
export function detectCarousel(input = {}) {
  const signals = carouselSignals(input),
    order = [
      ["phase", "game-log", "observed"],
      ["gep", "gep", "observed"],
      ["schedule", "schedule", "estimated"],
    ],
    pick = order.find(([key]) => signals[key] !== null),
    known = Object.values(signals).filter((v) => v !== null),
    at = parseStage(input.stage);
  return {
    active: pick ? signals[pick[0]] : null,
    stage: stageText(at),
    round: at?.round ?? null,
    source: pick?.[1] ?? null,
    confidence: pick?.[2] ?? null,
    signals,
    conflict: known.some((v) => v !== known[0]),
  };
}

/**
 * Oferta lida do GEP (`carousel_pieces`) que vale agora: só a da rodada atual. `offer` = `{stage, slots, unknown,
 * ageMs}` (de `mergeGep`); uma oferta de outra rodada (a do carrossel anterior, que o GEP não apaga) é descartada.
 * Sem estágio conhecido a oferta só vale se o GEP também diz que a rodada atual é o carrossel (`gepRound`).
 */
export function currentOffer(offer, { stage = null, gepRound = null } = {}) {
  if (!offer || !Array.isArray(offer.slots) || !offer.slots.length) return null;
  const at = parseStage(stage),
    offered = parseStage(offer.stage);
  if (at && offered) return stageText(at) === stageText(offered) ? offer : null;
  if (at && !offered) return null;
  return gepNamesCarousel(gepRound?.name) ? offer : null;
}
