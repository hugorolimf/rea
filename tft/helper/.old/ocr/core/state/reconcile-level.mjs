// ARQUIVO HISTÓRICO (fora do sistema; nada fora de .old/ importa este arquivo). Conciliação do nível lido pelo OCR do HUD
// (número do nível + total do XP), extraída de core/state/level.mjs quando a leitura de tela saiu do helper (2026-10-11).
// `screen-reader.mjs` (nesta pasta) a importava por `rules.mjs`; para restaurar, devolva as duas funções a
// core/state/level.mjs e a reexportação a rules.mjs (ver .old/ocr/README.md).
import { XP, levelsForXp } from "../../../../core/state/level.mjs";

/**
 * Nível a partir do XP mostrado ("4/10" → 4): o total do XP é o que falta para o próximo nível. Totais repetidos
 * (2: nível 1 ou 2; 68: nível 8 ou 9) são resolvidos pelo nível conhecido mais próximo (`hint`); sem pista, o maior.
 * `prevXp` (a leitura anterior) detecta a subida dentro do empate: no mesmo nível o XP atual nunca cai, então o
 * mesmo total com XP menor e o total do nível seguinte igual significa que subiu ("60/68" → "4/68" com pista 8 → 9).
 */
export function levelFromXp(xp, hint = null, prevXp = null) {
  const cur = /^(\d+)\/(\d+)$/.exec(xp ?? "");
  const levels = levelsForXp(xp);
  if (!levels.length) return null;
  const total = Number(cur[2]);
  const prev = /^(\d+)\/(\d+)$/.exec(prevXp ?? "");
  if (
    hint != null &&
    prev &&
    prev[2] === cur[2] &&
    Number(cur[1]) < Number(prev[1]) &&
    XP.xpToNext[hint + 1] === total
  )
    hint += 1;
  if (levels.length === 1 || hint == null) return levels.at(-1);
  return levels.reduce((best, lv) =>
    Math.abs(lv - hint) < Math.abs(best - hint) ? lv : best,
  );
}

/**
 * Junta as duas leituras do HUD num nível: `ocr` (o número do nível) e `xp` ("atual/total", cujo total diz o nível).
 * Devolve `{ level, source, conflict, ambiguous }` com `source` em "ocr+xp" (as duas concordam), "ocr", "xp" (nível
 * inferido do total, sem leitura do número), "held" (conflito sem saída: mantém `held`) ou null.
 * Em conflito (o total de XP não existe para o nível lido) vale a leitura plausível: o nível só sobe, de 1 em 1 em
 * condições normais, então com `held` confiável ("trusted") só vale `held` até `held + 2`. Se as duas forem plausíveis,
 * vence o número lido (o OCR dele exige três cópias iguais; o do XP é uma leitura só). `ambiguous` marca o total
 * repetido (2, 68) resolvido apenas pela pista.
 */
export function reconcileLevel({
  ocr = null,
  xp = null,
  prevXp = null,
  held = null,
  trusted = true,
} = {}) {
  const candidates = levelsForXp(xp),
    inferred = candidates.length ? levelFromXp(xp, held, prevXp) : null,
    ambiguous = candidates.length > 1;
  if (ocr == null)
    return {
      level: inferred,
      source: inferred == null ? null : "xp",
      conflict: false,
      ambiguous,
    };
  if (!candidates.length)
    return { level: ocr, source: "ocr", conflict: false, ambiguous: false };
  if (candidates.includes(ocr))
    return { level: ocr, source: "ocr+xp", conflict: false, ambiguous };
  const plausible = (lv) =>
    !trusted || held == null || (lv >= held && lv <= held + 2);
  if (plausible(ocr))
    return { level: ocr, source: "ocr", conflict: true, ambiguous: false };
  if (inferred != null && plausible(inferred))
    return { level: inferred, source: "xp", conflict: true, ambiguous };
  return { level: held, source: "held", conflict: true, ambiguous: false };
}
