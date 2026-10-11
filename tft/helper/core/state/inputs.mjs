// Do estado do jogo (o que o servidor leu) para as entradas da análise (`options`). É a única tradução: ouro, nível, XP,
// estágio, loja, removedores e oferta de aprimoramentos saem do estado do SERVIDOR; o cliente só manda decisões do
// usuário (comp fixada, trocas, aprimoramentos escolhidos) e, numa partida revista, os campos antigos dele.
// ESM puro.
import { parseStage } from "./clock.mjs";

/** Nível quando nada foi lido nem derivado e o tabuleiro também não diz: o mesmo padrão que o cliente usava. */
const FALLBACK_LEVEL = 7;

/**
 * Entradas da análise derivadas do estado `seen` (tela + arquivos do jogo + GEP, com uma fonte só por campo).
 *  - `augments`: aprimoramentos que o usuário já marcou (a oferta lida some quando uma carta já foi marcada);
 *  - `estimatedLevel`: peças em campo, estimativa de último recurso (`metadata.estimatedLevel`);
 *  - `live`: false numa partida revista, em que a leitura de agora não vale e `level`/`gold` seguem o cliente.
 * Ao vivo devolve também `level`, `levelEstimated`, `levelSource` ("tela", "derivado" ou "estimado") e `gold`
 * (null = não lido; nunca um padrão).
 */
export function analysisInputs(
  seen,
  { augments = [], estimatedLevel = null, live = true } = {},
) {
  const at = parseStage(seen.stage),
    offer = seen.augments ?? [],
    inputs = {
      // Só campeões: o Wisp da loja do GEP (`wisp: true`, `id: null`) não é alvo de compra nem de rolagem.
      shop: (seen.shop ?? []).map((card) =>
        card?.wisp ? null : (card?.id ?? null),
      ),
      // Oferta lida da tela; some quando uma das cartas já foi marcada como escolhida.
      augmentIds: offer.some((id) => augments.includes(id)) ? [] : offer,
      xp: seen.xp,
      removers: seen.removers === 0 ? 0 : null,
      hasRemover: (seen.removers ?? 0) > 0,
      stage: at,
    };
  if (!live) return inputs;
  const read = Number.isInteger(seen.level) ? seen.level : null;
  return {
    ...inputs,
    // Lido ou derivado (piso do XP passivo) pelo servidor; só sem os dois entra o tabuleiro, marcado "estimado".
    level: read ?? estimatedLevel ?? FALLBACK_LEVEL,
    levelEstimated: read === null,
    levelSource:
      read === null
        ? "estimado"
        : seen.sources?.level === "derived"
          ? "derivado"
          : "tela",
    gold:
      Number.isInteger(seen.gold) && seen.gold >= 0 && seen.gold <= 999
        ? seen.gold
        : null,
  };
}
