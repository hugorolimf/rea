// Relógio da partida no estado: o estágio-rodada "S-R" lido uma vez, na fronteira, e daí em diante um objeto.
// ESM puro (sem imports, sem tempo implícito): carrega igual no servidor e no navegador.

/** "2-4" -> `{ stage: 2, round: 4 }`; null se o texto não tem o formato estágio-rodada (espaços e zeros à esquerda não valem). */
export function parseStage(text) {
  const m = /^(\d+)-(\d+)$/.exec(text ?? "");
  return m ? { stage: Number(m[1]), round: Number(m[2]) } : null;
}

/** `{ stage, round }` -> "2-4" (o texto canônico que o jogo escreve); null se faltar um dos dois. */
export function stageText(at) {
  return Number.isInteger(at?.stage) && Number.isInteger(at?.round)
    ? `${at.stage}-${at.round}`
    : null;
}
