// Rodar com: node --test tft/helper/v2/js/connection.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFLINE_AFTER,
  POLL_MAX_MS,
  POLL_MS,
  RESUME_NOTE_AFTER_MS,
  STALE_AFTER_S,
  connectionView,
  dataAge,
  formatAge,
  retryDelay,
} from "./connection.js";

const NOW = 1_000_000;

test("recuo do laço: 5, 5, 10, 20, 30 s e nunca passa do teto", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 9].map((n) => retryDelay(n)),
    [5000, 5000, 10000, 20000, 30000, 30000, 30000],
  );
  assert.equal(retryDelay(-3), POLL_MS);
  assert.equal(retryDelay(40), POLL_MAX_MS);
});

test("idade legível", () => {
  assert.equal(formatAge(null), "idade desconhecida");
  assert.equal(formatAge(Number.NaN), "idade desconhecida");
  assert.equal(formatAge(-5), "idade desconhecida");
  assert.equal(formatAge(0.4), "agora");
  assert.equal(formatAge(12), "há 12 s");
  assert.equal(formatAge(59.6), "há 1 min");
  assert.equal(formatAge(185), "há 3 min");
  assert.equal(formatAge(7300), "há 2 h");
});

test("a idade do dado avança com o tempo desde a última resposta", () => {
  assert.equal(dataAge({ ageSeconds: 10, okAt: NOW - 4000, now: NOW }), 14);
  assert.equal(dataAge({ ageSeconds: null, okAt: NOW, now: NOW }), null);
  assert.equal(dataAge({ ageSeconds: 3, okAt: null, now: NOW }), 3);
  assert.equal(
    dataAge({ ageSeconds: 3, okAt: NOW + 5000, now: NOW }),
    3,
    "relógio que andou para trás não rejuvenesce",
  );
});

test("antes da primeira resposta: conectando", () => {
  const v = connectionView({ now: NOW });
  assert.equal(v.state, "connecting");
  assert.equal(v.tone, "idle");
  assert.equal(v.pulse, true);
});

test("conectado mostra a idade do dado e fica verde", () => {
  const v = connectionView({
    now: NOW + 3000,
    okAt: NOW,
    ageSeconds: 5,
    live: true,
  });
  assert.equal(v.state, "online");
  assert.equal(v.tone, "ok");
  assert.equal(v.label, "Conectado");
  assert.equal(v.detail, "dado há 8 s");
});

test("dado velho só vira aviso em partida", () => {
  const old = connectionView({
    now: NOW,
    okAt: NOW,
    ageSeconds: STALE_AFTER_S + 30,
    live: true,
  });
  assert.equal(old.state, "stale");
  assert.equal(old.tone, "warn");
  assert.match(old.title, /parou de gravar/);
  const lobby = connectionView({
    now: NOW,
    okAt: NOW,
    ageSeconds: STALE_AFTER_S + 30,
    live: false,
  });
  assert.equal(
    lobby.state,
    "online",
    "no lobby o tabuleiro não muda e isso é normal",
  );
});

test("falhas: reconectando e depois servidor indisponível, com o tempo da próxima tentativa", () => {
  const first = connectionView({
    now: NOW,
    okAt: NOW - 8000,
    failures: 1,
    error: "Sem resposta do servidor do helper.",
    retryInMs: 4200,
  });
  assert.equal(first.state, "reconnecting");
  assert.equal(first.tone, "warn");
  assert.match(first.detail, /5 s/);
  const down = connectionView({
    now: NOW,
    okAt: NOW - 90000,
    failures: OFFLINE_AFTER,
    retryInMs: 30000,
  });
  assert.equal(down.state, "offline");
  assert.equal(down.tone, "bad");
  assert.match(down.title, /análise do servidor continua/);
  // Nunca houve resposta e já falhou: indisponível (não "reconectando").
  assert.equal(
    connectionView({ now: NOW, okAt: null, failures: 1 }).state,
    "offline",
  );
});

test("navegador offline vence tudo", () => {
  const v = connectionView({
    now: NOW,
    okAt: NOW,
    networkOnline: false,
    ageSeconds: 1,
  });
  assert.equal(v.state, "offline");
  assert.equal(v.label, "Sem rede");
});

test("volta da aba com leitura velha: diz de quando é a tela até a nova chegar", () => {
  const back = connectionView({
    now: NOW,
    okAt: NOW - 3 * 60_000,
    ageSeconds: 2,
    live: true,
    resumed: true,
  });
  assert.match(back.detail, /atualizando · última leitura há 3 min/);
  assert.equal(back.pulse, true);
  assert.match(back.title, /segundo plano/);
  // Leitura recente (o SSE manteve a aba em dia): nada a avisar.
  const fresh = connectionView({
    now: NOW,
    okAt: NOW - (RESUME_NOTE_AFTER_MS - 1000),
    ageSeconds: 2,
    resumed: true,
  });
  assert.doesNotMatch(fresh.detail, /atualizando/);
  // Leitura nova chegou (`resumed` volta a false): o normal.
  assert.doesNotMatch(
    connectionView({ now: NOW, okAt: NOW - 3 * 60_000, ageSeconds: 2 }).detail,
    /atualizando/,
  );
  // Falha vence a nota de volta.
  assert.equal(
    connectionView({
      now: NOW,
      okAt: NOW - 3 * 60_000,
      failures: 1,
      resumed: true,
    }).state,
    "reconnecting",
  );
});

test("SSE fora do ar vira nota na dica, sem mudar o tom", () => {
  const v = connectionView({
    now: NOW,
    okAt: NOW,
    ageSeconds: 1,
    sse: "closed",
  });
  assert.equal(v.tone, "ok");
  assert.match(v.title, /Avisos instantâneos fora do ar/);
});
