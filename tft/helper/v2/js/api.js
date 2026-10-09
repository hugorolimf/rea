import { shareEvents } from "./sse-share.js";

/** Camada de rede da v2: usa os mesmos endpoints da v1, sem alterar o contrato. */
const getJSON = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Não foi possível atualizar a leitura.");
  return body;
};

export async function loadCatalog() {
  const d = await getJSON("/api/catalog");
  return {
    champions: new Map(d.champions.map((c) => [c.id, c])),
    items: new Map(d.items.map((i) => [i.id, i])),
    traits: new Map(d.traits.map((t) => [t.name, t.breakpoints])),
    traitIcons: new Map(d.traits.map((t) => [t.name, t.icon])),
  };
}
export const loadState = () => getJSON("/api/state");
/** Comps de meta da cópia local do servidor, com fonte e data. */
export const loadComps = () => getJSON("/api/comps");
/** Itens do set com atributos, receita e tier por categoria (desempenho da cópia de meta). */
export const loadItems = () => getJSON("/api/items");
/** Partidas registradas pelo servidor, da mais recente para a mais antiga. */
export const loadHistory = async () =>
  (await getJSON("/api/history")).matches ?? [];

/**
 * Corpo do POST /api/recommend, derivado do estado lido (nível/ouro/itens vêm da tela quando há).
 * `goal` é a comp fixada ({id, swaps}); o servidor resolve unidades, carry e builds e aplica as trocas.
 */
export function recommendPayload(state, goal = null, augments = []) {
  const screen = state.screen ?? {};
  return {
    augments: augments.map((a) => a.id),
    playerId: state.localPlayerId,
    viewedPlayerId: "",
    level: screen.level ?? state.estimatedLevel ?? 7,
    gold: screen.gold ?? null,
    bench: [],
    inventory: Array.isArray(screen.items) ? screen.items : [],
    levelEstimated: screen.level == null,
    targetLevel: "auto",
    previewIds: [],
    side: "right",
    goalCarryId: "",
    goalCompId: goal?.id ?? "",
    goalSwaps: goal?.swaps ?? [],
  };
}
export const loadRecommendation = (payload) =>
  getJSON("/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

/** Chave que muda só quando uma nova análise é necessária (mesma regra de cache da v1). */
export const analysisKey = (state, payload) =>
  JSON.stringify({
    payload,
    source: state.modifiedAt,
    phase: state.phase,
    actionable: state.actionable,
    sameGame: state.sameGame,
    match: state.match?.id,
    screen: {
      xp: state.screen?.xp,
      stage: state.screen?.stage,
      shop: state.screen?.shop,
      augments: state.screen?.augments,
    },
    window: Math.floor(Date.now() / 30000),
  });

/**
 * Assina os avisos do servidor (SSE): novos tabuleiros e início/fim de partida (`type: "match"`).
 * Devolve uma função que encerra a assinatura.
 */
export const subscribe = (onEvent) =>
  shareEvents((text) => {
    let event = null;
    try {
      event = JSON.parse(text);
    } catch {}
    onEvent(event);
  });
