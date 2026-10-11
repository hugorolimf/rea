// A parte PESADA do pipeline da recomendação (M10b, ARQUITETURA.md): da análise base (com a busca de evidência) até a
// disputa, sobre uma entrada que o servidor já montou (`payload`). Foi extraída de app/recommend.mjs sem mudar nenhuma
// regra nem a ordem das etapas; o que ficou lá é o que depende de estado e de E/S do servidor (validação, leitura do
// estado, decisões lembradas, plano em andamento, arquivos). Esta função não lê disco, não grava nada e não conhece o
// servidor: roda no processo principal (modo de reserva) ou numa thread (app/analysis-thread.mjs), com o mesmo resultado.
//
// Dois efeitos que ficam FORA daqui por dependerem do estado do servidor:
//   - `planState.track` (plano em andamento): a função devolve em `track` o que ele lê, capturado ANTES de `augmentAdvice` e
//     `contestAlert` mexerem na análise (a mesma ordem de sempre), e o servidor o chama e acrescenta `planProgress`;
//   - `overlay`/`results`/arquivos: tudo depois do resultado.
//
// Estado que vive aqui (um dono só, na thread quando há thread): o grafo de fatos (a base, a tática e os planos por conteúdo
// das entradas: é o que torna a base INCREMENTAL, só refaz o que uma entrada declarada mudou), as respostas do explorer
// (`evidenceMap`/`conditionalMap`) e a vaga que ordena as análises.
import { teamCode } from "../team-code.mjs";
import { augmentAdvice } from "../augment-advice.mjs";
import { contestAlert } from "../contest.mjs";
import {
  evidenceStats,
  settleEvidence,
  turnLock,
  yieldToLoop,
} from "./live-load.mjs";
import {
  MAX_PLANS,
  bindRun,
  composeAnalysis,
  computeCounts,
  createRecommendGraph,
  plansOf,
  recommendValues,
  recomputedText,
} from "./recommend-facts.mjs";

/**
 * Cria o pipeline pesado. `deps`: dados fixos (`heroId`, `catalog`, `plannerCatalog`, `localNames`, `augmentById`,
 * `traitRules`), `evidenceClient` (explorer da MetaTFT) e `budgetMs` (teto de espera de rede por análise). `yieldBetween`
 * cede o event loop entre as etapas (o servidor passa `yieldToLoop`; na thread não faz falta). `clock` mede cada fato.
 */
export function createAnalysisPipeline(deps) {
  const {
    heroId: HERO_ID,
    catalog,
    plannerCatalog,
    localNames,
    augmentById,
    traitRules,
    evidenceClient,
    budgetMs: EVIDENCE_BUDGET_MS,
    yieldBetween = yieldToLoop,
    clock = () => performance.now(),
  } = deps;
  // Uma análise por vez depois da base: a ordem das análises (plano em andamento, sequências) é a de sempre.
  const analysisTurn = turnLock();
  // Respostas do explorer já obtidas: filtro → {avg, games, top4} (null = falhou; a análise segue sem ela).
  const evidenceMap = new Map();
  // Tabelas condicionais já obtidas: filtro do trunfo → {units, traits} (o que rende junto com ele).
  const conditionalMap = new Map();
  // Versão do conteúdo dos dois mapas (muda a cada resposta guardada ou apagada): decide quando refazer a cópia que o
  // grafo recebe (os mapas mudam no lugar; as entradas do grafo são tratadas como imutáveis).
  let evidenceVersion = 0;
  let evidenceCopy = { version: -1, evidence: null, conditional: null };
  const evidenceInputs = () => {
    if (evidenceCopy.version !== evidenceVersion)
      evidenceCopy = {
        version: evidenceVersion,
        evidence: new Map(evidenceMap),
        conditional: new Map(conditionalMap),
      };
    return {
      evidence: evidenceCopy.evidence,
      conditional: evidenceCopy.conditional,
    };
  };
  // Perguntas que falharam (rede) ficam como null para não repetir a cada leitura; voltam a ser tentadas em 10 min.
  const sweep = setInterval(
    () => {
      for (const map of [evidenceMap, conditionalMap])
        for (const [k, v] of map)
          if (v === null && map.delete(k)) evidenceVersion++;
    },
    10 * 60 * 1000,
  );
  sweep.unref?.();
  // O grafo de fatos da recomendação: guarda a base, a tática e os planos por conteúdo das entradas (o histórico faz o
  // papel dos caches antigos; um fato recalcula só se uma entrada DECLARADA dele mudou).
  const graph = createRecommendGraph({ clock });

  /**
   * Roda a análise pesada.
   *  - `payload`: `{ snapshot, options, chosen, goal, augmentsFrom, gepPicked }`. `options` é o que `run` montou (com a
   *    leitura do estado, as decisões e o plano em andamento); `chosen` os aprimoramentos escolhidos (entradas de
   *    augments.json); `goal` a comp fixada ou null; `augmentsFrom` de onde vieram ("gep" ou "manual"); `gepPicked` o
   *    estágio de escolha por id lido do GEP (objeto simples: tem de ser JSON, a chave de conteúdo o lê).
   *  - `context`: as cópias de meta que o servidor renova (`meta`, `metaComps`, `boardStats`, `augmentStats`).
   *  - `lap(nome)`: marca de etapa para o `TEMPO`.
   * Devolve `{ parts, track, notes, evidence }`: `parts` = a resposta sem `metadata` nem `planProgress`; `track` = o que
   * `planState.track` lê (ou null quando a análise não conta como leitura do plano); `notes`/`evidence` = texto do `TEMPO`.
   * Lança `Error` com mensagem para o usuário (ex.: adversário não encontrado).
   */
  async function compute(payload, context, { lap = () => {} } = {}) {
    const { snapshot, options, chosen, goal, augmentsFrom } = payload;
    const gepPicked = payload.gepPicked ?? {};
    const { meta, metaComps, boardStats, augmentStats } = context;
    const countsBefore = computeCounts(graph);
    // A evidência que a ÚLTIMA leitura da base usou. Depois da base há `await`s (a vaga, o loop cedido entre os planos) em
    // que a evidência pode mudar (respostas do explorer de outra análise, perguntas que o teto de espera deixou abertas,
    // a limpeza de 10 min): a tática e os planos têm de partir da MESMA evidência da base que guardaram, senão o fato
    // `comps.base` seria refeito no meio do laço de planos e `composeAnalysis` colaria o campo e a estratégia de uma
    // tática em planos de outra. Fixada ao fim de `settleEvidence`.
    let seenEvidence = null,
      pinnedEvidence = null;
    // Os fatos da recomendação (app/recommend-facts.mjs). `targetLevel` é a ESCOLHA do usuário ("auto" ou um nível); o
    // nível-alvo resolvido é o fato `level.target`. Cada leitura reafirma todas as entradas no mesmo trecho síncrono.
    const view = bindRun(
      graph,
      recommendValues({
        snapshot,
        catalog,
        options,
        meta,
        metaComps,
        boardStats,
        augmentStats,
        chosen,
        goal,
        targetLevel: options.targetLevel,
      }),
      () => pinnedEvidence ?? evidenceInputs(),
    );
    const target = view.target();
    // O que o resto da análise lê de `options`: a escolha de nível-alvo já resolvida, as estatísticas de aprimoramento e os
    // escolhidos (augmentAdvice os lê). Uma cópia: `options` do chamador (e a chave dele) não muda.
    const resolved = {
      ...options,
      targetLevel: target.level,
      augmentStats,
      chosenAugments: chosen,
    };
    // O motor escolhe os trunfos e diz o que precisa saber da MetaTFT; o servidor busca e refaz a análise.
    // Scouting, XP, sequência e removedores só afetam a tática e a estratégia, não a escolha das comps; a loja afeta
    // a nota das comps (shopHits) e por isso é entrada da base.
    let baseComputed = false;
    const evidence = evidenceStats();
    // Perguntas novas ao explorer (tabelas dos trunfos, depois os totais dos tabuleiros): busca em paralelo e refaz a
    // análise com as respostas. Três rodadas bastam: trunfos → candidatos → medição. A espera de rede tem teto
    // (EVIDENCE_BUDGET_MS) e o tempo de analyze x rede vai para o log (app/live-load.mjs). A base fica no histórico do
    // grafo (por conteúdo das entradas, evidência inclusa): uma leitura igual não refaz nada, e o que mudou na
    // evidência entra como entrada nova.
    await settleEvidence({
      analyzeNow: () => {
        // Sem `await` aqui dentro: outra análise não roda no meio, então a diferença de `computes` é desta leitura.
        seenEvidence = evidenceInputs();
        const before = view.computes("comps.base"),
          built = view.base();
        baseComputed ||= view.computes("comps.base") > before;
        return built;
      },
      ask: (f) =>
        Promise.all([
          ...f.conditionalRequests.map((c) =>
            evidenceClient
              .conditional(c)
              .then((got) => conditionalMap.set(c, got))
              .catch(() => conditionalMap.set(c, null))
              .finally(() => evidenceVersion++),
          ),
          evidenceClient.totals(f.evidenceRequests).then((got) => {
            for (const [k, val] of got) evidenceMap.set(k, val);
            if (got.size) evidenceVersion++;
          }),
        ]),
      budgetMs: EVIDENCE_BUDGET_MS,
      stats: evidence,
    });
    pinnedEvidence = seenEvidence;
    let note = baseComputed ? "base=nova" : "base=cache";
    lap("base");
    // Daqui até o fim a análise cede o loop entre as etapas (/api/state e SSE entram no meio); a vaga mantém a
    // ordem das análises. Solta ao terminar (ou falhar).
    const release = await analysisTurn();
    try {
      lap("fila");
      await yieldBetween();
      // A base com a tática por cima, a comp fixada e as trocas: o fato `tactics.analysis`.
      const tactical = view.tactical();
      lap("tactics");
      await yieldBetween();
      // Campo de agora e estratégia de cada plano (as sugestões e o fixado): um fato por plano, cedendo o loop entre eles.
      const count = plansOf(tactical).length;
      if (count > MAX_PLANS)
        throw Error(
          `A análise trouxe ${count} planos; o grafo tem fatos para ${MAX_PLANS}.`,
        );
      const perPlan = [];
      for (let slot = 0; slot < count; slot++) {
        perPlan.push({
          stage: view.field(slot),
          strategy: view.strategy(slot),
        });
        await yieldBetween();
      }
      // Os fatos ficam intactos: o resto do pipeline (plano em andamento, aprimoramentos, disputa) trabalha numa cópia.
      const analysis = composeAnalysis(tactical, perPlan, (ids) =>
        teamCode(ids, plannerCatalog),
      );
      analysis.currentLevel = options.level;
      lap("planos");
      // O que `planState.track` lê, capturado agora (ANTES de augmentAdvice e contestAlert mexerem na análise): o servidor
      // chama `track` com isto e acrescenta `planProgress` à resposta. Só entra na leitura do plano uma análise ao vivo,
      // com o jogador vivo e uma comp de meta (ou o tabuleiro livre) no topo.
      let track = null;
      if (
        !options.replayGameId &&
        analysis.self.health > 0 &&
        (analysis.recommendations[0]?.meta ||
          analysis.recommendations[0]?.freeId)
      ) {
        const top = analysis.recommendations[0];
        track = structuredClone({
          top,
          shown: analysis.preview ?? top,
          self: {
            units: analysis.self.units,
            reserve: analysis.self.reserve,
          },
          baseId: view.readingId(),
          pinned: !!analysis.preview,
          health: analysis.self.health,
          level: options.level,
          targetLevel: resolved.targetLevel,
          gold: options.gold,
        });
      }
      analysis.chosenAugments = chosen.map((a) => ({
        id: a.id,
        name: a.name,
        desc: a.desc,
        traits: a.traits.map((t) => traitRules.nameOf(t)).filter(Boolean),
        // Origem: "gep" (lido do jogo, com o estágio da escolha) ou "manual" (marcado na tela, que prevalece).
        source: augmentsFrom,
        stage: gepPicked[a.id] ?? null,
      }));
      // A ordem das ofertas considera o caminho já escolhido (sinergias dos aprimoramentos anteriores).
      analysis.augmentAdvice = augmentAdvice(
        options.augmentIds.map((id) => augmentById.get(id)).filter(Boolean),
        analysis.preview ?? analysis.recommendations[0],
        analysis,
        catalog,
        resolved,
        localNames,
      );
      // Lobby jogando as mesmas peças da comp exibida: quem disputa e uma comp menos disputada para trocar.
      analysis.contest = contestAlert({
        plan: analysis.preview ?? analysis.recommendations[0],
        opponents: analysis.opponents,
        ranking: analysis.compRanking ?? [],
        comps: metaComps.comps,
        mine: analysis.self.units.map((u) => u.championName),
        stage: options.stage,
      });
      lap("resto");
      analysis.buildSource = meta.builds.size
        ? {
            label: meta.label,
            fetchedAt: meta.fetchedAt,
            url: "https://www.metatft.com/",
          }
        : null;
      analysis.targetLevel = resolved.targetLevel;
      analysis.targetLevelAuto = target.auto;
      analysis.targetLevelReasons = target.reasons;
      analysis.levelEstimated = options.levelEstimated;
      analysis.levelSource = options.levelSource;
      const viewed = snapshot.statsBlock.players.find(
        (p) => String(p.playerId) === options.viewedPlayerId,
      );
      if (options.viewedPlayerId && !viewed)
        throw Error("Adversário não encontrado nesta partida.");
      const viewedBoard = viewed
        ? {
            playerId: String(viewed.playerId),
            name: viewed.riotIdGameName ?? viewed.summonerName,
            isSelf: String(viewed.playerId) === HERO_ID,
            units: viewed.boardPieces.map((u) => {
              const c = catalog.champions.find(
                (c) => c.apiName === u.championName,
              );
              const t = traitRules.of(c?.traits, u.itemNames);
              return {
                ...u,
                name: c?.name ?? u.championName,
                traits: t.traits,
                emblemTraits: t.added,
              };
            }),
          }
        : null;
      // Os fatos que recalcularam desde o começo desta análise (o que o grafo reaproveitou não aparece; é aproximado: inclui
      // o que outra análise em andamento recalculou no mesmo intervalo): vai para o `TEMPO`.
      note += ` fatos=${recomputedText(graph, countsBefore) || "nenhum"}`;
      return {
        parts: { ...analysis, viewedBoard },
        track,
        notes: note,
        evidence: evidence.text(),
      };
    } finally {
      release();
    }
  }

  return {
    compute,
    /** O grafo de fatos (contadores em `graph.stats()`, estrutura em `graph.describe()`): diagnóstico e testes. */
    graph,
    /** Respostas do explorer guardadas (diagnóstico e testes). */
    evidenceSize: () => evidenceMap.size + conditionalMap.size,
    /** Para o temporizador de limpeza (encerramento e testes). */
    close() {
      clearInterval(sweep);
    },
  };
}
