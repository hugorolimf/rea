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
import { baseInputs } from "../analysis-keys.mjs";
import { loadContext, loadSnapshots, runScenario } from "./golden/harness.mjs";
import { scenarios } from "./golden/scenarios.mjs";

const REPORT = process.env.ARCH_REPORT === "1";
const ALL = listSources();

/** Código de teste, ferramentas offline e fixtures: não são o produto, ficam fora das regras. */
const isSupport = (f) =>
  f.endsWith('.test.mjs') ||
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
  // O servidor e os motores importam do diretório do navegador: v2/js/traits.js e item-source.js são, na prática, núcleo.
  // M3 move traits para core/catalog; M6 move item-source para core/facts/holdings (reexport fino em v2/js).
  "engine.mjs -> v2/js/traits.js":
    "D7: regra de traços/emblemas mora no navegador (M3)",
  "tactics.mjs -> v2/js/traits.js": "D7 (M3)",
  "server.mjs -> v2/js/traits.js":
    "D7: servidor usa emblemTraitMap/traitsWithEmblems (M3)",
  "engine.mjs -> v2/js/item-source.js":
    "D8: posse de itens da Formação usada pelo motor (M6)",
  "item-holdings.mjs -> v2/js/item-source.js":
    "D8: resolveHoldings aplica a regra da Formação (M6)",
  "item-plan.mjs -> v2/js/item-source.js": "D8 (M6)",
  "item-value.mjs -> v2/js/item-source.js": "D8 (M6)",
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
    // Fora de v2/ (e do teste) ninguém importa v2/.
    if (!from.startsWith("v2/") && to?.startsWith("v2/"))
      add(key, "importa v2/");
    // O navegador (v2/ e live-mock.js) não importa o servidor nem node:* (só /core, /rules.mjs, /economy.mjs).
    const browser = from.startsWith("v2/") || from === "live-mock.js";
    if (browser && spec.startsWith("node:"))
      add(key, "navegador importa node:*");
    if (
      from.startsWith("v2/") &&
      to &&
      !to.startsWith("v2/") &&
      !spec.startsWith("/")
    )
      add(key, "v2/ importa fora de v2/ por caminho relativo");
    if (
      browser &&
      spec.startsWith("/") &&
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
    baseline: {
      "item-tiers.mjs": [
        2,
        "baseItemId e kindOf (dono atual do catálogo de itens; M2)",
      ],
      "v2/js/comp-items.js": [
        1,
        "cópia idêntica de baseItemId (aba Comps; M2/M6)",
      ],
      "v2/js/item-source.js": [
        1,
        "cópia idêntica de baseItem (Formação; M2/M6)",
      ],
    },
  },
  {
    id: "component-id-literal",
    covers: "D2 / 1.2-a",
    what: "ids de componentes escritos à mão (DA_Component_*) fora do catálogo de itens",
    owner: "core/catalog/items.mjs",
    view: "strings",
    pattern: /DA_Component_/g,
    baseline: {
      "carousel.mjs": [
        1,
        "carrossel decide componentes por conta própria (M6)",
      ],
      "engine.mjs": [1, "classificação componente x pronto do motor (M2)"],
      "item-holdings.mjs": [1, "regra de posse (M6)"],
      "item-plan.mjs": [1, "plano de itens (M6)"],
      "item-tiers.mjs": [2, "dono atual (isComponent/consumíveis; M2)"],
      "live-mock.js": [
        4,
        "o mock reimplementa o servidor (ajustar depois de M5)",
      ],
      "tactics.mjs": [1, "tactics.build (M2)"],
      "v2/js/item-source.js": [1, "Formação (M6)"],
      "v2/js/items.js": [2, "leitura do banco no cliente (M2)"],
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
        6,
        "itemRole/holderRole: 11 de 39 itens montáveis divergem dos outros classificadores (D2; M2)",
      ],
      "live-mock.js": [
        12,
        "mock com os próprios papéis de item (ajustar depois de M5)",
      ],
      "meta-builds.mjs": [3, "TANK/AP/AD e roleOf (D2; M2)"],
      "stage.mjs": [3, "stage.kind (D2; M2)"],
      "tactics.mjs": [
        18,
        "tactics: tabelas de pontos por papel e regex de cobertura (D2; M2)",
      ],
    },
  },
  {
    id: "star-copies",
    covers: "D10 / 1.2-e",
    what: "cópias <-> estrela (3 ** (estrela - 1)) fora do dono de unidades",
    owner: "core/facts/units.mjs",
    view: "code",
    pattern: /\b3\s*\*\*\s*[\w(]/g,
    baseline: {
      "contest.mjs": [1, "copies de rivais da disputa (M6)"],
      "economy.mjs": [2, "sellValue e afins (dono atual da economia; M5)"],
      "engine.mjs": [4, "count/own/rivals (M4/M6)"],
      "pool-tracker.mjs": [1, "bancos ocultos (M4)"],
      "tactics.mjs": [1, "haveStars (M6)"],
      "unit-ledger.mjs": [
        1,
        "copies exportada, usada só por plan-progress (M6)",
      ],
      "v2/js/model.js": [1, "cópias no cliente (M6)"],
    },
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
    owner: "core/facts/shop.mjs",
    view: "code",
    pattern: /\bODDS\s*\[/g,
    baseline: {
      "economy.mjs": [2, "slotChance/odds (dono atual; M4)"],
      "engine.mjs": [5, "probability e limiares de loja (M4)"],
      "roll.mjs": [1, "denom por custo na rolagem (M4)"],
      "stage.mjs": [2, "MIN_ODDS e cartas (M4)"],
      "strategy.mjs": [1, "levelGain/odds do próximo nível (M4)"],
    },
  },
  {
    id: "per-shop-chance",
    covers: "D3",
    what: "chance por loja recalculada (1 - (1 - p) ** 5)",
    owner: "core/facts/shop.mjs",
    view: "code",
    pattern: /\)\s*\*\*\s*5\b/g,
    baseline: {
      "engine.mjs": [
        2,
        "pool[].chancePerShop fracionário; economy.slotChance usa outro denominador (D3; M4)",
      ],
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
    owner: "core/facts/shop.mjs",
    view: "code",
    unit: "lines",
    pattern: /ODDS[^\n]*>=\s*10\b|\bMIN_ODDS\s*=\s*\d+/g,
    baseline: {
      "engine.mjs": [3, "available/extend/shopOk com >= 10 literal (M4)"],
      "stage.mjs": [1, "MIN_ODDS = 10 (M4)"],
    },
  },
  {
    id: "interest-constants",
    covers: "1.2-b / D4",
    what: "juros (interestStep/interestMax/INTEREST_*) fora do dono da economia",
    owner: "core/facts/economy.mjs",
    view: "code",
    pattern: /\binterestStep\b|\binterestMax\b|\bINTEREST_(?:STEP|CAP)\b/g,
    baseline: {
      "economy.mjs": [
        8,
        "dono atual da regra de juros (M5 move para core/facts/economy)",
      ],
      "engine.mjs": [2, "renda inline do motor, diferente de incomeOf (M5)"],
      "rules.mjs": [2, "definição da constante (vira tabela do patch; M5)"],
      "v2/js/model.js": [2, "INTEREST_STEP/CAP do cliente (M5)"],
      "v2/js/ui/hud.js": [9, "medidor de ouro com juros próprios (M5)"],
    },
  },
  {
    id: "gold-literal-threshold",
    covers: "D4 / D14 / 1.2-b",
    what: "limiar de ouro escrito como literal (gold >= 50, gold < 30, ...)",
    owner: "core/facts/economy.mjs + core/rules/policy.mjs",
    view: "code",
    pattern: /\b(?:gold|goldNow)\s*(?:>=|<=|>|<)\s*[1-9]\d*/g,
    baseline: {
      "decision.mjs": [1, "gold < 30 (código sem consumidor; removido em M5)"],
      "live-mock.js": [
        1,
        "o mock reimplementa o servidor (ajustar depois de M5)",
      ],
      "playbook.mjs": [
        3,
        "gold < 50 / >= 50 (código sem consumidor; removido em M5)",
      ],
      "server.mjs": [
        1,
        "validação de entrada (gold > 999): legítimo, vira validação do contrato (M7)",
      ],
      "strategy.mjs": [1, "projeção até 50 g (usa a faixa de juros; M5)"],
      "target-level.mjs": [2, "gold >= 50 (M5)"],
    },
  },
  {
    id: "hp-literal-threshold",
    covers: "D4 / 1.2-i",
    what: "limiar de vida escrito como literal (hp <= 35, health <= 45, ...) fora da política",
    owner: "core/rules/policy.mjs",
    view: "code",
    pattern: /\b(?:hp|health)\s*(?:>=|<=|>|<)\s*[1-9]\d*/g,
    baseline: {
      "augment-advice.mjs": [3, "hp >= 60, < 40, < 50 (M5)"],
      "decision.mjs": [
        3,
        "hp <= 45/40 (código sem consumidor; removido em M5)",
      ],
      "economy.mjs": [1, "pressureOf: bleeding com hp <= 65 (dono atual; M5)"],
      "engine.mjs": [
        1,
        "rollBudget: health <= 35 ? 20 : 50 (D4: diverge de POLICY.hp.fastReroll; M5)",
      ],
      "playbook.mjs": [
        2,
        "hp <= 35 / > 45 (código sem consumidor; removido em M5)",
      ],
      "streak.mjs": [1, "hp <= 100: filtro de leitura inválida, não política"],
      "target-level.mjs": [5, "hp <= 35, < 60, >= 60, >= 70, > 35 (M5)"],
      "v2/js/ui/hud.js": [1, "hp <= 30 para a barra baixa (M5)"],
    },
  },
  {
    id: "trait-breakpoints",
    covers: "D7 / 1.2-f",
    what: "patamares de traço lidos do catálogo (minUnits) fora da regra de traços",
    owner: "core/catalog/traits.mjs",
    view: "code",
    pattern: /\bminUnits\b/g,
    baseline: {
      "engine.mjs": [1, "thresholdsOf (M3)"],
      "server.mjs": [1, "breakpoints do /api/catalog (M3)"],
      "tactics.mjs": [3, "t.effects.find / patamares (M3)"],
    },
  },
  {
    id: "trait-solo-rule",
    covers: "D7 / 1.2-f",
    what: "regra de traço solo ('Only active while fielding 1') fora da regra de traços",
    owner: "core/catalog/traits.mjs",
    view: "strings",
    pattern: /Only active while fielding/g,
    baseline: {
      "engine.mjs": [1, "soloOnly: só o motor conhece a regra (M3)"],
    },
  },
  {
    id: "stage-round-parse",
    covers: "D10 / 1.2-c",
    what: "parse de estágio 'S-R' (/^(\\d)-(\\d)$/) fora do relógio de rodada",
    owner: "core/facts/clock.mjs",
    view: "strings",
    pattern: /\^\(\\d\+?\)-\(\\d\+?\)\$/g,
    baseline: {
      "game-log.mjs": [
        1,
        "fonte: rodada do Sentry (normalizar uma vez na fronteira; M7)",
      ],
      "gep-reader.mjs": [1, "fonte GEP (M7)"],
      "live-mock.js": [
        1,
        "o mock reimplementa o servidor (ajustar depois de M5)",
      ],
      "plan-progress.mjs": [1, "rank da rodada (M5)"],
      "rules.mjs": [1, "roundNumber (dono atual da rodada; M5)"],
      "server.mjs": [1, "stageRead no POST (M5/M7)"],
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
    owner: "core/facts/economy.mjs",
    view: "code",
    pattern: /\bgold\s*\?\?\s*30\b/g,
    baseline: {
      "engine.mjs": [
        1,
        "shops = f(gold ?? 30) enquanto strategy trata null como 'não lido' (D14; M5/M7)",
      ],
    },
  },
  {
    id: "item-stock-consumption",
    covers: "D8 / 1.2-a",
    what: "estoque de itens consumido localmente (indexOf/findIndex + splice sobre estoque/banco/peças)",
    owner: "core/facts/holdings.mjs",
    view: "code",
    // Idioma 'tira uma cópia do estoque': splice sobre uma lista de itens até 2 linhas depois de indexOf/findIndex.
    scan(code) {
      const lines = code.split("\n"),
        hits = [];
      lines.forEach((line, i) => {
        if (
          !/\b(?:stock|bank|held|heldLeft|left|parts|check|rest|probe|owned|missingIds|items|list)\.splice\(/.test(
            line,
          )
        )
          return;
        const window = lines.slice(Math.max(0, i - 2), i + 1).join(" ");
        if (/\.indexOf\(|\.findIndex\(/.test(window)) hits.push(i + 1);
      });
      return hits;
    },
    baseline: {
      "carousel.mjs": [2, "cópia 6: aloca o banco por conta própria (M6)"],
      "engine.mjs": [2, "cópia 1: contagem simples de equipados + banco (M6)"],
      "item-edge.mjs": [2, "cópia 2: caminho antigo ao lado do resolved (M6)"],
      "item-holdings.mjs": [
        1,
        "DONO ATUAL (resolveHoldings; vira core/facts/holdings em M6)",
      ],
      "tactics.mjs": [6, "cópia 3: build/itemMoves/ownedItemAdvice (M6)"],
      "v2/js/comp-items.js": [
        5,
        "cópia 7: aba Comps aloca o banco entre builds (M6)",
      ],
      "v2/js/item-source.js": [
        1,
        "DONO ATUAL (regra da Formação; vira core/facts/holdings em M6)",
      ],
      "v2/js/next-item.js": [
        2,
        "NÃO listado no mapa 1.2-a: 'próximo item' consome o estoque sozinho (achado do M1; M6)",
      ],
    },
  },
  {
    id: "server-option-assembly",
    covers: "D12",
    what: "regra de negócio montada em server.mjs (atribuições a options.X dentro do POST)",
    owner: "app/recommend.mjs",
    view: "code",
    pattern: /\boptions\.[A-Za-z]+\s*=(?!=)/g,
    baseline: {
      "server.mjs": [
        39,
        "o bloco POST /api/recommend monta ~39 campos de options e decide sticky, hidden, emblemas...; sai em M9",
      ],
    },
  },
  {
    id: "unbounded-memo-maps",
    covers: "D11",
    what: "cache próprio por módulo (new Map de cache/SIMS/pending) em vez do grafo memoizado",
    owner: "core/facts/graph.mjs",
    view: "code",
    pattern:
      /\b(?:\w*[cC]ache\w*|SIMS|pending\w*|rankedCache|wantsCache)\s*=\s*new Map\(/g,
    baseline: {
      "engine.mjs": [3, "roleCache/thresholdCache/termCache por chamada (M8)"],
      "evidence.mjs": [
        1,
        "cache do explorer: E/S real, fica em sources/ (não migra)",
      ],
      "item-value.mjs": [3, "cache/rankedCache/wantsCache por chamada (M8)"],
      "roll.mjs": [
        1,
        "SIMS: Monte Carlo por JSON.stringify([nível, denom, alvos]) (M8)",
      ],
      "server.mjs": [
        3,
        "analysisCache/baseAnalysisCache/pendingBase (D11; M8)",
      ],
    },
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
  "playbook.mjs",
  "decision.mjs",
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
  "pool-tracker.mjs|Date.now":
    "D13: now = Date.now() como valor padrão; o relógio entra no estado (M4/M7)",
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

/* ---------- D1 / D11: o que a análise base lê tem de estar na chave dela ---------- */

/**
 * Opções que `engine.analyze` lê sem aparecerem em `analysis-keys.baseInputs`, e por que isso é seguro.
 * Qualquer leitura nova sem chave e sem justificativa aqui falha: é exatamente o defeito D1.
 */
const COVERED_ELSEWHERE = {
  augmentEmblems: "derivado de `augments`, que está na chave",
  baseAvg: "derivado de `stats` (data da cópia na chave)",
  stats: "cópia de meta: `stats` (data) na chave",
  itemStats: "cópia de meta: data de `builds` na chave",
  metaBuilds: "cópia de meta: data de `builds` na chave",
  metaRoles: "cópia de meta: data de `builds` na chave",
  augmentStats:
    "o servidor apaga os dois caches ao renovar augment-stats (sem data na chave)",
  evidence: "versionada à parte (`evidenceVersion` em baseKey)",
  conditional: "versionada à parte (`evidenceVersion` em baseKey)",
};
/** Exceção D1 verificada: o motor lê a loja (shopHits -> compScore), a chave da base não. Some em M8. */
const D1_UNKEYED = {
  shop: "D1: compScore usa shopHits; baseInputs não tem `shop` (tests/golden: shop-cache-d1; corrigido por construção em M8)",
};

test("D1: toda opção que o motor lê entra na chave da base ou está justificada (exceção D1 conhecida: shop)", async () => {
  const ctx = await loadContext(),
    snapshots = loadSnapshots(),
    engineReads = new Set();
  const watch = (set) => (options) =>
    new Proxy(options, {
      get(target, key, receiver) {
        if (typeof key === "string") set.add(key);
        return Reflect.get(target, key, receiver);
      },
    });
  let sample;
  for (const scenario of scenarios)
    runScenario(ctx, scenario, snapshots, {
      observeOptions: (o) => ((sample = o), watch(engineReads)(o)),
    });
  const keyReads = new Set();
  baseInputs(watch(keyReads)(sample), {
    source: "s",
    builds: "b",
    comps: "c",
    stats: "t",
  });
  const unkeyed = [...engineReads].filter(
    (k) => !keyReads.has(k) && !(k in COVERED_ELSEWHERE),
  );
  const unknown = unkeyed.filter((k) => !(k in D1_UNKEYED));
  assert.deepEqual(
    unknown,
    [],
    "o motor lê opção que não está em analysis-keys.baseInputs: a análise base em cache ficaria defasada (D1). Inclua a opção na chave.",
  );
  const stale = Object.keys(D1_UNKEYED).filter((k) => !unkeyed.includes(k));
  assert.deepEqual(
    stale,
    [],
    "D1 corrigido? apague a exceção de D1_UNKEYED e inverta o teste de caracterização do golden.",
  );
  for (const k of Object.keys(COVERED_ELSEWHERE))
    assert.ok(
      engineReads.has(k) || !keyReads.has(k),
      `${k}: justificativa sem leitura (apague de COVERED_ELSEWHERE)`,
    );
});

/* ---------- D12: server.mjs só transporte ---------- */

/** Teto de linhas de server.mjs (D12). Só baixa; a meta de M9 é < 400. */
const SERVER_MAX_LINES = 1409;

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

test("D5 (premissa do M5): a interface v2 não lê `playbook` nem `decision` do servidor", () => {
  const readers = [];
  for (const f of PRODUCT.filter((f) => f.startsWith("v2/"))) {
    const code = stripNonCode(read(f));
    if (/\.playbook\b|\.decision\b|\bplaybook\s*:|\bdecision\s*:/.test(code))
      readers.push(f);
  }
  assert.deepEqual(
    readers,
    [],
    "a v2 passou a ler playbook/decision: reavalie a remoção de playbook.mjs/decision.mjs prevista para o M5.",
  );
});
