// ARQUIVO HISTÓRICO (fora da suíte: os globs de teste não entram em .old/). Casos de v2/js/model.test.mjs que só
// existiam para a leitura de tela (OCR) como fonte do Ao vivo: nível/ouro "velhos" (`hero.levelStale`/`goldStale`,
// `screen.stale`), origem "screen" e o chip "GEP off · tela" com "Lendo da tela: ...". Copiados como estavam em
// 2026-10-11, antes da remoção; hoje falhariam (o modelo não tem mais esses campos). Ver .old/ocr/README.md.
// No sistema atual: sem GEP os campos ficam desconhecidos, o chip diz "GEP off · sem fonte" e `status.gep.missing`
// lista os campos (v2/js/model.test.mjs, "sem GEP o chip diz 'sem fonte'...").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel, gepNote } from "../../../v2/js/model.js";

const { state, rec } = JSON.parse(
  readFileSync(
    new URL("../../../live-mock-base.json", import.meta.url),
    "utf8",
  ),
);
const live = () => {
  const s = structuredClone(state),
    r = structuredClone(rec);
  s.screen = {
    running: true,
    stage: "4-2",
    gold: 54,
    level: 8,
    xp: "23/68",
    items: [],
  };
  r.metadata.actionable = true;
  r.self.health = 58;
  return { state: s, rec: r };
};

test("nível: lido, derivado (piso) e estimado pelo tabuleiro são distinguidos", () => {
  const read = buildModel(live());
  assert.equal(read.hero.levelSource, "lido");
  const derived = live();
  derived.state.screen = {
    ...derived.state.screen,
    level: 5,
    sources: { level: "derived" },
  };
  assert.equal(buildModel(derived).hero.levelSource, "derivado");
  const estimated = live();
  estimated.state.screen = { ...estimated.state.screen, level: null };
  estimated.state.estimatedLevel = 6;
  const m = buildModel(estimated);
  assert.equal(m.hero.level, 6);
  assert.equal(m.hero.levelSource, "estimado");
  // Leitura em conflito com o XP ou velha avisa; o nível usado pela análise aparece à parte.
  const stale = live();
  stale.state.screen.stale = { level: true };
  stale.rec.currentLevel = 7;
  const s = buildModel(stale);
  assert.equal(s.hero.levelStale, true);
  assert.equal(s.hero.levelUsed, 7);
});

test("fonte GEP: o modelo traz a origem de ouro/nível e o estado da fonte para o tooltip", () => {
  const s = structuredClone(state);
  s.screen = {
    stage: "1-3",
    gold: 0,
    level: 2,
    xp: "0/2",
    items: [],
    sources: { gold: "gep", level: "gep" },
  };
  s.gepStatus = { state: "ativo", reason: null, lastEventAgeMs: 4200 };
  const { hero, status } = buildModel({ state: s, rec: null });
  assert.equal(hero.goldFrom, "gep");
  assert.equal(hero.levelFrom, "gep");
  assert.equal(hero.levelSource, "lido");
  assert.equal(status.gep.label, "GEP ativo · último evento há 4s");
  s.screen.sources = { gold: "screen", level: "screen" };
  assert.equal(buildModel({ state: s, rec: null }).hero.goldFrom, null);
  assert.equal(
    buildModel({ state: { ...s, gepStatus: undefined }, rec: null }).status.gep,
    null,
  );
});

test("fonte GEP: obsoleto, ausente e esquema desconhecido dizem que a tela assumiu", () => {
  assert.match(
    gepNote({
      state: "obsoleto",
      reason: "sem-eventos-recentes",
      lastEventAgeMs: 90000,
    }).label,
    /obsoleto.*90s.*leitura de tela/,
  );
  assert.match(
    gepNote({ state: "ausente", reason: "banco-ausente" }).label,
    /ausente: banco do TFTAcademy não encontrado.*leitura de tela/,
  );
  assert.match(
    gepNote({ state: "esquema-desconhecido", detail: "events: key" }).label,
    /esquema.*events: key/,
  );
  assert.equal(gepNote(null), null);
  // Chip curto do HUD: ativo mostra a idade; os demais avisam que caiu para a leitura de tela.
  assert.equal(
    gepNote({ state: "ativo", lastEventAgeMs: 4200 }).short,
    "GEP ativo · 4s",
  );
  assert.equal(gepNote({ state: "ativo" }).short, "GEP ativo");
  assert.equal(
    gepNote({ state: "obsoleto", reason: "sem-eventos-recentes" }).short,
    "GEP parado",
  );
  assert.equal(
    gepNote({ state: "ausente", reason: "banco-ausente" }).short,
    "GEP off",
  );
  assert.equal(gepNote({ state: "esquema-desconhecido" }).short, "GEP ?");
});

test("fonte GEP: sem GEP o chip diz que a tela assumiu e a dica lista os campos que ela lê", () => {
  const sources = {
    gold: "screen",
    level: "screen",
    xp: "screen",
    shop: "screen",
    items: "screen",
    bench: null,
  };
  const off = gepNote({ state: "ausente", reason: "banco-ausente" }, sources);
  assert.equal(off.short, "GEP off · tela");
  assert.match(off.label, /Lendo da tela: ouro, nível, XP, loja, itens/);
  assert.deepEqual(off.screen, ["ouro", "nível", "XP", "loja", "itens"]);
  // Parte dos campos vindo do arquivo do jogo ou do GEP: só os da tela entram.
  const part = gepNote(
    { state: "obsoleto", reason: "sem-eventos-recentes" },
    { ...sources, gold: "gep", items: "screen", shop: null, xp: null },
  );
  assert.equal(part.short, "GEP parado · tela");
  assert.deepEqual(part.screen, ["nível", "itens"]);
  // A tela também não leu nada (janela fechada): o aviso é honesto e o chip não promete leitura.
  const none = gepNote({ state: "ausente", reason: "sem-partida" }, {});
  assert.equal(none.short, "GEP off");
  assert.match(none.label, /Nada lido da tela agora/);
  // GEP ativo: nada muda; sem as origens do servidor, o texto é o de antes.
  assert.equal(gepNote({ state: "ativo" }, sources).short, "GEP ativo");
  assert.equal(gepNote({ state: "ativo" }, sources).screen, undefined);
  assert.equal(
    gepNote({ state: "ausente", reason: "banco-ausente" }).screen,
    undefined,
  );
  // O modelo repassa as origens da tela ao chip.
  const s = structuredClone(state);
  s.screen = { stage: "2-1", gold: 3, level: 2, sources };
  s.gepStatus = { state: "ausente", reason: "banco-ausente" };
  assert.equal(
    buildModel({ state: s, rec: null }).status.gep.short,
    "GEP off · tela",
  );
});

test("fonte GEP: gravação desligada no TFTAcademy diz como ligar, no chip e na dica", () => {
  const off = gepNote({
    state: "ausente",
    reason: "gravacao-desligada",
    recordGames: false,
    was: "sem-partida",
  });
  assert.match(
    off.label,
    /ausente: gravação de partidas desligada no TFTAcademy/,
  );
  assert.match(
    off.label,
    /Ligue "gravar partidas" nas configurações do TFTAcademy/,
  );
  assert.match(off.label, /leitura de tela/);
  assert.equal(off.short, "GEP off · ligar gravação");
  assert.match(off.hint, /gravar partidas/);
  // Fora de partida (motivo próprio) com a gravação desligada: o motivo fica, a instrução também.
  const outside = gepNote({
    state: "ausente",
    reason: "fora-de-partida",
    recordGames: false,
  });
  assert.match(outside.label, /fora de partida.*gravar partidas/);
  assert.equal(outside.short, "GEP off");
  // Ativo (partida que já estava sendo gravada) ou configuração desconhecida/ligada: sem a instrução.
  assert.equal(gepNote({ state: "ativo", recordGames: false }).hint, undefined);
  assert.equal(
    gepNote({ state: "ausente", reason: "sem-partida", recordGames: true })
      .hint,
    undefined,
  );
  assert.doesNotMatch(
    gepNote({ state: "ausente", reason: "sem-partida" }).label,
    /gravar partidas/,
  );
});
