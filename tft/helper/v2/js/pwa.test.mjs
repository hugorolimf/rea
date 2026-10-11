// Rodar com: node --test tft/helper/v2/js/pwa.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { canRegister, shellUrls } from "./pwa.js";

test("só registra o worker em contexto seguro, com suporte e fora do mock", () => {
  const win = (o = {}) => ({
    navigator: { serviceWorker: {} },
    isSecureContext: true,
    location: { search: "" },
    ...o,
  });
  assert.equal(canRegister(win()), true);
  assert.equal(
    canRegister(win({ isSecureContext: false })),
    false,
    "http na rede local não é contexto seguro",
  );
  assert.equal(canRegister(win({ navigator: {} })), false);
  assert.equal(
    canRegister(win({ location: { search: "?mock=completo" } })),
    false,
    "o mock nunca é cacheado",
  );
  assert.equal(canRegister(win({ location: { search: "?theme=dark" } })), true);
  assert.equal(canRegister({}), false);
});

test("shellUrls guarda a casca e as imagens, nunca a API nem outra origem", () => {
  const origin = "http://127.0.0.1:3218";
  const urls = shellUrls(
    [
      { name: "http://127.0.0.1:3218/v2/js/main.js" },
      { name: "http://127.0.0.1:3218/v2/css/tokens.css?x=1" },
      { name: "http://127.0.0.1:3218/core/state/clock.mjs" },
      { name: "http://127.0.0.1:3218/assets/0123456789abcdef01234567.png" },
      { name: "http://127.0.0.1:3218/api/state" },
      { name: "http://127.0.0.1:3218/api/events" },
      { name: "http://127.0.0.1:3218/overlay/index.html" },
      { name: "http://127.0.0.1:3218/live-mock.js" },
      { name: "https://cdn.exemplo.com/v2/js/x.js" },
      { name: "não é url" },
      "http://127.0.0.1:3218/manifest.webmanifest",
    ],
    origin,
  );
  assert.deepEqual(urls.sort(), [
    "/",
    "/assets/0123456789abcdef01234567.png",
    "/core/state/clock.mjs",
    "/manifest.webmanifest",
    "/v2/css/tokens.css",
    "/v2/js/main.js",
  ]);
});
