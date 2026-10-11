/**
 * Roteamento por hash das telas do app. Puro: recebe e devolve strings, sem tocar em `location` nem no DOM (o main.js
 * e ui/shell.js ligam isto à janela). Endereços:
 *
 *   `#ao-vivo` (ou vazio, `#`)  → Ao vivo           `#comps`      → Comps
 *   `#itens`                    → Itens             `#historico`  → Histórico
 *   `#partida/<id>`             → Ao vivo revendo a partida <id> (somente leitura)
 *
 * Endereços antigos continuam valendo: o hash vazio e `#partida/<id>` já eram usados antes desta camada.
 */

/** Telas, na ordem da navegação. `hash` é o endereço canônico; `key` é o atalho de teclado (1 a 4). */
export const VIEWS = [
  {
    id: "live",
    hash: "#ao-vivo",
    label: "Ao vivo",
    title: "Ao vivo",
    icon: "live",
    key: "1",
    hint: "Decisões da rodada",
  },
  {
    id: "comps",
    hash: "#comps",
    label: "Comps",
    title: "Escolher comp",
    icon: "comps",
    key: "2",
    hint: "Escolher a comp",
  },
  {
    id: "items",
    hash: "#itens",
    label: "Itens",
    title: "Itens",
    icon: "items",
    key: "3",
    hint: "Tier de itens e atributos",
  },
  {
    id: "history",
    hash: "#historico",
    label: "Histórico",
    title: "Histórico",
    icon: "history",
    key: "4",
    hint: "Partidas anteriores",
  },
];

const BY_HASH = new Map([
  ["", "live"],
  ["#", "live"],
  ["#ao-vivo", "live"],
  ["#aovivo", "live"],
  ["#live", "live"],
  ["#comps", "comps"],
  ["#itens", "items"],
  ["#items", "items"],
  ["#historico", "history"],
  ["#histórico", "history"],
]);
const REPLAY = /^#partida\/(\d+)$/;

/**
 * Interpreta um hash. `replay` é o id da partida revista (só com `view: "live"`); hash desconhecido cai no Ao vivo
 * (a tela principal), nunca numa página vazia.
 * @returns {{ view: "live" | "comps" | "items" | "history", replay: string | null }}
 */
export function parseHash(hash = "") {
  const raw = String(hash ?? "").trim();
  const replay = REPLAY.exec(raw)?.[1];
  if (replay) return { view: "live", replay };
  let key = raw;
  try {
    key = decodeURI(raw);
  } catch {
    // `%` solto: fica como veio e cai no Ao vivo.
  }
  return { view: BY_HASH.get(key.toLowerCase()) ?? "live", replay: null };
}

/** Hash canônico de uma tela (`#ao-vivo` para o Ao vivo). */
export function hashFor(view) {
  return VIEWS.find((v) => v.id === view)?.hash ?? "#ao-vivo";
}

/** Dados de uma tela pelo id (o Ao vivo se o id for desconhecido). */
export const viewInfo = (id) => VIEWS.find((v) => v.id === id) ?? VIEWS[0];

/** Título do documento: a tela (ou, no Ao vivo, o título dinâmico da ação) mais o nome do app. */
export function documentTitle(view, liveTitle = "TFT Compass") {
  return view === "live" ? liveTitle : `${viewInfo(view).title} · TFT Compass`;
}

/** Tela correspondente a uma tecla de atalho ("1" a "4"), ou null. */
export const viewForKey = (key) => VIEWS.find((v) => v.key === key)?.id ?? null;
