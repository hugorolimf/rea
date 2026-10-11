/**
 * Saúde das fontes para o indicador discreto do dock e para o painel de ajuda. Função pura, sem DOM e sem imports:
 * só reorganiza o que o modelo de tela (`view.mjs`) e o host já informam. Nada é medido aqui.
 *
 * Cada item: `{ id, ok, text, title }`. `ok`: true (funcionando), false (com problema) ou null (sem informação
 * ou sem dado ainda). `id`: "server" | "gep" | "screen" | "game".
 */

/** Origens que contam como leitura de tela (o servidor usa "screen"; o modelo da interface, "tela"/"derivado"). */
const SCREEN_SOURCES = new Set(["screen", "tela", "derived", "derivado"]);

const sourcesOf = (view) =>
  view?.sources && typeof view.sources === "object" ? view.sources : null;

/** Servidor do helper: sem resposta, conectando, dado velho ou respondendo. */
function serverHealth(view, offline) {
  if (offline)
    return {
      id: "server",
      ok: false,
      text: "Servidor sem resposta",
      title:
        "O helper não respondeu às últimas consultas; o desenho é a última leitura recebida.",
    };
  const status = view?.status ?? "loading";
  if (status === "loading")
    return {
      id: "server",
      ok: null,
      text: "Conectando ao helper",
      title: "Aguardando a primeira resposta do servidor.",
    };
  const old = (view?.notices ?? []).find(
    (n) => n.kind === "state-old" || n.kind === "analysis-old",
  );
  if (old)
    return {
      id: "server",
      ok: null,
      text: `Dado velho: ${old.text}`,
      title: old.title,
    };
  if (status === "no-state")
    return {
      id: "server",
      ok: null,
      text: "Servidor ok, sem leitura da partida",
      title:
        "O servidor responde, mas ainda não recebeu o estado de uma partida.",
    };
  return {
    id: "server",
    ok: true,
    text: "Servidor do helper respondendo",
    title: "A consulta de /api/overlay está funcionando.",
  };
}

/** Fonte GEP (TFTAcademy): ativa, ou em reserva com o motivo que o servidor deu. */
function gepHealth(view) {
  const g = sourcesOf(view)?.gep ?? view?.bar?.gep ?? null;
  if (!g)
    return {
      id: "gep",
      ok: null,
      text: "GEP: sem informação",
      title:
        "O servidor ainda não informou o estado da fonte GEP (TFTAcademy).",
    };
  return {
    id: "gep",
    ok: g.state === "ativo",
    text: g.short ?? g.state ?? "GEP",
    title: g.label ?? g.short ?? "Fonte GEP (TFTAcademy)",
  };
}

/** Leitor de tela: erro do leitor, em uso, em reserva (o GEP cobre os dados) ou sem informação. */
function screenHealth(view) {
  const src = sourcesOf(view);
  if (src?.reader)
    return {
      id: "screen",
      ok: false,
      text: `Leitor de tela: ${src.reader}`,
      title: `O leitor de tela relatou: ${src.reader}`,
    };
  const used = [src?.shopSource, src?.goldSource, src?.levelSource].filter(
    Boolean,
  );
  if (!src || !used.length)
    return {
      id: "screen",
      ok: null,
      text: "Leitor de tela: sem informação",
      title: "O servidor ainda não informou a origem dos dados lidos.",
    };
  if (used.some((s) => SCREEN_SOURCES.has(s)))
    return {
      id: "screen",
      ok: true,
      text: "Leitura de tela em uso",
      title: "Parte dos dados (loja, ouro ou nível) vem da leitura de tela.",
    };
  return {
    id: "screen",
    ok: true,
    text: "Leitor de tela em reserva",
    title:
      "Os dados vêm da fonte GEP; a leitura de tela só entra se ela falhar.",
  };
}

/** Janela do TFT: não acompanhada (modo painel), não encontrada, em tela cheia exclusiva ou detectada. */
function gameHealth(game) {
  if (!game || typeof game !== "object")
    return {
      id: "game",
      ok: null,
      text: "Janela do TFT: não acompanhada",
      title: "No modo painel o overlay não segue a janela do jogo.",
    };
  if (game.found !== true)
    return {
      id: "game",
      ok: false,
      text: "Janela do TFT não encontrada",
      title:
        "O overlay não localizou a janela do TFT (só funciona em janela ou janela sem borda). Abra o jogo ou peça nova detecção.",
    };
  if (game.fullscreen?.warn)
    return {
      id: "game",
      ok: false,
      text: game.fullscreen.text || "Tela cheia exclusiva",
      title:
        "O jogo está em tela cheia exclusiva: o overlay não aparece sobre ele. Use janela ou janela sem borda.",
    };
  const size =
    Number.isFinite(game.width) && Number.isFinite(game.height)
      ? ` ${Math.round(game.width)}x${Math.round(game.height)}`
      : "";
  return {
    id: "game",
    ok: true,
    text: `TFT detectado${size}`,
    title: "O overlay está ancorado na área cliente da janela do TFT.",
  };
}

/**
 * Saúde das quatro fontes. `view`: modelo de `overlayView`; `offline`: o servidor parou de responder; `game`:
 * `mode.game` do host (ou null fora do modo integrado).
 */
export function healthOf(view, { offline = false, game = null } = {}) {
  return [
    serverHealth(view, offline === true),
    gepHealth(view),
    screenHealth(view),
    gameHealth(game),
  ];
}

/** Pior situação do conjunto: false se algum falhou, null se algum sem informação, senão true. */
export function worstOk(items) {
  if (items.some((i) => i.ok === false)) return false;
  if (items.some((i) => i.ok === null)) return null;
  return true;
}
