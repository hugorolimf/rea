// Rodar com: node --test tft/helper/v2/js/
// "Próximo item" do Ao vivo: o item principal e as duas peças da receita, cada uma no banco, equipada na peça ou faltando.
// Parametrizado sobre o catálogo real do set; o desenho (steps.js) é conferido pelo HTML que o jogador recebe.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { realCatalog } from "./catalog-fixture.mjs";
import { nextItemRecipe } from "./next-item.js";

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const { setCatalog } = await import("./ui/glyphs.js");
const { nextRow } = await import("./ui/steps.js");
const { buildModel } = await import("./model.js");

const catalog = realCatalog();
setCatalog(catalog);
const SUN = "DA_SunfireCape",
  VEST = "DA_Component_ChainVest",
  BELT = "DA_Component_GiantsBelt";
const states = (r) => r.parts.map((p) => `${p.name}:${p.state}`);

test("servidor informa o que falta (nomes): cada peça da receita ganha a situação", () => {
  const both = nextItemRecipe(
    { id: SUN, name: "Sunfire Cape", missing: ["Chain Vest", "Giant's Belt"] },
    catalog.items,
  );
  assert.deepEqual(states(both), [
    "Chain Vest:missing",
    "Giant's Belt:missing",
  ]);
  assert.equal(both.complete, false);
  const one = nextItemRecipe(
    { id: SUN, name: "Sunfire Cape", missing: ["Giant's Belt"] },
    catalog.items,
  );
  assert.deepEqual(states(one), ["Chain Vest:bank", "Giant's Belt:missing"]);
  const ready = nextItemRecipe(
    { id: SUN, name: "Sunfire Cape", missing: [] },
    catalog.items,
  );
  assert.deepEqual(states(ready), ["Chain Vest:bank", "Giant's Belt:bank"]);
  assert.equal(ready.complete, true);
});

test("ids de faltantes e componente já equipado na peça têm prioridade sobre os nomes", () => {
  const r = nextItemRecipe(
    {
      id: SUN,
      name: "Sunfire Cape",
      missing: ["Giant's Belt"],
      missingIds: [BELT],
      usesHeld: VEST,
      components: [{ id: VEST }, { id: BELT }],
    },
    catalog.items,
  );
  assert.deepEqual(states(r), ["Chain Vest:equipped", "Giant's Belt:missing"]);
});

test("receita com a mesma peça duas vezes: falta uma só", () => {
  const r = nextItemRecipe(
    { id: "DA_RedBuff", name: "Red Buff", missing: ["Recurve Bow"] },
    catalog.items,
  );
  assert.deepEqual(states(r), ["Recurve Bow:missing", "Recurve Bow:bank"]);
});

test("servidor sem a informação: o banco de itens lido decide; sem banco, a situação é desconhecida", () => {
  const item = { id: SUN, name: "Sunfire Cape" };
  assert.deepEqual(
    states(
      nextItemRecipe(item, catalog.items, {
        bank: [BELT, "DA_Component_Spatula"],
      }),
    ),
    ["Chain Vest:missing", "Giant's Belt:bank"],
  );
  assert.deepEqual(states(nextItemRecipe(item, catalog.items)), [
    "Chain Vest:unknown",
    "Giant's Belt:unknown",
  ]);
  assert.equal(
    nextItemRecipe(item, catalog.items).complete,
    true,
    "desconhecido não afirma que falta",
  );
});

test("radiante: mostra o item base e a receita do base, sempre pelo banco", () => {
  const r = nextItemRecipe(
    // O servidor não avalia a receita de um radiante: `missing: []` dele não significa que as peças existam.
    { id: "DA_SunfireCape_Radiant", name: "Radiant Sunfire Cape", missing: [] },
    catalog.items,
    { bank: [BELT] },
  );
  assert.equal(r.radiant, true);
  assert.deepEqual(r.base, { id: SUN, name: "Sunfire Cape" });
  assert.deepEqual(states(r), ["Chain Vest:missing", "Giant's Belt:bank"]);
});

test("item sem receita (artefato, emblema fixo, sem item): sem componentes", () => {
  const art = nextItemRecipe(
    { id: "DA_Artifact_Mittens", name: "Mittens", missing: [] },
    catalog.items,
  );
  assert.deepEqual(art.parts, []);
  assert.equal(art.radiant, false);
  assert.equal(nextItemRecipe(null, catalog.items), null);
  assert.equal(nextItemRecipe({ name: "sem id" }, catalog.items), null);
});

const unit = { id: "DA_18_Cassiopeia", name: "Cassiopeia", stars: 1 };
const plain = (html) => html.replace(/<[^>]+>/g, "");

test("linha 'Próximo item': peça, item principal e as duas peças da receita com a situação", () => {
  const html = nextRow({
    unit,
    item: {
      id: SUN,
      name: "Sunfire Cape",
      missing: ["Chain Vest", "Giant's Belt"],
    },
    bank: null,
  });
  assert.equal(
    html.match(/class="nx-part"/g).length,
    2,
    "duas peças da receita",
  );
  assert.match(
    html,
    /data-state="missing" role="img" aria-label="Chain Vest: falta"/,
  );
  assert.match(html, /aria-label="Giant&#39;s Belt: falta"/);
  assert.match(
    html,
    /<small class="nx-note" data-tone="amber">falta 2<\/small>/,
  );
  assert.match(html, /role="group" aria-label="Receita de Sunfire Cape"/);
  // A peça é a imagem; o nome dela só para leitores de tela.
  assert.match(html, /<b class="sr">Cassiopeia<\/b>/);
  assert.ok(!/<b>Cassiopeia/.test(html), "campeão sem nome visível");
  // Item principal tracejado enquanto falta peça.
  assert.match(html, /pt pt-item is-dashed/);
  assert.equal(
    html.match(/<img /g).length,
    4,
    "campeão, item e duas peças, todos com imagem",
  );
});

test("linha 'Próximo item': pronto para montar mostra todas as peças no banco e o aviso de que monta", () => {
  const html = nextRow({
    unit,
    item: { id: SUN, name: "Sunfire Cape", missing: [] },
    bank: [VEST, BELT],
  });
  assert.equal(html.match(/data-state="bank"/g).length, 2);
  assert.match(html, /class="nx-note" data-tone="go">monta</);
  assert.match(html, /class="nx-item" data-complete="1"/);
  assert.ok(!html.includes("is-dashed"));
});

test("linha 'Próximo item': peça já equipada na campeã aparece como equipada", () => {
  const html = nextRow({
    unit,
    item: {
      id: SUN,
      name: "Sunfire Cape",
      missing: ["Giant's Belt"],
      missingIds: [BELT],
      usesHeld: VEST,
    },
  });
  assert.match(
    html,
    /data-state="equipped" role="img" aria-label="Chain Vest: já equipado na peça"/,
  );
  assert.match(
    html,
    /data-state="missing" role="img" aria-label="Giant&#39;s Belt: falta"/,
  );
});

test("linha 'Próximo item' de radiante: item principal, o base e as peças do base", () => {
  const html = nextRow({
    unit,
    item: {
      id: "DA_SunfireCape_Radiant",
      name: "Radiant Sunfire Cape",
      missing: [],
    },
    bank: [VEST],
  });
  assert.equal(
    html.match(/<img /g).length,
    5,
    "campeã, radiante, base e duas peças",
  );
  assert.match(html, /aria-label="Chain Vest: no banco"/);
  assert.match(html, /aria-label="Giant&#39;s Belt: falta"/);
  assert.match(plain(html), /= *=/, "radiante = base = peças");
});

test("linha 'Próximo item' sem receita não desenha componentes", () => {
  const html = nextRow({
    unit,
    item: { id: "DA_Artifact_Mittens", name: "Mittens", missing: [] },
  });
  assert.ok(!html.includes("nx-recipe") && !html.includes("nx-part"));
  assert.equal(html.match(/<img /g).length, 2);
});

test("modelo: a linha 'Próximo item' leva o item do servidor e o banco de itens lido", () => {
  const base = JSON.parse(
    readFileSync(new URL("../../live-mock-base.json", import.meta.url), "utf8"),
  );
  const state = structuredClone(base.state),
    rec = structuredClone(base.rec),
    plan = rec.recommendations[0];
  state.seen = {
    stage: "4-2",
    gold: 30,
    level: 8,
    xp: "10/68",
    items: [BELT],
  };
  rec.metadata.actionable = true;
  rec.self.health = 80;
  plan.stage = {
    ...plan.stage,
    board: [
      {
        id: unit.id,
        name: unit.name,
        status: "meta",
        slotsFree: 1,
        equipNow: [],
        nextItem: { id: SUN, name: "Sunfire Cape", missing: ["Chain Vest"] },
      },
    ],
  };
  const step = buildModel({ state, rec }).plan.steps.find(
    (s) => s.id === "next",
  );
  assert.ok(step, "etapa 'Próximo item'");
  assert.equal(step.rows[0].item.id, SUN);
  assert.deepEqual(step.rows[0].bank, [BELT]);
  assert.match(nextRow(step.rows[0]), /aria-label="Chain Vest: falta"/);
});
