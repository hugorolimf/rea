import { esc } from "../dom.js";
import { champIcon, getCatalog, itemIcon, portrait } from "./glyphs.js";

/**
 * Texto rico: troca, dentro de uma frase, o nome de um campeão ou de um item pela imagem dele (regra do produto:
 * nenhum nome de campeão ou item aparece só como texto). Serve às frases geradas pelo servidor ("Teemo (hoje 2★) +
 * Pebbles", razões, passos, notas) e a qualquer texto que cite peças.
 *
 * Regras de casamento, pelo catálogo do jogo (`getCatalog()`):
 * - compara sem acento e sem diferença de maiúsculas, mas só troca quando o trecho do texto começa em maiúscula
 *   (nomes próprios; "Vi" é campeã, "vi" é verbo);
 * - só em palavra inteira (aceita o possessivo `'s` e o plural em "s" para nomes de 6+ letras);
 * - vence a correspondência mais longa ("Sunfire Cape" antes de qualquer nome menor dentro dele);
 * - sinergias, aprimoramentos e qualquer termo ambíguo (mesmo nome para campeão e item, ou para campeão e sinergia)
 *   entram no dicionário como "bloqueio": o trecho é consumido e fica como texto, nunca vira imagem.
 * O HTML devolvido escapa todo o texto; só este módulo insere as imagens (via `portrait`).
 */

/** Dobra o texto para comparar: sem acento, minúsculo e com o mesmo comprimento do original. */
export function fold(text) {
  const s = String(text ?? "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (c === "’" || c === "‘") c = "'";
    else if (c === " ") c = " ";
    const d = c.normalize("NFD")[0] ?? c;
    out += d.toLowerCase()[0] ?? d;
  }
  return out;
}

const WORD = /[\p{L}\p{N}]/u;
const isWord = (c) => c !== undefined && WORD.test(c);

const lexicons = new WeakMap();

/** Entre vários ids com o mesmo nome (versões "Upgrade", "Prismatic"...), o que tem ícone e o id mais curto. */
const preferred = (entries, hasIcon) =>
  [...entries].sort(
    (a, b) =>
      Number(hasIcon(b)) - Number(hasIcon(a)) || a.id.length - b.id.length,
  )[0];

/**
 * Dicionário (trie por caractere dobrado) do catálogo. Cada nó terminal guarda a entrada a trocar
 * (`{kind, id, name}`) ou `null` quando o termo só deve ser consumido (sinergia, aprimoramento, ambíguo).
 */
export function lexiconOf(catalog = getCatalog()) {
  const cached = lexicons.get(catalog);
  if (cached) return cached;
  const found = new Map();
  const put = (name, kind, id, icon = null) => {
    const key = fold(String(name ?? "").trim());
    if (key.length < 2) return;
    if (!found.has(key)) found.set(key, []);
    found.get(key).push({ kind, id, name: String(name).trim(), icon });
  };
  for (const [id, c] of catalog.champions ?? [])
    put(c.name, "champion", id, c.icon);
  for (const [id, i] of catalog.items ?? []) {
    // Item de verdade = tem ícone no jogo ou um tipo conhecido; o resto (aprimoramentos) só bloqueia.
    const real = !!i.icon || (i.kind && i.kind !== "other");
    put(i.name, real ? "item" : "other", id, i.icon);
  }
  for (const name of catalog.traits?.keys?.() ?? []) put(name, "trait", name);
  const root = { next: new Map(), entry: undefined };
  for (const [key, list] of found) {
    const kinds = new Set(list.map((e) => e.kind));
    let entry = null;
    if (kinds.size === 1 && (kinds.has("champion") || kinds.has("item")))
      entry = preferred(list, (e) => !!e.icon);
    let node = root;
    for (const ch of key) {
      if (!node.next.has(ch))
        node.next.set(ch, { next: new Map(), entry: undefined });
      node = node.next.get(ch);
    }
    node.entry = entry
      ? { kind: entry.kind, id: entry.id, name: entry.name }
      : null;
  }
  lexicons.set(catalog, root);
  return root;
}

/** Fim do trecho do texto casado a partir de `start` (correspondência mais longa em palavra inteira) ou null. */
function longestAt(root, low, src, start) {
  let node = root,
    best = null;
  for (let i = start; i < low.length; i++) {
    node = node.next.get(low[i]);
    if (!node) break;
    if (node.entry === undefined) continue;
    const end = i + 1,
      len = end - start;
    const after = src[end];
    const wordEnd = !isWord(after);
    // Possessivo ("Teemo's") e plural ("Chain Vests") sobre o nome; fora disso, só palavra inteira.
    const possessive =
      after === "'" && low[end + 1] === "s" && !isWord(src[end + 2]);
    const plural = len >= 6 && low[end] === "s" && !isWord(src[end + 1]);
    if (wordEnd || possessive || plural) best = { end, entry: node.entry };
  }
  return best;
}

/**
 * Divide o texto em trechos: `{ text }` ou `{ ref: {kind, id, name}, text }` (o que foi trocado, como veio escrito).
 * Pura: não toca no DOM.
 */
export function segments(text, catalog = getCatalog()) {
  const src = String(text ?? "");
  if (!src) return [];
  const root = lexiconOf(catalog),
    low = fold(src),
    out = [];
  let plain = 0,
    i = 0;
  const flush = (to) => {
    if (to > plain) out.push({ text: src.slice(plain, to) });
  };
  while (i < src.length) {
    const c = src[i];
    // Só começa em início de palavra e em maiúscula (ou dígito): "vi" minúsculo não é a campeã Vi.
    if (isWord(c) && !isWord(src[i - 1]) && c === c.toUpperCase()) {
      const hit = longestAt(root, low, src, i);
      if (hit) {
        if (hit.entry) {
          flush(i);
          out.push({ ref: hit.entry, text: src.slice(i, hit.end) });
          plain = hit.end;
        }
        i = hit.end;
        continue;
      }
    }
    i++;
  }
  flush(src.length);
  return out;
}

/**
 * Chip de campeão ou item: a imagem (campeão com anel na cor do custo) e o nome só para leitores de tela; com
 * `legend`, o nome fica visível ao lado. Sem ícone (ou se a imagem falhar em `main.js`), mostra o nome em texto.
 */
export function nameChip(kind, id, name, { size = 18, legend = false } = {}) {
  const item = kind === "item",
    src = item ? itemIcon(id) : champIcon(id),
    label = esc(name);
  if (!src)
    return `<span class="rt is-text" data-kind="${kind}"><span class="rt-name">${label}</span></span>`;
  const ring = item
    ? ""
    : ` style="--ring-c:var(--cost-${Math.min(5, Math.max(1, getCatalog().champions.get(id)?.cost ?? 1))})"`;
  return `<span class="rt${legend ? " has-legend" : ""}" data-kind="${kind}" title="${label}"${ring}>${portrait(id, name, { kind, size, hidden: true })}<span class="rt-name">${label}</span></span>`;
}

/**
 * HTML do texto com os nomes de campeões e itens trocados por chips de imagem. `size` é o lado do retrato e
 * `legend` mantém o nome visível ao lado da imagem (listas densas).
 */
export function richText(
  text,
  { size = 18, legend = false, catalog = getCatalog() } = {},
) {
  return segments(text, catalog)
    .map((s) =>
      s.ref
        ? nameChip(s.ref.kind, s.ref.id, s.text, { size, legend })
        : esc(s.text),
    )
    .join("");
}
