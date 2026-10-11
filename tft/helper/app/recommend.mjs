// O pipeline da recomendação (antes o corpo de POST /api/recommend em server.mjs): validação da entrada, leitura do estado,
// montagem de `options`, análise base (com a busca de evidência), tática, planos, plano em andamento, aprimoramentos e
// disputa. Quem chama é o POST (interface) e o laço automático (app/auto-refresh.mjs): o servidor conduz a análise
// sozinho durante a partida, sem a interface aberta, e os dois dividem os mesmos caches.
//
// A ORDEM das etapas é a de sempre (o harness do golden, tests/golden/harness.mjs, é uma transcrição dela e
// tests/golden.test.mjs guarda a ordem aqui). Isto é uma MUDANÇA DE LUGAR: nenhuma regra mudou. O que é novo:
//   - `run(entrada, { source })` devolve `{ status, data, stages }` em vez de escrever na resposta HTTP;
//   - as decisões do usuário de um POST da interface (`source: "ui"`) ficam guardadas por partida em plan-state, e o laço
//     as usa quando a interface não está aberta;
//   - uma camada por chave de análise (core/state/analysis-key.mjs, `results`): o POST que repete a chave de uma análise
//     recente (do laço ou de outro POST) responde dela, sem refazer;
//   - (M8b) a base, a tática e os planos são FATOS do grafo (app/recommend-facts.mjs): cada um com as entradas declaradas e
//     memoizado por conteúdo. Sumiram `analysisCache`, `baseAnalysisCache`, `pendingBase`, a chave de cache montada à mão
//     (`analysis-keys.mjs`) e o `structuredClone` da base antes da tática (agora dentro do fato `tactics.analysis`). A loja
//     passou a ser entrada da base (defeito D1).
//
// Fronteira para a thread de análise (M10a/M10b, ainda não ligada; ver ARQUITETURA.md): estado e efeitos (validate,
// current/seenState, hidden, sticky/holdPlan, streaks, matches.augments, track, appendFile, caches) ficam aqui; a parte
// pura é da marca "análise base" até "contestAlert".
import fs from "node:fs/promises";
import { teamCode } from "../team-code.mjs";
import { augmentAdvice } from "../augment-advice.mjs";
import { isThiefsGloves } from "../core/catalog/items.mjs";
import { isAvatar } from "../core/catalog/champions.mjs";
import { analysisKey, decisionPayload } from "../core/state/analysis-key.mjs";
import { analysisInputs } from "../core/state/inputs.mjs";
import { chosenAugmentIds, gepBenchUnits } from "../gep-reader.mjs";
import { contestAlert } from "../contest.mjs";
import { gameRows } from "../replay.mjs";
import { hiddenHoldings } from "../pool-tracker.mjs";
import { recommendInventory } from "../item-holdings.mjs";
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

/** Marcas de tempo por etapa de uma análise: `lap("x")` guarda o que passou desde a marca anterior. */
export function stageTimer() {
  const marks = [];
  let last = performance.now();
  return {
    cacheHit: false,
    note: "",
    lap(label) {
      const now = performance.now();
      marks.push(`${label}=${(now - last).toFixed(0)}`);
      last = now;
    },
    text: () => marks.join(" "),
  };
}

/**
 * Cria o pipeline. `deps`: dados fixos (`heroId`, `catalog`, `itemIds`, `plannerCatalog`, `localNames`, `augmentById`,
 * `traitRules`, `capturesFile`, `planLog`, `budgetMs`), estado/efeitos do servidor (`current`, `replayState`, `seenState`,
 * `gepContext`, `matches`, `planState`, `streaks`, `gameFiles`, `evidenceClient`, `overlay`, `results`) e as cópias de meta
 * (`meta`, `metaComps`, `boardStats`, `augmentStats`: leitura por getter, o servidor as renova). `now` = relógio em ms.
 */
export function createRecommender(deps) {
  const {
    heroId: HERO_ID,
    catalog,
    itemIds,
    plannerCatalog,
    localNames,
    augmentById,
    traitRules,
    capturesFile,
    planLog,
    budgetMs: EVIDENCE_BUDGET_MS,
    current,
    replayState,
    seenState,
    gepContext,
    matches,
    planState,
    streaks,
    gameFiles,
    evidenceClient,
    overlay,
    results,
    now = Date.now,
  } = deps;
  // Uma análise por vez depois da base: a análise cede o loop entre as etapas, e a ordem das análises (plano em andamento,
  // sequências) continua a de antes.
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
  setInterval(
    () => {
      for (const map of [evidenceMap, conditionalMap])
        for (const [k, v] of map)
          if (v === null && map.delete(k)) evidenceVersion++;
    },
    10 * 60 * 1000,
  ).unref();
  // O grafo de fatos da recomendação: guarda a base, a tática e os planos por conteúdo das entradas (o histórico faz o
  // papel dos caches antigos; um fato recalcula só se uma entrada DECLARADA dele mudou).
  const graph = createRecommendGraph({ clock: () => performance.now() });

  function validate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw Error("Entrada inválida.");
    // Nível e ouro são do estado do servidor (core/state/inputs.mjs); o cliente só os manda numa partida revista, e o
    // payload antigo (que sempre os mandava) continua aceito e validado. Sem nível, o servidor decide.
    const level =
      input.level === undefined || input.level === null
        ? null
        : Number(input.level);
    if (level !== null && (!Number.isInteger(level) || level < 1 || level > 11))
      throw Error("Nível deve ser de 1 a 11.");
    const gold =
      input.gold === null || input.gold === "" ? null : Number(input.gold);
    if (gold !== null && (!Number.isInteger(gold) || gold < 0 || gold > 999))
      throw Error("Ouro inválido.");
    // Sem banco informado: o jogo não expõe o banco de ninguém e a entrada manual foi removida (FONTES-DE-DADOS.md).
    const bench = [];
    const ids = new Set(catalog.champions.map((c) => c.apiName));
    const inventory = input.inventory ?? [];
    if (
      !Array.isArray(inventory) ||
      inventory.length > 60 ||
      inventory.some(
        (id) =>
          typeof id !== "string" ||
          !catalog.items.some((i) => i.apiName === id),
      )
    )
      throw Error("Inventário de itens inválido.");
    const previewIds = input.previewIds ?? [];
    if (
      !Array.isArray(previewIds) ||
      previewIds.length > 11 ||
      new Set(previewIds).size !== previewIds.length ||
      previewIds.some((id) => typeof id !== "string" || !ids.has(id))
    )
      throw Error("Plano de campeões inválido.");
    const side = input.side ?? "right";
    if (!["left", "right"].includes(side)) throw Error("Lado inválido.");
    const targetLevel =
      input.targetLevel === undefined || input.targetLevel === "auto"
        ? "auto"
        : Number(input.targetLevel);
    if (
      targetLevel !== "auto" &&
      (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 10)
    )
      throw Error("Nível de destino inválido.");
    const goalCarryId =
      typeof input.goalCarryId === "string" ? input.goalCarryId : "";
    if (goalCarryId && !ids.has(goalCarryId))
      throw Error("Carry de destino inválido.");
    const augments = input.augments ?? [];
    if (
      !Array.isArray(augments) ||
      augments.length > 8 ||
      augments.some((id) => typeof id !== "string" || id.length > 80)
    )
      throw Error("Aprimoramentos inválidos.");
    // A tela tem registro de aprimoramentos desta partida: a lista vale mesmo vazia (remoção explícita).
    if (
      input.augmentsKnown !== undefined &&
      typeof input.augmentsKnown !== "boolean"
    )
      throw Error("Aprimoramentos inválidos.");
    const goalCompId = input.goalCompId ?? "";
    if (typeof goalCompId !== "string" || !/^[\w-]{0,40}$/.test(goalCompId))
      throw Error("Comp escolhida inválida.");
    // Substituições aplicadas sobre a comp escolhida: pares {out, in} de campeões do catálogo.
    const goalSwaps = input.goalSwaps ?? [];
    if (
      !Array.isArray(goalSwaps) ||
      goalSwaps.length > 10 ||
      goalSwaps.some(
        (s) => !s || !ids.has(s.out) || !ids.has(s.in) || s.out === s.in,
      )
    )
      throw Error("Substituições inválidas.");
    // Substituições no automático: {idDaComp: [{out, in}]}, aplicadas à comp de meta quando ela é sugerida.
    const compSwaps = input.compSwaps ?? {};
    if (
      !compSwaps ||
      typeof compSwaps !== "object" ||
      Array.isArray(compSwaps) ||
      Object.keys(compSwaps).length > 10 ||
      Object.entries(compSwaps).some(
        ([id, list]) =>
          !/^[\w-]{1,40}$/.test(id) ||
          !Array.isArray(list) ||
          list.length > 10 ||
          list.some(
            (x) => !x || !ids.has(x.out) || !ids.has(x.in) || x.out === x.in,
          ),
      )
    )
      throw Error("Substituições inválidas.");
    // Rever partida passada: id numérico de uma partida capturada.
    const replayGameId = input.replayGameId ?? "";
    if (typeof replayGameId !== "string" || !/^\d{0,20}$/.test(replayGameId))
      throw Error("Partida a rever inválida.");
    return {
      compSwaps: Object.fromEntries(
        Object.entries(compSwaps).map(([id, list]) => [
          id,
          list.map((x) => ({ out: x.out, in: x.in })),
        ]),
      ),
      replayGameId,
      goalCompId,
      goalSwaps: goalSwaps.map((s) => ({ out: s.out, in: s.in })),
      augments,
      augmentsKnown: input.augmentsKnown === true,
      level,
      gold,
      bench,
      inventory,
      previewIds,
      side,
      targetLevel,
      goalCarryId,
      levelEstimated: input.levelEstimated === true,
      levelSource: ["tela", "derivado", "estimado"].includes(input.levelSource)
        ? input.levelSource
        : input.levelEstimated === true
          ? "estimado"
          : "tela",
      playerId: typeof input.playerId === "string" ? input.playerId : "",
      viewedPlayerId:
        typeof input.viewedPlayerId === "string" ? input.viewedPlayerId : "",
    };
  }

  /**
   * Roda a recomendação para `input` (corpo do POST ou as decisões lembradas). `source`: "ui" (POST da interface; guarda as
   * decisões da partida) ou "auto" (laço do servidor; não as sobrescreve). Lança `Error` com mensagem para o usuário em
   * entrada inválida. Devolve `{ status: 200, data, stages }` (a resposta, já gravada no feed do overlay se ao vivo) ou
   * `{ status: 409, data: { error, metadata }, stages }` para um snapshot de outro set. `stages` = tempos por etapa.
   */
  async function run(input, { source = "ui", stages = stageTimer() } = {}) {
    const meta = deps.meta,
      metaComps = deps.metaComps,
      boardStats = deps.boardStats,
      augmentStats = deps.augmentStats;
    const options = validate(input),
      { snapshot, metadata } = options.replayGameId
        ? await replayState(options.replayGameId)
        : await current();
    if (options.replayGameId) options.level = metadata.estimatedLevel;
    stages.lap("estado");
    // A chave de análise do cliente só descreve pedidos "simples" (sem adversário visto, plano de campeões, nível de destino
    // ou lado diferentes do padrão): o resto nunca é servido pela camada por chave.
    const plain =
      !options.replayGameId &&
      options.viewedPlayerId === "" &&
      options.previewIds.length === 0 &&
      options.targetLevel === "auto" &&
      options.side === "right" &&
      options.goalCarryId === "";
    // Decisões do usuário nesta partida, como chegaram (antes de qualquer ajuste): o laço automático as reaproveita
    // quando a interface não está aberta. Partida revista não conta.
    const picked = options.replayGameId
      ? null
      : {
          goalCompId: options.goalCompId,
          goalSwaps: options.goalSwaps,
          compSwaps: options.compSwaps,
          augments: options.augments,
          augmentsKnown: options.augmentsKnown,
        };
    if (picked && source === "ui" && metadata.set === "TFTSet18")
      planState.setDecisions(metadata.gameId, picked);
    // Luva de Ladrão: o jogo grava os dois itens sorteados da rodada junto com ela; só a luva é um item real.
    for (const p of snapshot.statsBlock.players)
      for (const u of p.boardPieces ?? [])
        if ((u.itemNames ?? []).some(isThiefsGloves))
          u.itemNames = u.itemNames.filter(isThiefsGloves);
    if (options.playerId && options.playerId !== HERO_ID)
      throw Error(
        "O jogador local é Hero. Use a consulta de adversário para ver outra arena.",
      );
    options.playerId = HERO_ID;
    // Comp de meta fixada na tela de seleção: unidades, carry e builds vêm da cópia local pela id.
    const goal = options.goalCompId
      ? (metaComps.comps.find((c) => c.id === options.goalCompId) ?? null)
      : null;
    if (goal) {
      // Cada troca só vale se a peça que sai está na comp e a que entra ainda não está.
      const units = goal.units.filter(
        (id) => !isAvatar(catalog.champions.find((c) => c.apiName === id)),
      );
      options.goalSwaps = options.goalSwaps.filter(
        (s) =>
          s.out !== goal.carry &&
          units.includes(s.out) &&
          !units.includes(s.in),
      );
      for (const s of options.goalSwaps)
        units.splice(units.indexOf(s.out), 1, s.in);
      options.previewIds = units;
      options.goalCarryId = options.previewIds.includes(goal.carry)
        ? goal.carry
        : "";
    }
    if (metadata.set !== "TFTSet18")
      return {
        status: 409,
        data: {
          error: "O catálogo é do Set 18. Este snapshot pertence a outro set.",
          metadata,
        },
        stages,
      };
    // Partida revista: a leitura de tela é da partida de agora e não vale para ela.
    const seen = options.replayGameId
      ? {}
      : seenState(metadata.gameId, gepContext(metadata, snapshot));
    // Reserva: só com origem GEP fresca (a entrada manual saiu e o cliente não a define). Sem GEP fica vazia.
    options.bench = gepBenchUnits(seen, HERO_ID);
    // Banco de itens: o do servidor (GEP ou tela, sem consumíveis) manda; o do cliente só vale numa partida revista.
    options.inventory = recommendInventory(
      options.replayGameId ? options.inventory : [],
      seen,
      (id) => itemIds.has(id),
    );
    // Banco lido da tela (ou enviado pelo cliente): sem ele o plano de itens não atribui nada, só lista desejos.
    options.bankRead =
      !options.replayGameId &&
      (Array.isArray(seen.items) || options.inventory.length > 0);
    // Aprimoramentos escolhidos: o registro do usuário (marcado ou corrigido na tela, mesmo vazio) prevalece; sem ele
    // valem os lidos do GEP (observados, só do jogador local). `augmentsFrom` diz qual dos dois foi usado.
    const augmentPick = chosenAugmentIds({
        manual: options.augments,
        known: options.augmentsKnown,
        gepPicked: options.replayGameId ? [] : seen.pickedAugments,
        valid: (id) => augmentById.has(id),
      }),
      augmentsFrom = augmentPick.source,
      gepPicked = augmentPick.stages;
    // Ouro, nível, XP, estágio, loja e oferta de aprimoramentos saem do estado do servidor (core/state/inputs.mjs);
    // numa partida revista ficam os campos do cliente (a leitura de agora não vale para ela). Os aprimoramentos
    // escolhidos (registro manual ou GEP) também são entrada derivada do estado: entram na mesma atribuição.
    Object.assign(
      options,
      { augments: augmentPick.ids },
      analysisInputs(seen, {
        augments: augmentPick.ids,
        estimatedLevel: metadata.estimatedLevel,
        live: !options.replayGameId,
      }),
    );
    // Partida revista: os aprimoramentos gravados no registro dela, se a tela não mandou outros.
    if (options.replayGameId && !options.augments.length)
      options.augments = (metadata.match?.last?.augments ?? [])
        .map((a) => a.id)
        .filter((id) => augmentById.has(id));
    const chosen = options.augments
      .map((id) => augmentById.get(id))
      .filter(Boolean);
    // Lista vazia só apaga o registro da partida quando a tela diz que tem um (remoção explícita).
    if (!options.replayGameId && (chosen.length || options.augmentsKnown))
      matches.augments(metadata.gameId, chosen);
    // As sinergias e os emblemas que os aprimoramentos escolhidos concedem (e os nomes que a evidência mostra) são o
    // fato `traits.grants` do grafo (regra única em core/catalog/traits.mjs, `traitBook().grants`): o motor os recebe
    // pelas entradas declaradas da base, não por `options`.
    options.sticky = options.replayGameId
      ? null
      : planState.sticky(metadata.gameId);
    // Plano em andamento: um desafiante só o substitui depois de liderar por mais de uma rodada (plan-state.mjs).
    options.holdPlan =
      !options.replayGameId && planState.holdFor(metadata.gameId);
    if (!options.replayGameId)
      streaks.observe({
        gameId: metadata.gameId,
        stage: seen.stage,
        hp: snapshot.statsBlock.players.find(
          (p) => String(p.playerId) === HERO_ID,
        )?.health,
      });
    options.streak = options.replayGameId ? null : streaks.current();
    options.trend = options.replayGameId ? null : streaks.trend();
    // Banco dos rivais estimado pelas peças que saíram do tabuleiro deles (ver pool-tracker.mjs). Meio
    // em meio para a base não mudar a cada segundo de decaimento. Só rivais vivos no snapshot
    // atual contam: a captura só grava quando o tabuleiro muda, e um eliminado pode sumir da lista.
    const alive = new Set(
      snapshot.statsBlock.players
        .filter((p) => (p.health ?? 1) > 0)
        .map((p) => String(p.playerId)),
    );
    options.hidden = Object.fromEntries(
      [
        ...hiddenHoldings(
          (await gameRows(capturesFile, metadata.gameId)).filter((r) =>
            alive.has(String(r.id)),
          ),
          {
            now: options.replayGameId ? Date.parse(metadata.modifiedAt) : now(),
            skip: new Set([HERO_ID]),
          },
        ),
      ]
        .map(([id, n]) => [id, Math.round(n * 2) / 2])
        .filter(([, n]) => n > 0),
    );
    stages.lap("entrada");
    // Partida revista não alimenta o overlay: ele mostra só a análise ao vivo.
    const live = (body) =>
      options.replayGameId ? body : overlay.recordRecommendation(body);
    // A chave de análise do cliente (core/state/analysis-key.mjs), calculada com o estado que esta chamada acabou de ler:
    // o laço do servidor e o POST da interface repetem a mesma chave quando o jogo não mudou, e o segundo responde do
    // primeiro. Partida revista (e pedido que não é "simples") não tem chave.
    const uiKey = !plain
      ? null
      : analysisKey(
          { ...metadata, screen: seen },
          decisionPayload(metadata, picked),
          now(),
        );
    const compute = async () => {
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
      options.targetLevel = target.level;
      options.augmentStats = augmentStats;
      // O motor escolhe os trunfos e diz o que precisa saber da MetaTFT; o servidor busca e refaz a análise.
      // Scouting, XP, sequência e removedores só afetam a tática e a estratégia, não a escolha das comps; a loja afeta
      // a nota das comps (shopHits) e por isso é entrada da base.
      let baseComputed = false;
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
        stats: (stages.evidence = evidenceStats()),
      });
      pinnedEvidence = seenEvidence;
      stages.note = baseComputed ? "base=nova" : "base=cache";
      stages.lap("base");
      // Daqui até o fim a análise cede o loop entre as etapas (/api/state e SSE entram no meio); a vaga mantém a
      // ordem das análises. Solta ao terminar (ou falhar).
      const release = await analysisTurn();
      try {
        stages.lap("fila");
        await yieldToLoop();
        // A base com a tática por cima, a comp fixada e as trocas: o fato `tactics.analysis`.
        const tactical = view.tactical();
        stages.lap("tactics");
        await yieldToLoop();
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
          await yieldToLoop();
        }
        // Os fatos ficam intactos: o resto do pipeline (plano em andamento, aprimoramentos, disputa) trabalha numa cópia.
        const analysis = composeAnalysis(tactical, perPlan, (ids) =>
          teamCode(ids, plannerCatalog),
        );
        analysis.currentLevel = options.level;
        stages.lap("planos");
        if (
          !options.replayGameId &&
          analysis.self.health > 0 &&
          (analysis.recommendations[0]?.meta ||
            analysis.recommendations[0]?.freeId)
        ) {
          const top = analysis.recommendations[0];
          // Livro-razão do TFT.log (compras): só o teto da reserva das peças do plano que ainda não estão em campo.
          let ledger = null;
          try {
            ledger = gameFiles.ledger(
              metadata.gameId,
              snapshot.statsBlock.players.find(
                (p) => String(p.playerId) === HERO_ID,
              )?.boardPieces ?? [],
            );
          } catch {}
          // Plano em andamento: adota/mantém/troca (com confirmação) e atualiza o checklist de progresso.
          const { switched, progress } = planState.track({
            gameId: metadata.gameId,
            stage: seen.stage ?? null,
            level: options.level,
            targetLevel: options.targetLevel,
            gold: options.gold,
            top,
            shown: analysis.preview ?? top,
            analysis,
            chosen: chosen.map((a) => ({ id: a.id, name: a.name })),
            ledger,
            baseId: view.readingId(),
            pinned: !!analysis.preview,
          });
          analysis.planProgress = progress;
          // Troca de plano na mesma partida: registra quando, de qual para qual e com que margem (revisão depois).
          if (switched)
            fs.appendFile(
              planLog,
              JSON.stringify({
                gameId: metadata.gameId,
                at: new Date().toISOString(),
                stage: options.stage
                  ? `${options.stage.stage}-${options.stage.round}`
                  : null,
                level: options.level,
                hp: analysis.self.health,
                from: switched.from,
                to: switched.to,
                expected: top.evidence?.expected ?? null,
                switch: top.evidence?.switch ?? null,
              }) + "\n",
            ).catch(() => {});
        }
        stages.lap("plano");
        analysis.chosenAugments = chosen.map((a) => ({
          id: a.id,
          name: a.name,
          desc: a.desc,
          traits: a.traits.map((t) => traitRules.nameOf(t)).filter(Boolean),
          // Origem: "gep" (lido do jogo, com o estágio da escolha) ou "manual" (marcado na tela, que prevalece).
          source: augmentsFrom,
          stage: gepPicked.get(a.id) ?? null,
        }));
        // A ordem das ofertas considera o caminho já escolhido (sinergias dos aprimoramentos anteriores).
        options.chosenAugments = chosen;
        analysis.augmentAdvice = augmentAdvice(
          options.augmentIds.map((id) => augmentById.get(id)).filter(Boolean),
          analysis.preview ?? analysis.recommendations[0],
          analysis,
          catalog,
          options,
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
        stages.lap("resto");
        analysis.buildSource = meta.builds.size
          ? {
              label: meta.label,
              fetchedAt: meta.fetchedAt,
              url: "https://www.metatft.com/",
            }
          : null;
        analysis.targetLevel = options.targetLevel;
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
        stages.note += ` fatos=${recomputedText(graph, countsBefore) || "nenhum"}`;
        return { ...analysis, viewedBoard };
      } finally {
        release();
      }
    };
    const { parts, via } = uiKey
      ? await results.run(uiKey, compute)
      : { parts: await compute(), via: "novo" };
    // Chave repetida de uma análise recente (do laço, ou de outro POST em andamento): nada foi recalculado aqui.
    if (via !== "novo") {
      stages.cacheHit = true;
      stages.note = `chave=${via}`;
    }
    return { status: 200, data: live({ metadata, ...parts }), stages };
  }

  return {
    run,
    validate,
    /** O grafo de fatos (contadores em `graph.stats()`, estrutura em `graph.describe()`): diagnóstico e testes. */
    graph,
    /**
     * Esquece os resultados recentes por chave de análise (cópias de meta, estatísticas ou partida mudaram). Os fatos do
     * grafo não precisam ser apagados: a chave deles é o conteúdo das entradas, então uma cópia de meta nova entra como
     * entrada que mudou e o que não mudou segue válido. O parâmetro `base` ficou por compatibilidade (era o que
     * `updateComps` pedia para manter a análise base); já não tem efeito.
     */
    clear() {
      results.clear();
    },
  };
}
