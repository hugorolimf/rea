// Montagem dos gabaritos de glifo (screen-glyphs.json) a partir dos glifos que o leitor devolve em -Dump e da verdade do GEP.
// ESM puro. Os vetores têm a forma do `Glyph.Shape` do screen-reader.ps1 (grade GW x GH em bytes, base64); a mesma
// distância (RMS) e a mesma regra de aceite (limite e folga) do leitor medem o acerto.
export const GRID = [12, 16];
const N = GRID[0] * GRID[1];

/** Limites do leitor (screen-reader.ps1: $GLYPH_MAX e $GLYPH_GAP). */
export const MAX_D = 0.25;
export const GAP = 0.03;

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const decode = (b64) =>
  Float64Array.from(Buffer.from(b64, "base64"), (b) => b / 255);
const encode = (v) =>
  Buffer.from(
    Uint8Array.from(v, (x) => Math.max(0, Math.min(255, Math.round(x * 255)))),
  ).toString("base64");

/** Distância RMS entre dois vetores de glifo. */
export function dist(a, b) {
  let s = 0;
  for (let i = 0; i < N; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / N);
}

/** Proporção largura/altura plausível de cada caractere (descarta pedaços de glifo partido ou colado). */
function sane(ch, part) {
  const r = part.w / part.h;
  if (ch === "1") return r <= 0.6;
  if (ch === "/") return r >= 0.2 && r <= 0.8;
  return r >= 0.35 && r <= 1.0;
}

const SCALES = ["s100", "s80", "s65", "s115", "s130", "s145"];

/**
 * Amostras `{set, ch, v}` de um quadro: `read` é a linha do leitor com `glyphs`, `truth` a verdade do quadro. Cada campo
 * entra se, em algum limiar, o número de glifos é o do texto esperado (e as proporções batem); o hífen do estágio é
 * reconhecido pela geometria e não vira amostra. O selo de quantidade vem do total de removedores da verdade.
 */
export function samplesOf(read, truth) {
  const out = [],
    labels = {
      gold: truth.gold,
      level: truth.level,
      xp: truth.xp,
      stage: truth.stage,
      badge: truth.removers > 0 ? truth.removers : undefined,
    };
  for (const [set, label] of Object.entries(labels)) {
    const g = read.glyphs?.[set];
    if (label === undefined || label === null || !g) continue;
    const chars = String(label).split("");
    for (const sc of SCALES) {
      const parts = arr(g[sc]);
      if (parts.length !== chars.length) continue;
      const fits = chars.every(
        (ch, i) =>
          (ch === "-") === (parts[i].ch === "-") &&
          (ch === "-" || (parts[i].v && sane(ch, parts[i]))),
      );
      if (!fits) continue;
      chars.forEach(
        (ch, i) => ch !== "-" && out.push({ set, ch, v: decode(parts[i].v) }),
      );
      break;
    }
  }
  return out;
}

function kmeans(vectors, k) {
  if (vectors.length <= k) return vectors.map((v) => Float64Array.from(v));
  const centers = [Float64Array.from(vectors[0])];
  while (centers.length < k) {
    let far = 0,
      farD = -1;
    vectors.forEach((v, i) => {
      const d = Math.min(...centers.map((c) => dist(c, v)));
      if (d > farD) {
        farD = d;
        far = i;
      }
    });
    centers.push(Float64Array.from(vectors[far]));
  }
  for (let round = 0; round < 12; round++) {
    const sums = centers.map(() => new Float64Array(N)),
      counts = centers.map(() => 0);
    for (const v of vectors) {
      let best = 0,
        bestD = Infinity;
      centers.forEach((c, i) => {
        const d = dist(c, v);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      counts[best]++;
      for (let j = 0; j < N; j++) sums[best][j] += v[j];
    }
    centers.forEach(
      (c, i) => counts[i] && c.set(sums[i].map((x) => x / counts[i])),
    );
  }
  return centers;
}

/** Biblioteca `{set: {char: [vetor]}}`: até `kmax` centros por caractere (um por ~8 amostras). */
export function buildLibrary(samples, kmax = 5) {
  const by = {};
  for (const s of samples) ((by[s.set] ??= {})[s.ch] ??= []).push(s.v);
  const lib = {};
  for (const [set, chars] of Object.entries(by))
    for (const [ch, vs] of Object.entries(chars))
      (lib[set] ??= {})[ch] = kmeans(
        vs,
        Math.min(kmax, Math.max(1, Math.ceil(vs.length / 8))),
      );
  return lib;
}

/** Classifica um vetor como o leitor: caractere mais próximo se a distância e a folga passam, senão "?". */
export function classify(lib, set, v) {
  const L = lib[set];
  if (!L) return { ch: "?", raw: "?", d1: 99, d2: 99 };
  let raw = "?",
    d1 = 99;
  for (const [ch, vs] of Object.entries(L))
    for (const t of vs) {
      const d = dist(v, t);
      if (d < d1) {
        d1 = d;
        raw = ch;
      }
    }
  let d2 = 99;
  for (const [ch, vs] of Object.entries(L))
    if (ch !== raw) for (const t of vs) d2 = Math.min(d2, dist(v, t));
  const ok = d1 <= MAX_D && (d2 - d1 >= GAP || d1 <= 0.7 * d2);
  return { ch: ok ? raw : "?", raw, d1, d2 };
}

/**
 * Acerto por conjunto: `{set: {n, hit, miss, wrong, hitD, wrongD}}`; perda = "?" onde havia caractere, falso = outro
 * caractere. `hitD` é a maior distância entre os acertos e `wrongD` a menor entre os falsos (o limite do leitor deve ficar
 * entre as duas, para o conjunto recusar glifo que não conhece em vez de lê-lo como outro caractere).
 */
export function evaluate(lib, samples) {
  const out = {};
  for (const s of samples) {
    const t = (out[s.set] ??= {
        n: 0,
        hit: 0,
        miss: 0,
        wrong: 0,
        hitD: 0,
        wrongD: null,
      }),
      r = classify(lib, s.set, s.v);
    t.n++;
    const kind = r.ch === s.ch ? "hit" : r.ch === "?" ? "miss" : "wrong";
    t[kind]++;
    if (kind === "hit")
      t.hitD = Math.max(t.hitD, Math.round(r.d1 * 1000) / 1000);
    if (kind === "wrong")
      t.wrongD = Math.min(t.wrongD ?? 99, Math.round(r.d1 * 1000) / 1000);
  }
  return out;
}

/**
 * Limpa rótulos errados: o GEP e a tela divergem às vezes (o estágio do GEP fica uma rodada atrás por minutos), e um glifo
 * rotulado errado sujaria o gabarito. Com 2+ partidas, uma amostra é descartada se um gabarito treinado só nas OUTRAS partidas
 * a classifica, com folga, como outro caractere (e só se o gabarito delas conhece o caractere do rótulo). byGame = {jogo: amostras}. Devolve {samples, dropped}.
 */
export function clean(byGame) {
  const games = Object.keys(byGame);
  if (games.length < 2)
    return { samples: Object.values(byGame).flat(), dropped: 0 };
  const kept = [];
  let dropped = 0;
  for (const g of games) {
    const lib = buildLibrary(
      games.filter((o) => o !== g).flatMap((o) => byGame[o]),
    );
    for (const s of byGame[g]) {
      const r = classify(lib, s.set, s.v);
      // Só contradiz quem o gabarito das outras partidas conhece: um caractere que só esta partida viu (o "5" do selo) não tem como
      // ser conferido e fica.
      if (lib[s.set]?.[s.ch] && r.ch !== "?" && r.ch !== s.ch && r.d1 <= 0.2)
        dropped++;
      else kept.push(s);
    }
  }
  return { samples: kept, dropped };
}

/** Documento do screen-glyphs.json. */
export function toDocument(lib, meta = {}) {
  const sets = {};
  for (const [set, chars] of Object.entries(lib))
    for (const [ch, vs] of Object.entries(chars))
      (sets[set] ??= {})[ch] = vs.map(encode);
  return { version: 1, grid: GRID, sets, meta };
}
