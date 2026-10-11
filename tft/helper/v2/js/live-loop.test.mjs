// Rodar com: node --test tft/helper/v2/js/live-loop.test.mjs
// Laço do Ao vivo: buscar continua com a aba oculta, desenhar espera a aba voltar, SSE e temporizador não duplicam.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLiveLoop } from "./live-loop.js";

/** Relógio e temporizadores manuais. */
function fakeClock() {
  let t = 0,
    seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, at: t + ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    /** Avança o relógio rodando, em ordem, os temporizadores que vencem. */
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers]
          .filter(([, x]) => x.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
        await flush();
      }
      t = end;
      await flush();
    },
    get pending() {
      return timers.size;
    },
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Busca controlável: cada chamada fica pendente até `finish()`; `auto` resolve na hora. */
function fakePull({ auto = true, onPull = () => {} } = {}) {
  const calls = [];
  let open = [];
  const pull = () => {
    calls.push(calls.length + 1);
    onPull(calls.length);
    if (auto) return Promise.resolve();
    return new Promise((resolve) => open.push(resolve));
  };
  return {
    pull,
    calls,
    finish() {
      const done = open;
      open = [];
      for (const r of done) r();
    },
  };
}

function setup({ hidden = false, auto = true, delay = 5000 } = {}) {
  const clock = fakeClock(),
    page = { hidden },
    draws = [],
    settled = [];
  let loop;
  const fetcher = fakePull({
    auto,
    onPull: (n) => loop.paint(() => draws.push(n)),
  });
  loop = createLiveLoop({
    pull: fetcher.pull,
    hidden: () => page.hidden,
    delay: typeof delay === "function" ? delay : () => delay,
    onSettled: () => settled.push(clock.now()),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    onError: () => {},
  });
  return { clock, page, draws, settled, loop, fetcher };
}

test("aba oculta: o temporizador continua buscando e o desenho fica para a volta", async () => {
  const { clock, page, draws, loop, fetcher } = setup({ hidden: true });
  await loop.request();
  assert.equal(fetcher.calls.length, 1, "a primeira leitura acontece oculta");
  assert.deepEqual(draws, [], "oculta: não desenha");
  assert.equal(loop.stale, true);
  await clock.advance(5000);
  await clock.advance(5000);
  assert.equal(fetcher.calls.length, 3, "o ciclo de 5 s segue buscando oculto");
  assert.deepEqual(draws, []);
  page.hidden = false;
  assert.equal(loop.show(), true, "ao voltar desenha na hora");
  assert.deepEqual(draws, [3], "só o desenho da leitura mais recente");
  assert.equal(loop.stale, false);
  assert.equal(loop.show(), false, "nada mais para desenhar");
});

test("aba oculta: evento do servidor (SSE) dispara a busca", async () => {
  const { clock, loop, fetcher, draws } = setup({ hidden: true });
  loop.kick();
  loop.kick(); // rajada: vira uma busca só
  assert.equal(fetcher.calls.length, 0, "espera a rajada juntar");
  await clock.advance(200);
  assert.equal(fetcher.calls.length, 1);
  assert.deepEqual(draws, []);
  assert.equal(loop.stale, true);
});

test("aba visível: desenha na hora, sem nada adiado", async () => {
  const { loop, draws } = setup({ hidden: false });
  await loop.request();
  assert.deepEqual(draws, [1]);
  assert.equal(loop.stale, false);
  assert.equal(loop.show(), false);
});

test("SSE e temporizador coincidindo: uma busca só", async () => {
  const { clock, loop, fetcher } = setup({ auto: false });
  void loop.request();
  fetcher.finish();
  await flush();
  assert.equal(fetcher.calls.length, 1);
  // Evento chega perto do fim do intervalo: a busca dele ainda está em andamento quando o temporizador vence.
  await clock.advance(4700);
  loop.kick();
  await clock.advance(200); // busca do evento começa (t = 4900)
  assert.equal(fetcher.calls.length, 2);
  await clock.advance(300); // t = 5200: o temporizador de 5 s venceu com a busca em andamento
  assert.equal(fetcher.calls.length, 2, "o temporizador não abre outra busca");
  fetcher.finish();
  await flush();
  // Sem seguimento: a próxima busca é a de reserva, 5 s depois do fim da busca do evento.
  await clock.advance(4900);
  assert.equal(fetcher.calls.length, 2, "nada antes de 5 s");
  await clock.advance(200);
  assert.equal(fetcher.calls.length, 3);
});

test("toda busca empurra o temporizador: com eventos frequentes ele não soma buscas", async () => {
  const { clock, loop, fetcher } = setup();
  await loop.request();
  for (let i = 0; i < 5; i++) {
    await clock.advance(3000);
    loop.kick();
    await clock.advance(200);
  }
  // 1 inicial + 5 eventos; nenhum disparo do temporizador (nunca passaram 5 s sem busca).
  assert.equal(fetcher.calls.length, 6);
});

test("pedido explícito com busca em andamento: exatamente uma busca de seguimento", async () => {
  const { clock, loop, fetcher } = setup({ auto: false });
  void loop.request();
  void loop.request();
  void loop.request();
  loop.kick();
  await clock.advance(200);
  assert.equal(fetcher.calls.length, 1);
  fetcher.finish();
  await flush();
  await clock.advance(80);
  assert.equal(fetcher.calls.length, 2, "uma de seguimento, não três");
  fetcher.finish();
  await flush();
  await clock.advance(80);
  assert.equal(fetcher.calls.length, 2);
});

test("volta da aba com busca em andamento (soft): a resposta que chega serve", async () => {
  const { clock, loop, fetcher, page, draws } = setup({
    hidden: true,
    auto: false,
  });
  void loop.request();
  page.hidden = false;
  loop.show();
  void loop.request({ soft: true });
  fetcher.finish();
  await flush();
  await clock.advance(1000);
  assert.equal(fetcher.calls.length, 1, "sem leitura repetida");
  assert.deepEqual(draws, [1], "o desenho guardado aparece uma vez ao voltar");
});

test("recuo em falha: o intervalo vem de `delay()` a cada busca", async () => {
  let failures = 0;
  const { clock, loop, fetcher } = setup({
    delay: () => [5000, 5000, 10000, 20000][Math.min(failures, 3)],
  });
  failures = 2;
  await loop.request();
  assert.equal(loop.nextAt, 10000);
  await clock.advance(9999);
  assert.equal(fetcher.calls.length, 1);
  await clock.advance(1);
  assert.equal(fetcher.calls.length, 2);
});

test("um erro que escapa da busca não para o laço", async () => {
  const clock = fakeClock();
  let calls = 0;
  const errors = [];
  const loop = createLiveLoop({
    pull: async () => {
      calls += 1;
      throw new Error("falhou");
    },
    hidden: () => true,
    delay: () => 5000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    onError: (e) => errors.push(e.message),
  });
  await loop.request();
  await clock.advance(5000);
  assert.equal(calls, 2);
  assert.deepEqual(errors, ["falhou", "falhou"]);
});

test("onSettled roda depois de agendar a próxima busca", async () => {
  const { loop, settled, clock } = setup();
  await loop.request();
  assert.deepEqual(settled, [0]);
  assert.equal(loop.nextAt, clock.now() + 5000);
});

test("main.js: nenhum gatilho de leitura depende da aba estar visível", () => {
  const src = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    src,
    /document\.hidden\s*&&\s*refresh|!document\.hidden\)\s*await refresh/,
    "a busca não pode ser condicionada à aba visível",
  );
  assert.match(src, /createLiveLoop\(/);
  assert.match(src, /loop\.kick\(\)/, "o evento SSE pede a leitura pelo laço");
  assert.match(src, /addEventListener\("visibilitychange", resume\)/);
  assert.match(src, /loop\.paint\(/, "o desenho passa pelo laço");
});
