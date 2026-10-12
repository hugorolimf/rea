// Os fatos derivados do pipeline da recomendação (M8b da migração, ver ARQUITETURA.md) e o grafo que os guarda.
//
// Antes, cada camada tinha uma chave de cache montada à mão (`analysis-keys.baseInputs`, `analysisCache`,
// `baseAnalysisCache`, `pendingBase`) e o motor lia `options.shop` sem a loja estar na chave (defeito D1). Agora cada
// camada é um FATO com as entradas DECLARADAS: a função só enxerga o que declarou (core/graph) e a chave de memoização
// sai do conteúdo dessas entradas. Declarar a loja na base é o que corrige D1 por construção.
//
//   entradas (graph.set) -> clock.stage, catalog.traits, traits.grants, economy.shopsAhead, level.target, comps.swapped
//                        -> comps.base (analyze) -> comps.readingId
//                        -> tactics.analysis (clone da base + tactics + comp fixada)
//                        -> plan.stage.K -> plan.strategy.K            (K = 0..3: até 3 sugestões + o plano fixado)
//
// REGRAS DESTE ARQUIVO (tests/architecture.test.mjs, "T7"): todo `defineFact` está na raiz do módulo e o `compute` é uma
// função nomeada da raiz (nunca um fechamento sobre variáveis do pipeline), não há `let`/`var` nem `Map`/`Set` na raiz, e
// nada de relógio, aleatório, rede, `process` ou `await`. O que um fato precisa entra por `inputs`.
//
// Fronteira com o pipeline (app/recommend.mjs e o harness do golden): quem monta o estado (impuro) chama
// `recommendValues` para traduzir `options` + cópias de meta em entradas e `bindRun` para ler os fatos. Cada leitura faz
// `graph.set(tudo)` e `graph.get(fato)` SEM `await` entre os dois: o grafo é um só e várias análises se intercalam nas
// esperas de rede, então cada trecho síncrono reafirma as entradas dele.
import {
  canonical,
  createGraph,
  defineFact,
  digestString,
} from "../core/graph/index.mjs";
import { traitBook } from "../core/catalog/traits.mjs";
import { shopsAhead } from "../core/economy/gold.mjs";
import { snapshotIdentity } from "../core/state/snapshot-identity.mjs";
import { analyze } from "../engine.mjs";
import { tactics } from "../tactics.mjs";
import { stagePlan } from "../stage.mjs";
import { slotTransitions } from "../core/board/interim.mjs";
import { strategy } from "../strategy.mjs";
import { suggestTargetLevel } from "../target-level.mjs";

/** Planos analisados por leitura: até 3 sugestões do motor e o plano fixado pelo usuário (`preview`). */
export const MAX_PLANS = 4;

/** Os planos de uma análise, na ordem em que o pipeline sempre os percorreu: sugestões e depois o fixado. */
export const plansOf = (analysis) => [
  ...analysis.recommendations,
  ...(analysis.preview ? [analysis.preview] : []),
];

/**
 * Entradas do grafo (o que `graph.set` aceita). O tabuleiro do jogo (`snapshot`) é grande e regravado a cada segundo:
 * a chave dele é a IDENTIDADE (core/state/snapshot-identity.mjs: vida, colocação, aprimoramentos e peças ordenadas), o
 * mesmo que `snapshotSignature` era; os fatos continuam recebendo o snapshot inteiro.
 */
export const GRAPH_INPUTS = Object.freeze({
  snapshot: { identity: snapshotIdentity },
  catalog: null,
  playerId: null,
  bench: null,
  hidden: null,
  inventory: null,
  bankRead: null,
  level: null,
  levelEstimated: null,
  targetLevel: null,
  gold: null,
  targetGold: null,
  targetHp: null,
  xp: null,
  stage: null,
  shop: null,
  removers: null,
  hasRemover: null,
  streak: null,
  trend: null,
  augments: null,
  chosen: null,
  previewIds: null,
  goalCarryId: null,
  goal: null,
  goalCompId: null,
  goalSwaps: null,
  compSwaps: null,
  metaComps: null,
  metaBuilds: null,
  metaRoles: null,
  metaLabel: null,
  metaDates: null,
  itemStats: null,
  boardStats: null,
  augmentStats: null,
  evidence: null,
  conditional: null,
  sticky: null,
  holdPlan: null,
  benchKnown: null,
  side: null,
  viewedPlayerId: null,
});

/* ---------- Fatos pequenos ---------- */

function stageNumber({ stage }) {
  return { stage: stage?.stage ?? null };
}

/** O motor só lê o número do estágio (`options.stage?.stage`): a rodada dentro dele não refaz a base. */
export const clockStageFact = defineFact({
  id: "clock.stage",
  inputs: ["stage"],
  compute: stageNumber,
  keep: 8,
  doc: "Número do estágio (o motor ignora a rodada).",
});

function bookOf({ catalog }) {
  return traitBook(catalog);
}

export const catalogTraitsFact = defineFact({
  id: "catalog.traits",
  inputs: ["catalog"],
  compute: bookOf,
  // O livro tem funções e Maps: sem resumo da saída; o corte é pela chave (o catálogo).
  cutoff: "key",
  keep: 2,
  doc: "Livro de sinergias e emblemas do catálogo (core/catalog/traits.mjs).",
});

function grantsOf({ traits, chosen }) {
  const g = traits.grants(chosen);
  return { traits: g.traits, traitsById: g.traitsById, emblems: g.emblems };
}

export const traitsGrantsFact = defineFact({
  id: "traits.grants",
  inputs: { traits: "catalog.traits", chosen: "chosen" },
  compute: grantsOf,
  keep: 8,
  doc: "Sinergias e itens de emblema que os aprimoramentos escolhidos concedem (o que o motor lê em options.augment*).",
});

function shopsOf({ gold }) {
  return shopsAhead(gold);
}

export const shopsAheadFact = defineFact({
  id: "economy.shopsAhead",
  inputs: ["gold"],
  compute: shopsOf,
  keep: 16,
  doc: "Lojas ao alcance: o ouro de agora mais a renda das próximas rodadas (core/economy/gold.mjs).",
});

function targetOf({
  snapshot,
  playerId,
  level,
  targetGold,
  targetHp,
  targetLevel,
}) {
  if (targetLevel !== "auto")
    return { level: targetLevel, reasons: [], auto: false };
  const target = suggestTargetLevel(snapshot, playerId, level, targetGold, {
    hp: targetHp,
  });
  return { level: target.level, reasons: target.reasons, auto: true };
}

/**
 * O alvo lê o ouro e a vida DA RODADA (`targetGold`/`targetHp`, de target-level.mjs `steadyTargetInputs`), não o ouro de
 * agora: o ouro cruzando o teto de juros durante a loja não alterna o alvo nem o tamanho do tabuleiro planejado.
 */
export const levelTargetFact = defineFact({
  id: "level.target",
  inputs: [
    "snapshot",
    "playerId",
    "level",
    "targetGold",
    "targetHp",
    "targetLevel",
  ],
  compute: targetOf,
  keep: 8,
  doc: "Nível-alvo: o escolhido pelo usuário ou o sugerido por vida e ouro da rodada e tabuleiros (target-level.mjs).",
});

function targetNumber({ target }) {
  return target.level;
}

/** Só o número do alvo: os motivos citam o ouro (texto), e a base não deve refazer por causa de uma frase. */
export const levelTargetNumberFact = defineFact({
  id: "level.targetLevel",
  inputs: { target: "level.target" },
  compute: targetNumber,
  keep: 8,
  doc: "O nível-alvo sem os motivos.",
});

function swappedOf({ metaComps, compSwaps }) {
  // Automático com substituições: a comp de meta já entra no ranking com as peças trocadas pelo usuário.
  return (metaComps ?? []).map((c) => {
    const list = (compSwaps[c.id] ?? []).filter(
      (x) =>
        x.out !== c.carry && c.units.includes(x.out) && !c.units.includes(x.in),
    );
    if (!list.length) return c;
    const units = [...c.units];
    for (const x of list) units.splice(units.indexOf(x.out), 1, x.in);
    return { ...c, units, appliedSwaps: list };
  });
}

export const compsSwappedFact = defineFact({
  id: "comps.swapped",
  inputs: ["metaComps", "compSwaps"],
  compute: swappedOf,
  keep: 4,
  doc: "Comps de meta com as trocas do usuário aplicadas (só as que valem: a peça que sai está na comp e a que entra não).",
});

/* ---------- A base: o motor de comps ---------- */

/** Entradas que decidem a LEITURA do jogo (não a loja nem a evidência): o que o identificador da leitura resume. */
const STATE_INPUTS = Object.freeze({
  snapshot: "snapshot",
  catalog: "catalog",
  playerId: "playerId",
  bench: "bench",
  benchKnown: "benchKnown",
  hidden: "hidden",
  inventory: "inventory",
  bankRead: "bankRead",
  level: "level",
  previewIds: "previewIds",
  goalCarryId: "goalCarryId",
  sticky: "sticky",
  holdPlan: "holdPlan",
  augments: "augments",
  chosen: "chosen",
  stage: "clock.stage",
  targetLevel: "level.targetLevel",
  grants: "traits.grants",
  swapped: "comps.swapped",
});

/**
 * Tudo o que `analyze` lê, e SÓ isso. A loja (`shop`) entra aqui: o motor a lê (`shopHits` -> `compScore`) e a chave de
 * cache antiga não a tinha (D1). O ouro entra como lojas ao alcance (`economy.shopsAhead`): é a única coisa que o motor
 * faz com ele.
 */
const BASE_INPUTS = Object.freeze({
  ...STATE_INPUTS,
  shops: "economy.shopsAhead",
  shop: "shop",
  metaBuilds: "metaBuilds",
  metaRoles: "metaRoles",
  itemStats: "itemStats",
  boardStats: "boardStats",
  augmentStats: "augmentStats",
  evidence: "evidence",
  conditional: "conditional",
  // Tendência da vida (streak.mjs): o alcance (core/comps/reach.mjs) mede por ela a taxa de derrota e o dano por derrota.
  trend: "trend",
});

/** O `options` do motor, montado SÓ com as entradas declaradas de `comps.base` (o D1 do teste de arquitetura mede isto). */
export function baseOptions(i) {
  return {
    level: i.level,
    targetLevel: i.targetLevel,
    shopsAhead: i.shops,
    playerId: i.playerId,
    bench: i.bench,
    benchKnown: i.benchKnown,
    trend: i.trend ?? null,
    hidden: i.hidden,
    inventory: i.inventory,
    bankRead: i.bankRead,
    previewIds: i.previewIds,
    goalCarryId: i.goalCarryId,
    sticky: i.sticky,
    stickyCompId: i.sticky?.id ?? null,
    holdPlan: i.holdPlan,
    stage: i.stage,
    shop: i.shop,
    augments: i.augments,
    augmentNames: Object.fromEntries(i.chosen.map((a) => [a.id, a.name])),
    augmentTraits: i.grants.traits,
    augmentTraitsById: i.grants.traitsById,
    augmentEmblems: i.grants.emblems,
    metaComps: i.swapped,
    metaBuilds: i.metaBuilds,
    metaRoles: i.metaRoles,
    stats: i.boardStats,
    itemStats: i.itemStats,
    baseAvg: i.boardStats?.base?.[0] ?? 4.466,
    augmentStats: i.augmentStats,
    evidence: i.evidence,
    conditional: i.conditional,
  };
}

function baseOf(i) {
  return analyze(i.snapshot, i.catalog, baseOptions(i));
}

export const compsBaseFact = defineFact({
  id: "comps.base",
  inputs: BASE_INPUTS,
  compute: baseOf,
  // ~1 MB por resposta (o ranking de comps é metade): sem resumo da saída; o corte é pela chave das entradas.
  cutoff: "key",
  keep: 4,
  doc: "Análise base (engine.analyze): escolhe e mede os planos. Entradas = tudo o que o motor lê, inclusive a loja.",
});

function readingOf(i) {
  return digestString(
    canonical([
      snapshotIdentity(i.snapshot),
      i.playerId,
      i.bench,
      i.benchKnown,
      i.hidden,
      i.inventory,
      i.bankRead,
      i.level,
      i.targetLevel,
      i.gold,
      i.previewIds,
      i.goalCarryId,
      [...i.augments].sort(),
      i.swapped
        .filter((c) => c.appliedSwaps)
        .map((c) => [c.id, c.appliedSwaps]),
      i.sticky?.id ?? null,
      i.sticky?.units ?? null,
      i.holdPlan ?? false,
      i.stage.stage,
      i.metaDates,
    ]),
  );
}

/**
 * Identificador da LEITURA do jogo a que a base se refere (o `baseId` que o plano em andamento usa para não contar duas
 * vezes a mesma leitura do desafiante). É o mesmo recorte do `baseInputs` antigo: sem a loja nem a evidência (a loja
 * muda a nota das comps, não a leitura) e com o ouro de verdade, não as lojas ao alcance.
 */
export const compsReadingFact = defineFact({
  id: "comps.readingId",
  inputs: { ...STATE_INPUTS, gold: "gold", metaDates: "metaDates" },
  compute: readingOf,
  keep: 16,
  doc: "Identificador da leitura do jogo da análise base (sem loja nem evidência).",
});

/* ---------- A camada tática ---------- */

function tacticalOf(i) {
  const built = i.base;
  // A base guardada/compartilhada nunca é alterada: o fato trabalha numa cópia. compRanking (~580 KB) não é alterado
  // depois da análise (tactics, stagePlan, strategy, planState, augmentAdvice e contestAlert só leem): segue por referência.
  const base = structuredClone({ ...built, compRanking: undefined });
  base.compRanking = built.compRanking;
  const previewIds = base.previewGrow.length
    ? [...i.previewIds, ...base.previewGrow.map((g) => g.id)]
    : i.previewIds;
  const analysis = tactics(base, i.catalog, {
    metaRoles: i.metaRoles,
    viewedPlayerId: i.viewedPlayerId,
    stats: i.boardStats,
    metaBuilds: i.metaBuilds,
    inventory: i.inventory,
    metaLabel: i.metaLabel,
    side: i.side,
    removers: i.removers,
    hasRemover: i.hasRemover,
    previewIds,
    goalCarryId: i.goalCarryId,
    goalComp: i.goal,
  });
  analysis.goalIds = base.previewGrow.length ? previewIds : null;
  // A comp fixada vira um plano de meta como as sugestões: mesmo título e dados que a economia usa.
  analysis.goal = i.goalCompId
    ? { id: i.goalCompId, found: !!i.goal, swaps: i.goalSwaps }
    : null;
  // Substituições valendo na comp sugerida (automático).
  const shownId = analysis.recommendations[0]?.meta?.id;
  analysis.autoSwaps = i.goal
    ? []
    : (i.swapped.find((c) => c.id === shownId)?.appliedSwaps ?? []);
  if (analysis.preview) analysis.preview.flex = base.previewFlex ?? [];
  // Emblema e evidência da comp fixada vêm da linha dela no ranking (medidos na comp de meta, sem as trocas
  // nem as peças acrescentadas: aproximação para exibir).
  const ranked = i.goal
    ? analysis.compRanking?.find((r) => r.id === i.goal.id)
    : null;
  if (i.goal && analysis.preview)
    Object.assign(analysis.preview, {
      emblems: ranked?.emblem ?? [],
      evidence: ranked?.evidence ?? null,
      title: i.goal.title,
      meta: {
        id: i.goal.id,
        tier: i.goal.tier,
        avg: i.goal.avg,
        top4: i.goal.top4,
        win: i.goal.win,
        games: i.goal.games,
        levelling: i.goal.levelling,
        rerollLevel: i.goal.rerollLevel,
        stars3: i.goal.stars3,
        builds: i.goal.builds,
        buildStats: i.goal.buildStats ?? {},
      },
    });
  return analysis;
}

export const tacticsAnalysisFact = defineFact({
  id: "tactics.analysis",
  inputs: {
    base: "comps.base",
    catalog: "catalog",
    metaRoles: "metaRoles",
    viewedPlayerId: "viewedPlayerId",
    boardStats: "boardStats",
    metaBuilds: "metaBuilds",
    inventory: "inventory",
    metaLabel: "metaLabel",
    side: "side",
    removers: "removers",
    hasRemover: "hasRemover",
    previewIds: "previewIds",
    goalCarryId: "goalCarryId",
    goal: "goal",
    goalCompId: "goalCompId",
    goalSwaps: "goalSwaps",
    swapped: "comps.swapped",
  },
  compute: tacticalOf,
  cutoff: "key",
  keep: 4,
  doc: "A base com a tática por cima (cópia da base + tactics + comp fixada). Só o que a tática lê: loja, ouro e XP não entram. As trocas (substituto temporário) saem das vagas da Formação em composeAnalysis.",
});

function stageAt(slot, i) {
  const plan = plansOf(i.analysis)[slot];
  if (!plan) return null;
  return stagePlan(plan, i.analysis, i.catalog, {
    level: i.level,
    gold: i.gold,
    stage: i.stage,
    shop: i.shop,
    metaBuilds: i.metaBuilds,
    inventory: i.inventory,
    // A faixa de vida da loja é a mesma da estratégia: entra a tendência da vida.
    trend: i.trend,
    // Última luta (vitória estabiliza o perigo): a mesma entrada da estratégia.
    streak: i.streak,
    // Reserva lida (GEP): sem ela, a compra para a reserva não sugere venda (vagas desconhecidas).
    benchKnown: i.benchKnown,
  });
}

function strategyAt(slot, i) {
  const plan = plansOf(i.analysis)[slot];
  if (!plan) return null;
  // strategy lê `plan.stage.buyNow/shop` (a loja já classificada): o plano vai com o campo de agora.
  return strategy({ ...plan, stage: i.field }, i.analysis, {
    level: i.level,
    gold: i.gold,
    stage: i.stage,
    streak: i.streak,
    trend: i.trend,
    xp: i.xp,
    levelEstimated: i.levelEstimated,
    augmentTraits: i.grants.traits,
    targetLevel: i.targetLevel,
  });
}

// Um fato por posição de plano (0..MAX_PLANS-1): são escritos por extenso, sem fábrica, para o `compute` de cada um
// ser uma função nomeada da raiz (a regra T7 recusa fechamentos). Posição sem plano devolve null.
function stage0(i) {
  return stageAt(0, i);
}
function stage1(i) {
  return stageAt(1, i);
}
function stage2(i) {
  return stageAt(2, i);
}
function stage3(i) {
  return stageAt(3, i);
}
function strategy0(i) {
  return strategyAt(0, i);
}
function strategy1(i) {
  return strategyAt(1, i);
}
function strategy2(i) {
  return strategyAt(2, i);
}
function strategy3(i) {
  return strategyAt(3, i);
}

const STAGE_INPUTS = Object.freeze({
  analysis: "tactics.analysis",
  catalog: "catalog",
  level: "level",
  gold: "gold",
  stage: "stage",
  shop: "shop",
  metaBuilds: "metaBuilds",
  inventory: "inventory",
  trend: "trend",
  streak: "streak",
  benchKnown: "benchKnown",
});
const STAGE_DOC =
  "Campo de agora do plano: o que manter, comprar (com a loja lida) e passar de itens (stage.mjs).";

const strategyInputs = (slot) =>
  Object.freeze({
    analysis: "tactics.analysis",
    field: `plan.stage.${slot}`,
    level: "level",
    gold: "gold",
    stage: "stage",
    streak: "streak",
    trend: "trend",
    xp: "xp",
    levelEstimated: "levelEstimated",
    grants: "traits.grants",
    // O mesmo nível-alvo que escolheu o tamanho da comp: a decisão da rodada (core/turn) mira nele.
    targetLevel: "level.targetLevel",
  });
const STRATEGY_DOC =
  "Economia, nível e rolagem do plano (strategy.mjs; a simulação de rolagem é o fato roll.sim de roll-sim.mjs).";

export const planStage0Fact = defineFact({
  id: "plan.stage.0",
  inputs: STAGE_INPUTS,
  compute: stage0,
  keep: 8,
  doc: STAGE_DOC,
});
export const planStage1Fact = defineFact({
  id: "plan.stage.1",
  inputs: STAGE_INPUTS,
  compute: stage1,
  keep: 8,
  doc: STAGE_DOC,
});
export const planStage2Fact = defineFact({
  id: "plan.stage.2",
  inputs: STAGE_INPUTS,
  compute: stage2,
  keep: 8,
  doc: STAGE_DOC,
});
export const planStage3Fact = defineFact({
  id: "plan.stage.3",
  inputs: STAGE_INPUTS,
  compute: stage3,
  keep: 8,
  doc: STAGE_DOC,
});
export const planStrategy0Fact = defineFact({
  id: "plan.strategy.0",
  inputs: strategyInputs(0),
  compute: strategy0,
  keep: 8,
  doc: STRATEGY_DOC,
});
export const planStrategy1Fact = defineFact({
  id: "plan.strategy.1",
  inputs: strategyInputs(1),
  compute: strategy1,
  keep: 8,
  doc: STRATEGY_DOC,
});
export const planStrategy2Fact = defineFact({
  id: "plan.strategy.2",
  inputs: strategyInputs(2),
  compute: strategy2,
  keep: 8,
  doc: STRATEGY_DOC,
});
export const planStrategy3Fact = defineFact({
  id: "plan.strategy.3",
  inputs: strategyInputs(3),
  compute: strategy3,
  keep: 8,
  doc: STRATEGY_DOC,
});

/** Todos os fatos do pipeline, na ordem em que dependem uns dos outros. */
export const RECOMMEND_FACTS = Object.freeze([
  clockStageFact,
  catalogTraitsFact,
  traitsGrantsFact,
  shopsAheadFact,
  levelTargetFact,
  levelTargetNumberFact,
  compsSwappedFact,
  compsBaseFact,
  compsReadingFact,
  tacticsAnalysisFact,
  planStage0Fact,
  planStage1Fact,
  planStage2Fact,
  planStage3Fact,
  planStrategy0Fact,
  planStrategy1Fact,
  planStrategy2Fact,
  planStrategy3Fact,
]);

/**
 * Cria o grafo do pipeline. `clock` (ms) só mede o tempo de cada cálculo em `stats()`; `verify` é o modo de teste do
 * grafo; `overrides` troca fatos pelo id (os testes põem um espião no lugar de `comps.base`).
 */
export function createRecommendGraph({
  clock = null,
  verify = false,
  overrides = [],
} = {}) {
  const swap = new Map(overrides.map((fact) => [fact.id, fact]));
  return createGraph({
    facts: RECOMMEND_FACTS.map((fact) => swap.get(fact.id) ?? fact),
    inputs: GRAPH_INPUTS,
    clock,
    verify,
  });
}

/**
 * As entradas do grafo para UMA análise, traduzidas do `options` que o pipeline monta (impuro: estado, planos, sequências)
 * e das cópias de meta. `evidence` e `conditional` ficam de fora (mudam durante a espera de rede: `bindRun` as pede a
 * cada leitura). Chame depois que `options` está pronto e NÃO o altere depois no que os fatos leem.
 *  - `targetLevel`: a escolha do usuário ("auto" ou um nível), não o resolvido (esse é o fato `level.target`);
 *  - `chosen`: aprimoramentos escolhidos (entradas de augments.json); `goal`: a comp de meta fixada, ou null.
 */
export function recommendValues({
  snapshot,
  catalog,
  options,
  meta,
  metaComps,
  boardStats,
  augmentStats,
  chosen,
  goal,
  targetLevel,
}) {
  return {
    snapshot,
    catalog,
    playerId: options.playerId,
    bench: options.bench,
    // A reserva foi lida (GEP fresco)? Sem isso, `bench: []` é "não sei", não "reserva vazia".
    benchKnown: options.benchKnown === true,
    hidden: options.hidden,
    inventory: options.inventory,
    bankRead: options.bankRead !== false,
    level: options.level,
    levelEstimated: options.levelEstimated === true,
    targetLevel,
    gold: options.gold,
    // Ouro e vida da rodada para o nível-alvo (app/recommend.mjs, targetLevelTracker); sem eles (partida revista, golden),
    // o ouro lido e a vida do snapshot.
    targetGold:
      options.targetGold !== undefined ? options.targetGold : options.gold,
    targetHp: options.targetHp ?? null,
    xp: options.xp,
    stage: options.stage ?? null,
    shop: options.shop,
    removers: options.removers,
    hasRemover: options.hasRemover,
    streak: options.streak ?? null,
    trend: options.trend ?? null,
    augments: options.augments,
    chosen,
    previewIds: options.previewIds,
    goalCarryId: options.goalCarryId,
    goal,
    goalCompId: options.goalCompId,
    goalSwaps: options.goalSwaps,
    compSwaps: options.compSwaps,
    metaComps: metaComps.comps,
    metaBuilds: meta.builds,
    metaRoles: meta.roles,
    metaLabel: meta.label,
    // As datas das cópias de meta: o identificador da leitura as resume (a chave dos fatos usa o conteúdo).
    metaDates: {
      builds: meta.fetchedAt,
      comps: metaComps.fetchedAt,
      stats: boardStats?.fetchedAt ?? null,
    },
    itemStats: meta.items ?? {},
    boardStats,
    augmentStats,
    sticky: options.sticky ?? null,
    // true (segura), false (sem plano) ou { release: id } (plan-state.mjs holdFor: fato novo libera o desafiante).
    holdPlan: options.holdPlan ?? false,
    side: options.side,
    viewedPlayerId: options.viewedPlayerId,
  };
}

/**
 * Liga o grafo a uma análise. `values` vem de `recommendValues`; `evidence()` devolve `{ evidence, conditional }` (cópias
 * dos mapas do explorer, que o chamador só renova quando mudam: o grafo guarda por conteúdo e a referência igual é
 * atalho). Cada leitura reafirma TODAS as entradas e lê o fato no mesmo trecho síncrono.
 */
export function bindRun(graph, values, evidence) {
  const read = (name) => {
    try {
      graph.set({ ...values, ...evidence() });
      return graph.get(name);
    } catch (error) {
      // O erro de um fato (ex.: "Selecione o seu jogador." do motor) chega ao chamador com a mensagem de sempre, não
      // embrulhado em COMPUTE_FAILED: é o texto que o servidor devolve à tela.
      throw error?.code === "COMPUTE_FAILED" && error.cause
        ? error.cause
        : error;
    }
  };
  const computes = (name) => graph.stats().facts[name]?.computes ?? 0;
  return {
    graph,
    read,
    computes,
    base: () => read("comps.base"),
    readingId: () => read("comps.readingId"),
    target: () => read("level.target"),
    tactical: () => read("tactics.analysis"),
    field: (slot) => read(`plan.stage.${slot}`),
    strategy: (slot) => read(`plan.strategy.${slot}`),
  };
}

/** Quantas vezes cada fato executou até agora: a diferença entre duas leituras diz o que uma análise recalculou. */
export function computeCounts(graph) {
  return Object.fromEntries(
    Object.entries(graph.stats().facts).map(([id, s]) => [id, s.computes]),
  );
}

/**
 * Resumo dos fatos que executaram desde `before` (de `computeCounts`), na ordem das dependências, para o `TEMPO`:
 * `comps.base,tactics.analysis,plan.stage.0x3`. Não zera nada: várias análises podem estar em andamento no mesmo grafo.
 */
export function recomputedText(graph, before = {}) {
  return Object.entries(graph.stats().facts)
    .map(([id, s]) => [id, s.computes - (before[id] ?? 0)])
    .filter(([, n]) => n > 0)
    .map(([id, n]) => (n > 1 ? `${id}x${n}` : id))
    .join(",");
}

/**
 * Monta a análise que o resto do pipeline altera (plano em andamento, aprimoramentos, disputa): uma CÓPIA do fato
 * `tactics.analysis` com o campo de agora e a estratégia de cada plano (também copiados) e o código do time. Os fatos
 * ficam intactos; quem muta é a cópia. `teamCodeOf(ids)` é `teamCode(ids, plannerCatalog)`.
 */
export function composeAnalysis(tactical, perPlan, teamCodeOf) {
  const analysis = structuredClone({ ...tactical, compRanking: undefined });
  analysis.compRanking = tactical.compRanking;
  const copies = structuredClone(perPlan);
  plansOf(analysis).forEach((plan, slot) => {
    plan.stage = copies[slot].stage;
    plan.strategy = copies[slot].strategy;
    plan.teamCode = teamCodeOf(plan.board.map((u) => u.id));
    // As trocas e o "Passar itens agora" leem as vagas da Formação (core/board/interim.mjs com a loja, o ouro e a faixa de
    // vida): a tática calculou o mesmo sem a loja; aqui as duas viram uma só decisão.
    if (plan.stage?.slots) {
      plan.transitions = slotTransitions(plan.stage.slots);
      for (const move of plan.itemMoves ?? [])
        if (move.leaving && move.method !== "sem removedor disponível")
          move.now =
            plan.transitions.find((t) => t.exit?.id === move.from.id)?.ready ===
            true;
    }
  });
  return analysis;
}
