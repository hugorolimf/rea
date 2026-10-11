// Rodar com: node --test tft/helper/tests/static-files.test.mjs
// O servidor serve `/v2/*` e `/core/*` (o núcleo puro que o navegador carrega sem build). Este teste fixa a resolução
// de caminhos e confere que todo import estático do front, resolvido como URL, cai num arquivo servido.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sendStatic, staticTarget } from "../static-files.mjs";
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

test("staticTarget: /overlay/* serve só overlay/hud (HUD do overlay); o resto de overlay/ e prefixos parecidos não", () => {
  assert.deepEqual(staticTarget(root, "/overlay/index.html"), {
    target: abs("overlay", "hud", "index.html"),
    type: "text/html; charset=utf-8",
  });
  assert.equal(staticTarget(root, "/overlay/hud.css").type, "text/css");
  assert.equal(staticTarget(root, "/overlay/hud.mjs").type, "text/javascript");
  // Nada fora de overlay/hud: package.json, JSON, node_modules e `..` não viram arquivo servido.
  for (const p of [
    "/overlay/../package.json",
    "/overlay/x.json",
    "/overlay/../main.cjs",
    "/overlay/../node_modules/electron/index.js",
    "/overlay/%2e%2e/package.json",
  ])
    assert.equal(staticTarget(root, p).type, undefined, p);
  // Sem a barra, ou com prefixo parecido, a rota é de outro dono.
  for (const p of ["/overlay", "/overlays/x", "/overlayx/index.html"])
    assert.equal(staticTarget(root, p), null, p);
});

test("PWA: /sw.js e /manifest.webmanifest vêm de v2/ (o worker precisa estar na raiz para controlar a página); ícones png são servidos", () => {
  assert.deepEqual(staticTarget(root, "/sw.js"), {
    target: abs("v2", "sw.js"),
    type: "text/javascript",
  });
  assert.deepEqual(staticTarget(root, "/manifest.webmanifest"), {
    target: abs("v2", "manifest.webmanifest"),
    type: "application/manifest+json",
  });
  assert.equal(staticTarget(root, "/v2/icons/icon-192.png").type, "image/png");
  assert.equal(staticTarget(root, "/v2/icons/icon.svg").type, "image/svg+xml");
  // Só esses dois nomes fixos: nada parecido vira rota estática da raiz, e o `Object.hasOwn` impede "constructor" etc.
  for (const p of [
    "/sw.mjs",
    "/sw.js/",
    "/v2sw.js",
    "/constructor",
    "/__proto__",
    "/toString",
  ])
    assert.equal(staticTarget(root, p), null, p);
  // O resto de v2/ continua só com tipos web (README e DESIGN em markdown não são servidos).
  assert.equal(staticTarget(root, "/v2/DESIGN.md").type, undefined);
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

test("rota estática: arquivo ausente responde 404 limpo (o cabeçalho 200 só sai depois de ler o arquivo)", async () => {
  const http = await import("node:http"),
    json = (res) => (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    },
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1");
        if (await sendStatic(res, root, url.pathname, json(res))) return;
        json(res)(404, { error: "Rota não encontrada." });
      } catch (e) {
        // Antes da correção: writeHead(200) já enviado + catch tentando outro writeHead caía aqui.
        if (!res.headersSent) json(res)(400, { error: e.message });
        else res.destroy();
      }
    });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`,
      get = async (p) => {
        const r = await fetch(base + p);
        return {
          status: r.status,
          type: r.headers.get("content-type"),
          body: await r.text(),
        };
      };
    for (const p of [
      "/v2/js/nao-existe.js",
      "/core/nao-existe.mjs",
      "/v2/css/nada.css",
    ]) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
      assert.match(r.type, /application\/json/, p);
      assert.deepEqual(
        JSON.parse(r.body),
        { error: "Arquivo não encontrado." },
        p,
      );
    }
    // Tipo que não é web: 404 de rota, sem tocar o disco.
    const readme = await get("/core/README.md");
    assert.equal(readme.status, 404);
    assert.deepEqual(JSON.parse(readme.body), {
      error: "Rota não encontrada.",
    });
    // Arquivo que existe segue com 200 e o tipo certo, e o servidor continua de pé depois dos 404.
    const ok = await get("/core/state/clock.mjs");
    assert.equal(ok.status, 200);
    assert.equal(ok.type, "text/javascript");
    assert.match(ok.body, /parseStage/);
    // Rota de outro dono: não é estática.
    const other = await get("/api/state");
    assert.equal(other.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rules.mjs (carregado pelo mock no navegador) só importa módulos que o servidor serve", () => {
  for (const spec of importsOf("rules.mjs")) {
    assert.ok(spec.startsWith("./core/"), `rules.mjs importa ${spec}`);
    const hit = staticTarget(root, "/" + spec.slice(2));
    assert.ok(hit?.type, `${spec}: o servidor não serve`);
    assert.ok(fs.existsSync(hit.target), `${spec}: arquivo não existe`);
  }
});
