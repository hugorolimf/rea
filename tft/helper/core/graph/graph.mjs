/**
 * Grafo de fatos derivados com memoização por entradas declaradas (M8a da migração, ver ARQUITETURA.md).
 *
 * Três ideias:
 *
 * 1. Um FATO é uma função pura cujas entradas são NOMEADAS e DECLARADAS (`defineFact`). A função recebe só um objeto
 *    com o que declarou; ler outra coisa pelo objeto falha na hora (`UNDECLARED_INPUT`). É o que impede o defeito D1
 *    (o motor lia `options.shop` sem a loja estar na chave do cache).
 * 2. A chave de memoização de um fato é feita SÓ dos conteúdos das entradas declaradas (resumo estrutural estável de
 *    `stable-key.mjs`, sem campos voláteis): mesmas entradas, mesma chave, em qualquer processo.
 * 3. O grafo é estático e explícito (fatos dependem de entradas e de outros fatos). `set` marca como "sujos" só os
 *    fatos que dependem do que mudou; `get` recalcula sob demanda e, se um fato recalculado dá a mesma saída (ou a
 *    chave dele já foi vista), os dependentes NÃO rodam (corte antecipado). `stats()` diz o que foi recalculado.
 *
 * O que o grafo garante e o que NÃO garante:
 * - garante: a função só enxerga o que declarou (via objeto de entradas), ciclos são recusados na criação, o cache tem
 *   teto (`keep` entradas por fato), nenhum relógio implícito (o relógio é injetado e serve só para medir tempo).
 * - NÃO garante: que a função não leia uma variável do módulo (fechamento) nem que ninguém mute entradas/saídas
 *   depois de entregues. Para isso: escreva fatos como funções de topo de módulo e use `verify: true` nos testes
 *   (executa duas vezes, confere que as entradas não mudaram e congela a saída).
 *
 * ESM puro: sem `node:*`, sem relógio nem aleatório implícitos.
 */
import { GraphError } from "./errors.mjs";
import { stableKey } from "./stable-key.mjs";

/** Quantas entradas de histórico cada fato guarda por padrão (a atual mais as anteriores mais recentes). */
export const DEFAULT_KEEP = 8;
/** Tamanho máximo da lista `recomputed` de `stats()` (o excedente só é contado em `recomputedDropped`). */
const LOG_MAX = 512;
/** Leituras inofensivas permitidas no objeto de entradas (`JSON.stringify(inputs)` chama `toJSON`). */
const PROBES = new Set(["toJSON"]);

/** Fatos criados por `defineFact`: `createGraph` só aceita estes. */
const DEFINED = new WeakSet();

const isName = (s) => typeof s === "string" && s.length > 0;
const invalid = (msg, extra) => new GraphError("INVALID", msg, extra);

function normalizeInputs(id, raw) {
  const pairs = [];
  if (raw === undefined || raw === null) {
    // fato sem entradas: constante, calculado uma vez
  } else if (Array.isArray(raw)) {
    for (const n of raw) {
      if (!isName(n))
        throw invalid(`fato "${id}": nome de entrada inválido em inputs`);
      pairs.push([n, n]);
    }
  } else if (typeof raw === "object") {
    for (const [alias, node] of Object.entries(raw)) {
      if (!isName(alias) || !isName(node))
        throw invalid(
          `fato "${id}": inputs deve mapear apelido -> nome de entrada ou de fato (recebeu ${alias}: ${String(node)})`,
        );
      pairs.push([alias, node]);
    }
  } else throw invalid(`fato "${id}": inputs deve ser objeto ou lista`);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (new Set(pairs.map((p) => p[0])).size !== pairs.length)
    throw invalid(`fato "${id}": apelido repetido em inputs`);
  return Object.freeze(Object.fromEntries(pairs));
}

/**
 * Declara um fato derivado puro.
 *
 * @param {object} spec
 * @param {string} spec.id nome único do fato no grafo (ex.: `"economy.shopsAhead"`).
 * @param {Record<string,string> | string[]} [spec.inputs] entradas declaradas: `{ apelido: "nome" }`, onde `nome` é uma
 *   entrada do grafo ou outro fato; a lista `["gold", "level"]` usa o próprio nome como apelido. A função recebe um
 *   objeto só com estes apelidos; os apelidos, em ordem alfabética, formam a chave de cache.
 * @param {(inputs: Record<string, any>) => unknown} spec.compute função pura e SÍNCRONA. Não deve mutar as entradas
 *   nem devolver algo que as mutações posteriores de terceiros alterem.
 * @param {"structural" | "key"} [spec.cutoff] como decidir se a saída mudou para os dependentes. `"structural"`
 *   (padrão): resumo estrutural da saída, então saída igual não invalida ninguém; exige saída serializável (sem
 *   funções). `"key"`: não resume a saída; os dependentes são invalidados sempre que o fato recalcula com chave nova
 *   (para saídas com funções, como um índice com métodos, ou muito grandes).
 * @param {number} [spec.keep] teto de entradas memoizadas deste fato (padrão: o do grafo). Entradas antigas saem por
 *   LRU; a mais recente nunca sai.
 * @param {string} [spec.doc] frase curta: qual regra o fato carrega.
 * @returns {Readonly<{id: string, inputs: Readonly<Record<string,string>>, compute: Function, cutoff: string, keep: number | null, doc: string}>}
 */
export function defineFact(spec) {
  if (!spec || typeof spec !== "object")
    throw invalid("defineFact espera um objeto { id, inputs, compute }");
  const { id, compute, cutoff = "structural", keep = null, doc = "" } = spec;
  if (!isName(id)) throw invalid("defineFact: id deve ser um texto não vazio");
  if (typeof compute !== "function")
    throw invalid(`fato "${id}": compute deve ser uma função`);
  if (cutoff !== "structural" && cutoff !== "key")
    throw invalid(`fato "${id}": cutoff deve ser "structural" ou "key"`);
  if (keep !== null && !(Number.isInteger(keep) && keep >= 1))
    throw invalid(`fato "${id}": keep deve ser um inteiro >= 1`);
  const fact = Object.freeze({
    id,
    inputs: normalizeInputs(id, spec.inputs),
    compute,
    cutoff,
    keep,
    doc: String(doc),
  });
  DEFINED.add(fact);
  return fact;
}

function undeclared(factId, key, declared) {
  return new GraphError(
    "UNDECLARED_INPUT",
    `fato "${factId}" leu a entrada "${String(key)}", que não declarou em inputs (declaradas: ${declared.join(", ") || "nenhuma"}). Declare-a em defineFact para ela entrar na chave de cache.`,
    { fact: factId, input: String(key) },
  );
}

/** Objeto de entradas que o fato recebe: só os apelidos declarados, somente leitura. */
function guarded(factId, values, declared) {
  const readonly = (op) => () => {
    throw new GraphError(
      "READONLY_INPUT",
      `fato "${factId}" tentou ${op} nas entradas; entradas são somente leitura`,
      { fact: factId },
    );
  };
  return new Proxy(values, {
    get(target, key, receiver) {
      if (typeof key === "symbol") return Reflect.get(target, key, receiver);
      if (key in target) return target[key];
      if (PROBES.has(key)) return undefined;
      throw undeclared(factId, key, declared);
    },
    has(target, key) {
      if (typeof key === "symbol" || key in target) return key in target;
      throw undeclared(factId, key, declared);
    },
    set: readonly("escrever"),
    deleteProperty: readonly("apagar"),
    defineProperty: readonly("definir propriedade"),
  });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value))
    return value;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value;
  if (value instanceof Map)
    for (const [k, v] of value) {
      deepFreeze(k, seen);
      deepFreeze(v, seen);
    }
  else if (value instanceof Set) for (const v of value) deepFreeze(v, seen);
  else
    for (const k of Reflect.ownKeys(value)) {
      const d = Object.getOwnPropertyDescriptor(value, k);
      if (d && "value" in d) deepFreeze(d.value, seen);
    }
  return Object.freeze(value);
}

function assertAcyclic(factNodes) {
  const color = new Map(),
    stack = [];
  const visit = (node) => {
    color.set(node, 1);
    stack.push(node.id);
    for (const [, dep] of node.deps) {
      if (dep.kind !== "fact") continue;
      if (color.get(dep) === 1) {
        const cycle = [...stack.slice(stack.indexOf(dep.id)), dep.id];
        throw new GraphError(
          "CYCLE",
          `ciclo de dependência entre fatos: ${cycle.join(" -> ")}`,
          { cycle },
        );
      }
      if (!color.has(dep)) visit(dep);
    }
    stack.pop();
    color.set(node, 2);
  };
  for (const node of factNodes) if (!color.has(node)) visit(node);
}

/**
 * Cria um grafo de fatos.
 *
 * @param {object} options
 * @param {ReturnType<typeof defineFact>[]} options.facts fatos do grafo (criados por `defineFact`).
 * @param {string[] | Record<string, null | { ignore?: string[] }>} [options.inputs] entradas que `set` pode receber.
 *   Em forma de objeto, cada entrada aceita `ignore`: nomes de propriedade voláteis (ex.: `modifiedAt`) que NÃO entram
 *   na chave. Prometer que uma propriedade é volátil é afirmar que nenhum fato muda de resultado por causa dela.
 *   Aceita também `identity: (valor) => outro`: a chave da entrada é a do que `identity` devolve (a projeção do que
 *   importa), enquanto o fato continua recebendo o valor INTEIRO. É para a entrada grande cuja maior parte é volátil
 *   ou desordenada (o tabuleiro do jogo regravado a cada segundo): declarar a `identity` é afirmar que o que ela deixa
 *   de fora não muda o resultado de nenhum fato que a lê. `identity` deve ser pura e rápida.
 * @param {number} [options.keep] teto padrão de entradas memoizadas por fato (padrão 8). O total de entradas do grafo
 *   nunca passa da soma dos `keep` dos fatos: não há Map crescendo sem teto.
 * @param {(() => number) | null} [options.clock] relógio injetado (milissegundos), usado só para medir o tempo de cada
 *   cálculo em `stats()`. Sem ele, os tempos ficam `null`.
 * @param {string[]} [options.ignore] propriedades voláteis comuns a todas as entradas e saídas.
 * @param {boolean} [options.verify] modo de teste: executa cada fato duas vezes e exige a mesma saída, confere que as
 *   entradas não foram mutadas e congela a saída (profundo). Atenção: congela também objetos das entradas que a saída
 *   reaproveita.
 * @returns {{
 *   set(values: Record<string, unknown>): string[],
 *   get(name: string): any,
 *   stats(options?: { reset?: boolean }): object,
 *   explain(name: string): object,
 *   describe(): object,
 * }}
 *   - `set(values)`: atualiza entradas (parcial; só os nomes dados). Devolve os nomes cujo CONTEÚDO mudou; trocar por
 *     um valor estruturalmente igual não invalida nada. Entradas devem ser tratadas como imutáveis depois de entregues:
 *     passar a mesma referência mutada não é detectado.
 *   - `get(name)`: valor do fato (ou da entrada) atual; recalcula só o que está sujo e ainda não foi visto.
 *   - `stats({reset})`: contadores (por fato: `computes`, `hits` = reaproveitado do histórico, `reused` = conferido e
 *     sem mudança; `recomputed` = ids na ordem em que rodaram desde o último reset). `reset: true` zera os contadores.
 *   - `explain(name)`: chave atual, quais entradas mudaram na última resolução e de onde veio o valor; não calcula.
 *   - `describe()`: a estrutura do grafo (entradas, fatos, dependentes diretos e transitivos).
 */
export function createGraph(options = {}) {
  const {
    facts = [],
    inputs = {},
    keep = DEFAULT_KEEP,
    clock = null,
    ignore = [],
    verify = false,
  } = options ?? {};
  if (!Array.isArray(facts)) throw invalid("createGraph: facts deve ser lista");
  if (!(Number.isInteger(keep) && keep >= 1))
    throw invalid("createGraph: keep deve ser um inteiro >= 1");
  if (clock !== null && typeof clock !== "function")
    throw invalid("createGraph: clock deve ser uma função () => milissegundos");
  if (!Array.isArray(ignore) || !ignore.every(isName))
    throw invalid("createGraph: ignore deve ser lista de nomes");
  const globalIgnore = new Set(ignore);

  /** @type {Map<string, any>} */
  const nodes = new Map();
  const inputNodes = [],
    factNodes = [];

  const inputSpec = Array.isArray(inputs)
    ? Object.fromEntries(
        inputs.map((n) => {
          if (!isName(n))
            throw invalid("createGraph: nome de entrada inválido");
          return [n, null];
        }),
      )
    : (inputs ?? {});
  for (const [name, spec] of Object.entries(inputSpec)) {
    if (!isName(name)) throw invalid("createGraph: nome de entrada vazio");
    const extra = spec && typeof spec === "object" ? (spec.ignore ?? []) : [];
    if (!Array.isArray(extra) || !extra.every(isName))
      throw invalid(`entrada "${name}": ignore deve ser lista de nomes`);
    const identity =
      spec && typeof spec === "object" ? (spec.identity ?? null) : null;
    if (identity !== null && typeof identity !== "function")
      throw invalid(`entrada "${name}": identity deve ser uma função`);
    const node = {
      kind: "input",
      id: name,
      ignore: new Set([...globalIgnore, ...extra]),
      identity,
      has: false,
      value: undefined,
      token: null,
      downstream: [],
    };
    nodes.set(name, node);
    inputNodes.push(node);
  }
  for (const def of facts) {
    if (!DEFINED.has(def))
      throw invalid("createGraph: cada fato deve vir de defineFact");
    if (nodes.has(def.id))
      throw new GraphError("DUPLICATE", `nome repetido no grafo: "${def.id}"`, {
        id: def.id,
      });
    const node = {
      kind: "fact",
      id: def.id,
      def,
      keep: def.keep ?? keep,
      deps: [],
      downstream: [],
      entries: new Map(),
      currentKey: null,
      curTokens: null,
      fresh: false,
      value: undefined,
      token: null,
      last: null,
      stats: {
        computes: 0,
        hits: 0,
        reused: 0,
        evictions: 0,
        totalMs: 0,
        lastMs: null,
      },
    };
    nodes.set(def.id, node);
    factNodes.push(node);
  }
  const direct = new Map([...nodes.values()].map((n) => [n, []]));
  for (const node of factNodes)
    for (const [alias, name] of Object.entries(node.def.inputs)) {
      const dep = nodes.get(name);
      if (!dep)
        throw new GraphError(
          "UNKNOWN_NODE",
          `fato "${node.id}" depende de "${name}" (apelido "${alias}"), que não é entrada nem fato do grafo`,
          { fact: node.id, input: name },
        );
      node.deps.push([alias, dep]);
      direct.get(dep).push(node);
    }
  assertAcyclic(factNodes);
  // Dependentes transitivos de cada nó (para marcar como sujo sem percorrer o grafo a cada `set`).
  const closure = (node) => {
    const seen = new Set(),
      todo = [...direct.get(node)];
    while (todo.length) {
      const next = todo.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      todo.push(...direct.get(next));
    }
    return [...seen].sort((a, b) => (a.id < b.id ? -1 : 1));
  };
  for (const node of nodes.values()) node.downstream = closure(node);

  const counters = { sets: 0, inputsChanged: 0, recomputedDropped: 0 };
  let recomputed = [];
  let computing = null;

  const reentrant = () => {
    if (computing)
      throw new GraphError(
        "REENTRANT",
        `get/set chamado de dentro do fato "${computing}"; a função do fato só pode usar as entradas declaradas`,
        { fact: computing },
      );
  };

  const outputToken = (node, value, key) => {
    if (node.def.cutoff === "key") return stableKey(`${node.id}\u0000${key}`);
    try {
      return stableKey(value, { ignore: globalIgnore });
    } catch (error) {
      if (error instanceof GraphError && error.code === "UNSERIALIZABLE")
        throw new GraphError(
          "UNSERIALIZABLE",
          `fato "${node.id}": a saída ${error.message.replace("valor sem chave estável ", "não tem chave estável ")}. Se a saída tem funções, use cutoff: "key".`,
          error.details,
        );
      throw error;
    }
  };

  /** Chave de uma entrada: o resumo do que a identidade dela diz (padrão: o valor inteiro), sem os campos voláteis. */
  const inputToken = (node, value) =>
    stableKey(node.identity ? node.identity(value) : value, {
      ignore: node.ignore,
    });

  const run = (node, values) => {
    const declared = node.deps.map(([alias]) => alias);
    const out = node.def.compute(guarded(node.id, values, declared));
    if (out && typeof out.then === "function")
      throw new GraphError(
        "ASYNC_FACT",
        `fato "${node.id}" devolveu uma Promise; fatos são síncronos (resolva a E/S fora do grafo e passe o resultado como entrada)`,
        { fact: node.id },
      );
    return out;
  };

  const verified = (node, values, first) => {
    const again = run(node, values);
    let a = null,
      b = null;
    try {
      a = stableKey(first, { ignore: globalIgnore });
      b = stableKey(again, { ignore: globalIgnore });
    } catch {
      // saída sem chave estável (cutoff "key"): só dá para conferir as entradas
    }
    if (a !== b)
      throw new GraphError(
        "IMPURE",
        `fato "${node.id}" deu saídas diferentes para as mesmas entradas (leu estado externo, relógio ou aleatório?)`,
        { fact: node.id },
      );
    for (const [alias, dep] of node.deps) {
      if (dep.kind === "fact" && dep.def.cutoff === "key") continue;
      const now =
        dep.kind === "input"
          ? inputToken(dep, dep.value)
          : stableKey(dep.value, { ignore: globalIgnore });
      if (now !== dep.token)
        throw new GraphError(
          "IMPURE",
          `fato "${node.id}" mudou a entrada "${alias}" (${dep.id}); entradas são somente leitura`,
          { fact: node.id, input: dep.id },
        );
    }
    return deepFreeze(first);
  };

  const compute = (node, key, values) => {
    reentrant();
    computing = node.id;
    const t0 = clock ? clock() : null;
    let value;
    try {
      value = run(node, values);
      if (verify) value = verified(node, values, value);
    } catch (error) {
      if (error instanceof GraphError) throw error;
      throw new GraphError(
        "COMPUTE_FAILED",
        `fato "${node.id}" falhou: ${error?.message ?? error}`,
        { cause: error, fact: node.id },
      );
    } finally {
      computing = null;
    }
    const entry = { value, token: outputToken(node, value, key) };
    const ms = clock ? clock() - t0 : null;
    node.stats.computes++;
    if (ms !== null) {
      node.stats.totalMs += ms;
      node.stats.lastMs = ms;
    }
    if (recomputed.length < LOG_MAX) recomputed.push(node.id);
    else counters.recomputedDropped++;
    return entry;
  };

  const resolve = (node) => {
    if (node.kind === "input") {
      if (!node.has)
        throw new GraphError(
          "MISSING_INPUT",
          `a entrada "${node.id}" ainda não recebeu valor (graph.set)`,
          { input: node.id },
        );
      return node;
    }
    if (node.fresh) return node;
    const values = Object.create(null),
      tokens = [];
    for (const [alias, dep] of node.deps) {
      const resolved = resolve(dep);
      values[alias] = resolved.value;
      tokens.push(resolved.token);
    }
    const key = tokens.join("|");
    let entry = node.entries.get(key),
      via;
    if (entry) {
      node.entries.delete(key); // LRU: volta ao fim
      via = node.currentKey === key ? "reused" : "hits";
      node.stats[via]++;
    } else {
      entry = compute(node, key, values);
      via = "computed";
    }
    node.entries.set(key, entry);
    while (node.entries.size > node.keep) {
      node.entries.delete(node.entries.keys().next().value);
      node.stats.evictions++;
    }
    const prev = node.curTokens;
    node.last = {
      via,
      changed: node.deps
        .map(([alias], i) => (prev && prev[i] === tokens[i] ? null : alias))
        .filter(Boolean),
    };
    node.curTokens = tokens;
    node.currentKey = key;
    node.value = entry.value;
    node.token = entry.token;
    node.fresh = true;
    return node;
  };

  const need = (name) => {
    const node = nodes.get(name);
    if (!node)
      throw new GraphError(
        "UNKNOWN_NODE",
        `"${String(name)}" não é entrada nem fato deste grafo`,
        { id: String(name) },
      );
    return node;
  };

  return {
    set(values) {
      reentrant();
      if (!values || typeof values !== "object" || Array.isArray(values))
        throw invalid("graph.set espera um objeto { entrada: valor }");
      const staged = [];
      for (const name of Object.keys(values)) {
        const node = nodes.get(name);
        if (!node || node.kind !== "input")
          throw new GraphError(
            "UNKNOWN_INPUT",
            `"${name}" não foi declarada como entrada em createGraph`,
            { input: name },
          );
        const value = values[name];
        if (node.has && Object.is(node.value, value)) continue;
        let token;
        try {
          token = inputToken(node, value);
        } catch (error) {
          if (error instanceof GraphError)
            throw new GraphError(
              error.code,
              `entrada "${name}": ${error.message}`,
              error.details,
            );
          throw error;
        }
        staged.push([node, value, token]);
      }
      counters.sets++;
      const changed = [];
      for (const [node, value, token] of staged) {
        const same = node.has && node.token === token;
        node.value = value; // mesma estrutura: guarda a referência nova, a chave não muda
        if (same) continue;
        node.has = true;
        node.token = token;
        changed.push(node.id);
        for (const dependent of node.downstream) dependent.fresh = false;
      }
      counters.inputsChanged += changed.length;
      return changed;
    },

    get(name) {
      reentrant();
      return resolve(need(name)).value;
    },

    stats({ reset = false } = {}) {
      const perFact = {};
      const total = {
        computes: 0,
        hits: 0,
        reused: 0,
        evictions: 0,
        entries: 0,
        capacity: 0,
      };
      for (const node of factNodes) {
        const s = node.stats;
        perFact[node.id] = {
          ...s,
          entries: node.entries.size,
          keep: node.keep,
        };
        total.computes += s.computes;
        total.hits += s.hits;
        total.reused += s.reused;
        total.evictions += s.evictions;
        total.entries += node.entries.size;
        total.capacity += node.keep;
      }
      const snapshot = {
        ...counters,
        ...total,
        recomputed: [...recomputed],
        facts: perFact,
      };
      if (reset) {
        recomputed = [];
        counters.sets = counters.inputsChanged = counters.recomputedDropped = 0;
        for (const node of factNodes)
          node.stats = {
            computes: 0,
            hits: 0,
            reused: 0,
            evictions: 0,
            totalMs: 0,
            lastMs: null,
          };
      }
      return snapshot;
    },

    explain(name) {
      const node = need(name);
      if (node.kind === "input")
        return { id: node.id, kind: "input", has: node.has, token: node.token };
      return {
        id: node.id,
        kind: "fact",
        doc: node.def.doc,
        fresh: node.fresh,
        key: node.currentKey,
        token: node.token,
        deps: Object.fromEntries(
          node.deps.map(([alias, dep]) => [alias, dep.id]),
        ),
        last: node.last,
        entries: node.entries.size,
      };
    },

    describe() {
      return {
        inputs: Object.fromEntries(
          inputNodes.map((n) => [
            n.id,
            { downstream: n.downstream.map((d) => d.id) },
          ]),
        ),
        facts: Object.fromEntries(
          factNodes.map((n) => [
            n.id,
            {
              inputs: { ...n.def.inputs },
              cutoff: n.def.cutoff,
              keep: n.keep,
              downstream: n.downstream.map((d) => d.id),
            },
          ]),
        ),
      };
    },
  };
}
