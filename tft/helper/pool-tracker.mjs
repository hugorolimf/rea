// Banco dos rivais estimado pelo histórico de tabuleiros. O arquivo do jogo só mostra peças em campo; uma
// cópia que sai do tabuleiro foi vendida (voltou para a pool) ou ficou no banco (continua fora da pool).
// Sem ver o banco, cada cópia que sai conta como "provavelmente guardada" com peso que decai com o tempo;
// se a peça volta ao campo (ou vira 2★), a cópia guardada é reconhecida e deixa de contar.
// Rival eliminado devolve tudo à pool e é ignorado. Valores são estimativas, nunca observações.

/** Parâmetros da estimativa: chance inicial de a cópia ter ficado no banco e meia-vida dessa chance. */
export const BENCH_POLICY = {
  keep: 0.5,
  halfLifeMs: 180_000,
  // Banco tem 9 espaços; peças guardadas costumam ser 1★ ou 2★: teto de cópias estimadas por rival.
  maxCopies: 18,
};

const copiesOf = (units) => {
  const m = new Map();
  for (const u of units ?? [])
    m.set(
      u.championName,
      (m.get(u.championName) ?? 0) + 3 ** ((u.starLevel ?? 1) - 1),
    );
  return m;
};

/**
 * Cópias estimadas fora da pool nos bancos dos rivais: Map championName → cópias (fracionárias).
 * `rows` são as capturas de uma partida na ordem gravada ({id, health, units, sourceAt}); `skip` são ids
 * ignorados (o próprio jogador, cujo banco é informado à parte).
 */
export function hiddenHoldings(
  rows,
  { now = Date.now(), skip = new Set(), policy = BENCH_POLICY } = {},
) {
  const byPlayer = new Map();
  for (const r of rows ?? []) {
    const id = String(r.id);
    if (skip.has(id)) continue;
    const seq = byPlayer.get(id) ?? [];
    seq.push(r);
    byPlayer.set(id, seq);
  }
  const total = new Map();
  for (const seq of byPlayer.values()) {
    if ((seq.at(-1)?.health ?? 1) <= 0) continue;
    let prev = new Map();
    const pending = [];
    for (const r of seq) {
      const cur = copiesOf(r.units),
        at = Date.parse(r.sourceAt) || now;
      for (const [c, n] of prev) {
        const gone = n - (cur.get(c) ?? 0);
        if (gone > 0) pending.push({ champion: c, copies: gone, at });
      }
      for (const [c, n] of cur) {
        let back = n - (prev.get(c) ?? 0);
        for (let i = pending.length - 1; i >= 0 && back > 0; i--) {
          if (pending[i].champion !== c) continue;
          const used = Math.min(back, pending[i].copies);
          pending[i].copies -= used;
          back -= used;
          if (!pending[i].copies) pending.splice(i, 1);
        }
      }
      prev = cur;
    }
    const mine = new Map();
    let sum = 0;
    for (const p of pending) {
      const w =
        p.copies *
        policy.keep *
        0.5 ** (Math.max(0, now - p.at) / policy.halfLifeMs);
      mine.set(p.champion, (mine.get(p.champion) ?? 0) + w);
      sum += w;
    }
    const scale = sum > policy.maxCopies ? policy.maxCopies / sum : 1;
    for (const [c, w] of mine) total.set(c, (total.get(c) ?? 0) + w * scale);
  }
  return total;
}
