// Rodar com: node --test tft/helper/v2/js/shell-files.test.mjs
// A casca do app (index.html, manifesto, service worker, ícones) aponta para arquivos que o servidor realmente serve.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { staticTarget } from "../../static-files.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const html = read("v2/index.html");

/** O arquivo existe no disco e a rota estática o serve com um tipo. */
function assertServed(url, from = "index.html") {
  const hit = staticTarget(root, new URL(url, "http://helper/").pathname);
  assert.ok(hit?.type, `${from}: o servidor não serve ${url}`);
  assert.ok(fs.existsSync(hit.target), `${from}: ${url} não existe em disco`);
}

test("index.html: todo stylesheet, modulepreload, ícone e script é servido", () => {
  const refs = [
    ...html.matchAll(/<link[^>]+(?:href)="([^"]+)"/g),
    ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
  ].map((m) => m[1]);
  assert.ok(refs.length > 15, "esperava os CSS e módulos da casca");
  for (const url of refs) {
    if (url.startsWith("/live-mock")) continue; // do mock: servido pelo server.mjs, não por static-files
    assertServed(url);
  }
});

test("index.html: ordem das folhas de estilo (tokens, base, shell, components e só depois as áreas)", () => {
  const sheets = [
    ...html.matchAll(/rel="stylesheet" href="\/v2\/css\/([a-z-]+)\.css"/g),
  ].map((m) => m[1]);
  assert.deepEqual(sheets.slice(0, 4), [
    "tokens",
    "base",
    "shell",
    "components",
  ]);
  const onDisk = fs
    .readdirSync(path.join(root, "v2/css"))
    .filter((f) => f.endsWith(".css"))
    .map((f) => f.replace(/\.css$/, ""))
    .sort();
  assert.deepEqual(
    [...sheets].sort(),
    onDisk,
    "todo CSS de v2/css é carregado e nenhum carregado falta",
  );
});

test("index.html: modulepreload só de módulos que o main.js realmente importa (direto ou indireto)", () => {
  const seen = new Set(),
    queue = ["v2/js/main.js"];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const m of read(rel).matchAll(
      /(?:from\s+|import\s*\()\s*"(\.{1,2}\/[^"]+)"/g,
    )) {
      const next = path.posix.normalize(
        path.posix.join(path.posix.dirname(rel), m[1]),
      );
      if (next.startsWith("v2/")) queue.push(next);
    }
  }
  for (const m of html.matchAll(
    /rel="modulepreload" href="\/(v2\/js\/[^"]+)"/g,
  ))
    assert.ok(
      seen.has(m[1]),
      `${m[1]} está no modulepreload mas o main.js não o importa`,
    );
});

test("index.html: marcos de página (landmarks), idioma, tema e ancora do conteúdo", () => {
  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, /<header class="appbar" role="banner">/);
  assert.match(html, /<nav class="nav" aria-label="[^"]+">/);
  assert.match(html, /<main class="stage" id="stage"/);
  assert.match(
    html,
    /<aside class="panel[^"]*" id="panel" aria-label="[^"]+">/,
  );
  assert.match(html, /<a class="skip-link" href="#stage">/);
  assert.match(html, /<meta name="color-scheme" content="dark light">/);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  // Um anunciador educado e único; nenhuma outra região assertiva na casca.
  assert.equal([...html.matchAll(/aria-live="assertive"/g)].length, 0);
  assert.match(html, /id="announcer"[^>]*aria-live="polite"/);
  // Todo botão só de ícone tem nome acessível.
  for (const m of html.matchAll(
    /<button[^>]*class="[^"]*btn-icon[^"]*"[^>]*>/g,
  ))
    assert.match(m[0], /aria-label="/, m[0]);
  // O mock só é carregado com ?mock= (não bloqueia a página normal).
  assert.doesNotMatch(
    html,
    /<script src="\/live-mock\.js"><\/script>\s*<script type="module"/,
  );
});

test("manifesto: instalável (nome, início e escopo, ícones 192/512 e maskable existentes)", () => {
  const manifest = JSON.parse(read("v2/manifest.webmanifest"));
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.start_url.startsWith("/"));
  const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
  for (const need of ["192x192:any", "512x512:any", "512x512:maskable"])
    assert.ok(sizes.includes(need), need);
  for (const icon of manifest.icons) assertServed(icon.src, "manifest");
  for (const s of manifest.shortcuts ?? [])
    assert.ok(s.url.startsWith("/#"), s.url);
});

test("o servidor serve /sw.js (escopo da raiz) e o manifesto no endereço que a página usa", () => {
  assert.equal(staticTarget(root, "/sw.js").type, "text/javascript");
  assert.equal(
    staticTarget(root, "/manifest.webmanifest").type,
    "application/manifest+json",
  );
  assertServed("/sw.js");
  assertServed("/manifest.webmanifest");
});

test("service worker: nunca intercepta a API, o SSE, o overlay nem o mock", () => {
  const sw = read("v2/sw.js");
  assert.match(sw, /p\.startsWith\("\/api\/"\)/);
  assert.match(sw, /p\.startsWith\("\/overlay\/"\)/);
  assert.match(sw, /p\.startsWith\("\/live-mock"\)/);
  // Só GET e só a mesma origem entram no tratamento de `fetch`.
  assert.match(sw, /request\.method !== "GET"\) return/);
  assert.match(
    sw,
    /url\.origin !== self\.location\.origin \|\| bypass\(url\.pathname\)\) return/,
  );
  // O worker não cacheia nada de /api (a regra de cache só nomeia casca e imagens).
  assert.doesNotMatch(sw, /cache\.(?:put|add|addAll)\([^)]*\/api/);
});
