// Monta os gabaritos de glifo do leitor de tela (screen-glyphs.json) a partir de partidas gravadas pelo TFTAcademy:
// o vídeo é a tela e os eventos do GEP dizem o que estava escrito (ouro, nível, XP, estágio, quantidade do removedor).
//
//   node scripts/screen-glyphs.mjs [--game ID ...] [--every 6] [--scales 1,2] [--cache DIR] [--out screen-glyphs.json] [--dry]
//
// Sem --game usa todas as partidas do banco com vídeo legível. Com 2 ou mais partidas, descarta rótulos que um gabarito
// treinado nas OUTRAS partidas contradiz (GEP e tela divergem às vezes) e mede o acerto fora da amostra: treina em
// todas menos uma e testa na que ficou de fora. O arquivo gravado é o treinado em todas. --scales também treina com os mesmos
// quadros reescalados (padrão 1 e 2: o vídeo é 720p e a tela nativa é maior; um quadro a cada dois nos reescalados).
// Só Windows (o leitor é o screen-reader.ps1), com ffmpeg no PATH. Nada disso roda no servidor.
import fs from "node:fs";
import path from "node:path";
import { truthAt } from "../screen-accuracy.mjs";
import {
  ROOT,
  listRecordedGames,
  loadCatalog,
  loadGame,
  readGame,
} from "./lib/screen-corpus.mjs";
import {
  buildLibrary,
  clean,
  evaluate,
  samplesOf,
  toDocument,
} from "./lib/glyph-train.mjs";

function args(argv) {
  const out = {
    game: [],
    every: 6,
    scales: [1, 2],
    cache: undefined,
    out: path.join(ROOT, "screen-glyphs.json"),
    dry: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--game") out.game.push(argv[++i]);
    else if (a === "--every") out.every = Number(argv[++i]);
    else if (a === "--scales") out.scales = argv[++i].split(",").map(Number);
    else if (a === "--cache") out.cache = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--dry") out.dry = true;
    else throw Error(`argumento desconhecido: ${a}`);
  }
  return out;
}

const opts = args(process.argv.slice(2)),
  catalog = loadCatalog(),
  ids = opts.game.length ? opts.game : listRecordedGames().map((g) => g.id),
  byGame = {};
for (const id of ids) {
  try {
    const game = loadGame(id, { env: catalog.env });
    byGame[id] = [];
    for (const scale of opts.scales) {
      const { offset, frames } = await readGame(game, {
        every: opts.every,
        cacheDir: opts.cache,
        dump: true,
        candidates: catalog.candidates,
        scale,
        log: (m) => console.error(m),
      });
      byGame[id].push(
        ...frames.flatMap((f) =>
          f.event
            ? samplesOf(f.event, truthAt(game.timeline, game.startedAt, f.at))
            : [],
        ),
      );
      console.error(
        `${id} a ${scale}x: ${byGame[id].length} glifos rotulados no total (deslocamento ${offset} s)`,
      );
    }
  } catch (e) {
    if (opts.game.length) throw e;
    console.error(`${id}: ignorada (${e.message.split("\n")[0]})`);
  }
}
const games = Object.keys(byGame);
if (!games.length) throw Error("nenhuma partida utilizável");
const { samples, dropped } = clean(byGame);
console.log(
  `rótulos descartados por contradizerem as outras partidas: ${dropped}`,
);
if (games.length > 1)
  for (const g of games) {
    const train = buildLibrary(
        samples.filter((s) => !byGame[g].some((x) => x.v === s.v)),
      ),
      held = evaluate(train, byGame[g]);
    console.log(
      `fora da amostra (treino sem ${g.slice(0, 8)}): ${JSON.stringify(held)}`,
    );
  }
const lib = buildLibrary(samples),
  counts = {};
for (const s of samples)
  counts[`${s.set}:${s.ch}`] = (counts[`${s.set}:${s.ch}`] ?? 0) + 1;
console.log(`em amostra: ${JSON.stringify(evaluate(lib, samples))}`);
const doc = toDocument(lib, {
  games: games.map((g) => g.slice(0, 8)),
  samples: counts,
  droppedLabels: dropped,
});
if (opts.dry) console.log("--dry: nada gravado");
else {
  fs.writeFileSync(opts.out, JSON.stringify(doc));
  console.log(`gravado ${opts.out} (${fs.statSync(opts.out).size} bytes)`);
}
