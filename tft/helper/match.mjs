// Ciclo de vida da partida: detecta início e fim e grava um histórico enxuto (uma linha JSON por partida).
//
// Fontes, na ordem de confiança:
// - cliente (LCU): fase InProgress/Reconnect e gameId marcam o início assim que a partida carrega; sair dessas
//   fases encerra a partida;
// - tabuleiro (TFTEoGStats.json): ffaStanding é a colocação corrente. Hero com vida ≤ 0 tem colocação definitiva;
//   Hero como único vivo venceu. O primeiro arquivo de cada partida vem com vida e colocação -1 em todos e não
//   significa eliminação.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { practiceSignal } from "./core/state/practice.mjs";

const IN_GAME = new Set(["InProgress", "Reconnect"]);
// Fases que dizem explicitamente que a partida terminou: encerram na hora.
const GAME_OVER = new Set(["WaitingForStats", "PreEndOfGame", "EndOfGame"]);
// Encerrada pelo cliente sem colocação: espera o jogo gravar o tabuleiro final antes de registrar sem ela.
const FINAL_WAIT_MS = 3 * 60 * 1000;
// Partida de treino (sem rivais): o jogo segue em andamento enquanto o estágio/rodada avançar. Uma rodada dura menos
// que isto, então um estágio parado por mais tempo já não é partida rodando.
const ADVANCING_MS = 90 * 1000;
// Treino sem o cliente do jogo para dizer a fase: o tabuleiro parado por tanto tempo e sem rodada avançando é partida fechada.
const IDLE_MS = 5 * 60 * 1000;

function readHistory(file) {
  let lines;
  try {
    lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  // Mesma partida gravada mais de uma vez (dois processos, versões antigas): vale o último registro, o mais completo.
  const byGame = new Map();
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (!r || r.gameId == null) continue;
      const key = String(r.gameId);
      byGame.delete(key); // reposiciona no lugar da última ocorrência
      byGame.set(key, r);
    } catch {
      // linha truncada não invalida o restante
    }
  }
  return [...byGame.values()];
}

/**
 * Colocação definitiva do Hero neste snapshot, ou null enquanto a partida dele continua. Em partida de treino (sem
 * rivais, ver core/state/practice.mjs) nunca há colocação: vida -99 e posição 1 desde o primeiro arquivo não são fim.
 * `forced` é o interruptor manual `TFT_PRACTICE=1`.
 */
export function finalPlacement(snapshot, heroId, { forced = false } = {}) {
  if (practiceSignal(snapshot, { forced }) !== null) return null;
  const players = snapshot?.statsBlock?.players ?? [],
    hero = players.find((p) => String(p.playerId) === heroId);
  if (!hero || !(hero.ffaStanding >= 1)) return null;
  if (hero.health <= 0) return hero.ffaStanding;
  return players.filter((p) => p.health > 0).length <= 1 ? 1 : null;
}

/**
 * Cria o rastreador. `observe(snapshot, stat, session)` é idempotente e pode ser chamado a cada leitura;
 * `onChange({kind})` avisa "start" (partida nova), "resume" (reabre a mesma), "end" e "saved".
 */
export function matchTracker(
  file,
  heroId,
  {
    onChange = () => {},
    // Interruptor manual do modo treino (`TFT_PRACTICE=1`), para o caso de a detecção pelos dados falhar.
    practice: forcedPractice = false,
    now = Date.now,
    // Dados ao vivo guardados da partida (app/live-snapshot.mjs): `info(gameId)` diz se há e de quando.
    liveSnapshots = null,
  } = {},
) {
  const records = readHistory(file),
    recorded = new Set(records.map((r) => String(r.gameId))),
    started = new Set(); // partidas já iniciadas neste processo: um snapshot antigo nunca volta a abrir uma delas
  let match = null,
    boardGameId = null,
    // Leituras seguidas do cliente fora da partida: uma só pode ser soluço do cliente com o jogo pesado.
    outside = 0,
    // Carimbo (session.at) da última leitura contada: a mesma leitura em cache não conta duas vezes.
    outsideAt = null;

  const heroOf = (snapshot) =>
    snapshot?.statsBlock?.players?.find((p) => String(p.playerId) === heroId);

  function save() {
    const m = match;
    if (!m || m.saved || !m.board || recorded.has(String(m.id))) return;
    m.saved = true;
    const record = {
      gameId: m.id,
      queue: m.queue,
      set: m.set,
      endedAt: m.board.at,
      durationSeconds: m.board.seconds,
      placement: m.placement,
      units: m.board.units,
      // Aprimoramentos marcados na tela durante a partida (o arquivo do jogo não os informa).
      augments: m.augments ?? [],
      // Treino (sem rivais): sem colocação, que o jogo não publica; o registro diz o modo.
      ...(m.practice ? { practice: true } : {}),
      // Último Ao vivo guardado (versão do esquema, momento e tamanho); os dados ficam em app/live-snapshot.mjs.
      ...(liveSnapshots?.info(m.id)
        ? { liveSnapshot: liveSnapshots.info(m.id) }
        : {}),
    };
    records.push(record);
    recorded.add(String(m.id));
    fsp
      .mkdir(path.dirname(file), { recursive: true })
      .then(() => fsp.appendFile(file, JSON.stringify(record) + "\n"))
      .catch((e) => {
        // Desfaz a marcação: a partida volta a ser gravada no próximo save() ou begin().
        const i = records.lastIndexOf(record);
        if (i >= 0) records.splice(i, 1);
        recorded.delete(String(m.id));
        m.saved = false;
        console.log("Histórico de partidas não gravado: " + e.message);
      });
    onChange({ kind: "saved", record });
  }
  function begin(id) {
    if (match?.status === "ended") save();
    started.add(String(id));
    outside = 0;
    outsideAt = null;
    match = {
      id,
      status: "live",
      startedAt: new Date().toISOString(),
      endedAt: null,
      placement: null,
      queue: null,
      set: null,
      board: null,
      saved: false,
      practice: false,
      stage: null,
      stageAt: null,
      endStage: null,
    };
    onChange({ kind: "start" });
  }
  function end() {
    match.status = "ended";
    match.endedAt = new Date().toISOString();
    match.endStage = match.stage;
    onChange({ kind: "end" });
  }
  // A rodada mudou há pouco: o jogo está rodando (vale para o treino e para reabrir qualquer partida).
  const advancing = () =>
    match?.stageAt != null && now() - match.stageAt < ADVANCING_MS;

  return {
    /**
     * Atualiza o estado com a leitura atual; snapshot/stat/session podem ser null (fonte indisponível). `signals.stage`
     * é a rodada ("S-R") que os arquivos do jogo informam para a partida aberta: rodada avançando prova que a partida
     * segue em andamento.
     */
    observe(snapshot, stat, session, signals = {}) {
      const phase = typeof session?.phase === "string" ? session.phase : null,
        inGame = IN_GAME.has(phase),
        // Em partida sem o ID (a consulta da sessão estourou o tempo): é a mesma partida que já está aberta.
        clientGame = inGame
          ? session?.gameId ||
            (match && match.placement === null ? match.id : null)
          : null,
        id = snapshot?.gameId ?? null;
      const stage = typeof signals?.stage === "string" ? signals.stage : null;
      if (match && stage && stage !== match.stage) {
        match.stage = stage;
        match.stageAt = now();
      }
      // Encerrada por engano (sem colocação) e o jogo continua: o cliente mostra a mesma partida em andamento ou a
      // rodada avançou depois do fim. Reabre em qualquer modo; com colocação definitiva nunca reabre.
      if (
        match?.status === "ended" &&
        !match.saved &&
        match.placement === null &&
        ((clientGame && String(clientGame) === String(match.id)) ||
          (stage && stage !== match.endStage && advancing()))
      ) {
        match.status = "live";
        match.endedAt = null;
        outside = 0;
        outsideAt = null;
        onChange({ kind: "resume" }); // mesma partida: não é início (não zera o que é dela)
      }
      boardGameId = id;
      if (clientGame && clientGame !== match?.id) {
        if (recorded.has(String(clientGame))) {
          // Já registrada (ex.: servidor reiniciado com o Hero eliminado assistindo): reaproveita o registro sem
          // emitir "start", que zeraria o plano e pararia o leitor.
          if (match?.status === "ended") save();
          const r = records.findLast(
            (x) => String(x.gameId) === String(clientGame),
          );
          match = {
            id: clientGame,
            status: "ended",
            startedAt: null,
            endedAt: r?.endedAt ?? null,
            placement: r?.placement ?? null,
            queue: r?.queue ?? null,
            set: r?.set ?? null,
            board: null,
            saved: true,
            practice: r?.practice === true,
            stage: null,
            stageAt: null,
            endStage: null,
          };
          started.add(String(clientGame));
        } else begin(clientGame);
      } else if (
        !clientGame &&
        id &&
        id !== match?.id &&
        !started.has(String(id)) &&
        !recorded.has(String(id)) &&
        heroOf(snapshot) &&
        // Com o cliente fora da partida, só um tabuleiro final abre (e já fecha) uma partida perdida. Treino sem
        // cliente só abre com o arquivo recente: o tabuleiro de uma partida antiga não é partida em andamento.
        (!phase
          ? !(
              practiceSignal(snapshot, { forced: forcedPractice }) !== null &&
              stat?.mtime &&
              now() - stat.mtime.getTime() > IDLE_MS
            )
          : finalPlacement(snapshot, heroId, { forced: forcedPractice }) !==
            null)
      )
        begin(id);
      if (match && id === match.id) {
        const hero = heroOf(snapshot);
        match.queue = snapshot.queueType ?? match.queue;
        match.set = snapshot.statsBlock.setCoreName ?? match.set;
        match.practice =
          practiceSignal(snapshot, { forced: forcedPractice }) !== null;
        if (hero && hero.ffaStanding >= 1 && match.placement === null)
          match.board = {
            at: (stat?.mtime ?? new Date()).toISOString(),
            seconds: snapshot.statsBlock.gameLengthSeconds ?? null,
            units: (hero.boardPieces ?? []).map((u) => ({
              id: u.championName,
              stars: u.starLevel,
              items: u.itemNames ?? [],
            })),
          };
        const placement = finalPlacement(snapshot, heroId, {
          forced: forcedPractice,
        });
        if (placement !== null && match.placement === null) {
          match.placement = placement;
          if (match.status === "live") end();
          save();
        }
      }
      // Fim pelo cliente: fase de fim de partida encerra na hora; outra fase fora da partida precisa aparecer em
      // duas leituras seguidas (~10 s). ID ausente ou consulta falha nunca encerram a partida.
      // Sessão sem carimbo (testes, chamadores antigos) conta por chamada.
      // Treino: nem a fase de fim encerra na hora, e a rodada avançando prova que o jogo segue (o cliente em "EndOfGame"
      // já veio com a partida rodando): só o cliente fora por duas leituras, com a rodada parada, encerra.
      if (match?.status === "live" && phase && !inGame) {
        if (match.practice && advancing()) {
          outside = 0;
          outsideAt = null;
        } else if (GAME_OVER.has(phase) && !match.practice) end();
        else if (session?.at == null || session.at !== outsideAt) {
          outsideAt = session?.at ?? null;
          if (++outside >= 2) end();
        }
      } else {
        outside = 0;
        outsideAt = null;
      }
      // Treino sem o cliente do jogo (fase desconhecida): tabuleiro parado e rodada sem avançar é partida fechada.
      if (
        match?.status === "live" &&
        match.practice &&
        !phase &&
        stat?.mtime &&
        now() - stat.mtime.getTime() > IDLE_MS &&
        !advancing()
      )
        end();
      if (
        match?.status === "ended" &&
        !match.saved &&
        Date.now() - Date.parse(match.endedAt) > FINAL_WAIT_MS
      )
        save();
      return this.status();
    },
    /** Guarda os aprimoramentos marcados na tela para a partida `id` (vale só para a partida em andamento). */
    augments(id, list) {
      if (
        match &&
        String(match.id) === String(id) &&
        !match.saved &&
        Array.isArray(list)
      )
        match.augments = list.map((a) => ({ id: a.id, name: a.name }));
    },
    /** Estado para a interface. `boardReady` diz se o tabuleiro lido já é desta partida. */
    status() {
      return {
        id: match?.id ?? null,
        status: match?.status ?? "none",
        startedAt: match?.startedAt ?? null,
        endedAt: match?.endedAt ?? null,
        placement: match?.placement ?? null,
        // Partida de treino (sem rivais): não tem colocação nem vida; só fecha quando o jogo realmente fecha.
        practice: match?.practice === true,
        // Último Ao vivo guardado da partida (null se não há): permite revê-la com os dados congelados.
        liveSnapshot: match ? (liveSnapshots?.info(match.id) ?? null) : null,
        boardReady: !!match && boardGameId === match.id,
        last: records.at(-1) ?? null,
        recorded: records.length,
      };
    },
    /** Partidas registradas, da mais recente para a mais antiga. */
    history(limit = 200) {
      return records.slice(-limit).reverse();
    },
  };
}
