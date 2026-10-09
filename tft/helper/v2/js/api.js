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
  };
}
export const loadState = () => getJSON("/api/state");

/** Corpo do POST /api/recommend, derivado do estado lido (nível/ouro/itens vêm da tela quando há). */
export function recommendPayload(state) {
  const screen = state.screen ?? {};
  return {
    augments: [],
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
    screen: {
      xp: state.screen?.xp,
      stage: state.screen?.stage,
      shop: state.screen?.shop,
      augments: state.screen?.augments,
    },
    window: Math.floor(Date.now() / 30000),
  });

/** Assina os avisos de novos dados do jogo (SSE); devolve uma função que encerra a assinatura. */
export function subscribe(onTick) {
  const source = new EventSource("/api/events");
  source.onmessage = () => onTick();
  return () => source.close();
}
