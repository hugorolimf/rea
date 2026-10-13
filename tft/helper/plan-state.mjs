// Estado persistente do plano da partida: o plano em andamento, o desafiante que ainda não foi confirmado, as marcas
// de progresso e o histórico de decisões. Cada análise é um DELTA sobre este estado, não um recomeço.
//
// O que o estado resolve (ver README, "Plano em andamento"):
// - o plano que o motor mantém (`sticky`) vivia só na memória do servidor e morria no reinício; agora fica em disco;
// - o motor trocava de plano quando a vantagem passava da margem, mas cada leitura nova medida de novo podia inverter a
//   ordem: partidas reais tiveram 8 trocas Veigar<->Teemo na mesma rodada. A troca agora exige que o desafiante lidere de
//   novo DEPOIS DE UM FATO NOVO (`CONFIRM`): loja nova, peça comprada ou vendida, outra rodada, outro nível, ouro, itens ou
//   aprimoramento (`factKey`). Reler o mesmo estado não é evidência nova e não conta; outro desafiante recomeça;
// - o que já foi conquistado (estrelas, itens, aprimoramentos, nível) ficava invisível: `plan-progress.mjs` o transforma
//   em checklist e este módulo guarda as marcas entre rodadas.
//
// A vantagem do desafiante vem do motor em COLOCAÇÃO ESPERADA (`switch.unit === "placement"`): a mesma medida que ordena
// a lista e que a tela mostra (engine.mjs, E). A troca vale quando E_mantido − E_desafiante passa do custo de trocar mais a
// histerese; o motor decide, este módulo só segura até o fato novo.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { buildChecklist } from "./plan-progress.mjs";

/** Fatos distintos (factKey) em que o desafiante precisa liderar: o primeiro em que apareceu e mais um, novo. */
export const CONFIRM = Object.freeze({ facts: 2 });

/**
 * Identidade do FATO de jogo que uma análise lê: estágio-rodada, nível, ouro, loja, peças (campo e banco), itens do banco
 * e aprimoramentos escolhidos. Duas leituras com o mesmo fato são a mesma evidência (reler não confirma um desafiante).
 * Texto estável (listas ordenadas); campos ausentes contam como null.
 */
export function factKey({
  stage = null,
  level = null,
  gold = null,
  shop = [],
  board = [],
  bench = [],
  inventory = [],
  augments = [],
} = {}) {
  const units = (list) =>
    (list ?? [])
      .map((u) =>
        typeof u === "string"
          ? u
          : `${u?.championName ?? u?.id ?? "?"}:${u?.starLevel ?? u?.stars ?? 1}`,
      )
      .sort();
  return JSON.stringify([
    stage ?? null,
    level ?? null,
    gold ?? null,
    (shop ?? []).map((x) => (typeof x === "string" ? x : (x?.id ?? null))),
    units(board),
    units(bench),
    [...(inventory ?? [])].sort(),
    [...(augments ?? [])].sort(),
  ]);
}
/** Campos da nota de troca do motor (engine.mjs `switch`) que o desafiante guarda e a tela mostra. */
const noteOf = (sw) => ({
  title: sw.to ?? sw.title,
  gain: sw.gain ?? null,
  cost: sw.cost ?? null,
  hysteresis: sw.hysteresis ?? null,
  expectedFrom: sw.expectedFrom ?? null,
  expectedTo: sw.expectedTo ?? null,
  unit: sw.unit ?? null,
});

const comma = (x) => String(Math.round(x * 100) / 100).replace(".", ",");
/** "lidera por 0,3 de colocação esperada" (ou, em nota antiga, a unidade dela). */
const leadText = (sw) =>
  `lidera por ${comma(sw.gain ?? 0)}${sw.unit === "placement" ? " de colocação esperada" : sw.unit === "score" ? " pontos de score" : "º"}`;

const HISTORY_MAX = 80,
  VERSION = 1,
  CURRENT = "free:current";

const emptyState = (gameId = null) => ({
  version: VERSION,
  gameId,
  revision: 0,
  updatedAt: null,
  plan: null,
  challenger: null,
  memory: {},
  history: [],
  // Últimas decisões do usuário recebidas em POST /api/recommend nesta partida (comp fixada e trocas, aprimoramentos
  // marcados): o servidor as usa para renovar a análise sozinho, sem a interface aberta (app/auto-refresh.mjs).
  decisions: null,
});

/**
 * Rastreador do plano da partida. `file` guarda o estado entre reinícios (null = só memória); `now` é injetável.
 * Uma partida por vez: ao ver outro `gameId` o estado começa vazio.
 */
export function planTracker({ file = null, now = Date.now } = {}) {
  let state = emptyState();
  if (file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (saved?.version === VERSION && typeof saved.gameId === "string")
        state = { ...emptyState(), ...saved };
    } catch (e) {
      if (e.code !== "ENOENT")
        console.warn(`estado do plano: ${file} descartado (${e.message})`);
    }
  }
  let dirty = false,
    saving = null,
    timer = null;
  const tmp = file ? `${file}.tmp` : null;
  const persist = () => {
    if (!file || !dirty || saving) return saving;
    dirty = false;
    saving = fsp
      .mkdir(path.dirname(file), { recursive: true })
      .then(() => fsp.writeFile(tmp, JSON.stringify(state)))
      .then(() => fsp.rename(tmp, file))
      .catch((e) => {
        dirty = true;
        console.warn(`estado do plano: falha ao gravar (${e.message})`);
      })
      .finally(() => {
        saving = null;
      });
    return saving;
  };
  const touch = () => {
    state.revision++;
    state.updatedAt = new Date(now()).toISOString();
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(persist, 500);
    timer.unref?.();
  };
  const forGame = (gameId) => {
    const id = gameId == null ? null : String(gameId);
    if (id !== state.gameId) state = emptyState(id);
    return state;
  };
  const log = (event, stage) => {
    state.history.push({
      at: new Date(now()).toISOString(),
      stage: stage ?? null,
      ...event,
    });
    if (state.history.length > HISTORY_MAX)
      state.history.splice(0, state.history.length - HISTORY_MAX);
  };

  const adopt = (top, stage, level) => {
    const id = top.meta?.id ?? top.freeId,
      carry = top.board.find((u) => u.name === top.carry)?.id ?? null;
    state.plan = {
      id,
      title: top.title,
      kind: top.meta ? "meta" : id === CURRENT ? "current" : "free",
      carry,
      units: top.board.map((u) => u.id),
      core: top.evidenceCore ?? [],
      asset: top.evidenceAsset ?? null,
      assetFilter: top.evidenceAssetFilter ?? null,
      adoptedAt: {
        stage: stage ?? null,
        level: level ?? null,
        at: new Date(now()).toISOString(),
      },
    };
    // Plano novo: a ordem das peças e os itens-alvo congelados eram do anterior.
    state.memory = { ...state.memory, order: [], itemTargets: {} };
  };

  return {
    /** Plano mantido no formato que o motor espera em `options.sticky`, ou null (outra partida ou sem plano). */
    sticky(gameId) {
      const p = state.gameId === String(gameId) ? state.plan : null;
      return p
        ? {
            game: state.gameId,
            id: p.id,
            units: p.units,
            carry: p.carry,
            title: p.title,
            core: p.core,
            asset: p.asset,
            assetFilter: p.assetFilter,
          }
        : null;
    },

    /**
     * O motor deve segurar o plano em andamento nesta análise? `false` sem plano comprometido ("Seu tabuleiro atual" não é
     * compromisso); `true` enquanto não há desafiante ou o fato (`fact`, factKey) é o mesmo em que ele apareceu;
     * `{ release: id }` quando chegou um fato novo: se o mesmo desafiante ainda vencer a margem nesta reavaliação, o motor
     * troca agora; outro desafiante continua segurado (recomeça a contagem).
     */
    holdFor(gameId, fact = null) {
      if (
        state.gameId !== String(gameId) ||
        !state.plan ||
        state.plan.id === CURRENT
      )
        return false;
      const c = state.challenger;
      return c && fact != null && c.fact !== fact ? { release: c.id } : true;
    },

    /**
     * Registra uma análise nova: adota/mantém/troca o plano, conta o desafiante e atualiza o checklist.
     * `top` = recomendação 1 (decide o plano); `shown` = a mostrada (a comp fixada pelo usuário, se houver);
     * `fact` (factKey) identifica o fato de jogo lido (sem ele, `baseId` + estágio): o desafiante guarda o fato em que
     * apareceu e só é liberado (holdFor) quando chega outro.
     * Devolve `{ switched, progress }`.
     */
    track({
      gameId,
      stage = null,
      level = null,
      targetLevel = null,
      gold = null,
      top,
      shown = top,
      analysis,
      chosen = [],
      ledger = null,
      baseId = null,
      fact = null,
      pinned = false,
    }) {
      forGame(gameId);
      const at = now(),
        seen = fact ?? `${baseId}|${stage}`,
        id = top.meta?.id ?? top.freeId;
      let switched = null,
        lead = null;
      // Nota de troca do motor: no plano mostrado (também sem evidência) ou, em motor antigo, na evidência dele.
      const note = top.switch ?? top.evidence?.switch ?? null;
      if (!state.plan) {
        adopt(top, stage, level);
        log({ type: "adopt", text: `Plano: ${top.title}` }, stage);
        state.challenger = null;
      } else if (id === state.plan.id) {
        const sw = note;
        if (sw?.held && sw.toId) {
          // Venceu a margem com o plano segurado: registra o desafiante no fato em que apareceu (o mesmo desafiante mantém
          // o primeiro fato; outro recomeça).
          const c = state.challenger?.id === sw.toId ? state.challenger : null;
          if (!c)
            log(
              {
                type: "hold",
                text: `Mantido ${state.plan.title}; ${sw.to} ${leadText(sw)}, aguardando um fato novo`,
              },
              stage,
            );
          state.challenger = {
            ...(c ?? {
              id: sw.toId,
              fact: seen,
              firstAt: new Date(at).toISOString(),
            }),
            ...noteOf(sw),
            readings: (c?.readings ?? 0) + 1,
          };
        } else {
          state.challenger = null;
          // Mantido porque a vantagem não passa do custo de trocar + histerese: não há o que confirmar, mas a tela diz
          // por que o plano segue.
          if (sw?.kept && sw.toId && sw.gain > 0)
            lead = { id: sw.toId, ...noteOf(sw), pending: false };
        }
        // Mesma comp: acompanha o crescimento do tabuleiro (nível sobe) sem mexer no resto.
        const units = top.board.map((u) => u.id);
        if (units.join() !== state.plan.units.join()) {
          const added = units.filter((u) => !state.plan.units.includes(u));
          if (added.length)
            log(
              {
                type: "grow",
                text: `Plano ampliado: ${top.board
                  .filter((u) => added.includes(u.id))
                  .map((u) => u.name)
                  .join(", ")}`,
              },
              stage,
            );
          state.plan.units = units;
        }
        state.plan.title = top.title;
        state.plan.core = top.evidenceCore ?? state.plan.core;
        state.plan.asset = top.evidenceAsset ?? state.plan.asset;
        state.plan.assetFilter =
          top.evidenceAssetFilter ?? state.plan.assetFilter;
      } else {
        // O motor trocou (plano confirmado ou queda de classe do mantido): assume o novo e zera o desafiante.
        switched = {
          from: state.plan.title,
          to: top.title,
          fromId: state.plan.id,
          toId: id,
        };
        const sw = note;
        adopt(top, stage, level);
        log(
          {
            type: "switch",
            text: `Troca de plano: ${switched.from} → ${top.title}${sw?.unit === "win" && sw.winFrom != null ? ` (${comma(Math.round(sw.winFrom * 1000) / 10)}% → ${comma(Math.round(sw.winTo * 1000) / 10)}% de vitória: ganho ${comma(Math.round(sw.gain * 1000) / 10)} > custo ${comma(Math.round(sw.cost * 1000) / 10)} + margem ${comma(Math.round((sw.hysteresis ?? 0) * 1000) / 10)} pontos)` : sw?.unit === "placement" && sw.expectedFrom != null ? ` (${comma(sw.expectedFrom)}º → ${comma(sw.expectedTo)}º esperado: ganho ${comma(sw.gain)} > custo ${comma(sw.cost)} + margem ${comma(sw.hysteresis ?? 0)})` : ""}`,
            gain: sw?.gain ?? null,
          },
          stage,
        );
        state.challenger = null;
      }
      const built = buildChecklist({
        shown,
        analysis,
        state: { level, targetLevel, gold, stage, chosen, ledger },
        memory: state.memory,
      });
      state.memory = built.memory;
      for (const e of built.events) log(e, stage);
      touch();
      const c = state.challenger;
      return {
        switched,
        progress: {
          plan: {
            id: state.plan.id,
            title: state.plan.title,
            kind: state.plan.kind,
            since: state.plan.adoptedAt,
            // O plano mostrado é a comp fixada pelo usuário, não o plano automático.
            pinned,
          },
          // Desafiante que lidera mas ainda não passou da confirmação (`pending`: nada muda na tela até confirmar) ou que
          // lidera sem passar da margem de troca (`pending: false`: o plano segue e a nota diz por quê).
          challenger: c
            ? {
                id: c.id,
                title: c.title,
                ...noteOf(c),
                readings: c.readings ?? 1,
                need: { ...CONFIRM },
                pending: true,
              }
            : lead,
          // Alcance do plano mostrado em uma linha (core/comps/reach.mjs: peças que tem, que faltam e a chance no prazo).
          reach:
            (
              shown?.reach ??
              analysis?.compRanking?.find(
                (r) => r.id === (shown?.meta?.id ?? top.meta?.id),
              )?.reach
            )?.text ?? null,
          ...built.checklist,
          changes: state.history.slice(-6).reverse(),
        },
      };
    },

    /**
     * Últimas decisões do usuário desta partida (cópia), ou null (outra partida, ou nenhum POST ainda: valem os padrões).
     */
    decisions(gameId) {
      return state.gameId === String(gameId) && state.decisions
        ? structuredClone(state.decisions)
        : null;
    },

    /**
     * Guarda as decisões recebidas agora (só o que o usuário decidiu: comp fixada, trocas, aprimoramentos marcados).
     * Persiste junto do plano (sobrevive ao reinício) e só toca o estado quando algo mudou. Devolve se mudou.
     */
    setDecisions(gameId, decisions) {
      forGame(gameId);
      const next = JSON.stringify(decisions ?? null);
      if (JSON.stringify(state.decisions) === next) return false;
      state.decisions = JSON.parse(next);
      touch();
      return true;
    },

    /** Estado atual (cópia), para diagnóstico e testes. */
    snapshot: () => structuredClone(state),

    /** Apaga o plano da partida (fim ou início de partida). */
    reset() {
      state = emptyState();
      touch();
    },

    /** Espera a gravação pendente (testes e encerramento). */
    async flush() {
      clearTimeout(timer);
      await persist();
    },
  };
}
