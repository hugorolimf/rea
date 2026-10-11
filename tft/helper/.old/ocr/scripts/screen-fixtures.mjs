// Gera os recortes de teste do leitor de tela (tests/fixtures/screen/) a partir de partidas gravadas pelo TFTAcademy.
//
//   node scripts/screen-fixtures.mjs [--game ID ...] [--count 24] [--every 6] [--cache DIR]
//
// Cada fixture é uma "tela" 1280x720 preta com só as regiões do HUD que o leitor usa (faixa do estágio, nível/XP, ouro, nomes
// da loja, coluna do banco de itens), recortadas de um quadro real; ao lado, a verdade esperada vinda do GEP naquele instante
// (index.json). Não há imagem do desktop nem de outras janelas. Os quadros são escolhidos para cobrir o que o leitor precisa
// acertar (cada dígito do ouro, cada nível, os dois layouts do estágio, cada item e item repetido, removedor empilhado, lojas
// diversas, e barra de baixo escondida), só entre quadros em que a verdade ficou parada em volta do instante.
// Só Windows/ffmpeg; usa o vídeo e o banco do TFTAcademy (somente leitura). Os recortes guardados são o que os testes usam.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { truthAt } from "../screen-accuracy.mjs";
import {
  ROOT,
  listRecordedGames,
  loadCatalog,
  loadGame,
  prepareFrames,
} from "./lib/screen-corpus.mjs";

/** Regiões do quadro 1280x720 que o leitor lê, com folga: [x, y, largura, altura]. */
export const REGIONS = [
  [430, 0, 230, 30], // faixa do estágio
  [240, 578, 130, 38], // nível e XP
  [660, 578, 80, 38], // ouro
  [365, 692, 650, 26], // nomes das 5 cartas da loja
  [0, 108, 96, 468], // coluna do banco de itens (a faixa que o leitor mede: 0,15 a 0,80 da altura, 0,13 da altura de largura)
];

function args(argv) {
  const out = { game: [], count: 24, every: 6, cache: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--game") out.game.push(argv[++i]);
    else if (a === "--count") out.count = Number(argv[++i]);
    else if (a === "--every") out.every = Number(argv[++i]);
    else if (a === "--cache") out.cache = argv[++i];
    else throw Error(`argumento desconhecido: ${a}`);
  }
  return out;
}

/** Características que um quadro cobre (para a seleção gulosa). */
function featuresOf(truth) {
  const f = new Set();
  if (truth.absent) f.add("oculto");
  if (truth.gold !== undefined)
    for (const d of String(truth.gold))
      (f.add(`ouro:${d}`), f.add(`ouro-${String(truth.gold).length}d`));
  if (truth.level !== undefined) f.add(`nivel:${truth.level}`);
  if (truth.xp) {
    const [cur, max] = truth.xp.split("/");
    f.add(`xpmax:${max}`);
    f.add(`xp-${cur.length}d`);
    for (const d of cur) f.add(`xp:${d}`);
  }
  if (truth.stage) {
    f.add(`estagio${truth.stage[0] === "1" ? "-1" : "-2+"}`);
    f.add(`estagio:${truth.stage[0]}`);
  }
  const bag = new Map();
  for (const id of truth.items ?? []) {
    f.add(`item:${id}`);
    bag.set(id, (bag.get(id) ?? 0) + 1);
  }
  for (const [id, n] of bag) if (n > 1) f.add(`repetido:${id}`);
  if (truth.removers > 0) f.add(`removedores:${truth.removers}`);
  for (const slot of truth.shop ?? [])
    f.add(
      slot === null ? "carta-vazia" : slot.wisp ? "wisp" : `carta:${slot.id}`,
    );
  return f;
}

/**
 * A faixa dos nomes da loja tem texto e arte? Com uma unidade arrastada para vender, o painel vira uma área escura e lisa
 * ("Vender por N de ouro"): o GEP segue dizendo que há cartas, mas elas não estão na tela, então o quadro não serve de fixture.
 */
function shopVisibleIn(frame) {
  const [x, y, w, h] = REGIONS[3],
    raw = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        frame,
        "-vf",
        `crop=${w}:${h}:${x}:${y},format=gray`,
        "-f",
        "rawvideo",
        "-",
      ],
      { maxBuffer: 1 << 22 },
    ).stdout;
  if (!raw?.length) return false;
  const mean = raw.reduce((n, v) => n + v, 0) / raw.length,
    sd = Math.sqrt(raw.reduce((n, v) => n + (v - mean) ** 2, 0) / raw.length);
  return sd >= 12;
}

/** Monta a tela preta com as regiões recortadas do quadro (ffmpeg, PNG sem perda). */
function compose(frame, out) {
  const split = REGIONS.map((_, i) => `[s${i}]`).join(""),
    crops = REGIONS.map(
      ([x, y, w, h], i) => `[s${i}]crop=${w}:${h}:${x}:${y}[c${i}]`,
    ).join(";"),
    overlays = REGIONS.map(
      ([x, y], i) =>
        `[${i === 0 ? "0:v" : `o${i - 1}`}][c${i}]overlay=${x}:${y}[o${i}]`,
    ).join(";");
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1280x720",
      "-i",
      frame,
      "-filter_complex",
      `[1:v]split=${REGIONS.length}${split};${crops};${overlays}`,
      "-map",
      `[o${REGIONS.length - 1}]`,
      "-frames:v",
      "1",
      "-compression_level",
      "9",
      out,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
}

const opts = args(process.argv.slice(2)),
  catalog = loadCatalog(),
  ids = opts.game.length ? opts.game : listRecordedGames().map((g) => g.id),
  pool = [];
for (const id of ids) {
  try {
    const game = loadGame(id, { env: catalog.env }),
      { offset, frames } = await prepareFrames(game, {
        every: opts.every,
        cacheDir: opts.cache,
        log: (m) => console.error(m),
      });
    for (const f of frames) {
      const truth = truthAt(game.timeline, game.startedAt, f.at);
      delete truth.bench; // a reserva não é lida da tela (modelos 3D, sem ícone)
      const complete =
        truth.gold !== undefined &&
        truth.items &&
        truth.shop &&
        truth.xp &&
        truth.level !== undefined &&
        truth.stage;
      if (
        truth.absent ||
        (complete &&
          (truth.shop.filter(Boolean).length < 3 || shopVisibleIn(f.image)))
      )
        pool.push({
          ...f,
          game: id,
          offset,
          truth,
          features: featuresOf(truth),
        });
    }
  } catch (e) {
    if (opts.game.length) throw e;
    console.error(`${id}: ignorada (${e.message.split("\n")[0]})`);
  }
}
if (!pool.length) throw Error("nenhum quadro com verdade estável");

const chosen = [],
  seen = new Set();
while (chosen.length < opts.count) {
  let best = null,
    gain = 0;
  for (const f of pool) {
    if (chosen.includes(f)) continue;
    const g = [...f.features].filter((x) => !seen.has(x)).length;
    if (g > gain) {
      gain = g;
      best = f;
    }
  }
  if (!best) break;
  chosen.push(best);
  for (const x of best.features) seen.add(x);
}

const dir = path.join(ROOT, "tests/fixtures/screen");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const index = {
  version: 1,
  note: "Recortes 1280x720 de partidas gravadas pelo TFTAcademy (só as regiões do HUD que o leitor usa) e a verdade do GEP no instante. Gerado por scripts/screen-fixtures.mjs.",
  regions: REGIONS,
  frames: [],
};
chosen.sort((a, b) =>
  a.game === b.game ? a.t - b.t : a.game < b.game ? -1 : 1,
);
chosen.forEach((f, i) => {
  const name = `f${String(i + 1).padStart(2, "0")}.png`;
  compose(f.image, path.join(dir, name));
  index.frames.push({
    id: name.replace(".png", ""),
    file: name,
    client: "0,0,1280,720",
    source: { game: f.game.slice(0, 8), at: Math.round(f.at) },
    truth: f.truth,
  });
});
fs.writeFileSync(
  path.join(dir, "index.json"),
  `${JSON.stringify(index, null, 1)}\n`,
);
const bytes = fs
  .readdirSync(dir)
  .reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
console.log(
  `${chosen.length} recortes (${(bytes / 1024).toFixed(0)} KB) em ${dir}; cobertura: ${seen.size} características`,
);
