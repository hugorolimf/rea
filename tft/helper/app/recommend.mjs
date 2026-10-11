// O pipeline da recomendação (antes o corpo de POST /api/recommend em server.mjs): validação da entrada, leitura do estado,
// montagem de `options`, análise base (com a busca de evidência), tática, planos, plano em andamento, aprimoramentos e
// disputa. Quem chama é o POST (interface) e o laço automático (app/auto-refresh.mjs): o servidor conduz a análise
// sozinho durante a partida, sem a interface aberta, e os dois dividem os mesmos resultados.
//
// A ORDEM das etapas é a de sempre (o harness do golden, tests/golden/harness.mjs, é uma transcrição dela e
// tests/golden.test.mjs guarda a ordem aqui e em app/analysis-pipeline.mjs). Isto é uma MUDANÇA DE LUGAR: nenhuma regra
// mudou. O que é novo:
//   - `run(entrada, { source })` devolve `{ status, data | bytes, stages }` em vez de escrever na resposta HTTP;
//   - as decisões do usuário de um POST da interface (`source: "ui"`) ficam guardadas por partida em plan-state, e o laço
//     as usa quando a interface não está aberta;
//   - uma camada por chave de análise (core/state/analysis-key.mjs, `results`): o POST que repete a chave de uma análise
//     recente (do laço ou de outro POST) responde dela, sem refazer. A segunda chave é o CONTEÚDO da entrada da análise
//     pesada (estado + opções): duas chamadas com a mesma entrada dividem o cálculo em andamento ou o recente, mesmo que
//     a chave de análise da tela difira (fase do cliente, idade do arquivo, janela de 2 min);
//   - (M8b) a base, a tática e os planos são FATOS do grafo (app/recommend-facts.mjs): cada um com as entradas declaradas e
//     memoizado por conteúdo; a loja é entrada da base (defeito D1);
//   - (M10b) a parte PESADA (da análise base até a disputa) mora em app/analysis-pipeline.mjs e roda na thread de análise
//     (app/analysis-runner.mjs decide onde; sem thread, roda aqui mesmo, com o mesmo código). Daqui ficam o estado e os
//     efeitos: validate, current/seenState, hidden, sticky/holdPlan, streaks, matches.augments, planState.track (com o que o
//     pipeline capturou) e o arquivo de trocas de plano.
import fs from "node:fs/promises";
import { isThiefsGloves } from "../core/catalog/items.mjs";
import { isAvatar } from "../core/catalog/champions.mjs";
import { analysisKey, decisionPayload } from "../core/state/analysis-key.mjs";
import { analysisInputs } from "../core/state/inputs.mjs";
import { chosenAugmentIds, gepBenchUnits } from "../gep-reader.mjs";
import { gameRows } from "../replay.mjs";
import { hiddenHoldings } from "../pool-tracker.mjs";
import { recommendInventory } from "../item-holdings.mjs";
import { appendFields, prependField } from "../analysis-protocol.mjs";
import { factKey } from "../plan-state.mjs";
import { createAnalysisPipeline } from "./analysis-pipeline.mjs";
import { createAnalysisRunner } from "./analysis-runner.mjs";
import { targetLevelTracker } from "../target-level.mjs";
import { yieldToLoop } from "./live-load.mjs";

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
    /** Registra uma etapa medida em outro lugar (a thread de análise), sem mexer na marca de agora. */
    put(label, ms) {
      marks.push(`${label}=${Number(ms).toFixed(0)}`);
    },
    /** Recomeça a contagem de agora (depois de registrar etapas medidas fora com `put`). */
    restart() {
      last = performance.now();
    },
    text: () => marks.join(" "),
  };
}

/**
 * Cria o pipeline. `deps`: dados fixos (`heroId`, `catalog`, `itemIds`, `plannerCatalog`, `localNames`, `augmentById`,
 * `traitRules`, `capturesFile`, `planLog`, `budgetMs`), estado/efeitos do servidor (`current`, `replayState`, `seenState`,
 * `gepContext`, `matches`, `planState`, `streaks`, `gameFiles`, `evidenceClient`, `overlay`, `results`) e as cópias de meta
 * (`meta`, `metaComps`, `boardStats`, `augmentStats`: leitura por getter, o servidor as renova). `now` = relógio em ms.
 * `analysisWorker` (opcional): a thread de análise (`createAnalysisWorker`, analysis-worker.mjs, com `supersede: false`); sem
 * ela a análise pesada roda aqui mesmo, no processo principal, com o mesmo código. `log(nível, texto)` recebe os avisos
 * de falha da thread. `analyzer` (opcional) troca o executor inteiro (testes).
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
  // Ouro e vida da rodada que decidem o nível-alvo (target-level.mjs): o laço e o POST dividem a mesma memória.
  const targetInputs = deps.targetInputs ?? targetLevelTracker();
  // Onde a análise pesada roda. O pipeline do processo principal só é criado se for preciso (sem thread, ou se ela cair).
  const analyzer =
    deps.analyzer ??
    createAnalysisRunner({
      worker: deps.analysisWorker ?? null,
      log: deps.log,
      context: () => ({
        meta: deps.meta,
        metaComps: deps.metaComps,
        boardStats: deps.boardStats,
        augmentStats: deps.augmentStats,
      }),
      makePipeline: () =>
        createAnalysisPipeline({
          heroId: HERO_ID,
          catalog,
          plannerCatalog,
          localNames,
          augmentById,
          traitRules,
          evidenceClient,
          budgetMs: EVIDENCE_BUDGET_MS,
          yieldBetween: yieldToLoop,
        }),
    });

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
    // Ausente (o cliente ao vivo só manda decisões), nulo ou vazio = sem ouro do cliente: o servidor usa o próprio estado.
    const gold =
      input.gold === undefined || input.gold === null || input.gold === ""
        ? null
        : Number(input.gold);
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
    const metaComps = deps.metaComps;
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
      {
        augments: augmentPick.ids,
        // Sem GEP fresco a reserva é DESCONHECIDA (não vazia): o motor diz "reserva não lida" em vez de "você não tem".
        benchKnown: !options.replayGameId && seen.sources?.bench === "gep",
      },
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
    // Plano em andamento: um desafiante só o substitui se ainda liderar depois de um FATO NOVO (plan-state.mjs): o fato
    // lido agora (estágio-rodada, nível, ouro, loja, peças, itens, aprimoramentos) decide se ele já pode ser liberado.
    const fact = factKey({
      stage: seen.stage ?? null,
      level: options.level,
      gold: options.gold,
      shop: options.shop,
      board:
        snapshot.statsBlock.players.find((p) => String(p.playerId) === HERO_ID)
          ?.boardPieces ?? [],
      bench: options.bench,
      inventory: options.inventory,
      augments: options.augments,
    });
    options.holdPlan =
      !options.replayGameId && planState.holdFor(metadata.gameId, fact);
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
    // Nível-alvo: ouro e vida DA RODADA (o maior ouro e a menor vida do estágio-rodada; sem estágio, histerese), para o
    // ouro cruzando 50 g na loja não alternar o alvo. Partida revista: o ouro e a vida dela, sem memória.
    if (!options.replayGameId) {
      const steady = targetInputs.observe({
        gameId: metadata.gameId,
        stage: options.stage ?? null,
        gold: options.gold,
        hp: snapshot.statsBlock.players.find(
          (p) => String(p.playerId) === HERO_ID,
        )?.health,
      });
      Object.assign(options, { targetGold: steady.gold, targetHp: steady.hp });
    }
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
    // A entrada da análise pesada (app/analysis-pipeline.mjs): tudo o que ela lê do estado de agora. Não leva as cópias de meta
    // (vão à thread só quando mudam) nem `metadata`, que o pipeline não usa.
    const payload = {
      snapshot,
      options,
      chosen,
      goal,
      augmentsFrom,
      gepPicked: Object.fromEntries(gepPicked),
    };
    // O CONTEÚDO da entrada é a segunda chave de compartilhamento: o laço e o POST com a mesma entrada (mesmo que a chave de
    // análise da tela difira) dividem o cálculo em andamento ou o recente. Calculada antes de a análise mexer em `options`.
    const contentKey = `c:${JSON.stringify(payload)}`;
    const compute = async () => {
      const out = await analyzer.run(payload, stages);
      stages.note = `${out.notes} via=${out.via}`;
      stages.evidence = { text: () => out.evidence };
      // Plano em andamento (estado do servidor): adota/mantém/troca (com confirmação) e atualiza o checklist de progresso.
      // Recebe o que o pipeline capturou ANTES de aprimoramentos e disputa mexerem na análise (a ordem de sempre).
      let progress = null;
      if (out.track) {
        const t = out.track,
          top = t.top;
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
        const { switched, progress: tracked } = planState.track({
          gameId: metadata.gameId,
          stage: seen.stage ?? null,
          level: t.level,
          targetLevel: t.targetLevel,
          gold: t.gold,
          top,
          shown: t.shown,
          analysis: { self: t.self },
          chosen: chosen.map((a) => ({ id: a.id, name: a.name })),
          ledger,
          baseId: t.baseId,
          fact,
          pinned: t.pinned,
        });
        progress = tracked;
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
              level: t.level,
              hp: t.health,
              from: switched.from,
              to: switched.to,
              expected: top.evidence?.expected ?? null,
              switch: top.evidence?.switch ?? null,
            }) + "\n",
          ).catch(() => {});
      }
      stages.lap("plano");
      // O que fica guardado (e dividido com quem pedir a mesma coisa): a resposta sem `metadata`, com o progresso do plano.
      return out.bytes
        ? {
            bytes: progress
              ? appendFields(out.bytes, { planProgress: progress })
              : out.bytes,
          }
        : {
            parts: progress
              ? { ...out.parts, planProgress: progress }
              : out.parts,
          };
    };
    const keys = [uiKey, contentKey].filter(Boolean);
    const { parts: shared, via } = results
      ? await results.run(keys, compute)
      : { parts: await compute(), via: "novo" };
    // Chave repetida de uma análise recente (do laço, ou de outro POST em andamento): nada foi recalculado aqui.
    if (via !== "novo") {
      stages.cacheHit = true;
      stages.note = `chave=${via}`;
    }
    if (shared.bytes) {
      // A thread entrega o JSON pronto: o servidor só põe `metadata` na frente (nada de reparsear nem de serializar ~1 MB).
      const body = prependField(shared.bytes, "metadata", metadata);
      if (!options.replayGameId) overlay.recordRecommendationJson(body);
      return { status: 200, bytes: body, stages };
    }
    return {
      status: 200,
      data: live({ metadata, ...shared.parts }),
      stages,
    };
  }

  return {
    run,
    validate,
    /** Onde a análise pesada roda (`status()` diz se é a thread ou o processo principal) e a fila dela. */
    analyzer,
    /**
     * Esquece os resultados recentes por chave de análise (cópias de meta, estatísticas ou partida mudaram). Os fatos do
     * grafo (na thread ou no processo principal) não precisam ser apagados: a chave deles é o conteúdo das entradas, então
     * uma cópia de meta nova entra como entrada que mudou e o que não mudou segue válido. O parâmetro `base` ficou por
     * compatibilidade (era o que `updateComps` pedia para manter a análise base); já não tem efeito.
     */
    clear() {
      results?.clear();
    },
  };
}
