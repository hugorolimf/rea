// Chaves de cache da análise: o que invalida o quê.
//
// A análise tem duas camadas (server.mjs):
//   base   (engine.mjs + busca de evidência): escolhe e mede os planos. Custa de ~0,3 s a vários segundos (rede).
//   tática (tactics/stage/strategy/playbook): o que fazer agora com a base. Barata.
//
// Cada entrada da tabela abaixo diz de que camada depende:
//   tabuleiro dos jogadores (peças, estrelas, itens, vida)  base + tática
//   nível, nível-alvo, ouro, banco, inventário, aprimoramentos, trocas   base + tática
//   plano mantido (id, peças) e o `holdPlan`                base + tática
//   loja, XP, removedores, sequência de vitórias/derrotas   só tática
//   cópias de meta (builds, comps, estatísticas, evidência) base (por versão)
// Fora de qualquer chave: o horário em que o jogo regravou o arquivo e o que não muda a leitura (tempo de partida,
// posições). Antes, `modifiedAt` entrava nas duas camadas e qualquer regravação do arquivo refazia tudo.
import { createHash } from "node:crypto";

const sortedItems = (u) => [...(u.itemNames ?? [])].sort();

/**
 * Assinatura do conteúdo do snapshot que a análise lê: por jogador, vida, colocação, aprimoramentos e as peças
 * (campeão, estrela, itens, ordenadas). Muda quando o JOGO muda, não quando o arquivo é regravado.
 */
export function snapshotSignature(snapshot) {
  const players = (snapshot?.statsBlock?.players ?? [])
    .map((p) => [
      String(p.playerId),
      p.health ?? null,
      p.ffaStanding ?? null,
      [...(p.augments ?? [])].map(String).sort(),
      (p.boardPieces ?? [])
        .map(
          (u) =>
            `${u.championName}:${u.starLevel ?? 1}:${sortedItems(u).join("+")}:${u.price ?? ""}`,
        )
        .sort(),
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return createHash("sha1")
    .update(
      JSON.stringify([
        snapshot?.gameId ?? null,
        snapshot?.statsBlock?.setCoreName ?? null,
        players,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}

/** Identificador curto de uma análise base (para contar leituras distintas sem guardar a chave inteira). */
export const baseId = (inputs) =>
  createHash("sha1").update(inputs).digest("hex").slice(0, 12);

/**
 * Entradas da camada base, em ordem fixa. `source` é a assinatura do snapshot; `builds`/`comps` são as datas das cópias
 * de meta. Fora daqui (de propósito): loja, XP, removedores, sequência (só tática) e a evidência (versionada à parte).
 */
export function baseInputs(options, { source, builds, comps, stats = null }) {
  return JSON.stringify({
    source,
    builds,
    comps,
    // Cópia das estatísticas de colocação por campeão × item (valor medido dos itens, item-plan.mjs).
    stats,
    level: options.level,
    targetLevel: options.targetLevel,
    gold: options.gold,
    playerId: options.playerId,
    bench: options.bench,
    hidden: options.hidden,
    inventory: options.inventory,
    // Banco lido (ou não): sem leitura o plano de itens só devolve a lista de desejos.
    bankRead: options.bankRead !== false,
    previewIds: options.previewIds,
    augmentTraits: options.augmentTraits,
    // Tier por comp (augAdj) e emblemas dados vêm dos ids; a ordem não muda a soma.
    augments: [...options.augments].sort(),
    // Substituições que de fato entraram nas comps de meta (as descartadas não mudam a análise).
    swaps: options.metaComps
      .filter((c) => c.appliedSwaps)
      .map((c) => [c.id, c.appliedSwaps]),
    goalCarryId: options.goalCarryId,
    stickyCompId: options.stickyCompId,
    stickyUnits: options.sticky?.units ?? null,
    // O plano mantido muda a medição só entre planos da mesma classe; o servidor decide e o motor obedece.
    holdPlan: options.holdPlan === true,
    stage: options.stage?.stage ?? null,
  });
}
