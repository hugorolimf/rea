// Testes de arquitetura em modo CATRACA (M1 da migração, ver ARQUITETURA.md seções 2.2 e 3.3).
//
// A regra de ouro é "uma regra, um lugar": toda regra do jogo mora em `core/`. Enquanto o núcleo não existe, a regra mora
// onde está hoje e cada duplicação já verificada (mapa D1..D14 e as ~9 implementações de posse de itens) entra como EXCEÇÃO
// numerada em BASELINE, com o motivo. A catraca gira num sentido só:
//   - cópia nova, ou mais ocorrências numa exceção existente  -> o teste FALHA (use a regra no dono, não copie);
//   - menos ocorrências do que a exceção diz                  -> o teste FALHA pedindo para baixar o número (a melhora
//     fica registrada e não pode voltar).
// `ARCH_REPORT=1 node --test tests/architecture.test.mjs` imprime a contagem atual por regra e arquivo (para atualizar o
// BASELINE ao baixar uma exceção e para o relatório de progresso).
//
// Os passos M2..M9 apagam exceções à medida que movem a regra para `core/`; nenhum passo pode aumentar uma.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  importsOf,
  listSources,
  read,
  resolveImport,
  root,
  stripNonCode,
} from "./architecture/scan.mjs";
import { defineFact } from "../core/graph/index.mjs";
import { analyze } from "../engine.mjs";
import { baseOptions, compsBaseFact } from "../app/recommend-facts.mjs";
import { loadContext, loadSnapshots, runScenario } from "./golden/harness.mjs";
import { scenarios } from "./golden/scenarios.mjs";

const REPORT = process.env.ARCH_REPORT === "1";
const ALL = listSources();

/** Código de teste, ferramentas offline e fixtures: não são o produto, ficam fora das regras. */
const isSupport = (f) =>
  f.endsWith(".test.mjs") ||
  f.startsWith("tests/") ||
  f.startsWith("scripts/") ||
  f === "v2/js/catalog-fixture.mjs" ||
  /^(build-.*|download-assets|bench-candidates)\.mjs$/.test(f);
const PRODUCT = ALL.filter((f) => !isSupport(f));
const inCore = (f) => f.startsWith("core/");

/* ---------- Leitura estática: o próprio leitor precisa estar certo ---------- */

test("leitor estático: comentários, textos, templates e regex", () => {
  const src = [
    'const a = "x // y"; // comentário',
    'const r = /["\']/g.test(s); `t ${a + "q"} z`; /* bloco */ foo(/a\\/b/);',
    "const d = 10 / 2 / 5;",
  ].join("\n");
  const code = stripNonCode(src);
  assert.equal(code.length, src.length);
  assert.ok(!code.includes("comentário"));
  assert.ok(!code.includes("bloco"));
  assert.ok(!code.includes("x // y"));
  assert.ok(code.includes("a + "), "o código dentro de ${} continua visível");
  assert.ok(code.includes("10 / 2 / 5"), "divisão não é regex");
  const strings = stripNonCode(src, { keepStrings: true });
  assert.ok(strings.includes("x // y") && strings.includes("t ${a"));
  assert.ok(!strings.includes("comentário"));
});

test("leitor estático: acha imports estáticos, multilinha e dinâmicos", () => {
  const tmp = path.join(root, "tests", "architecture", "__probe.mjs");
  fs.writeFileSync(
    tmp,
    [
      'import a from "./x.mjs";',
      "import {",
      "  b,",
      "  c,",
      '} from "../y.mjs";',
      'export { d } from "./z.mjs";',
      '// import e from "./comentado.mjs";',
      'import "./efeito.mjs";',
      'const f = await import("./dinamico.mjs");',
    ].join("\n"),
  );
  try {
    assert.deepEqual(importsOf("tests/architecture/__probe.mjs"), [
      "./x.mjs",
      "../y.mjs",
      "./z.mjs",
      "./efeito.mjs",
      "./dinamico.mjs",
    ]);
  } finally {
    fs.unlinkSync(tmp);
  }
});

/* ---------- T1: direção dos imports ---------- */

/** Exceções de T1 (arquivo importador -> alvo). Só encolhe. */
const T1_EXCEPTIONS = {
  // Vazia desde o M6: a posse de itens mora em core/items/ (os traços saíram em M3: core/catalog/traits.mjs) e
  // v2/js/item-source.js é só um reexport fino para quem importava daqui.
};

function importEdges() {
  const edges = [];
  for (const f of PRODUCT)
    for (const spec of importsOf(f))
      edges.push({ from: f, spec, to: resolveImport(f, spec) });
  return edges;
}

test("T1: o núcleo só importa do núcleo; v2/ e servidor respeitam as camadas (exceções só encolhem)", () => {
  const found = new Map();
  const add = (key, why) => found.set(key, why);
  for (const { from, spec, to } of importEdges()) {
    const key = `${from} -> ${to ?? spec}`;
    // core/ só importa de core/ (sem node:*, sem pacotes, sem v2/, sem servidor).
    if (inCore(from) && !(to && inCore(to)))
      add(key, "core/ importa de fora de core/");
    // facts/ não importa engines/; sources/ e server.mjs não importam v2/ (coberto abaixo para todos).
    if (from.startsWith("core/facts/") && to?.startsWith("core/engines/"))
      add(key, "facts/ importa engines/");
    // Fora de v2/ (e do teste) ninguém importa v2/. Exceção de camada: a página do HUD do overlay (overlay/hud/) é um
    // cliente de navegador do mesmo servidor e importa a apresentação da interface (/v2/js/*) por caminho absoluto.
    const overlayPage = from.startsWith("overlay/hud/");
    if (!from.startsWith("v2/") && !overlayPage && to?.startsWith("v2/"))
      add(key, "importa v2/");
    // O navegador (v2/, live-mock.js e a página do overlay) não importa o servidor nem node:* (só /core, /rules.mjs, /economy.mjs).
    const browser =
      from.startsWith("v2/") || from === "live-mock.js" || overlayPage;
    if (browser && spec.startsWith("node:"))
      add(key, "navegador importa node:*");
    // Único caminho relativo permitido para fora de v2/: o núcleo. O servidor serve /core/* ao lado de /v2/*, então
    // "../../core/x.mjs" a partir de /v2/js/ resolve para /core/x.mjs no navegador e para o arquivo no Node (testes).
    if (
      from.startsWith("v2/") &&
      to &&
      !to.startsWith("v2/") &&
      !inCore(to) &&
      !spec.startsWith("/")
    )
      add(key, "v2/ importa fora de v2/ por caminho relativo");
    if (
      browser &&
      spec.startsWith("/") &&
      !(overlayPage && spec.startsWith("/v2/js/")) &&
      !/^\/(core\/|rules\.mjs$|economy\.mjs$)/.test(spec)
    )
      add(key, "navegador importa caminho absoluto não servido pelo servidor");
  }
  const wrong = [...found.keys()].filter((k) => !(k in T1_EXCEPTIONS));
  const stale = Object.keys(T1_EXCEPTIONS).filter((k) => !found.has(k));
  assert.deepEqual(
    wrong.map((k) => `${k}  (${found.get(k)})`),
    [],
    "import fora das camadas: mova a regra para core/ ou importe da camada certa (não acrescente exceção).",
  );
  assert.deepEqual(
    stale,
    [],
    "exceção de T1 que não existe mais: apague-a de T1_EXCEPTIONS (a catraca só gira num sentido).",
  );
});

test("T1: o grafo de imports do produto não tem ciclos e ninguém importa server.mjs", () => {
  const graph = new Map(PRODUCT.map((f) => [f, []]));
  for (const { from, to } of importEdges())
    if (to && graph.has(to)) graph.get(from).push(to);
  const cycles = [],
    state = new Map(),
    stack = [];
  const visit = (n) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of graph.get(n)) {
      if (state.get(m) === 1)
        cycles.push([...stack.slice(stack.indexOf(m)), m].join(" -> "));
      else if (!state.has(m)) visit(m);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of graph.keys()) if (!state.has(n)) visit(n);
  assert.deepEqual(cycles, []);
  const importers = [...graph]
    .filter(([, to]) => to.includes("server.mjs"))
    .map(([f]) => f);
  assert.deepEqual(importers, [], "server.mjs é transporte: nada importa dele");
});

/* ---------- T2: padrões que só o dono da regra pode ter ---------- */

/**
 * Cada regra descreve UMA coisa que só o dono deve fazer. `owner` é onde ela passa a morar; os arquivos de `core/` nunca
 * contam. `baseline` é o estado verificado hoje: arquivo -> [ocorrências, motivo/referência ao mapa].
 * `view`: "code" ignora comentários e textos; "strings" ignora só comentários (nomes de itens em strings e regex).
 * `unit`: "matches" conta cada ocorrência; "lines" conta linhas com ocorrência.
 */
const RULES = [
  {
    id: "radiant-base-id",
    covers: "D10 / 1.2-a",
    what: "id do item base de um radiante (replace /_?Radiant$/)",
    owner: "core/catalog/items.mjs",
    view: "strings",
    pattern: /_\?Radiant\$/g,
    // M6: 2 -> 0 (comp-items.js e item-source.js leem baseItemId de core/catalog/items.mjs).
    baseline: {},
  },
  {
    id: "component-id-literal",
    covers: "D2 / 1.2-a",
    what: "ids de componentes escritos à mão (DA_Component_*) fora do catálogo de itens",
    owner: "core/catalog/items.mjs",
    view: "strings",
    pattern: /DA_Component_/g,
    // M6: item-holdings, item-plan e item-source saíram (isComponent / isEmblemTool de core/catalog/items.mjs).
    baseline: {
      "live-mock.js": [
        4,
        "o mock reimplementa o servidor (ajustar depois de M5)",
      ],
    },
  },
  {
    id: "item-class-regex",
    covers: "D2 / D9",
    what: "classe/papel de item por nome (Rabadon|InfinityEdge|Warmog|...) fora do catálogo",
    owner: "core/catalog/items.mjs",
    view: "strings",
    unit: "lines",
    pattern:
      /Rabadon|InfinityEdge|Warmog|Gargoyle|Bloodthirster|SpiritVisage|Archangel|Shojin|Deathblade/g,
    baseline: {
      "engine.mjs": [
        3,
        "ameaça do lobby (armorCount/mrCount e cura): conjunto de itens por efeito, fato lobby.threat (passo próprio; mrCount diverge do plano, D15)",
      ],
      "live-mock.js": [
        12,
        "mock com os próprios papéis de item (ajustar depois de M5)",
      ],
      "tactics.mjs": [
        14,
        "4 regex da ameaça do lobby (lobby.threat, D15) + 10 add() da tabela de pontos por item da build (política da build: não muda)",
      ],
    },
  },
  {
    id: "item-consumable-regex",
    covers: "D2 / 1.2-a",
    what: "regex de consumível (Consumable_|Reforger|Potion|...) fora do catálogo de itens",
    owner: "core/catalog/items.mjs",
    view: "strings",
    unit: "lines",
    pattern: /Consumable_|Reforger|Potion|Booster|Masterwork|LuckyItemChest/g,
    baseline: {},
  },
  {
    id: "item-coverage-regex",
    covers: "D2",
    what: "regex de cobertura de item (VoidStaff -> shredMagic, LastWhisper -> shredArmor, Sunfire/Morello/RedBuff -> wounds) fora do catálogo",
    owner: "core/catalog/items.mjs",
    view: "strings",
    unit: "lines",
    pattern:
      /\/[^/\n]*(?:VoidStaff|LastWhisper|SunfireCape|Morellonomicon)[^/\n]*\//g,
    baseline: {},
  },
  {
    id: "item-special-regex",
    covers: "D2",
    what: "regex de item especial (Emblem, ThiefsGloves, BlueBuff|SpearOfShojin) fora do catálogo",
    owner: "core/catalog/items.mjs",
    view: "strings",
    unit: "lines",
    pattern:
      /\/[^/\n]*(?:Emblem|ThiefsGloves|BlueBuff\|SpearOfShojin)[^/\n]*\//g,
    baseline: {},
  },
  {
    id: "item-recipe-length",
    covers: "D2",
    what: "receita montável (composition.length === 2) escrita à mão fora do catálogo de itens",
    owner: "core/catalog/items.mjs",
    view: "code",
    pattern: /composition\??\.length(?:\s*\?\?\s*0\))?\s*===?\s*2/g,
    // M6: 3 -> 0 (comp-items.js usa recipeOf; tactics.mjs, que escrevia `(... ?? 0) === 2`, também).
    baseline: {},
  },
  {
    id: "champion-role-heuristic",
    covers: "D9",
    what: "heurística de papel do campeão pela habilidade (physical damage / magic damage) fora do catálogo",
    owner: "core/catalog/champions.mjs",
    view: "strings",
    pattern: /physical damage/g,
    baseline: {},
  },
  {
    id: "avatar-trait-test",
    covers: "1.2-e",
    what: 'teste de Avatar (traits.includes("Avatar")) fora do catálogo de campeões',
    owner: "core/catalog/champions.mjs",
    view: "strings",
    pattern: /includes\("Avatar"\)/g,
    baseline: {},
  },
  {
    id: "star-copies",
    covers: "D10 / 1.2-e",
    what: "cópias <-> estrela (3 ** (estrela - 1)) fora do dono (core/pool/copies.mjs: starCopies/starsForCopies)",
    owner: "core/pool/copies.mjs",
    view: "code",
    pattern: /\b3\s*\*\*\s*[\w(]/g,
    // M4: 11 -> 0 (engine 4, economy 2, contest, pool-tracker, tactics, unit-ledger, model.js leem starCopies).
    baseline: {},
  },
  {
    id: "stars-from-copies-literal",
    covers: "D10 / 1.2-e",
    what: "estrela a partir das cópias com limiares escritos (copies >= 9 ? 3 : copies >= 3 ? 2 ...)",
    owner: "core/pool/copies.mjs",
    view: "code",
    pattern: /\bcopies\s*>=\s*9\b/g,
    baseline: {},
  },
  {
    id: "pool-free-rounding",
    covers: "D3",
    what: "pool livre arredondada para inteiro (Math.round sobre remainingLikely/likelyFree): a pool livre é fracionária",
    owner: "core/pool/copies.mjs",
    view: "code",
    pattern: /Math\.round\([^)\n]*(?:remainingLikely|likelyFree|\.free\b)/g,
    baseline: {},
  },
  {
    id: "might-formula",
    covers: "D10 / 1.2-k",
    what: "tabela de força por estrela redeclarada (const STAR)",
    owner: "core/facts/force.mjs",
    view: "code",
    pattern: /\bconst\s+STAR\b/g,
    baseline: {
      "roll.mjs": [
        1,
        "STAR = POLICY.star: reusa a tabela mas a redeclara (M5)",
      ],
      "tactics.mjs": [1, "STAR redeclarado com [0, 1, 1.8, 3.2] (M5)"],
    },
  },
  {
    id: "odds-index",
    covers: "D3 / 1.2-d",
    what: "acesso direto a ODDS[nível][custo]",
    owner: "core/pool/shop.mjs",
    view: "code",
    pattern: /\bODDS\s*\[/g,
    // M4: 11 -> 0 (economy 2, engine 5, roll, stage 2, strategy leem levelOdds/oddsAt/isBuyable de core/pool).
    baseline: {},
  },
  {
    id: "per-shop-chance",
    covers: "D3",
    what: "chance por loja recalculada (1 - (1 - p) ** 5)",
    owner: "core/pool/shop.mjs",
    view: "code",
    pattern: /\)\s*\*\*\s*5\b/g,
    // M4: engine 2 -> 0 (shopChance de core/pool; a rolagem usa a mesma chance por slot).
    baseline: {
      "live-mock.js": [
        1,
        "o mock reimplementa o servidor (ajustar depois de M5)",
      ],
    },
  },
  {
    id: "buyable-odds-literal",
    covers: "D3 / 1.2-d",
    what: "limite 'comprável no nível' (10 %) escrito como literal",
    owner: "core/pool/tables.mjs",
    view: "code",
    unit: "lines",
    pattern: /ODDS[^\n]*>=\s*10\b|\bMIN_ODDS\s*=\s*\d+/g,
    // M4: engine 3 + stage 1 -> 0 (BUYABLE_ODDS / isBuyable de core/pool).
    baseline: {},
  },
  {
    id: "shop-slots-literal",
    covers: "D3 / 1.2-d",
    what: "número de slots da loja como literal (5 * lojas): use SHOP.slots / shopChance / slotsIn",
    owner: "core/pool/shop.mjs",
    view: "code",
    pattern:
      /\b5\s*\*\s*(?:shops|rollBudget)\b|\b(?:shops|rollBudget)\s*\*\s*5\b/g,
    baseline: {},
  },
  {
    id: "interest-constants",
    covers: "1.2-b / D4",
    what: "juros (interestStep/interestMax/INTEREST_*) fora do dono da economia",
    owner: "core/economy/gold.mjs",
    view: "code",
    pattern: /\binterestStep\b|\binterestMax\b|\bINTEREST_(?:STEP|CAP)\b/g,
    // M5b: economy 8, engine 2, rules 2, model.js 2, hud.js 9 -> 0 (interestOf/maxInterestGold/interestTiers de core/economy).
    baseline: {},
  },
  {
    id: "income-table-read",
    covers: "1.2-b / D4 (M5b)",
    what: "tabela de renda (INCOME.base/interestStep/streakGold) lida fora do dono: chame incomeOf, interestOf, streakGold",
    owner: "core/economy/gold.mjs",
    view: "code",
    pattern: /\bINCOME\s*\.|\bbaseIncome\b/g,
    baseline: {},
  },
  {
    id: "gold-literal-threshold",
    covers: "D4 / D14 / 1.2-b",
    what: "limiar de ouro escrito como literal (gold >= 50, gold < 30, ...)",
    owner: "core/economy/policy.mjs + core/economy/gold.mjs",
    view: "code",
    pattern: /\b(?:gold|goldNow)\s*(?:>=|<=|>|<)\s*[1-9]\d*/g,
    // M5b: live-mock 1, strategy 1, target-level 2 -> 0 (maxInterestGold / POLICY.floor.*). Só sobra a validação de entrada.
    baseline: {
      "app/recommend.mjs": [
        1,
        "validação de entrada (gold > 999): legítimo, vira validação do contrato (M7); mudou de server.mjs para app/recommend.mjs no M10b",
      ],
    },
  },
  {
    id: "gold-keep-literal",
    covers: "D4 (M5b)",
    what: "ouro que sobra depois de subir de nível ou rolar escrito como literal (cash - levelCost >= 30, Math.min(floor, 30), spare >= 6, nextTier(...) ?? 50)",
    owner:
      "core/economy/policy.mjs (POLICY.floor.*, POLICY.weakLobbySpare, maxInterestGold)",
    view: "code",
    pattern:
      /\blevelCost\s*>=\s*[1-9]\d*|Math\.min\(\s*floor\s*,\s*[1-9]\d*\s*\)|\bspare\s*(?:>=|>)\s*[1-9]\d*|\bnextTier\([^)]*\)\s*\?\?\s*[1-9]\d*/g,
    baseline: {},
  },
  {
    id: "hp-literal-threshold",
    covers: "D4 / 1.2-i",
    what: "limiar de vida escrito como literal (hp <= 35, health <= 45, ...) fora da política",
    owner: "core/economy/policy.mjs",
    view: "code",
    pattern: /\b(?:hp|health)\s*(?:>=|<=|>|<)\s*[1-9]\d*/g,
    // M5b: augment-advice 3, economy 1, streak 1, target-level 5, hud.js 1 -> 0 (POLICY.hp.*, POLICY.trend.*, HP.max).
    baseline: {},
  },
  {
    id: "trait-breakpoints",
    covers: "D7 / 1.2-f",
    what: "patamares de traço lidos do catálogo (minUnits) fora da regra de traços",
    owner: "core/catalog/traits.mjs",
    view: "code",
    pattern: /\bminUnits\b/g,
    baseline: {},
  },
  {
    id: "trait-solo-rule",
    covers: "D7 / 1.2-f",
    what: "regra de traço solo ('Only active while fielding 1') fora da regra de traços",
    owner: "core/catalog/traits.mjs",
    view: "strings",
    pattern: /Only active while fielding/g,
    baseline: {},
  },
  {
    id: "trait-count-loop",
    covers: "D7 / 1.2-f",
    what: "laço que conta sinergias (counts[t] = (counts[t] ?? 0) + 1) fora da regra de traços",
    owner: "core/catalog/traits.mjs",
    view: "code",
    pattern: /\(\s*counts?(?:\[t\]|\.get\(t\))\s*\?\?\s*0\s*\)\s*\+\s*1/g,
    baseline: {},
  },
  {
    id: "emblem-trait-rule",
    covers: "D7 / 1.2-f",
    what: "mapa de emblema -> sinergia e soma de emblema (traitsWithEmblems/emblemTraitMap) fora da regra de traços",
    owner: "core/catalog/traits.mjs",
    view: "code",
    pattern: /\btraitsWithEmblems\b|\bemblemTraitMap\b/g,
    baseline: {
      "v2/js/traits.js": [
        2,
        "reexport fino de core/catalog/traits.mjs (fica: back-compat do front e dos testes)",
      ],
    },
  },
  {
    id: "trait-first-breakpoint",
    covers: "D7 / 1.2-f",
    what: "primeiro patamar de uma sinergia (Math.min(...(patamares?.length ? patamares : [2]))) fora da regra de traços",
    owner: "core/catalog/traits.mjs",
    view: "code",
    pattern: /Math\.min\(\s*\.\.\.\(\s*\w+\.get\(\w+\)\?\.length/g,
    baseline: {},
  },
  {
    id: "emblem-name-parse",
    covers: "D7 / 1.2-f",
    what: "sinergia de um emblema lida do nome do item (/ Emblem$/) fora da regra de traços",
    owner: "core/catalog/traits.mjs",
    view: "strings",
    pattern: /\/ Emblem\$\//g,
    baseline: {},
  },
  {
    id: "augment-emblem-rule",
    covers: "M9 / D7",
    what: "emblema que um aprimoramento dá (nome 'X Crest/Crown/Circlet/Emblem' ou texto 'Recebe um Emblema de X') lido fora da regra de traços",
    owner: "core/catalog/traits.mjs",
    view: "strings",
    pattern: /Crest\|Crown\|Circlet/g,
    baseline: {},
  },
  {
    id: "stage-round-parse",
    covers: "D10 / 1.2-c",
    what: "parse de estágio 'S-R' (/^(\\d)-(\\d)$/) fora do relógio de rodada",
    owner: "core/state/clock.mjs",
    view: "strings",
    pattern: /\^\(\\d\+?\)-\(\\d\+?\)\$/g,
    baseline: {
      "live-mock.js": [
        1,
        "o mock reimplementa o servidor (ajustar depois de M5)",
      ],
      "plan-progress.mjs": [1, "rank da rodada (M5)"],
      "streak.mjs": [1, "parse próprio do estágio (M5)"],
      "v2/js/model.js": [1, "parseStage do cliente (M5)"],
    },
  },
  {
    id: "augment-round-track",
    covers: "D10 / 1.2-c",
    what: "trilha de rodadas de aprimoramento (2-1, 3-2, 4-2) repetida",
    owner: "core/rules/game.mjs",
    view: "strings",
    pattern: /["']2-1["'][^"'\n]{0,24}["']3-2["']/g,
    baseline: {
      "augment-advice.mjs": [1, "{2:'2-1',3:'3-2',4:'4-2'} (M5)"],
      "plan-progress.mjs": [1, "AUGMENT_ROUNDS (M5)"],
      "v2/js/augs.js": [1, "AUG_STAGES (M5)"],
    },
  },
  {
    id: "curve-level-fallback",
    covers: "1.2-c",
    what: "nível esperado sem estágio escrito no motor (level >= 8 ? 5 : ...)",
    owner: "core/facts/economy.mjs",
    view: "code",
    pattern: /level\s*>=\s*8\s*\?\s*5/g,
    baseline: {
      "engine.mjs": [
        1,
        "fallback de rodadas; economy.POLICY.curve já descreve a curva (M5)",
      ],
    },
  },
  {
    id: "gold-default",
    covers: "D14",
    what: "ouro não lido tratado como 30 g (gold ?? 30)",
    owner: "core/economy/gold.mjs (shopsAhead + POLICY.shopsAhead.assumedGold)",
    view: "code",
    pattern: /\bgold\s*\?\?\s*30\b/g,
    // M5b: engine 1 -> 0. A suposição de 30 g (D14) continua, mas como POLICY.shopsAhead.assumedGold, num lugar só.
    baseline: {},
  },
  {
    id: "item-stock-consumption",
    covers: "D8 / 1.2-a",
    what: "estoque de itens consumido localmente (indexOf/findIndex + splice sobre estoque/banco/peças)",
    owner: "core/items/stock.mjs",
    view: "code",
    // Idioma 'tira uma cópia do estoque': splice sobre uma lista de itens até 2 linhas depois de indexOf/findIndex.
    scan(code) {
      const lines = code.split("\n"),
        hits = [];
      lines.forEach((line, i) => {
        if (
          !/\b(?:stock|stockAll|bank|bankLeft|held|heldLeft|loose|left|parts|check|rest|probe|owned|remaining|inventory|missingIds|missingNames|items|list)\.splice\(/.test(
            line,
          )
        )
          return;
        const window = lines.slice(Math.max(0, i - 2), i + 1).join(" ");
        if (/\.indexOf\(|\.findIndex\(/.test(window)) hits.push(i + 1);
      });
      return hits;
    },
    // M6: 21 -> 0 (carousel 2, engine 2, item-edge 2, item-holdings 1, tactics 6, comp-items 5, item-source 1, next-item 2):
    // gastar uma cópia é takeOne/takeItem/takeAll/spend de core/items/stock.mjs.
    baseline: {},
  },
  {
    id: "item-holdings-reimplemented",
    covers: "D8 / 1.2-a",
    what: "a regra de posse de itens (locateItem, ownersOf, classifyHoldings, spendBank*) definida fora do dono",
    owner: "core/items/holdings.mjs",
    view: "code",
    pattern:
      /\b(?:function|const)\s+(?:locateItem|ownersOf|classifyHoldings|buildStates|spendBankOnBuilds|spendBankHalves|movedInto|movesInto)\b/g,
    baseline: {},
  },
  {
    id: "server-option-assembly",
    covers: "D12",
    what: "regra de negócio montada no transporte (atribuições a options.X fora de app/recommend.mjs)",
    owner: "app/recommend.mjs",
    view: "code",
    pattern: /\boptions\.[A-Za-z]+\s*=(?!=)/g,
    baseline: {
      "app/recommend.mjs": [
        17,
        "o pipeline (ex-POST /api/recommend, movido para app/recommend.mjs no M10b) ainda monta ~17 campos de options (entrada do usuário, estado, sticky, hidden, nível-alvo) que viram as entradas do grafo; sai em M9 (M7 tirou 6: loja, oferta, XP, removedores e estágio; M8b tirou 16: tudo o que era só da base ou da tática virou entrada declarada dos fatos)",
      ],
    },
  },
  {
    id: "unbounded-memo-maps",
    covers: "D11",
    what: "cache próprio por módulo (new Map de cache/SIMS/pending) em vez do grafo memoizado",
    owner: "core/graph/ (createGraph + defineFact)",
    view: "code",
    pattern:
      /\b(?:\w*[cC]ache\w*|SIMS|pending\w*|rankedCache|wantsCache)\s*=\s*new Map\(/g,
    baseline: {
      "engine.mjs": [
        2,
        "roleCache/termCache: memos DENTRO de uma chamada de analyze (nascem e morrem com ela: não há chave a invalidar); somem quando analyze for dividido em fatos (M9)",
      ],
      "evidence.mjs": [
        1,
        "cache do explorer: E/S real, fica em sources/ (não migra)",
      ],
      "item-value.mjs": [
        3,
        "cache/rankedCache/wantsCache: memos por chamada da tabela de valor dos itens (M9, junto com o motor de itens)",
      ],
    },
  },
  {
    id: "manual-memo-key",
    covers: "D1 / D11 (M8a)",
    what: "consulta a cache por chave montada à mão (cache.get(chave), SIMS.get(JSON.stringify(...))) fora de core/graph",
    owner:
      "core/graph/ (createGraph + defineFact: a chave sai das entradas declaradas)",
    view: "code",
    pattern:
      /\b(?:\w*[cC]ache\w*|SIMS|pending\w*|\w*[mM]emo\w*)\.(?:get|has)\(\s*(?:\w*[kK]ey\w*|JSON\.stringify|\w*Inputs\b)/g,
    baseline: {
      "engine.mjs": [
        1,
        "planMemo.get(memoKey): memo do plano de itens DENTRO de analyze (por tabuleiro candidato; as passadas de evidência repetem as mesmas entradas). Só vira fato quando analyze for dividido (M9)",
      ],
    },
  },
  {
    id: "base-cache-resurrection",
    covers: "D1 / D11 (M8b)",
    what: "cache da base ou da análise com chave montada à mão (analysisCache, baseAnalysisCache, pendingBase, baseInputs, baseKey, analysis-keys.mjs)",
    owner:
      "core/graph/ (os fatos comps.base e seguintes, em app/recommend-facts.mjs)",
    view: "strings",
    pattern:
      /\b(?:analysisCache|baseAnalysisCache|pendingBase|baseInputs|baseKey)\b|analysis-keys/g,
    baseline: {},
  },
  {
    id: "analysis-key-rule",
    covers: "M10b",
    what: "a chave de análise (janela de renovação Math.floor(agora / REFRESH_WINDOW_MS)) calculada fora do dono",
    owner:
      "core/state/analysis-key.mjs (cliente e servidor importam a mesma analysisKey)",
    view: "code",
    pattern: /Math\.floor\(\s*[\w.()]+\s*\/\s*REFRESH_WINDOW_MS\s*\)/g,
    baseline: {},
  },
];

function inspect(rule, rel) {
  const raw = read(rel);
  const code = stripNonCode(raw, { keepStrings: rule.view === "strings" });
  if (rule.scan) return rule.scan(code, raw);
  const lines = [];
  for (const m of code.matchAll(rule.pattern)) {
    const line = code.slice(0, m.index).split("\n").length;
    lines.push(line);
  }
  return rule.unit === "lines" ? [...new Set(lines)] : lines;
}

const counts = new Map();
for (const rule of RULES) {
  const per = {};
  for (const f of PRODUCT) {
    if (inCore(f)) continue;
    const hits = inspect(rule, f);
    if (hits.length) per[f] = hits;
  }
  counts.set(rule.id, per);
}

if (REPORT) {
  const lines = [];
  for (const rule of RULES) {
    const per = counts.get(rule.id),
      total = Object.values(per).reduce((n, l) => n + l.length, 0);
    lines.push(
      `${rule.id.padEnd(26)} total ${String(total).padStart(3)}  ${Object.entries(
        per,
      )
        .map(([f, l]) => `${f}:${l.length}`)
        .join("  ")}`,
    );
  }
  console.log(lines.join("\n"));
}

for (const rule of RULES)
  test(`T2 ${rule.id} (${rule.covers}): só ${rule.owner} implementa "${rule.what}"`, () => {
    const per = counts.get(rule.id),
      problems = [];
    for (const [file, hits] of Object.entries(per)) {
      const allowed = rule.baseline[file]?.[0] ?? 0;
      if (hits.length > allowed)
        problems.push(
          `${file}: ${hits.length} ocorrência(s) (exceção: ${allowed}) nas linhas ${hits.join(", ")}. ` +
            `Esta regra mora em ${rule.owner}; chame-a em vez de reimplementar.`,
        );
    }
    for (const [file, [allowed]] of Object.entries(rule.baseline)) {
      const have = per[file]?.length ?? 0;
      if (have < allowed)
        problems.push(
          `${file}: caiu de ${allowed} para ${have}. A catraca girou: baixe a exceção em BASELINE (${rule.id}) para ${have}${have ? "" : " (apague a linha)"}.`,
        );
    }
    assert.deepEqual(problems, []);
  });

test("T2: toda exceção do BASELINE aponta um arquivo existente e diz o motivo/passo", () => {
  for (const rule of RULES)
    for (const [file, [n, why]] of Object.entries(rule.baseline)) {
      assert.ok(
        ALL.includes(file),
        `${rule.id}: ${file} não existe mais (apague a exceção)`,
      );
      assert.ok(
        Number.isInteger(n) && n > 0,
        `${rule.id}/${file}: contagem inválida`,
      );
      assert.ok(String(why).length > 10, `${rule.id}/${file}: falta o motivo`);
    }
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
});

/* ---------- T3: pureza do que vai para core/ ---------- */

/** Módulos que o ARQUITETURA.md (apêndice A) destina a `core/`: devem ser puros e depender só do núcleo. */
const CORE_CANDIDATES = new Set([
  "rules.mjs",
  "economy.mjs",
  "roll.mjs",
  "roll-sim.mjs",
  "strategy.mjs",
  "stage.mjs",
  "tactics.mjs",
  "engine.mjs",
  "item-edge.mjs",
  "comp-score.mjs",
  "item-holdings.mjs",
  "item-plan.mjs",
  "item-value.mjs",
  "item-tiers.mjs",
  "target-level.mjs",
  "carousel.mjs",
  "contest.mjs",
  "augment-advice.mjs",
  "plan-progress.mjs",
  "level.mjs",
  "streak.mjs",
  "pool-tracker.mjs",
  "unit-ledger.mjs",
  "team-code.mjs",
  "v2/js/traits.js",
  "v2/js/item-source.js",
  "v2/js/comp-items.js",
]);

/** Exceções de T3: "arquivo|motivo" -> [descrição, passo que a remove]. Só encolhe. */
const T3_EXCEPTIONS = {
  "engine.mjs|importa evidence.mjs":
    "evidence.mjs mistura o cliente de rede/disco com filtros puros; separar em sources/explorer + engines/comps (M9)",
  "engine.mjs|importa augment-stats.mjs":
    "augment-stats.mjs mistura download/disco com TIER_PLACE; separar a constante (M9)",
  "augment-advice.mjs|importa augment-stats.mjs":
    "idem: só precisa de TIER_PLACE (M9)",
  "streak.mjs|Date.now":
    "D13: observe/trend usam Date.now() como valor padrão (M5/M7)",
};

test("T3: núcleo (core/ e módulos destinados a ele) sem E/S, sem relógio implícito, sem aleatório", () => {
  const found = new Map();
  const impure =
    /\bDate\.now\b|\bnew Date\b|\bMath\.random\b|\bprocess\.|\bfetch\(|\brequire\(|\bglobalThis\.(?:localStorage|document|window)\b/;
  for (const f of PRODUCT) {
    if (!inCore(f) && !CORE_CANDIDATES.has(f)) continue;
    for (const spec of importsOf(f)) {
      const to = resolveImport(f, spec);
      if (spec.startsWith("node:"))
        found.set(`${f}|importa ${spec}`, "módulo de núcleo importa node:*");
      else if (to && !inCore(to) && !CORE_CANDIDATES.has(to))
        found.set(
          `${f}|importa ${path.posix.basename(to)}`,
          "núcleo depende de módulo que não é núcleo",
        );
    }
    const code = stripNonCode(read(f));
    const hit = impure.exec(code);
    if (hit) {
      const word = hit[0].replace(/\W+$/, "");
      found.set(`${f}|${word}`, "uso de tempo/aleatório/E-S dentro do núcleo");
    }
  }
  const wrong = [...found.keys()].filter((k) => !(k in T3_EXCEPTIONS));
  const stale = Object.keys(T3_EXCEPTIONS).filter((k) => !found.has(k));
  assert.deepEqual(
    wrong.map((k) => `${k}  (${found.get(k)})`),
    [],
    "núcleo impuro: passe o tempo/E-S como entrada ou mova o trecho para sources/app.",
  );
  assert.deepEqual(
    stale,
    [],
    "exceção de T3 que não existe mais: apague-a de T3_EXCEPTIONS.",
  );
});

test("T3: os candidatos a núcleo declarados existem (o apêndice A não envelhece em silêncio)", () => {
  for (const f of CORE_CANDIDATES)
    assert.ok(ALL.includes(f), `${f} sumiu: atualize CORE_CANDIDATES`);
});

/* ---------- D1 / D11: o que a análise base lê tem de ser entrada declarada do fato ---------- */

test("D1 (M8b): o motor só lê opções que o fato `comps.base` declara; a loja é uma delas e o ouro virou lojas ao alcance", async () => {
  const ctx = await loadContext(),
    snapshots = loadSnapshots(),
    reads = new Set(),
    declared = new Set();
  // Espião no lugar de `comps.base`: o mesmo `baseOptions` (as entradas declaradas viram o `options` do motor), mas o
  // `options` que o motor recebe registra cada propriedade lida. Se o motor ler algo que o fato não declarou, a base em
  // cache ficaria defasada (era o defeito D1 com `options.shop`): é erro aqui.
  const spy = defineFact({
    id: compsBaseFact.id,
    inputs: compsBaseFact.inputs,
    cutoff: "key",
    keep: 1,
    compute: (inputs) => {
      const options = baseOptions(inputs);
      for (const key of Object.keys(options)) declared.add(key);
      return analyze(
        inputs.snapshot,
        inputs.catalog,
        new Proxy(options, {
          get(target, key, receiver) {
            if (typeof key === "string") reads.add(key);
            return Reflect.get(target, key, receiver);
          },
        }),
      );
    },
  });
  for (const scenario of scenarios)
    runScenario(ctx, scenario, snapshots, { overrides: [spy] });
  assert.ok(reads.size > 10, "o espião não registrou as leituras do motor");
  assert.deepEqual(
    [...reads].filter((key) => !declared.has(key)),
    [],
    "o motor lê opção que `comps.base` não declara (app/recommend-facts.mjs, baseOptions): declare a entrada no fato (D1).",
  );
  assert.ok(
    reads.has("shop") && declared.has("shop"),
    "a loja é lida e declarada",
  );
  assert.ok(
    !declared.has("gold") && declared.has("shopsAhead"),
    "o motor recebe as lojas ao alcance (fato economy.shopsAhead), não o ouro",
  );
});

/* ---------- T7: os fatos do grafo são funções puras da raiz do módulo ---------- */

/** Arquivos que definem fatos: os fatos do pipeline, o da simulação de rolagem e (quando existirem) os de `core/facts/`. */
const FACT_FILES = PRODUCT.filter(
  (f) =>
    f === "app/recommend-facts.mjs" ||
    f === "roll-sim.mjs" ||
    f.startsWith("core/facts/"),
);

/** Funções da raiz que ligam o grafo ao pipeline (não são fatos): podem citar o grafo e `options`. */
const FACT_BINDINGS = new Set([
  "createRecommendGraph",
  "recommendValues",
  "bindRun",
  "computeCounts",
  "recomputedText",
  "composeAnalysis",
  "simulate",
]);

test("T7: todo `defineFact` está na raiz do módulo com `compute` nomeado, sem estado mutável de módulo e sem relógio, aleatório, rede ou await", () => {
  assert.ok(FACT_FILES.includes("app/recommend-facts.mjs"));
  assert.ok(FACT_FILES.includes("roll-sim.mjs"));
  const problems = [];
  for (const file of FACT_FILES) {
    const code = stripNonCode(read(file));
    const calls = [...code.matchAll(/\bdefineFact\(/g)].length,
      rooted = [...code.matchAll(/^(?:export )?const \w+ = defineFact\(/gm)];
    // A importação do próprio `defineFact` não é chamada; toda chamada é o inicializador de uma `const` da raiz.
    if (calls !== rooted.length)
      problems.push(
        `${file}: ${calls} chamada(s) de defineFact e só ${rooted.length} na raiz como "const X = defineFact(": nada de fábrica nem fechamento`,
      );
    for (const match of rooted) {
      const end = code.indexOf("\n});", match.index),
        body = code.slice(match.index, end < 0 ? code.length : end);
      const compute = /\bcompute:\s*([A-Za-z_$][\w$]*)\s*,/.exec(body)?.[1];
      if (!compute) {
        problems.push(
          `${file}: ${match[0]} ... o compute é inline (use uma função nomeada da raiz)`,
        );
        continue;
      }
      const named = new RegExp(`^function ${compute}\\b`, "m").test(code),
        imported = new RegExp(
          `import\\s*\\{[^}]*\\b${compute}\\b[^}]*\\}`,
        ).test(code);
      if (!named && !imported)
        problems.push(
          `${file}: compute "${compute}" não é função declarada na raiz nem importada`,
        );
    }
    // Nomes de fora: as funções de fato (as da raiz, menos as que ligam o grafo ao pipeline) não citam o grafo, a
    // visão da análise, `options` nem `deps`: o que um fato lê entra por `inputs`.
    for (const fn of code.matchAll(/^function (\w+)\(/gm)) {
      if (FACT_BINDINGS.has(fn[1])) continue;
      const end = code.indexOf("\n}\n", fn.index),
        body = code.slice(fn.index, end < 0 ? code.length : end),
        outside =
          /\b(?:graph|view|deps|options|globalThis|window|document|localStorage)\b/.exec(
            body,
          );
      if (outside)
        problems.push(
          `${file}: a função de fato ${fn[1]} cita "${outside[0]}", que não é uma entrada declarada`,
        );
    }
    if (/^(?:let|var)\s/m.test(code))
      problems.push(`${file}: let/var na raiz do módulo (estado mutável)`);
    if (
      /^(?:export )?const \w+ = new (?:Map|Set|WeakMap|WeakSet)\(/m.test(code)
    )
      problems.push(`${file}: Map/Set na raiz do módulo (estado mutável)`);
    const impure =
      /\b(?:Date|performance|process|setTimeout|setInterval|fetch|require|await|async)\b|Math\.random/.exec(
        code,
      );
    if (impure)
      problems.push(
        `${file}: "${impure[0]}" em arquivo de fatos (relógio, aleatório, rede e E/S ficam fora do grafo)`,
      );
  }
  assert.deepEqual(problems, []);
});

/* ---------- D12: server.mjs só transporte ---------- */

/** Teto de linhas de server.mjs (D12). Só baixa; a meta de M9 é < 400. */
const SERVER_MAX_LINES = 900;

test("D12: server.mjs não cresce (teto de linhas só baixa; meta de M9: < 400)", () => {
  const lines = read("server.mjs").split("\n").length;
  assert.ok(
    lines <= SERVER_MAX_LINES,
    `server.mjs tem ${lines} linhas (teto ${SERVER_MAX_LINES}): regra de negócio vai para o núcleo, não para o transporte.`,
  );
  assert.ok(
    lines >= SERVER_MAX_LINES * 0.95,
    `server.mjs encolheu para ${lines}: baixe SERVER_MAX_LINES (hoje ${SERVER_MAX_LINES}) para travar o ganho.`,
  );
});

/* ---------- D5: premissa do M5 (código sem consumidor) ---------- */

test("D5 (M5a): `playbook`, `decision` e `recommendations[i].roll` foram removidos e nada no produto os reintroduz", () => {
  // Removidos porque a v2 nunca os leu (busca em servidor, motor, v2/js, v2/js/ui, live-mock e scripts).
  for (const gone of ["playbook.mjs", "decision.mjs"])
    assert.ok(!ALL.includes(gone), `${gone} voltou: ninguém exibe o veredito.`);
  const back = [];
  for (const f of PRODUCT) {
    if (/\b(?:playbook|decision)\.mjs\b/.test(read(f)))
      back.push(`${f}: importa módulo removido`);
    const code = stripNonCode(read(f));
    if (
      /\.playbook\b|\.decision\b|\bplaybook\s*:|\bdecision\s*:|\bneededForTwoStar\b|\bchanceOneCopy\b/.test(
        code,
      )
    )
      back.push(`${f}: lê ou escreve playbook/decision/roll por recomendação`);
  }
  assert.deepEqual(
    back,
    [],
    "reintroduziu código sem consumidor; se a interface passou a exibir o veredito, decida isso no ARQUITETURA.md antes.",
  );
});

/* ---------- D4 (M5b): ouro e vida num lugar só ---------- */

test("D4 (M5b): um só piso de reroll rápido; as regras de ouro e de vida só existem em core/economy", () => {
  assert.ok(
    ["policy", "gold", "rounds", "pressure", "tables"].every((m) =>
      ALL.includes(`core/economy/${m}.mjs`),
    ),
    "core/economy sumiu algum módulo",
  );
  // Um único piso de reroll rápido: POLICY.floor.fastReroll/POLICY.hp.fastReroll, lidos só pela estratégia. O motor não
  // tem mais o `rollBudget` com piso próprio (saiu no M5a) e nenhum outro módulo o reescreve.
  const readers = PRODUCT.filter(
    (f) => !inCore(f) && /\bfastReroll\b/.test(stripNonCode(read(f))),
  );
  assert.deepEqual(readers, ["strategy.mjs"]);
  const budgets = PRODUCT.filter((f) =>
    /\brollBudget\b/.test(stripNonCode(read(f))),
  );
  assert.deepEqual(budgets, [], "rollBudget voltou: o piso é POLICY.floor.*");
  // Juros, renda, projeção, calendário de rodadas e pressão: definidos só em core/economy (economy.mjs reexporta).
  const moved = [
    "interestOf",
    "nextTier",
    "tierFloor",
    "maxInterestGold",
    "interestTiers",
    "streakGold",
    "incomeOf",
    "projectGold",
    "shopsAhead",
    "pressureOf",
    "nextRound",
    "isPvp",
    "roundLabel",
  ];
  const redefined = [];
  for (const f of PRODUCT) {
    if (inCore(f)) continue;
    const code = stripNonCode(read(f));
    for (const name of moved)
      if (new RegExp(`\\b(?:function|const|let|var)\\s+${name}\\b`).test(code))
        redefined.push(`${f}: define ${name}`);
  }
  assert.deepEqual(
    redefined,
    [],
    "regra de ouro/vida reimplementada fora de core/economy: chame a função do núcleo.",
  );
});
