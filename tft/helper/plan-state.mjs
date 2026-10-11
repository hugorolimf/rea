// Estado persistente do plano da partida: o plano em andamento, o desafiante que ainda não foi confirmado, as marcas
// de progresso e o histórico de decisões. Cada análise é um DELTA sobre este estado, não um recomeço.
//
// O que o estado resolve (ver README, "Plano em andamento"):
// - o plano que o motor mantém (`sticky`) vivia só na memória do servidor e morria no reinício; agora fica em disco;
// - o motor trocava de plano quando a vantagem passava da incerteza + custo, mas cada leitura nova (ouro, loja) medida
//   de novo podia inverter a ordem: partidas reais tiveram 8 trocas Veigar<->Teemo na mesma rodada. A troca agora exige que
//   o desafiante lidere por mais de uma rodada (`CONFIRM`); uma inversão no meio zera a contagem;
// - o que já foi conquistado (estrelas, itens, aprimoramentos, nível) ficava invisível: `plan-progress.mjs` o transforma
//   em checklist e este módulo guarda as marcas entre rodadas.
//
// Troca de classe (o plano mantido virou aposta ou deixou de usar o aprimoramento escolhido) NÃO espera confirmação:
// o motor só aplica o `holdPlan` entre planos da mesma classe.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { buildChecklist } from "./plan-progress.mjs";

/** Leituras distintas e rodadas distintas em que o desafiante precisa liderar antes de assumir o plano. */
export const CONFIRM = Object.freeze({ readings: 3, rounds: 2 });
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

/** Rodada "2-3" ou, sem leitura de estágio, o minuto corrido (uma rodada dura cerca de um minuto). */
const roundOf = (stage, at) =>
  stage ? String(stage) : `t${Math.floor(at / 60000)}`;

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
  const confirmed = (c) =>
    !!c && c.readings >= CONFIRM.readings && c.rounds.length >= CONFIRM.rounds;

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
     * O motor deve segurar o plano em andamento nesta análise? Verdadeiro enquanto há plano comprometido e o desafiante
     * (se houver) ainda não foi confirmado. "Seu tabuleiro atual" não é compromisso: é o que sobra sem plano.
     */
    holdFor(gameId) {
      if (
        state.gameId !== String(gameId) ||
        !state.plan ||
        state.plan.id === CURRENT
      )
        return false;
      return !confirmed(state.challenger);
    },

    /**
     * Registra uma análise nova: adota/mantém/troca o plano, conta o desafiante e atualiza o checklist.
     * `top` = recomendação 1 (decide o plano); `shown` = a mostrada (a comp fixada pelo usuário, se houver);
     * `baseId` identifica a análise base (a mesma base não conta duas vezes como leitura do desafiante).
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
      pinned = false,
    }) {
      forGame(gameId);
      const at = now(),
        round = roundOf(stage, at),
        id = top.meta?.id ?? top.freeId;
      let switched = null;
      if (!state.plan) {
        adopt(top, stage, level);
        log({ type: "adopt", text: `Plano: ${top.title}` }, stage);
        state.challenger = null;
      } else if (id === state.plan.id) {
        const sw = top.evidence?.switch;
        if (sw?.held && sw.toId) {
          const c = state.challenger?.id === sw.toId ? state.challenger : null;
          if (!c || c.lastBase !== baseId || baseId === null) {
            const next = c ?? {
              id: sw.toId,
              title: sw.to,
              readings: 0,
              rounds: [],
              firstAt: new Date(at).toISOString(),
            };
            next.readings++;
            if (!next.rounds.includes(round)) next.rounds.push(round);
            Object.assign(next, {
              title: sw.to,
              gain: sw.gain,
              noise: sw.noise,
              cost: sw.cost,
              lastBase: baseId,
              lastRound: round,
            });
            if (!c)
              log(
                {
                  type: "hold",
                  text: `Mantido ${state.plan.title}; ${sw.to} lidera por ${String(sw.gain).replace(".", ",")}º, aguardando confirmação`,
                },
                stage,
              );
            state.challenger = next;
          }
        } else state.challenger = null;
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
        const sw = top.evidence?.switch;
        adopt(top, stage, level);
        log(
          {
            type: "switch",
            text: `Troca de plano: ${switched.from} → ${top.title}`,
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
          // Desafiante que lidera mas ainda não passou da confirmação (nada muda na tela até confirmar).
          challenger: c
            ? {
                id: c.id,
                title: c.title,
                readings: c.readings,
                rounds: c.rounds.length,
                need: { ...CONFIRM },
                gain: c.gain,
                noise: c.noise,
                cost: c.cost,
              }
            : null,
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
