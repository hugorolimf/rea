// Rodar com: node --test tft/helper/tests/core-augment-emblem.test.mjs
// M9: o emblema que um aprimoramento dá (e as sinergias/emblemas dos aprimoramentos escolhidos) mora em
// core/catalog/traits.mjs (`traitBook().augmentEmblem` e `.grants`). A cópia que ficava em server.mjs (e a transcrita no
// harness do golden) está aqui, sem mudança, como referência: o núcleo precisa dar o mesmo com o catálogo e a lista de
// aprimoramentos reais.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { traitBook } from "../core/catalog/traits.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) =>
  JSON.parse(readFileSync(path.join(root, file), "utf8"));
const catalog = readJson("catalog.json");
const augments = readJson("augments.json").augments ?? [];
const book = traitBook(catalog);

/* ---------- Referência: o código de antes da migração (server.mjs), copiado sem mudança ---------- */

function legacy(catalog) {
  const traitApiByName = new Map(
    catalog.traits.map((t) => [t.name, t.apiName]),
  );
  const traitNameByApi = new Map(
    catalog.traits.map((t) => [t.apiName, t.name]),
  );
  function augmentEmblem(a) {
    if (!a.id.startsWith("DA_")) return null;
    const named = /^(.+) (?:Crest|Crown|Circlet|Emblem)$/.exec(
        a.nameEn ?? "",
      )?.[1],
      given = /Recebe um Emblema de (.+?)[.,]/.exec(a.desc ?? "")?.[1],
      trait =
        traitApiByName.get(named) ??
        traitApiByName.get(given) ??
        (given && a.traits.length === 1 ? a.traits[0] : null),
      name = catalog.traits.find((t) => t.apiName === trait)?.name,
      item = name
        ? catalog.items.find(
            (i) =>
              i.name === `${name} Emblem` &&
              i.apiName.startsWith("DA_") &&
              !i.apiName.endsWith("Augment"),
          )?.apiName
        : null;
    return trait ? { trait, item: item ?? null } : null;
  }
  function options(chosen) {
    const emblemOf = new Map(chosen.map((a) => [a.id, augmentEmblem(a)])),
      traitsOfAug = (a) => [
        ...new Set([...a.traits, emblemOf.get(a.id)?.trait].filter(Boolean)),
      ];
    return {
      augmentTraits: [
        ...new Set(
          chosen.flatMap((a) =>
            traitsOfAug(a)
              .map((t) => traitNameByApi.get(t))
              .filter(Boolean),
          ),
        ),
      ],
      augmentTraitsById: Object.fromEntries(
        chosen.map((a) => [a.id, traitsOfAug(a)]),
      ),
      augmentEmblems: chosen
        .map((a) => emblemOf.get(a.id)?.item)
        .filter(Boolean),
      chosenTraits: chosen.map((a) =>
        a.traits.map((t) => traitNameByApi.get(t)).filter(Boolean),
      ),
    };
  }
  return { augmentEmblem, options };
}

/** Sorteio determinístico (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("apiName e nome de sinergia são únicos no catálogo (o primeiro vence tanto no núcleo quanto no código de antes)", () => {
  assert.equal(
    new Set(catalog.traits.map((t) => t.apiName)).size,
    catalog.traits.length,
  );
  assert.equal(
    new Set(catalog.traits.map((t) => t.name)).size,
    catalog.traits.length,
  );
});

test("augmentEmblem do núcleo = o de server.mjs, para todos os aprimoramentos reais", () => {
  const old = legacy(catalog);
  assert.ok(augments.length > 10, "augments.json vazio?");
  let withEmblem = 0;
  for (const a of augments) {
    const want = old.augmentEmblem(a);
    assert.deepEqual(book.augmentEmblem(a), want, a.id);
    if (want?.item) withEmblem++;
  }
  // Sanidade: a regra de fato acha emblemas (se o catálogo mudar e nenhum for achado, a equivalência acima não prova nada).
  assert.ok(withEmblem >= 2, `só ${withEmblem} aprimoramento(s) com emblema`);
});

test("grants() = as opções que o servidor montava, em ~600 conjuntos sorteados de aprimoramentos escolhidos", () => {
  const old = legacy(catalog),
    rand = rng(18),
    pool = augments.filter((a) => a.id.startsWith("DA_")),
    withEmblem = pool.filter((a) => old.augmentEmblem(a)),
    pickFrom = (list) => list[Math.floor(rand() * list.length)];
  assert.ok(withEmblem.length >= 2);
  for (let n = 0; n < 600; n++) {
    const size = Math.floor(rand() * 5),
      chosen = [],
      seen = new Set();
    // metade dos sorteios garante um aprimoramento com emblema, para exercitar `emblems` e `traits`.
    for (let k = 0; k < size; k++) {
      const a = pickFrom(k === 0 && n % 2 ? withEmblem : augments);
      if (!seen.has(a.id)) {
        seen.add(a.id);
        chosen.push(a);
      }
    }
    const want = old.options(chosen),
      got = book.grants(chosen);
    assert.deepEqual(got.traits, want.augmentTraits);
    assert.deepEqual(got.traitsById, want.augmentTraitsById);
    assert.deepEqual(got.emblems, want.augmentEmblems);
    assert.deepEqual(
      chosen.map((a) => a.traits.map((t) => book.nameOf(t)).filter(Boolean)),
      want.chosenTraits,
    );
  }
});

test("casos da regra: id antigo, nome em inglês, texto em português, sinergia única e item sem emblema", () => {
  const trait = catalog.traits.find((t) =>
      catalog.items.some(
        (i) =>
          i.name === `${t.name} Emblem` &&
          i.apiName.startsWith("DA_") &&
          !i.apiName.endsWith("Augment"),
      ),
    ),
    emblem = catalog.items.find(
      (i) =>
        i.name === `${trait.name} Emblem` &&
        i.apiName.startsWith("DA_") &&
        !i.apiName.endsWith("Augment"),
    ),
    aug = (over) => ({
      id: "DA_Test",
      name: "x",
      nameEn: "",
      desc: "",
      traits: [],
      ...over,
    });
  // Aprimoramento de set antigo (id sem DA_): nunca dá emblema, mesmo com o nome certo.
  assert.equal(
    book.augmentEmblem(aug({ id: "TFT9_Aug", nameEn: `${trait.name} Crest` })),
    null,
  );
  // Pelo nome em inglês, com qualquer dos quatro sufixos.
  for (const suffix of ["Crest", "Crown", "Circlet", "Emblem"])
    assert.deepEqual(
      book.augmentEmblem(aug({ nameEn: `${trait.name} ${suffix}` })),
      { trait: trait.apiName, item: emblem.apiName },
      suffix,
    );
  // Pelo texto.
  assert.deepEqual(
    book.augmentEmblem(aug({ desc: `Recebe um Emblema de ${trait.name}.` })),
    { trait: trait.apiName, item: emblem.apiName },
  );
  // Texto com nome que não é do set: vale a única sinergia listada; com duas, não vale nenhuma.
  const other = catalog.traits.find((t) => t !== trait);
  assert.deepEqual(
    book.augmentEmblem(
      aug({ desc: "Recebe um Emblema de Nada.", traits: [other.apiName] }),
    ),
    {
      trait: other.apiName,
      item:
        catalog.items.find(
          (i) =>
            i.name === `${other.name} Emblem` &&
            i.apiName.startsWith("DA_") &&
            !i.apiName.endsWith("Augment"),
        )?.apiName ?? null,
    },
  );
  assert.equal(
    book.augmentEmblem(
      aug({
        desc: "Recebe um Emblema de Nada.",
        traits: [trait.apiName, other.apiName],
      }),
    ),
    null,
  );
  // Sem nada que lembre emblema.
  assert.equal(
    book.augmentEmblem(aug({ nameEn: "Outra coisa", traits: [trait.apiName] })),
    null,
  );
  // O item "…Augment" (mesmo nome, id do próprio aprimoramento) nunca é o emblema.
  const fake = {
    ...catalog,
    items: [
      { apiName: "DA_Item_ZZZ_Augment", name: `${trait.name} Emblem` },
      ...catalog.items.filter((i) => i.name !== `${trait.name} Emblem`),
    ],
  };
  assert.deepEqual(
    traitBook(fake).augmentEmblem(aug({ nameEn: `${trait.name} Crest` })),
    { trait: trait.apiName, item: null },
  );
});

test("grants(): a sinergia do emblema entra nas do aprimoramento sem repetir, na ordem do aprimoramento", () => {
  const trait = catalog.traits[0],
    other = catalog.traits[1],
    aug = {
      id: "DA_Test",
      name: "Teste",
      nameEn: `${trait.name} Crest`,
      desc: "",
      traits: [other.apiName, trait.apiName],
    };
  const g = book.grants([aug]);
  assert.deepEqual(g.traitsOf(aug), [other.apiName, trait.apiName]);
  assert.deepEqual(g.traits, [other.name, trait.name]);
  assert.deepEqual(g.traitsById, {
    DA_Test: [other.apiName, trait.apiName],
  });
  const none = book.grants([]);
  assert.deepEqual(none.traits, []);
  assert.deepEqual(none.traitsById, {});
  assert.deepEqual(none.emblems, []);
  assert.equal(none.emblemOf.size, 0);
});

test("servidor e harness do golden usam a regra do núcleo e não têm mais a cópia", () => {
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  // Desde o M8b o emblema de aprimoramento é o fato `traits.grants` (app/recommend-facts.mjs), que chama a regra do
  // núcleo; o pipeline do servidor (app/recommend.mjs) e o harness do golden consomem esse mesmo grafo de fatos.
  assert.match(
    read("app/recommend-facts.mjs"),
    /\.grants\(chosen\)/,
    "app/recommend-facts.mjs: o fato traits.grants não chama grants()",
  );
  for (const file of ["app/recommend.mjs", "tests/golden/harness.mjs"])
    assert.match(
      read(file),
      /recommend-facts\.mjs/,
      `${file}: não consome os fatos (traits.grants) de app/recommend-facts.mjs`,
    );
  for (const file of [
    "server.mjs",
    "app/recommend.mjs",
    "app/recommend-facts.mjs",
    "tests/golden/harness.mjs",
  ]) {
    const text = read(file);
    assert.ok(
      !/Crest\|Crown\|Circlet/.test(text),
      `${file}: ainda tem a regra`,
    );
    assert.ok(
      !/function augmentEmblem\b/.test(text),
      `${file}: ainda define augmentEmblem`,
    );
  }
});
