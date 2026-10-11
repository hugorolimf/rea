import {
  REFRESH_WINDOW_MS,
  analysisKey as coreAnalysisKey,
  decisionPayload,
} from "../../core/state/analysis-key.mjs";
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
    // Wisps (fogos-fátuos) do Set 18: a loja os mostra com marca própria e nunca como campeões (core/catalog/wisps.mjs).
    wisps: d.wisps ?? [],
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
 * Decisões do usuário (comp fixada com trocas, aprimoramentos marcados, trocas no automático) no formato do corpo do POST
 * e da chave de análise: a regra mora em core/state/analysis-key.mjs, a mesma que o servidor usa para conduzir a análise
 * sozinho. `augmentsKnown` (a tela tem registro de aprimoramentos desta partida) entra só quando informado.
 */
export const decisionsOf = (
  state,
  goal = null,
  augments = [],
  compSwaps = {},
  augmentsKnown = undefined,
) =>
  decisionPayload(state, {
    augments: augments.map((a) => a.id),
    goalCompId: goal?.id ?? "",
    goalSwaps: goal?.swaps ?? [],
    compSwaps: goal ? {} : compSwaps,
    augmentsKnown,
  });

/**
 * Corpo do POST /api/recommend: só decisões do usuário (comp fixada, trocas, aprimoramentos escolhidos). Ouro, nível,
 * itens, loja, XP e estágio o servidor lê do próprio estado (core/state/inputs.mjs); mandá-los daqui reintroduziria a
 * defasagem entre o que o cliente viu e o que o servidor lê no mesmo POST. `goal` é a comp fixada ({id, swaps}); o
 * servidor resolve unidades, carry e builds e aplica as trocas.
 * `replay` (partida revista): a leitura de agora não vale para ela, então os campos antigos do cliente continuam
 * indo (nível estimado, ouro desconhecido, sem banco de itens).
 */
export function recommendPayload(
  state,
  goal = null,
  augments = [],
  compSwaps = {},
  { replay = false, legacyServer = false } = {},
) {
  const screen = state.screen ?? {},
    decisions = decisionsOf(state, goal, augments, compSwaps);
  // `legacyServer`: um servidor iniciado antes do M7 ainda exige `level`/`gold`/`inventory` no POST (sem eles responde
  // "Nível deve ser de 1 a 11." / "Ouro inválido."). O servidor novo ignora esses campos ao vivo e usa o próprio estado,
  // então mandá-los é inofensivo. Remover quando todo servidor em uso for posterior ao M7.
  if (!replay && !legacyServer) return decisions;
  return {
    ...decisions,
    level: screen.level ?? state.estimatedLevel ?? 7,
    gold: screen.gold ?? null,
    bench: [],
    inventory: Array.isArray(screen.items) ? screen.items : [],
    levelEstimated: screen.level == null,
    levelSource: screen.level == null ? "estimado" : "tela",
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

export { REFRESH_WINDOW_MS };
/**
 * Chave que muda só quando uma nova análise é necessária (mesma regra de cache da v1). A regra é a de
 * core/state/analysis-key.mjs (o servidor calcula a mesma para conduzir a análise sozinho); aqui só entra o relógio.
 * `payload` = as decisões (`decisionsOf`), não o corpo do POST com os campos antigos do servidor legado.
 */
export const analysisKey = (state, payload) =>
  coreAnalysisKey(state, payload, Date.now());

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
