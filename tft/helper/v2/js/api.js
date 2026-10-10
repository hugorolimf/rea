import { shareEvents } from "./sse-share.js";

/** Camada de rede da v2: usa os mesmos endpoints da v1, sem alterar o contrato. */
const getJSON = async (url, init = {}, ms = 20000) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(ms),
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
    // Item de emblema → sinergia que ele dá a quem o equipa.
    emblems: new Map(
      d.items.filter((i) => i.trait).map((i) => [i.id, i.trait]),
    ),
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
export function recommendPayload(
  state,
  goal = null,
  augments = [],
  compSwaps = {},
) {
  const screen = state.screen ?? {};
  return {
    augments: augments.map((a) => a.id),
    playerId: state.localPlayerId,
    viewedPlayerId: "",
    level: screen.level ?? state.estimatedLevel ?? 7,
    gold: screen.gold ?? null,
    // O banco de campeões não é informado nem lido: não há fonte (ver FONTES-DE-DADOS.md).
    bench: [],
    inventory: Array.isArray(screen.items) ? screen.items : [],
    // screen.level é o lido ou o piso derivado (servidor, level.mjs). Só sem ele entra o tabuleiro, marcado estimado:
    // a análise não trata estimativa como leitura (sem rolagem/odds por nível).
    levelEstimated: screen.level == null,
    levelSource:
      screen.level == null
        ? "estimado"
        : screen.sources?.level === "derived"
          ? "derivado"
          : "tela",
    targetLevel: "auto",
    previewIds: [],
    side: "right",
    goalCarryId: "",
    goalCompId: goal?.id ?? "",
    goalSwaps: goal?.swaps ?? [],
    compSwaps: goal ? {} : compSwaps,
  };
}
// Análise nova busca evidência na MetaTFT em até 3 passes: espera mais que as leituras simples para não abortar
// (e repetir) um POST que o servidor ainda está montando.
export const loadRecommendation = (payload) =>
  getJSON(
    "/api/recommend",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    120000,
  );

export const REFRESH_WINDOW_MS = 120000;
/** Chave que muda só quando uma nova análise é necessária (mesma regra de cache da v1). */
export const analysisKey = (state, payload) =>
  JSON.stringify({
    payload,
    // Conteúdo do snapshot (o servidor devolve `signature`); o horário do arquivo muda a cada regravação, mesmo sem
    // nada de novo no jogo. Servidor antigo sem assinatura: cai para o horário.
    source: state.signature ?? state.modifiedAt,
    phase: state.phase,
    actionable: state.actionable,
    sameGame: state.sameGame,
    match: state.match?.id,
    screen: {
      xp: state.screen?.xp,
      stage: state.screen?.stage,
      shop: state.screen?.shop,
      augments: state.screen?.augments,
      // Removedores mudam o método de passar itens (servidor lê da própria tela).
      removers: state.screen?.removers,
    },
    // Só o decaimento do banco estimado dos rivais muda com o tempo (em meios, ver server.mjs): 2 min bastam. Antes,
    // 30 s refaziam a análise inteira mesmo com o jogo parado.
    window: Math.floor(Date.now() / REFRESH_WINDOW_MS),
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
