// Relatório de precisão do leitor de tela contra o GEP, campo a campo (ouro, nível, XP, estágio, loja, banco de itens).
//
//   node scripts/screen-accuracy.mjs --fixtures                 # os recortes guardados em tests/fixtures/screen/
//   node scripts/screen-accuracy.mjs [--game ID ...] [--every 6] [--scale 2] [--cache DIR] [--misses 30] [--json arquivo]
//
// Com partidas (sem --fixtures): cada quadro do vídeo do TFTAcademy é lido a frio pelo screen-reader.ps1 e comparado com o
// que o GEP dizia naquele instante (só valem os campos parados em volta do quadro; ver screen-accuracy.mjs). Sem --game usa
// todas as partidas do banco com vídeo legível. O vídeo é 720p e H.264, então o resultado é mais severo que uma captura
// nativa para o texto pequeno e mais brando em cores. Só Windows, com ffmpeg no PATH. Não toca em partida em andamento.
import fs from "node:fs";
import path from "node:path";
import {
  FIELDS,
  formatReport,
  readOf,
  scoreFrame,
  summarize,
  truthAt,
} from "../screen-accuracy.mjs";
import {
  ROOT,
  listRecordedGames,
  loadCatalog,
  loadGame,
  readGame,
  runReader,
} from "./lib/screen-corpus.mjs";

function args(argv) {
  const out = {
    game: [],
    every: 6,
    scale: 1,
    cache: undefined,
    misses: 20,
    json: null,
    fixtures: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--game") out.game.push(argv[++i]);
    else if (a === "--every") out.every = Number(argv[++i]);
    else if (a === "--scale") out.scale = Number(argv[++i]);
    else if (a === "--cache") out.cache = argv[++i];
    else if (a === "--misses") out.misses = Number(argv[++i]);
    else if (a === "--json") out.json = argv[++i];
    else if (a === "--fixtures") out.fixtures = true;
    else throw Error(`argumento desconhecido: ${a}`);
  }
  return out;
}

const opts = args(process.argv.slice(2)),
  catalog = loadCatalog(),
  scores = [],
  perGame = [];

if (opts.fixtures) {
  const dir = path.join(ROOT, "tests/fixtures/screen"),
    index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")),
    lines = await runReader(
      index.frames.map((f) => ({
        id: f.id,
        image: path.join(dir, f.file).replace(/\//g, "\\"),
        client: f.client,
      })),
      { candidates: catalog.candidates },
    );
  const byId = new Map(lines.map((l) => [l.id, l]));
  const local = [];
  for (const f of index.frames) {
    const score = scoreFrame(readOf(byId.get(f.id), catalog.champion), f.truth);
    local.push({ ...score, id: f.id });
  }
  perGame.push({
    title: `recortes guardados (${index.frames.length} quadros)`,
    scores: local,
  });
  scores.push(...local);
} else {
  const ids = opts.game.length
    ? opts.game
    : listRecordedGames().map((g) => g.id);
  for (const id of ids) {
    try {
      const game = loadGame(id, { env: catalog.env }),
        { offset, frames } = await readGame(game, {
          every: opts.every,
          cacheDir: opts.cache,
          scale: opts.scale,
          candidates: catalog.candidates,
          log: (m) => console.error(m),
        }),
        local = frames
          .filter((f) => f.event)
          .map((f) => ({
            ...scoreFrame(
              readOf(f.event, catalog.champion),
              truthAt(game.timeline, game.startedAt, f.at),
            ),
            id: f.id,
          }));
      perGame.push({
        title: `partida ${id.slice(0, 8)} (${local.length} quadros${opts.scale === 1 ? "" : ` reescalados ${opts.scale}x`}, deslocamento ${offset} s)`,
        scores: local,
      });
      scores.push(...local);
    } catch (e) {
      if (opts.game.length) throw e;
      console.error(`${id}: ignorada (${e.message.split("\n")[0]})`);
    }
  }
}
if (!scores.length) throw Error("nenhum quadro lido");

for (const g of perGame)
  console.log(`${formatReport(summarize(g.scores), g.title)}\n`);
if (perGame.length > 1)
  console.log(`${formatReport(summarize(scores), "Total")}\n`);

const misses = scores
  .flatMap((s) => s.misses.map((m) => ({ id: s.id, ...m })))
  .slice(0, opts.misses);
if (misses.length) {
  console.log(
    `Primeiras ${misses.length} divergências (esperado pelo GEP -> lido da tela):`,
  );
  for (const m of misses)
    console.log(
      `  ${m.id}  ${m.field}: ${JSON.stringify(m.expected)} -> ${JSON.stringify(m.got)}`,
    );
}
if (opts.json)
  fs.writeFileSync(
    opts.json,
    JSON.stringify(
      {
        summary: summarize(scores),
        fields: FIELDS,
        games: perGame.map((g) => ({
          title: g.title,
          summary: summarize(g.scores),
        })),
      },
      null,
      2,
    ),
  );
