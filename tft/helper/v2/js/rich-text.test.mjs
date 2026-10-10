// Rodar com: node --test tft/helper/v2/js/
// Texto rico: o nome de campeão ou item dentro de uma frase do servidor vira imagem, sem trocar sinergias nem termos
// ambíguos e sem abrir brecha para HTML. Parte do catálogo real do set (e de um catálogo pequeno para colisões).
import test from "node:test";
import assert from "node:assert/strict";
import { realCatalog, tinyCatalog } from "./catalog-fixture.mjs";

// dom.js lê matchMedia ao carregar: um stub mínimo basta.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const { setCatalog } = await import("./ui/glyphs.js");
const { fold, nameChip, richText, segments } =
  await import("./ui/rich-text.js");

const real = realCatalog(),
  tiny = tinyCatalog();
const refs = (text, catalog = tiny) =>
  segments(text, catalog)
    .filter((s) => s.ref)
    .map((s) => s.ref.id);
// Texto que um leitor de tela ouve: sem as tags e com as entidades desfeitas.
const plain = (html) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

test("fold: sem acento e sem diferença de caixa, mantendo o comprimento do texto", () => {
  assert.equal(fold("Ação É ÓTIMA ’s"), "acao e otima 's");
  assert.equal(fold("Rek’Sai").length, "Rek'Sai".length);
});

test("frase do servidor: campeões e itens viram imagens e o resto do texto fica como veio", () => {
  setCatalog(real);
  const text =
    "Teemo (hoje 2★, alvo 2★) + Pebbles + Scuttlecrab: falta Chain Vest e Giant's Belt";
  const found = refs(text, real);
  assert.deepEqual(found, [
    "DA_18_Teemo",
    "DA_18_Sentry",
    "DA_Scuttlecrab18",
    "DA_Component_ChainVest",
    "DA_Component_GiantsBelt",
  ]);
  const html = richText(text);
  assert.equal(html.match(/<img /g).length, 5, "uma imagem por nome");
  assert.equal(
    plain(html),
    text,
    "o texto lido (nomes inclusive) continua inteiro para leitores de tela",
  );
  assert.match(html, /\(hoje 2★, alvo 2★\) \+ /);
  assert.match(
    html,
    /<span class="rt" data-kind="champion" title="Teemo" style="--ring-c:var\(--cost-2\)">/,
    "anel na cor do custo (Teemo custa 2)",
  );
  assert.match(html, /<span class="rt" data-kind="item" title="Chain Vest">/);
  assert.match(
    html,
    /<img src="\/assets\/[0-9a-f]+\.png" alt="" width="18" height="18" loading="lazy" decoding="async">/,
  );
});

test("todo campeão e todo item com ícone do catálogo real é reconhecido pelo próprio nome", () => {
  const missing = [];
  for (const [id, c] of real.champions)
    if (!refs(c.name, real).length) missing.push(`campeão ${c.name}`);
  for (const [id, i] of real.items) {
    if (!i.icon) continue;
    const got = segments(i.name, real);
    // O mesmo nome em versões do mesmo item (Upgrade/Prismatic) escolhe uma delas; o que importa é virar chip de item.
    if (!(got.length === 1 && got[0].ref?.kind === "item"))
      missing.push(`item ${i.name}`);
  }
  assert.deepEqual(missing, []);
});

test("sinergia nunca vira imagem, nem o campeão que tem o mesmo nome dela", () => {
  assert.deepEqual(
    refs("Vanguard 4 e Rival 2"),
    [],
    "'Vanguard' é sinergia e campeão: ambíguo, fica texto",
  );
  assert.deepEqual(
    refs("Blade Master 2 com Teemo"),
    ["C_Teemo"],
    "a sinergia longa consome 'Blade': só o Teemo vira imagem",
  );
  assert.equal(
    plain(richText("Blade Master 2", { catalog: tiny })),
    "Blade Master 2",
  );
  setCatalog(real);
  for (const name of real.traits.keys()) {
    const got = segments(`${name} 2`, real).filter((s) => s.ref);
    assert.deepEqual(got, [], `sinergia ${name} ficou como texto`);
  }
});

test("a correspondência mais longa vence e nomes ambíguos ficam como texto", () => {
  assert.deepEqual(refs("Sunfire Cape"), ["I_Sun"]);
  assert.deepEqual(refs("Sunfire"), ["I_Sunfire"]);
  assert.deepEqual(refs("Vi"), [], "mesmo nome para campeão e item");
  assert.deepEqual(
    refs("Twin"),
    ["I_Dup"],
    "versões do mesmo item: uma só imagem",
  );
  assert.deepEqual(
    refs("Phantom Armor e Phantom"),
    ["I_Phantom"],
    "aprimoramento só bloqueia",
  );
});

test("só troca em palavra inteira, em maiúscula; aceita possessivo, plural e acentos", () => {
  assert.deepEqual(
    refs("Teemo's e Teemo’s"),
    ["C_Teemo", "C_Teemo"],
    "possessivo",
  );
  assert.deepEqual(
    refs("três Chain Vests"),
    ["I_Vest"],
    "plural em nomes longos",
  );
  assert.deepEqual(
    refs("Teemos"),
    [],
    "plural não vale para nomes curtos: 'Teemos' é outra palavra",
  );
  assert.deepEqual(
    refs("Pebbles"),
    ["C_Sentry"],
    "o nome que já termina em s casa inteiro",
  );
  assert.deepEqual(
    refs("teemo e chain vest"),
    [],
    "minúsculas não são nomes próprios",
  );
  assert.deepEqual(refs("XTeemo Teemoz"), [], "dentro de outra palavra");
  assert.deepEqual(refs("Rek’Sai entra"), ["C_Rek"], "apóstrofo tipográfico");
  assert.equal(segments("Teemo").length, 1);
  assert.deepEqual(
    segments("e Teemo!").map((s) => s.text),
    ["e ", "Teemo", "!"],
  );
});

test("escape: o texto do servidor nunca vira HTML e só o helper insere imagens", () => {
  setCatalog(tiny);
  const evil = `<img src=x onerror=alert(1)> Teemo "aspas" & <script>x</script>`;
  const html = richText(evil);
  assert.ok(!html.includes("<script>") && !html.includes("<img src=x"), html);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(html.match(/<img /g).length, 1, "só a imagem do Teemo");
  // Nome e ícone vindos do catálogo também são escapados.
  const chip = nameChip("champion", "C_Evil", "<b>Evil</b>");
  assert.ok(!chip.includes("<b>Evil</b>"), chip);
  assert.match(chip, /&lt;b&gt;Evil&lt;\/b&gt;/);
});

test("sem ícone no catálogo o nome fica em texto no marcador neutro, sem quebrar a frase", () => {
  setCatalog(tiny);
  const html = richText("Entra Poppy agora");
  assert.match(
    html,
    /<span class="rt is-text" data-kind="champion"><span class="rt-name">Poppy<\/span><\/span>/,
  );
  assert.ok(!html.includes("<img"), "sem imagem");
  assert.equal(plain(html), "Entra Poppy agora");
});

test("com legenda o nome fica visível ao lado da imagem; o retrato some para leitores de tela", () => {
  setCatalog(tiny);
  const html = nameChip("champion", "C_Teemo", "Teemo", {
    legend: true,
    size: 22,
  });
  assert.match(html, /class="rt has-legend"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /--s:22px/);
  assert.equal(plain(html), "Teemo");
});

test("textos vazios ou sem catálogo carregado não quebram", () => {
  assert.equal(richText(""), "");
  assert.equal(richText(null), "");
  const empty = { champions: new Map(), items: new Map(), traits: new Map() };
  assert.equal(richText("Teemo & Co", { catalog: empty }), "Teemo &amp; Co");
});
