/**
 * Lista de comps do modal da célula "Meta" do HUD: funções puras sobre o encaixe do motor (`compRanking` de
 * /api/recommend) e a comp que o Ao vivo mostra. Não decide nada de jogo: só ordena, escolhe onde abrir e navega.
 *
 * O "N/M" do anel do HUD NÃO é a posição entre as sugestões: é `plan.progress`, as peças da comp que já estão em campo
 * (roster.js no cliente; as que estão só na reserva vêm à parte, "+K na reserva"). A posição entre as sugestões é a de
 * `positionLabel`.
 */

/** Quantas comps o motor marca como sugeridas (`suggested` no ranking). */
export const SUGGESTION_COUNT = 3;

/**
 * Comps oferecidas no modal, em ordem de leitura:
 * - as sugeridas pelo motor, pela posição final dele (`rank`); em motor antigo, sem `suggested`, as primeiras do ranking;
 * - a comp que o Ao vivo mostra (`planId`) e a comp fixada (`goalId`), à frente, quando não estão entre as sugeridas
 *   (uma comp fixada pode ter encaixe ruim; o plano pode ser um tabuleiro fora da lista de meta e nesse caso não entra).
 * `knownIds` (Set) limita aos ids das comps de meta carregadas; sem ele, vale o ranking como veio.
 * Devolve `{ ids, start }`: `start` é onde abrir (a comp que o Ao vivo mostra; senão a fixada; senão a primeira).
 */
export function suggestionIds({
  ranking = [],
  knownIds = null,
  planId = null,
  goalId = null,
} = {}) {
  const known = (id) =>
      typeof id === "string" && (!knownIds || knownIds.has(id)),
    byRank = (Array.isArray(ranking) ? ranking : [])
      .filter((r) => r && known(r.id))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  let picked = byRank.filter((r) => r.suggested === true);
  if (!picked.length) picked = byRank.slice(0, SUGGESTION_COUNT);
  const ranked = picked.map((r) => r.id),
    lead = [planId, goalId].filter((id) => known(id) && !ranked.includes(id)),
    ids = [...new Set([...lead, ...ranked])],
    at = [planId, goalId].map((id) => ids.indexOf(id)).find((i) => i >= 0);
  return { ids, start: at ?? 0 };
}

/** Índice a mostrar depois de uma atualização: mantém a comp que o usuário está vendo, se ainda estiver na lista. */
export function keepIndex(ids, currentId, start = 0) {
  const i = currentId == null ? -1 : ids.indexOf(currentId);
  return i >= 0 ? i : Math.min(Math.max(0, start), Math.max(0, ids.length - 1));
}

/** Passo da navegação por setas, dando a volta nas pontas ("anterior" da primeira é a última). */
export function stepIndex(index, delta, length) {
  if (!(length > 0)) return 0;
  return (((index + delta) % length) + length) % length;
}

/** "2 de 3" para o leitor de tela e o cabeçalho. */
export const positionLabel = (index, length) =>
  length > 0 ? `${index + 1} de ${length}` : "sem sugestões";

/**
 * Estado de uma comp no modal: `chosen` = é a fixada (mostra "Escolhida" e "Desfazer"); `live` = é a que o Ao vivo
 * mostra agora; `suggested` = está entre as sugeridas do motor. A fixada vira o plano do Ao vivo, então `live` e
 * `chosen` coincidem depois que o servidor aceita a escolha.
 * `best` = a melhor sugestão pela medida do motor (o score; `best` do ranking); `kept` = é a do Ao vivo, mas mantida
 * atrás de outra de score maior (histerese da troca de plano: a nota do plano diz por quê).
 */
export function choiceState({
  id,
  goalId = null,
  planId = null,
  ranking = [],
}) {
  const rows = Array.isArray(ranking) ? ranking : [],
    row = rows.find((r) => r?.id === id) ?? null,
    top = rows.find((r) => r?.best === true) ?? null,
    live = id != null && id === planId;
  return {
    chosen: id != null && id === goalId,
    live,
    suggested: row?.suggested === true,
    best: row?.best === true,
    kept:
      live &&
      !!top &&
      top.id !== id &&
      (row?.kept === true ||
        (Number.isFinite(row?.score) &&
          Number.isFinite(top.score) &&
          row.score < top.score)),
  };
}

/** Passo da tecla de navegação do modal (seta esquerda/direita); null para qualquer outra tecla. */
export const navKey = (key) =>
  key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : null;
