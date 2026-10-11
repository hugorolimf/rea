/**
 * Chave estrutural estável: a identidade de um valor para memoização.
 *
 * `canonical(valor)` escreve o valor num texto que NÃO depende da ordem das chaves, da identidade dos objetos nem de
 * campos que o chamador declarou voláteis (`ignore`); `stableKey(valor)` é o resumo curto desse texto. Dois valores com
 * a mesma estrutura dão a mesma chave em qualquer processo, navegador ou servidor (não há semente, relógio nem
 * aleatório).
 *
 * Regras (documentadas porque definem quando dois valores "são iguais" para o cache):
 * - objetos: chaves ordenadas; propriedade com valor `undefined` conta como ausente;
 * - arrays: a ordem importa; posição `undefined` conta (`[undefined]` difere de `[]`);
 * - `Map`/`Set`: a ordem de inserção NÃO importa (entradas ordenadas pela forma canônica);
 * - números: `-0` e `0` são iguais; `NaN` é igual a `NaN`; `1` e `"1"` são diferentes;
 * - `Date`: pelo instante; `RegExp`: pela fonte e flags; typed arrays: pelo tipo e pelos elementos;
 * - sem chave estável (lança `GraphError` `UNSERIALIZABLE`, com o caminho do problema): funções, símbolos,
 *   `Promise`, `WeakMap`/`WeakSet`, `DataView` e referências circulares.
 *
 * ESM puro: sem `node:*`, relógio nem aleatório.
 */
import { GraphError } from "./errors.mjs";

/** cyrb53: resumo de 53 bits de um texto (não criptográfico), determinístico. */
function cyrb53(text, seed) {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Resumo curto e estável de um texto: dois hashes de 53 bits com sementes diferentes e o comprimento (106 bits
 * efetivos; a chance de colisão com milhares de entradas é desprezível).
 * @param {string} text
 * @returns {string}
 */
export function digestString(text) {
  return `${cyrb53(text, 0).toString(36)}-${cyrb53(text, 0x9e3779b1).toString(36)}.${text.length.toString(36)}`;
}

const asIgnoreSet = (ignore) =>
  ignore instanceof Set ? ignore : new Set(ignore ?? []);

function unserializable(what, path) {
  return new GraphError(
    "UNSERIALIZABLE",
    `valor sem chave estável (${what}) em ${path.length ? path.join(".") : "<raiz>"}`,
    { path: [...path] },
  );
}

function encode(value, ctx) {
  switch (typeof value) {
    case "undefined":
      return "u";
    case "boolean":
      return value ? "T" : "F";
    case "number":
      // String(-0) === "0" e String(NaN) === "NaN": já é a forma canônica.
      return `n${value};`;
    case "bigint":
      return `i${value};`;
    case "string":
      return `s${value.length}:${value}`;
    case "function":
      throw unserializable("função", ctx.path);
    case "symbol":
      throw unserializable("símbolo", ctx.path);
    default:
  }
  if (value === null) return "z";
  if (ctx.stack.includes(value))
    throw unserializable("referência circular", ctx.path);
  ctx.stack.push(value);
  try {
    if (Array.isArray(value)) {
      let out = `[${value.length}:`;
      for (let i = 0; i < value.length; i++) {
        ctx.path.push(String(i));
        out += encode(value[i], ctx);
        ctx.path.pop();
      }
      return `${out}]`;
    }
    if (value instanceof Date) return `D${value.getTime()};`;
    if (value instanceof RegExp)
      return `R${value.flags}/${value.source.length}:${value.source}`;
    if (value instanceof Map) {
      const rows = [];
      for (const [k, v] of value) {
        ctx.path.push("<map>");
        rows.push(encode(k, ctx) + encode(v, ctx));
        ctx.path.pop();
      }
      rows.sort();
      return `M${rows.length}:${rows.join("")}]`;
    }
    if (value instanceof Set) {
      const rows = [];
      for (const v of value) {
        ctx.path.push("<set>");
        rows.push(encode(v, ctx));
        ctx.path.pop();
      }
      rows.sort();
      return `S${rows.length}:${rows.join("")}]`;
    }
    if (ArrayBuffer.isView(value)) {
      if (value instanceof DataView) throw unserializable("DataView", ctx.path);
      return `V${value.constructor.name}${value.length}:${Array.from(value).join(",")};`;
    }
    if (
      value instanceof Promise ||
      value instanceof WeakMap ||
      value instanceof WeakSet
    )
      throw unserializable(value.constructor.name, ctx.path);
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined && !ctx.ignore.has(k))
      .sort();
    let out = `{${keys.length}:`;
    for (const k of keys) {
      ctx.path.push(k);
      out += `s${k.length}:${k}${encode(value[k], ctx)}`;
      ctx.path.pop();
    }
    return `${out}}`;
  } finally {
    ctx.stack.pop();
  }
}

/**
 * Forma canônica de um valor (texto). Ver as regras no cabeçalho do módulo.
 * @param {unknown} value
 * @param {{ ignore?: Iterable<string> }} [options] `ignore`: nomes de propriedade voláteis, ignorados em qualquer
 *   profundidade dos objetos (ex.: `["modifiedAt", "seenAt"]`).
 * @returns {string}
 */
export function canonical(value, { ignore } = {}) {
  return encode(value, { stack: [], path: [], ignore: asIgnoreSet(ignore) });
}

/**
 * Chave estável (resumo curto da forma canônica) de um valor.
 * @param {unknown} value
 * @param {{ ignore?: Iterable<string> }} [options]
 * @returns {string}
 */
export function stableKey(value, options) {
  return digestString(canonical(value, options));
}
