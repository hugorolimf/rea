// Corpus de partidas gravadas para medir e treinar o leitor de tela: eventos do GEP (verdade) + vídeo do TFTAcademy (a tela).
// Ferramentas de desenvolvimento, não entram no servidor. Só leitura: o banco do TFTAcademy é aberto como em gep-reader.mjs
// (sem criar arquivo), só as chaves do jogador local, e o vídeo é decodificado com o ffmpeg do PATH.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  defaultGepDb,
  gepOpenMode,
  wispCatalog,
  wispLookup,
} from "../../gep-reader.mjs";
import { buildTimeline } from "../../screen-accuracy.mjs";
import { benchCandidates } from "../../bench-candidates.mjs";
import { championResolver } from "../../screen-reader.mjs";

/** Raiz do pacote do helper (tft/helper). */
export const ROOT = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

/** Pares `feature.key` lidos como verdade: os mesmos do leitor do GEP (nada de rivais: `item_bench` só guarda a linha local). */
const TRUTH_KEYS = `(feature = 'me' AND key IN ('gold', 'xp'))
  OR (feature = 'store' AND key IN ('shop_pieces', 'shop_visible'))
  OR (feature = 'bench' AND key IN ('bench_pieces', 'item_bench'))
  OR (feature = 'match_info' AND key IN ('round_type', 'match_state'))
  OR (feature = 'roster' AND key = 'player_status')`;

/** Catálogo do helper: campeões, itens, wisps e o resolvedor de nomes da loja, como o servidor os monta. */
export function loadCatalog() {
  const read = (file) =>
      JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")),
    catalog = read("catalog.json"),
    manifest = read("assets-manifest.json");
  let localNames = {};
  try {
    localNames = read("names-pt_br.json").names ?? {};
  } catch {}
  const champions = new Set(catalog.champions.map((c) => c.apiName)),
    items = new Set(catalog.items.map((i) => i.apiName)),
    wisps = wispLookup(wispCatalog(catalog.items, []));
  return {
    catalog,
    manifest,
    env: {
      isChampion: (n) => champions.has(n),
      isItem: (n) => items.has(n),
      wispOf: wisps,
    },
    champion: championResolver(
      catalog.champions.map((c) => ({
        id: c.apiName,
        names: [c.name, localNames[c.apiName]].filter(Boolean),
      })),
    ),
    candidates: benchCandidates(catalog, manifest, ROOT),
  };
}

function openDb(file = defaultGepDb()) {
  const sqlite = process.getBuiltinModule("node:sqlite");
  return gepOpenMode(file) === "compartilhado"
    ? new sqlite.DatabaseSync(file, { readOnly: true })
    : new sqlite.DatabaseSync(`${pathToFileURL(file).href}?immutable=1`, {
        readOnly: true,
      });
}

/** Partidas do banco do TFTAcademy com vídeo gravado que ainda existe: `[{id, startedAt, video, matchId}]`. */
export function listRecordedGames(file) {
  const db = openDb(file);
  try {
    return db
      .prepare(
        "SELECT id, started_at, match_id, recording_file_path FROM games ORDER BY started_at",
      )
      .all()
      .filter(
        (g) => g.recording_file_path && fs.existsSync(g.recording_file_path),
      )
      .map((g) => ({
        id: g.id,
        startedAt: g.started_at,
        matchId: g.match_id,
        video: g.recording_file_path,
      }));
  } finally {
    db.close();
  }
}

/** Verdade de uma partida: `{id, startedAt, video, timeline}` (linha do tempo de `buildTimeline`). */
export function loadGame(gameId, { file, env } = {}) {
  const db = openDb(file);
  try {
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId);
    if (!game) throw Error(`partida ${gameId} não está no banco do TFTAcademy`);
    const rows = db
      .prepare(
        `SELECT id, timestamp AS ts, feature, key, data FROM events WHERE game_id = ? AND (${TRUTH_KEYS}) ORDER BY id`,
      )
      .all(gameId);
    return {
      id: game.id,
      startedAt: game.started_at,
      video: game.recording_file_path ?? null,
      timeline: buildTimeline(rows, env ?? loadCatalog().env),
    };
  } finally {
    db.close();
  }
}

/** Extrai um quadro a cada `every` s (PNG sem perda, `0001.png` = t 0) para `dir`; devolve os arquivos em ordem. */
export function extractFrames(video, dir, every = 6) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      video,
      "-vf",
      `fps=1/${every}`,
      path.join(dir, "%04d.png"),
    ],
    { stdio: ["ignore", "inherit", "inherit"], maxBuffer: 1 << 26 },
  );
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}\.png$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Deslocamento (s) entre o relógio do vídeo e o do GEP: o vídeo do TFTAcademy começa alguns segundos depois do início da
 * partida (observado: 13,5 s e 15,75 s) e só se descobre vendo o vídeo. Usa as mudanças bruscas na faixa da loja (a loja
 * some e volta no carrossel e na escolha de aprimoramento) contra os instantes de `shop_visible` do GEP; vale o
 * deslocamento (0 a 40 s, passo de 0,25 s) em que as mudanças do vídeo mais coincidem com os eventos. Devolve `{offset, score, next}`.
 */
export async function estimateOffset(video, timeline, startedAt) {
  const W = 676,
    H = 80,
    FPS = 4,
    size = W * H,
    diffs = [];
  await new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        video,
        "-vf",
        `crop=${W}:${H}:365:640,fps=${FPS},format=gray`,
        "-f",
        "rawvideo",
        "-",
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let buf = Buffer.alloc(0),
      prev = null;
    ff.stdout.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= size) {
        const frame = buf.subarray(0, size);
        if (prev) {
          let sum = 0;
          for (let i = 0; i < size; i += 7) sum += Math.abs(frame[i] - prev[i]);
          diffs.push(sum / (size / 7));
        }
        prev = Buffer.from(frame);
        buf = buf.subarray(size);
      }
    });
    ff.on("error", reject);
    ff.on("close", resolve);
  });
  const changes = [];
  let last = null;
  for (const e of timeline)
    if (e.shopVisible !== null && e.shopVisible !== last) {
      if (last !== null) changes.push(e.ts - startedAt);
      last = e.shopVisible;
    }
  const scores = [];
  for (let off = 0; off <= 40; off += 0.25) {
    let score = 0;
    for (const t of changes) {
      const k = Math.round((t - off) * FPS);
      let peak = 0;
      for (let j = k - 1; j <= k + 1; j++)
        peak = Math.max(peak, diffs[j - 1] ?? 0);
      score += peak;
    }
    scores.push([off, score]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  return {
    offset: scores[0][0],
    score: scores[0][1],
    next: scores[1]?.[1] ?? 0,
    changes: changes.length,
  };
}

/** Quadro `{id, image, client}` do tamanho dado (o vídeo do TFTAcademy é 1280x720). */
export const frameEntry = (id, image, width = 1280, height = 720) => ({
  id,
  image: path.resolve(image).replace(/\//g, "\\"),
  client: `0,0,${width},${height}`,
});

/**
 * Roda o screen-reader.ps1 em modo de teste sobre os quadros (cada um lido a frio, sem captura de tela nem OCR de janela) e
 * devolve as linhas JSON do leitor, na ordem. Só no Windows. `dump` pede os glifos de cada campo (gabaritos).
 */
export function runReader(frames, { dump = false, candidates } = {}) {
  if (process.platform !== "win32")
    throw Error("o leitor de tela só roda no Windows (powershell.exe)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reader-")),
    manifest = path.join(dir, "frames.json"),
    cands = path.join(dir, "candidates.json");
  fs.writeFileSync(manifest, JSON.stringify(frames));
  fs.writeFileSync(
    cands,
    JSON.stringify(candidates ?? loadCatalog().candidates),
  );
  const args = [
    "-NoProfile",
    "-File",
    path.join(ROOT, "screen-reader.ps1"),
    "-Candidates",
    cands,
    "-TestManifest",
    manifest,
  ];
  if (dump) args.push("-Dump");
  return new Promise((resolve, reject) => {
    const proc = spawn("powershell.exe", args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => (err += c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      fs.rmSync(dir, { recursive: true, force: true });
      const lines = out
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const failed = lines.find((l) => l.error);
      if (code !== 0 || failed)
        return reject(
          Error(
            failed?.error ??
              `leitor saiu com código ${code}: ${err.slice(-400)}`,
          ),
        );
      resolve(lines);
    });
  });
}

/**
 * Quadros de uma partida gravada: extrai um quadro a cada `every` s (reaproveita `cacheDir/<partida>/` se já existe) e
 * descobre o deslocamento vídeo→GEP (ou usa `offset`). Devolve `{offset, alignment, frames: [{id, image, t, at}]}`, com `t` o
 * instante no vídeo e `at` o instante no relógio do GEP (s desde o início da partida).
 */
export async function prepareFrames(
  game,
  {
    every = 6,
    cacheDir = path.join(os.tmpdir(), "tft-screen-corpus"),
    offset,
    log = () => {},
  } = {},
) {
  if (!game.video || !fs.existsSync(game.video))
    throw Error(`partida ${game.id}: vídeo não encontrado (${game.video})`);
  const dir = path.join(cacheDir, `${game.id}-${every}s`);
  let files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /^\d{4}\.png$/.test(f))
        .sort()
        .map((f) => path.join(dir, f))
    : [];
  if (!files.length) {
    log(`extraindo quadros de ${game.id} (um a cada ${every} s)`);
    files = extractFrames(game.video, dir, every);
  }
  let alignment = null;
  const offsetFile = path.join(dir, "offset.json");
  if (offset === undefined && fs.existsSync(offsetFile))
    offset = JSON.parse(fs.readFileSync(offsetFile, "utf8")).offset;
  if (offset === undefined) {
    log(`alinhando o vídeo de ${game.id} ao relógio do GEP`);
    alignment = await estimateOffset(game.video, game.timeline, game.startedAt);
    offset = alignment.offset;
    fs.writeFileSync(offsetFile, JSON.stringify(alignment));
  }
  return {
    offset,
    alignment,
    frames: files.map((image, i) => ({
      id: `${game.id}/${String(i + 1).padStart(4, "0")}`,
      image,
      t: i * every,
      at: i * every + offset,
    })),
  };
}

/**
 * Os mesmos quadros em outra resolução (lanczos, 16:9): `factor` 2 vira 2560x1440. O HUD não escala linearmente e o vídeo
 * gravado é 720p, então reescalar não substitui uma captura nativa, mas mostra se o leitor (glifos normalizados pela altura da
 * linha, grade dos espaços medida na imagem) depende do tamanho. Só um quadro a cada `step` (as cópias vão para
 * `<pasta dos quadros>-x<factor>/`). Devolve quadros com `width`/`height` e a imagem reescalada.
 */
export function rescaleFrames(frames, factor, { step = 2 } = {}) {
  if (factor === 1)
    return frames.map((f) => ({ ...f, width: 1280, height: 720 }));
  const width = Math.round(1280 * factor),
    height = Math.round(720 * factor);
  return frames
    .filter((_, i) => i % step === 0)
    .map((f) => {
      const dir = `${path.dirname(f.image)}-x${factor}`,
        image = path.join(dir, path.basename(f.image));
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(image))
        execFileSync("ffmpeg", [
          "-v",
          "error",
          "-y",
          "-i",
          f.image,
          "-vf",
          `scale=${width}:${height}:flags=lanczos`,
          image,
        ]);
      return { ...f, image, width, height };
    });
}

/** Como `prepareFrames` e roda o leitor em cada quadro: `frames[i].event` é a linha JSON do leitor (`dump`: com os glifos). */
export async function readGame(
  game,
  { dump = false, candidates, log = () => {}, scale = 1, ...rest } = {},
) {
  const prepared = await prepareFrames(game, { ...rest, log }),
    frames = rescaleFrames(prepared.frames, scale);
  log(
    `lendo ${frames.length} quadros de ${game.id} a ${scale}x (deslocamento ${prepared.offset} s)`,
  );
  const lines = await runReader(
      frames.map((f) => frameEntry(f.id, f.image, f.width, f.height)),
      { dump, candidates },
    ),
    byId = new Map(lines.map((l) => [l.id, l]));
  return {
    offset: prepared.offset,
    alignment: prepared.alignment,
    frames: frames.map((f) => ({ ...f, event: byId.get(f.id) })),
  };
}
