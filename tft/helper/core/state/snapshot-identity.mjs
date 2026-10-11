// Identidade do snapshot do jogo: o que a análise lê dele. Dois snapshots com a mesma identidade dão a mesma análise; o
// que fica de fora (horário em que o jogo regravou o arquivo, tempo de partida, ordem das peças) não a muda.
//
// Era `snapshotSignature` de analysis-keys.mjs (o hash SHA-1 dessa mesma estrutura). Agora a estrutura é a CHAVE da entrada
// `snapshot` do grafo de fatos (`identity` em core/graph) e a assinatura que o servidor devolve em `/api/state` é o
// resumo estável dela. ESM puro: sem `node:*`, relógio nem aleatório.
import { canonical, digestString } from "../graph/stable-key.mjs";

const sortedItems = (u) => [...(u.itemNames ?? [])].sort();

/**
 * Conteúdo do snapshot que a análise lê: jogo, set e, por jogador (ordenado pelo id), vida, colocação, aprimoramentos
 * e as peças (campeão, estrela, itens e preço, ordenadas como texto). Muda quando o JOGO muda, não quando o arquivo é
 * regravado nem quando o jogador só reorganiza as peças.
 * @param {{ gameId?: unknown, statsBlock?: { setCoreName?: unknown, players?: any[] } } | null | undefined} snapshot
 */
export function snapshotIdentity(snapshot) {
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
  return [
    snapshot?.gameId ?? null,
    snapshot?.statsBlock?.setCoreName ?? null,
    players,
  ];
}

/** Assinatura curta e estável da identidade (para o corpo de `GET /api/state` e a chave de análise do cliente). */
export const snapshotSignature = (snapshot) =>
  digestString(canonical(snapshotIdentity(snapshot)));
