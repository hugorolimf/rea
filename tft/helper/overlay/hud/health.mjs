/**
 * Saúde das fontes para o indicador discreto do dock e para o painel de ajuda. Função pura, sem DOM e sem imports:
 * só reorganiza o que o modelo de tela (`view.mjs`) e o host já informam. Nada é medido aqui.
 *
 * Cada item: `{ id, ok, text, title }`. `ok`: true (funcionando), false (com problema) ou null (sem informação
 * ou sem dado ainda). `id`: "server" | "gep" | "data" | "game".
 */

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

/**
 * Dados do jogador (ouro, nível, XP, loja, itens): o servidor diz quais campos ficaram sem fonte (`sources.missing`, os
 * nomes para o usuário). O helper não lê a tela; sem o GEP esses campos ficam desconhecidos.
 */
function dataHealth(view) {
  const src = sourcesOf(view);
  const missing = Array.isArray(src?.missing)
    ? src.missing.filter((m) => typeof m === "string" && m)
    : [];
  if (missing.length)
    return {
      id: "data",
      ok: false,
      text: `Sem fonte: ${missing.join(", ")}`,
      title:
        "Sem o GEP (Overwolf com o TFTAcademy aberto e gravando a partida), estes dados do jogador ficam desconhecidos: o helper não lê a tela. Abra o TFTAcademy para que voltem.",
    };
  // Só afirma "pelo GEP" com evidência: algum campo declarado como "gep" ou o chip do GEP ativo.
  const fromGep =
    [src?.shopSource, src?.goldSource, src?.levelSource].includes("gep") ||
    src?.gep?.state === "ativo";
  if (!fromGep)
    return {
      id: "data",
      ok: null,
      text: "Dados do jogador: sem informação",
      title: "O servidor ainda não informou de onde vêm os dados do jogador.",
    };
  return {
    id: "data",
    ok: true,
    text: "Dados do jogador pelo GEP",
    title:
      "Ouro, nível, XP, loja e itens do jogador vêm da fonte GEP (TFTAcademy).",
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
    dataHealth(view),
    gameHealth(game),
  ];
}

/** Pior situação do conjunto: false se algum falhou, null se algum sem informação, senão true. */
export function worstOk(items) {
  if (items.some((i) => i.ok === false)) return false;
  if (items.some((i) => i.ok === null)) return null;
  return true;
}
