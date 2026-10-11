// Leitura estática do código do helper para os testes de arquitetura (M1): lista de fontes, imports estáticos e
// código sem comentários nem textos. Só lê arquivos; nada é executado ou importado.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const SKIP_DIRS = new Set([
  // Arquivo histórico fora do sistema (a leitura de tela removida em 2026-10-11): não é código do helper.
  ".old",
  "node_modules",
  "pesquisa",
  "assets",
  "fixtures",
  "expected",
]);

/** Caminhos (com "/") relativos à raiz do helper de todos os .mjs/.js/.cjs do projeto, fora dados e dependências. */
export function listSources(dir = root, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) listSources(path.join(dir, e.name), out);
    } else if (/\.(mjs|js|cjs)$/.test(e.name))
      out.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/"));
  }
  return out.sort();
}

/** Texto do arquivo com fim de linha LF (a cópia de trabalho pode estar em CRLF). */
export const read = (rel) =>
  fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * O mesmo texto com comentários e (salvo `keepStrings`) conteúdo de strings, templates e regex trocados por espaços:
 * quebras de linha ficam, então número de linha e coluna não mudam. Reconhece literais de regex pelo caractere
 * significativo anterior. Dentro de `${...}` de um template o código continua visível.
 * `keepStrings: true` só tira comentários (para achar nomes de itens escritos em strings e regex).
 */
export function stripNonCode(src, { keepStrings = false } = {}) {
  let out = "";
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, " ");
  const mask = keepStrings ? (s) => s : blank;
  // Pilha de templates: cada `${` empilha a profundidade de chaves a fechar.
  const templates = [];
  let braces = 0;
  let last = ""; // último caractere significativo fora de string/comentário
  const regexAllowed = () =>
    last === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(last);
  const readTemplate = () => {
    // Em um template aberto: consome texto até "`" (fecha) ou "${" (volta ao código).
    let start = i;
    while (i < n) {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        out += mask(src.slice(start, i)) + (keepStrings ? "`" : " ");
        i++;
        last = "`";
        return true;
      }
      if (c === "$" && src[i + 1] === "{") {
        out += mask(src.slice(start, i)) + (keepStrings ? "${" : "  ");
        i += 2;
        templates.push(braces);
        braces++;
        last = "{";
        return true;
      }
      i++;
    }
    out += mask(src.slice(start, i));
    return false;
  };
  while (i < n) {
    const c = src[i],
      d = src[i + 1];
    if (c === "/" && d === "/") {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? n : j;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j < 0 ? n : j + 2;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n")
        j += src[j] === "\\" ? 2 : 1;
      out += c + mask(src.slice(i + 1, j)) + (src[j] === c ? c : "");
      i = j + 1;
      last = c;
    } else if (c === "`") {
      out += "`";
      i++;
      readTemplate();
    } else if (c === "/" && regexAllowed()) {
      let j = i + 1,
        inClass = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "[") {
          inClass = true;
          j++;
        } else if (src[j] === "]") {
          inClass = false;
          j++;
        } else if (src[j] === "/" && !inClass) break;
        else j++;
      }
      if (src[j] === "/") {
        let k = j + 1;
        while (/[a-z]/.test(src[k] ?? "")) k++;
        out += "/" + mask(src.slice(i + 1, j)) + "/" + src.slice(j + 1, k);
        i = k;
        last = "/";
      } else {
        out += c;
        i++;
        last = c;
      }
    } else {
      if (c === "{") braces++;
      if (c === "}") {
        braces--;
        if (templates.length && templates.at(-1) === braces) {
          templates.pop();
          out += "}";
          i++;
          readTemplate();
          continue;
        }
      }
      out += c;
      i++;
      if (!/\s/.test(c)) last = c;
    }
  }
  return out;
}

const IMPORT =
  /(?:^|[\n;])\s*(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']|(?:^|[\n;])\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** Especificadores dos imports estáticos e dinâmicos de um arquivo (strings literais), na ordem em que aparecem. */
export function importsOf(rel) {
  // Strings têm de sobreviver: só comentários saem (o texto do especificador é o que se quer).
  const noComments = read(rel).replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  const lines = noComments
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l))
    .join("\n");
  const found = [];
  for (const m of lines.matchAll(IMPORT)) found.push(m[1] ?? m[2] ?? m[3]);
  return found;
}

/** Arquivo (relativo à raiz) para o qual `spec` aponta a partir de `from`, ou null se não é relativo/absoluto do projeto. */
export function resolveImport(from, spec) {
  if (spec.startsWith("/")) return spec.slice(1); // servido pelo servidor a partir da raiz do helper
  if (!spec.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
}
