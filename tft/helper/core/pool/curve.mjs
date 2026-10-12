// Chance acumulada por ouro de fechar uma estrela rolando a loja (a conta exata de um campeão, com a pool encolhendo).
import { SHOP } from "./tables.mjs";
import { slotChance } from "./shop.mjs";

/** PMF da Binomial(n, p) por recorrência, sem fatoriais. */
export function binomialPmf(n, p) {
  const out = new Array(n + 1).fill(0);
  if (p <= 0) return ((out[0] = 1), out);
  if (p >= 1) return ((out[n] = 1), out);
  out[0] = (1 - p) ** n;
  for (let i = 0; i < n; i++)
    out[i + 1] = out[i] * ((n - i) / (i + 1)) * (p / (1 - p));
  return out;
}

/**
 * Chance exata de juntar `goal` cópias gastando no máximo g de ouro, para g = 0..maxGold.
 * Cadeia de Markov em (cópias compradas × ouro): cada loja custa `SHOP.cost` e mostra Binomial(slots, p_k) cópias,
 * com p_k = odds × (livres − k) ÷ (livres do custo − k) — a pool encolhe a cada compra; cada cópia
 * comprada custa `cost`. Compra tudo o que aparecer e couber no ouro. `free` e `denom` são fracionários.
 */
export function closeCurve({ level, cost, own, goal, free, denom, maxGold }) {
  const need = goal - own,
    curve = new Float64Array(maxGold + 1);
  if (need <= 0) return curve.fill(1);
  if (free < need || !cost) return curve;
  // f[k][g]: chance de fechar já tendo comprado k cópias e com g de ouro.
  const f = Array.from(
    { length: need + 1 },
    () => new Float64Array(maxGold + 1),
  );
  f[need].fill(1);
  const pmf = Array.from({ length: need }, (_, k) =>
    binomialPmf(SHOP.slots, slotChance(level, cost, free - k, denom - k)),
  );
  for (let g = SHOP.cost; g <= maxGold; g++) {
    const left = g - SHOP.cost,
      afford = Math.floor(left / cost);
    for (let k = need - 1; k >= 0; k--) {
      let v = 0;
      for (let x = 0; x <= SHOP.slots; x++) {
        const b = Math.min(x, need - k, afford);
        v += pmf[k][x] * f[k + b][left - b * cost];
      }
      f[k][g] = v;
    }
  }
  return f[0];
}

/** Menor ouro com chance ≥ q na curva (null se não chegar). */
export function goldFor(curve, q) {
  for (let g = 0; g < curve.length; g++) if (curve[g] >= q - 1e-12) return g;
  return null;
}
