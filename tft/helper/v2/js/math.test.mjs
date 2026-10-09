// Rodar com: node --test tft/helper/v2/js/math.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  arc,
  binomialTail,
  boardSize,
  cumulativeCurve,
  hexCenter,
  hexCorners,
  monotonePath,
  polar,
  quadAngle,
  quadAt,
  shopsFor,
  springEasing,
  springResponse,
  settlingTime,
} from "./math.js";

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("mola parte de 0, termina em 1 e oscila quando subamortecida", () => {
  const p = { stiffness: 170, damping: 14 };
  near(springResponse(0, p), 0);
  near(springResponse(5, p), 1, 1e-6);
  const peak = Math.max(
    ...Array.from({ length: 400 }, (_, i) => springResponse(i / 200, p)),
  );
  assert.ok(peak > 1, "subamortecida deve ultrapassar 1");
});

test("mola crítica e superamortecida nunca ultrapassam 1", () => {
  for (const damping of [2 * Math.sqrt(170), 60]) {
    const p = { stiffness: 170, damping };
    const peak = Math.max(
      ...Array.from({ length: 400 }, (_, i) => springResponse(i / 100, p)),
    );
    assert.ok(peak <= 1 + 1e-9, `damping ${damping}: pico ${peak}`);
    near(springResponse(8, p), 1, 1e-6);
  }
});

test("springEasing gera linear() com extremos 0 e 1 e duração coerente", () => {
  const { easing, duration } = springEasing({ stiffness: 200, damping: 22 });
  assert.match(easing, /^linear\(0, .*, 1\)$/);
  assert.equal(
    duration,
    Math.round(settlingTime({ stiffness: 200, damping: 22 }) * 1000),
  );
  assert.ok(duration > 100 && duration < 3000);
});

test("hexágono de topo pontudo: 6 vértices a distância `size` do centro", () => {
  const size = 30,
    corners = hexCorners(10, 20, size);
  assert.equal(corners.length, 6);
  for (const [x, y] of corners) near(Math.hypot(x - 10, y - 20), size, 1e-9);
  const ys = corners.map(([, y]) => y);
  near(Math.min(...ys), 20 - size);
  near(Math.max(...ys), 20 + size);
});

test("linhas ímpares deslocam meia largura e o tabuleiro cabe no tamanho calculado", () => {
  const s = 30,
    a = hexCenter(2, 0, s),
    b = hexCenter(2, 1, s);
  near(b.x - a.x, (Math.sqrt(3) * s) / 2);
  const { width, height } = boardSize(7, 4, s);
  const last = hexCenter(6, 1, s);
  assert.ok(last.x + (Math.sqrt(3) * s) / 2 <= width + 1e-9);
  near(hexCenter(0, 3, s).y + s, height);
});

test("arco Bézier: extremos exatos e tangente alinhada à corda quando bend=0", () => {
  const q = arc({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
  near(quadAt(q, 0).x, 0);
  near(quadAt(q, 1).x, 100);
  near(quadAngle(q, 1), 0);
  near(quadAt(q, 0.5).y, 0);
  const bent = arc({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.3);
  near(quadAt(bent, 0.5).y, 0.15 * 100, 1e-9);
});

test("polar: 0° à direita, 90° para baixo", () => {
  const r = polar(0, 0, 10, 0),
    d = polar(0, 0, 10, 90);
  near(r.x, 10);
  near(d.y, 10);
});

test("cauda binomial: casos limite e valor conhecido", () => {
  assert.equal(binomialTail(0, 5, 0.1), 1);
  assert.equal(binomialTail(3, 2, 0.9), 0);
  assert.equal(binomialTail(1, 5, 0), 0);
  assert.equal(binomialTail(2, 2, 1), 1);
  near(binomialTail(1, 4, 0.5), 1 - 0.5 ** 4);
  // P(X≥2), n=4, p=0.5 = (6+4+1)/16
  near(binomialTail(2, 4, 0.5), 11 / 16);
});

test("cauda binomial é monótona em n e cumulativeCurve fecha em ~1", () => {
  const curve = cumulativeCurve(2, 0.12, 60);
  for (let i = 1; i < curve.length; i++)
    assert.ok(curve[i].v >= curve[i - 1].v - 1e-12);
  assert.ok(curve.at(-1).v > 0.99);
});

test("shopsFor é o menor n que atinge a confiança", () => {
  const n = shopsFor(1, 0.12, 0.8);
  assert.ok(binomialTail(1, n, 0.12) >= 0.8);
  assert.ok(binomialTail(1, n - 1, 0.12) < 0.8);
  const m = shopsFor(3, 0.12, 0.8);
  assert.ok(binomialTail(3, m, 0.12) >= 0.8);
  assert.ok(binomialTail(3, m - 1, 0.12) < 0.8);
  assert.equal(shopsFor(2, 0, 0.8), Infinity);
});

test("monotonePath: não ultrapassa os pontos e preserva monotonia", () => {
  const pts = cumulativeCurve(2, 0.2, 12).map(({ n, v }) => ({
    x: n * 10,
    y: 100 - v * 100,
  }));
  const path = monotonePath(pts);
  assert.match(path, /^M0 100C/);
  const nums = [...path.matchAll(/C([\d. -]+)/g)].flatMap((m) =>
    m[1].trim().split(/[ ]+/).map(Number),
  );
  for (let i = 1; i < nums.length; i += 2)
    assert.ok(nums[i] <= 100.001 && nums[i] >= -0.001);
  assert.equal(monotonePath([]), "");
  assert.equal(monotonePath([{ x: 1, y: 2 }]), "M1 2");
});
