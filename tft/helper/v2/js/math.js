/**
 * Matemática pura da interface: molas amortecidas, geometria hexagonal, curvas Bézier,
 * probabilidade binomial e interpolação monótona. Nada aqui toca o DOM.
 */
export const TAU = Math.PI * 2;
export const SQRT3 = Math.sqrt(3);
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (x, digits = 2) => {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
};

/* ---------- Molas ---------- */

/**
 * Resposta ao degrau 0→1 de um oscilador amortecido (solução analítica).
 * ζ<1 oscila e assenta, ζ=1 é crítico, ζ>1 é superamortecido.
 */
export function springResponse(
  t,
  { stiffness = 170, damping = 20, mass = 1 } = {},
) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass),
    zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * w0 * t) *
        (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
    );
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = w0 * Math.sqrt(zeta * zeta - 1),
    r1 = -zeta * w0 + s,
    r2 = -zeta * w0 - s;
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/** Último instante (s) em que a resposta ainda difere de 1 por mais que `eps`. */
export function settlingTime(params, eps = 0.002, limit = 4) {
  const dt = 0.004;
  let last = 0;
  for (let t = 0; t <= limit; t += dt)
    if (Math.abs(springResponse(t, params) - 1) > eps) last = t;
  return Math.min(limit, last + dt);
}

/** Amostra a mola como easing CSS `linear()` e devolve a duração (ms) em que ela assenta. */
export function springEasing(params = {}, samples = 40) {
  const settle = settlingTime(params),
    points = [];
  for (let i = 0; i <= samples; i++)
    points.push(round(springResponse((settle * i) / samples, params), 4));
  points[samples] = 1;
  return {
    duration: Math.round(settle * 1000),
    easing: `linear(${points.join(", ")})`,
  };
}

/* ---------- Hexágonos (topo pontudo, linhas ímpares deslocadas) ---------- */

export function hexCenter(col, row, size) {
  return {
    x: SQRT3 * size * (col + 0.5 * (row & 1) + 0.5),
    y: size * (1.5 * row + 1),
  };
}
export function hexCorners(cx, cy, size) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return [cx + size * Math.cos(a), cy + size * Math.sin(a)];
  });
}
export const hexPoints = (cx, cy, size) =>
  hexCorners(cx, cy, size)
    .map(([x, y]) => `${round(x)},${round(y)}`)
    .join(" ");
export const boardSize = (cols, rows, size) => ({
  width: SQRT3 * size * (cols + 0.5),
  height: size * (1.5 * (rows - 1) + 2),
});

/* ---------- Bézier quadrática ---------- */

/** Arco do ponto `from` a `to`; `bend` é a flecha como fração da corda (sinal escolhe o lado). */
export function arc(from, to, bend = 0.25) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    len = Math.hypot(dx, dy) || 1;
  return {
    from,
    to,
    len,
    c: {
      x: (from.x + to.x) / 2 - (dy / len) * len * bend,
      y: (from.y + to.y) / 2 + (dx / len) * len * bend,
    },
  };
}
export const quadAt = ({ from, c, to }, t) => ({
  x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * c.x + t ** 2 * to.x,
  y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * c.y + t ** 2 * to.y,
});
/** Ângulo (rad) da tangente em t, útil para orientar pontas de seta. */
export const quadAngle = ({ from, c, to }, t) =>
  Math.atan2(
    2 * (1 - t) * (c.y - from.y) + 2 * t * (to.y - c.y),
    2 * (1 - t) * (c.x - from.x) + 2 * t * (to.x - c.x),
  );
export const quadPath = ({ from, c, to }) =>
  `M${round(from.x)} ${round(from.y)}Q${round(c.x)} ${round(c.y)} ${round(to.x)} ${round(to.y)}`;

/* ---------- Coordenadas polares ---------- */

/** Ponto a `deg` graus (sentido horário a partir de +x, y para baixo). */
export const polar = (cx, cy, r, deg) => ({
  x: cx + r * Math.cos((deg * Math.PI) / 180),
  y: cy + r * Math.sin((deg * Math.PI) / 180),
});

/* ---------- Probabilidade ---------- */

/**
 * P(X ≥ k) para X ~ Binomial(n, p), somando a PMF por recorrência
 * pmf(i+1) = pmf(i)·(n−i)/(i+1)·p/(1−p), que evita fatoriais enormes.
 */
export function binomialTail(k, n, p) {
  if (k <= 0) return 1;
  if (n < k || p <= 0) return 0;
  if (p >= 1) return 1;
  let pmf = (1 - p) ** n,
    below = 0;
  for (let i = 0; i < k; i++) {
    below += pmf;
    pmf *= ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return clamp(1 - below);
}
/** Menor número de lojas n com P(≥k acertos) ≥ q; Infinity se não passar de `limit`. */
export function shopsFor(k, p, q, limit = 200) {
  if (k <= 0) return 0;
  if (p <= 0) return Infinity;
  if (k === 1)
    return Math.min(limit, Math.ceil(Math.log(1 - q) / Math.log(1 - p)) || 1);
  for (let n = k; n <= limit; n++) if (binomialTail(k, n, p) >= q) return n;
  return Infinity;
}
export const cumulativeCurve = (k, p, maxN) =>
  Array.from({ length: maxN + 1 }, (_, n) => ({ n, v: binomialTail(k, n, p) }));

/* ---------- Interpolação monótona (Fritsch–Carlson) ---------- */

/** Curva cúbica suave que preserva a monotonia dos pontos, sem overshoot. */
export function monotonePath(points) {
  const n = points.length;
  if (n === 0) return "";
  const f = (v) => round(v, 2);
  if (n === 1) return `M${f(points[0].x)} ${f(points[0].y)}`;
  const dx = [],
    d = [],
    m = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    d[i] = (points[i + 1].y - points[i].y) / (dx[i] || 1);
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++)
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i],
      b = m[i + 1] / d[i],
      s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let path = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    path += `C${f(points[i].x + h)} ${f(points[i].y + m[i] * h)} ${f(points[i + 1].x - h)} ${f(points[i + 1].y - m[i + 1] * h)} ${f(points[i + 1].x)} ${f(points[i + 1].y)}`;
  }
  return path;
}
