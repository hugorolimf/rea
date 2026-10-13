// Taxa de vitória (chance de terminar em 1º) como a medida das comps: é ela que ordena as comps (aba Comps e
// recomendado), decide a troca do plano e vira o score. Puro e sem I/O.
//
// A vitória vem MEDIDA sempre que existe: a pergunta do explorer da MetaTFT (evidence.mjs: `win_percentage` dos
// tabuleiros com as suas peças, a peça-chave em cada estrela e os seus itens nos campeões certos) e a vitória publicada
// de cada comp (meta-comps.json `win`). A colocação média NÃO serve de substituta: nas comps do Set 18 (patch 18.4b) a
// relação entre as duas tem R² ≈ 0,19 — comps com a mesma média vencem de 8,5% a 15%.
//
// O que ainda chega em colocações (o custo de trocar de plano, o tier dos aprimoramentos, o ganho publicado das builds
// sem medida de vitória, o tabuleiro que fica se a comp não sai) é convertido pela inclinação medida nas comps de meta
// (`winFit`: mínimos quadrados de vitória × colocação média, pesados pelas partidas). A inclinação é dado, não
// política; só o valor de reserva (`FALLBACK_FIT`, quando não há comps com amostra) é fixo.

/** Partidas mínimas de uma comp para entrar no ajuste vitória × colocação. */
export const FIT_MIN_GAMES = 500;
/**
 * Reserva do ajuste quando faltam comps com amostra: a reta medida no Set 18 (patch 18.4b, 60 comps, 2026-10-12):
 * vitória ≈ 0,364 − 0,0531 × colocação média (4,5º → 12,5%, a média de 1 em 8).
 */
export const FALLBACK_FIT = Object.freeze({
  a: 0.364,
  b: -0.0531,
  n: 0,
  r2: null,
});
/**
 * Régua do score: a vitória que vale 0 (`worst`) e a que vale 50 (`half`). Curva sem teto, 100 × (1 − 2^(−(W − worst) /
 * (half − worst))): 12,5% = 50, 25% ≈ 78, 40% ≈ 92. A régua linear antiga (25% = 100) cortava no fim de jogo, quando o
 * tabuleiro forte põe quase toda comp acima de 25% e todas empatavam em 100. Política deste helper, não medida.
 */
export const WIN_SCALE = Object.freeze({ worst: 0.02, half: 0.125 });

const clamp = (v, lo = 0, hi = 1) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/**
 * Reta medida vitória (fração) × colocação média, das comps de meta (`[{ avg, win (%), games }]`), pesada pelas
 * partidas. Devolve `{ a, b, n, r2 }` (`b` < 0: colocação maior, vitória menor); sem 3 comps com amostra, `FALLBACK_FIT`.
 */
export function winFit(comps, { minGames = FIT_MIN_GAMES } = {}) {
  const pts = (comps ?? []).filter(
    (c) =>
      Number.isFinite(c?.avg) &&
      Number.isFinite(c?.win) &&
      (c.games ?? 0) >= minGames,
  );
  if (pts.length < 3) return FALLBACK_FIT;
  let sw = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (const c of pts) {
    const w = c.games,
      x = c.avg,
      y = c.win / 100;
    sw += w;
    sx += w * x;
    sy += w * y;
    sxx += w * x * x;
    sxy += w * x * y;
  }
  const den = sw * sxx - sx * sx;
  if (!(Math.abs(den) > 1e-12)) return FALLBACK_FIT;
  const b = (sw * sxy - sx * sy) / den,
    a = (sy - b * sx) / sw;
  // Inclinação com o sinal errado (mais colocação, mais vitória) não serve de conversão: fica a reserva.
  if (!(b < 0)) return FALLBACK_FIT;
  let ss = 0,
    st = 0;
  const my = sy / sw;
  for (const c of pts) {
    const y = c.win / 100;
    ss += c.games * (y - (a + b * c.avg)) ** 2;
    st += c.games * (y - my) ** 2;
  }
  return { a, b, n: pts.length, r2: st > 0 ? 1 - ss / st : null };
}

/** Vitória (fração) de uma colocação média pela reta medida: só para o que não tem vitória medida. */
export const winOfAvg = (avg, fit = FALLBACK_FIT) => clamp(fit.a + fit.b * avg);

/**
 * Diferença em colocações (positiva = pior) convertida em diferença de vitória (fração; positiva = mais vitória):
 * `−b × Δcolocação`, com `b` da reta medida. Ex.: +0,5 colocação custa ~2,7 pontos de vitória.
 */
export const winOfPlacementDelta = (delta, fit = FALLBACK_FIT) =>
  Number.isFinite(delta) ? fit.b * delta : 0;

/** Erro padrão de uma taxa de vitória medida em `games` partidas (binomial); 0 sem amostra. */
export const winSe = (win, games) =>
  games > 0 && Number.isFinite(win)
    ? Math.sqrt((clamp(win) * (1 - clamp(win))) / games)
    : 0;

/** Vitória (fração) de uma resposta do explorer ou de uma comp publicada (`win` em %); null sem o número. */
export const winOf = (x) =>
  x && Number.isFinite(x.win) ? clamp(x.win / 100) : null;

/** Score (0 a 100) de uma vitória esperada: estritamente monótono acima de `worst` (mais vitória, score maior), sem teto
 * que empate as comps fortes; 0 sem vitória. */
export const scoreFromWin = (win) =>
  win == null || !Number.isFinite(win)
    ? 0
    : Math.round(
        1000 *
          (1 -
            2 **
              -(
                Math.max(0, win - WIN_SCALE.worst) /
                (WIN_SCALE.half - WIN_SCALE.worst)
              )),
      ) / 10;
