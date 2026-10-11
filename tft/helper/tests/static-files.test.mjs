// Rodar com: node --test tft/helper/tests/static-files.test.mjs
// O servidor serve `/v2/*` e `/core/*` (o núcleo puro que o navegador carrega sem build). Este teste fixa a resolução
// de caminhos e confere que todo import estático do front, resolvido como URL, cai num arquivo servido.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { staticTarget } from "../static-files.mjs";
import { importsOf, root } from "./architecture/scan.mjs";

const abs = (...p) => path.join(root, ...p);

test("staticTarget: raiz, v2 e core; só tipos web; nunca sai da pasta", () => {
  assert.deepEqual(staticTarget(root, "/"), {
    target: abs("v2", "index.html"),
    type: "text/html; charset=utf-8",
  });
  assert.deepEqual(staticTarget(root, "/v2/js/main.js"), {
    target: abs("v2", "js", "main.js"),
    type: "text/javascript",
  });
  assert.deepEqual(staticTarget(root, "/core/catalog/traits.mjs"), {
    target: abs("core", "catalog", "traits.mjs"),
    type: "text/javascript",
  });
  assert.equal(staticTarget(root, "/v2/css/base.css").type, "text/css");
  // Tipo não web (README do núcleo, JSON, dados) não é servido.
  assert.equal(staticTarget(root, "/core/README.md").type, undefined);
  assert.equal(staticTarget(root, "/v2/README.md").type, undefined);
  assert.equal(staticTarget(root, "/core/x.json").type, undefined);
  // Fora das pastas servidas, o servidor segue para as outras rotas.
  for (const p of ["/api/state", "/engine.mjs", "/corex/a.mjs", "/v2", "/core"])
    assert.equal(staticTarget(root, p), null, p);
  // `..` que sobreviveria a um pathname cru nunca vira arquivo servido (a URL real já normaliza antes).
  for (const p of [
    "/core/../server.mjs",
    "/v2/../engine.mjs",
    "/core/..\\engine.mjs",
  ])
    assert.equal(staticTarget(root, p).type, undefined, p);
  assert.equal(
    staticTarget(root, "/core/catalog/../../server.mjs").type,
    undefined,
  );
});

test("front: todo import estático de v2/ resolve, como URL, para um arquivo servido (inclui /core/*)", () => {
  const seen = new Set(),
    served = new Set(),
    queue = ["/v2/js/main.js"];
  while (queue.length) {
    const url = queue.pop();
    if (seen.has(url)) continue;
    seen.add(url);
    const hit = staticTarget(root, url);
    assert.ok(hit?.type, `${url}: o servidor não serve este módulo`);
    assert.ok(fs.existsSync(hit.target), `${url}: arquivo não existe`);
    served.add(path.relative(root, hit.target).replace(/\\/g, "/"));
    for (const spec of importsOf(
      path.relative(root, hit.target).replace(/\\/g, "/"),
    )) {
      if (spec.startsWith("/rules.mjs") || spec.startsWith("/economy.mjs"))
        continue;
      assert.ok(
        spec.startsWith(".") || spec.startsWith("/"),
        `${url}: import de pacote/node no navegador (${spec})`,
      );
      queue.push(new URL(spec, `http://helper${url}`).pathname);
    }
  }
  assert.ok(served.has("v2/js/history.js"), "o front carrega history.js");
  assert.ok(
    served.has("core/catalog/traits.mjs"),
    "o front carrega o núcleo de traços por /core/*",
  );
});
