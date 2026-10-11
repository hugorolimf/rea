// Rodar com: node --test tft/helper/tests/
// Trechos reais gravados pelo jogo em 2026-10-10 (partida 3291600904, Set 18): bytes do __sentry-event e linhas do TFT.log.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyLogEvent,
  gameLog,
  mergeSources,
  parseLogLine,
  parseSentryEvent,
  phaseKind,
  readTag,
} from "../game-log.mjs";

// MessagePack do evento: game.id, game.queue, set_name e (mais adiante no arquivo) game.tft.phase / game.tft.round.
const SENTRY_IDS =
  "a767616d652e6964aa33323931363030393034aa67616d652e7175657565a431313030a87365745f6e616d65a85446545365743138";
const SENTRY_ROUND = (round, phase) => {
  const text = (s) =>
    Buffer.concat([Buffer.from([0xa0 | s.length]), Buffer.from(s)]);
  return Buffer.concat([
    text("game.tft.phase"),
    text(phase),
    text("game.tft.round"),
    text(round),
  ]);
};
// Mesmo trecho, como o jogo gravou em "Combat" / "2-5".
const SENTRY_ROUND_REAL =
  "ae67616d652e7466742e7068617365a6436f6d626174ae67616d652e7466742e726f756e64a3322d35";
// Chave longa (str8: 0xd9 + tamanho), como game.tft.currentGameReconnectCount.
const SENTRY_STR8 =
  "d92267616d652e7466742e63757272656e7447616d65526563" +
  "6f6e6e656374436f756e74a130";

const event = (round = SENTRY_ROUND_REAL) =>
  Buffer.concat([
    Buffer.from("8aa8", "hex"),
    Buffer.from(SENTRY_IDS, "hex"),
    Buffer.from(round, "hex"),
  ]);

const LINES = {
  buy: "[2026.10.10-03.18.51:775][996]TFT: [Client] TFTAudioEventSubsystem: Trigger[Audio.Event.VO.Unit.Purchase] Actor[TFTCharacter_2147458797 {DA_18_Warwick}] Plays Event[A_VO_Warwick18_Purchase_Cue] with Interrupt Channel [AC_VO_Round]",
  buyBlocked:
    "[2026.10.10-03.18.52:085][ 12]TFT: [Client] TFTAudioEventSubsystem: Actor[TFTCharacter_2147458210 {DA_18_Elise}] and Event[Audio.Event.VO.Unit.Purchase] was blocked by InterruptChannel[AC_VO_Round]",
  star2:
    "[2026.10.10-03.18.52:281][ 24]TFT: [Client] TFTAudioEventSubsystem: Trigger[Audio.Event.VO.Unit.StarUp.2Star] Actor[TFTCharacter_2147472080 {DA_18_Elise}] Plays Event[A_VO_Elise18_StarUp_Cue] with Interrupt Channel [AC_VO_Action]",
  star3Blocked:
    "[2026.10.10-03.26.00:742][  1]TFT: [Client] TFTAudioEventSubsystem: Actor[TFTCharacter_2147425794 {DA_18_Yunara}] and Event[Audio.Event.VO.Unit.StarUp.3Star] was blocked by InterruptChannel[AC_VO_Action]",
  item: "[2026.10.10-03.19.32:475][235]LogMovieScene: Initializing a legacy player for sequence 'ItemFlyToBench_INST'.",
  carousel:
    "[2026.10.10-03.22.01:007][367]LogTFTMusic: UTFTMusicPlayerSubsystem::SwitchToMusic - Switched to music [MS_Music_Set18_Gameplay_Carousel]",
  begin:
    "[2026.10.10-03.18.47:122][875]TFT: [Client] TFTAugmentPlayerSubsystem_3: Augment choice lifecycle Event[BeginGame] Initialized[1] BegunGame[1] ReadyForGameplay[1]",
  beginMenu:
    "[2026.10.10-03.18.05:211][  1]TFT: [Standalone] TFTAugmentPlayerSubsystem_2147481961: Augment choice lifecycle Event[BeginGame] Initialized[1] BegunGame[1]",
  end: "[2026.10.10-03.27.49:287][749]TFT: [Standalone] TFTAugmentPlayerSubsystem_3: Augment choice lifecycle Event[EndGame] Initialized[1] BegunGame[1]",
  noise:
    "[2026.10.10-03.18.06:225][  1]LogTFTMusic: Warning: UTFTMusicPlayerSubsystem::SwitchToMusic - No music data available for type [1] player [256]",
};

test("evento do jogo: partida, fila, set, fase e rodada vêm do MessagePack gravado", () => {
  const parsed = parseSentryEvent(event());
  assert.deepEqual(parsed, {
    gameId: "3291600904",
    queueId: "1100",
    set: "TFTSet18",
    phase: "Combat",
    phaseKind: "combat",
    stage: "2-5",
    stageNumber: 2,
    roundNumber: 5,
  });
});

test("evento do jogo: chave longa (str8), arquivo cortado ao meio e arquivo sem campos de partida", () => {
  assert.equal(
    readTag(
      Buffer.from(SENTRY_STR8, "hex"),
      "game.tft.currentGameReconnectCount",
    ),
    "0",
  );
  const whole = event();
  // Cortado no meio do valor da rodada: sem valor completo, a rodada não é inventada.
  const cut = parseSentryEvent(whole.subarray(0, whole.length - 2));
  assert.equal(cut.stage, null);
  assert.equal(cut.gameId, "3291600904");
  assert.equal(parseSentryEvent(Buffer.from("8aa8", "hex")), null);
  // Valor fora do formato estágio-rodada não vira estágio.
  assert.equal(
    parseSentryEvent(Buffer.concat([whole, SENTRY_ROUND("??", "Combat")]))
      .stage,
    "2-5",
  );
  assert.equal(
    parseSentryEvent(
      Buffer.concat([
        Buffer.from(SENTRY_IDS, "hex"),
        SENTRY_ROUND("??", "Combat"),
      ]),
    ).stage,
    null,
  );
});

test("fases do jogo são agrupadas em planejamento, combate e draft (carrossel)", () => {
  assert.deepEqual(
    [
      "Planning",
      "PlanningArrival",
      "CombatCeremony",
      "CombatDeparture",
      "Draft",
      "DraftArrival",
      "Intermission",
      null,
    ].map(phaseKind),
    [
      "planning",
      "planning",
      "combat",
      "combat",
      "draft",
      "draft",
      "other",
      null,
    ],
  );
});

test("linhas do TFT.log: compra, estrela, item no banco, carrossel e início/fim da partida", () => {
  assert.deepEqual(parseLogLine(LINES.buy), {
    type: "purchase",
    id: "DA_18_Warwick",
    actor: "2147458797",
    at: "2026-10-10T03:18:51.775Z",
    blocked: false,
  });
  assert.deepEqual(parseLogLine(LINES.buyBlocked), {
    type: "purchase",
    id: "DA_18_Elise",
    actor: "2147458210",
    at: "2026-10-10T03:18:52.085Z",
    blocked: true,
  });
  assert.deepEqual(parseLogLine(LINES.star2), {
    type: "starUp",
    id: "DA_18_Elise",
    actor: "2147472080",
    star: 2,
    at: "2026-10-10T03:18:52.281Z",
    blocked: false,
  });
  assert.deepEqual(parseLogLine(LINES.star3Blocked), {
    type: "starUp",
    id: "DA_18_Yunara",
    actor: "2147425794",
    star: 3,
    at: "2026-10-10T03:26:00.742Z",
    blocked: true,
  });
  assert.equal(parseLogLine(LINES.item).type, "itemToBench");
  assert.equal(parseLogLine(LINES.carousel).type, "carousel");
  assert.equal(parseLogLine(LINES.begin).type, "gameStart");
  assert.equal(
    parseLogLine(LINES.beginMenu),
    null,
    "o BeginGame do menu ([Standalone]) não é início de partida",
  );
  assert.equal(parseLogLine(LINES.end).type, "gameEnd");
  assert.equal(parseLogLine(LINES.noise), null);
  assert.equal(
    parseLogLine("sem prefixo Trigger[Audio.Event.VO.Unit.Purchase]"),
    null,
  );
});

test("pistas do log zeram quando uma partida nova começa", () => {
  let hints = applyLogEvent(
    {
      purchases: [],
      starUps: [],
      itemsReceived: 0,
      carousels: 0,
      ended: false,
      startedAt: null,
    },
    parseLogLine(LINES.begin),
  );
  for (const l of [
    LINES.buy,
    LINES.buyBlocked,
    LINES.star2,
    LINES.item,
    LINES.item,
    LINES.carousel,
  ])
    hints = applyLogEvent(hints, parseLogLine(l));
  assert.equal(hints.purchases.length, 2);
  assert.equal(hints.starUps.length, 1);
  assert.equal(hints.itemsReceived, 2);
  assert.equal(hints.carousels, 1);
  hints = applyLogEvent(hints, parseLogLine(LINES.end));
  assert.equal(hints.ended, true);
  hints = applyLogEvent(hints, parseLogLine(LINES.begin));
  assert.deepEqual(
    [hints.purchases.length, hints.itemsReceived, hints.ended],
    [0, 0, false],
  );
});

function tmpTft() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tft-gamelog-"));
  fs.mkdirSync(path.join(dir, ".sentry-native", "abc.run"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, "Saved", "Logs"), { recursive: true });
  return {
    dir,
    eventFile: path.join(dir, ".sentry-native", "abc.run", "__sentry-event"),
    logFile: path.join(dir, "Saved", "Logs", "TFT.log"),
  };
}

test("leitor: rodada e fase do arquivo do jogo, log incremental (BOM, CRLF), truncamento e outra partida", () => {
  const t = tmpTft();
  try {
    fs.writeFileSync(t.eventFile, event());
    fs.writeFileSync(
      t.logFile,
      "﻿" +
        [LINES.beginMenu, LINES.begin, LINES.buy].join("\r\n") +
        "\r\n" +
        LINES.star2.slice(0, 40),
    );
    const g = gameLog({ dir: t.dir, minIntervalMs: 0 });
    let s = g.status("3291600904");
    assert.deepEqual(
      [s.available, s.source, s.stage, s.phase, s.phaseKind, s.sameGame],
      [true, "sentry-event", "2-5", "Combat", "combat", true],
    );
    assert.equal(s.hints.purchases.length, 1);
    assert.equal(s.hints.starUps.length, 0, "linha ainda incompleta não conta");
    // O jogo termina a linha e acrescenta outra: só o trecho novo é lido.
    fs.appendFileSync(
      t.logFile,
      LINES.star2.slice(40) + "\r\n" + LINES.item + "\r\n",
    );
    s = g.status("3291600904");
    assert.deepEqual(
      [s.hints.purchases.length, s.hints.starUps.length, s.hints.itemsReceived],
      [1, 1, 1],
    );
    // Partida diferente da que o cliente diz estar em andamento: nada de rodada velha.
    s = g.status("111");
    assert.deepEqual(
      [s.available, s.stale, s.stage, s.phase, s.gameId],
      [false, true, null, null, "3291600904"],
    );
    // Sem id esperado (cliente fora do ar) a leitura vale, marcada como não conferida.
    assert.deepEqual([g.status().available, g.status().sameGame], [true, null]);
    // Rotação/truncamento do log: recomeça do zero.
    fs.writeFileSync(t.logFile, LINES.begin + "\n");
    s = g.status("3291600904");
    assert.deepEqual([s.hints.purchases.length, s.hints.itemsReceived], [0, 0]);
    // Rodada seguinte regravada pelo jogo.
    fs.writeFileSync(
      t.eventFile,
      event(SENTRY_ROUND_REAL.replace("322d35", "332d31")),
    );
    assert.equal(g.status("3291600904").stage, "3-1");
  } finally {
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test("leitor: sem o jogo instalado/aberto devolve indisponível com o motivo, sem lançar", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tft-gamelog-vazio-"));
  try {
    const s = gameLog({ dir, minIntervalMs: 0 }).status("1");
    assert.equal(s.available, false);
    assert.equal(s.stage, null);
    assert.match(s.error, /sentry-native/);
    assert.match(s.hints.error, /TFT\.log/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fusão: rodada do jogo vale mais que a da tela; demais campos seguem da tela com a origem registrada", () => {
  const screen = {
    gold: 34,
    level: 7,
    xp: "2/32",
    stage: "2-4",
    bank: ["DA_Component_BFSword"],
    shop: null,
    items: ["DA_Component_BFSword"],
  };
  const game = {
    available: true,
    stage: "2-6",
    phase: "Planning",
    phaseKind: "planning",
  };
  const merged = mergeSources(screen, game);
  assert.equal(merged.stage, "2-6");
  assert.equal(merged.gold, 34);
  assert.deepEqual(merged.sources, {
    stage: "game-log",
    phase: "game-log",
    gold: "screen",
    level: "screen",
    xp: "screen",
    items: "screen",
    shop: null,
    bench: null,
  });
  // Arquivo do jogo indisponível: a tela continua valendo.
  const fallback = mergeSources(screen, { available: false, stage: null });
  assert.deepEqual(
    [fallback.stage, fallback.sources.stage, fallback.phase],
    ["2-4", "screen", null],
  );
  assert.equal(
    mergeSources({ ...screen, stage: null }, null).sources.stage,
    null,
  );
});
