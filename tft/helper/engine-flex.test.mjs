// Rodar com: node --test tft/helper/engine-flex.test.mjs
// Substituições de peças da comp: catálogo e comps reais, tabuleiros sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyze } from "./engine.mjs";
import { loadComps } from "./meta-comps.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)),
  catalog = JSON.parse(readFileSync(path.join(root, "catalog.json"), "utf8")),
  { comps } = await loadComps(root, "TFTSet18", catalog),
  byName = new Map(catalog.champions.map((c) => [c.name, c])),
  HERO = 47445859;

const piece = (name, starLevel = 1, itemNames = []) => {
  const c = byName.get(name);
  assert.ok(c, `campeão ${name} no catálogo`);
  return { championName: c.apiName, starLevel, itemNames, price: c.cost };
};
const snapshot = (hero, rivals) => ({
  gameId: 1,
  statsBlock: {
    setCoreName: "TFTSet18",
    players: [
      { playerId: HERO, health: 60, ffaStanding: 3, boardPieces: hero },
      ...rivals.map((boardPieces, i) => ({
        playerId: 100 + i,
        health: 50,
        ffaStanding: 4 + i,
        riotIdGameName: `Rival ${i + 1}`,
        boardPieces,
      })),
    ],
  },
});
const run = (snap, comp) =>
  analyze(snap, catalog, {
    level: 8,
    targetLevel: 8,
    gold: 30,
    bench: [],
    inventory: [],
    playerId: String(HERO),
    metaComps: comps,
    previewIds: comp.units,
    goalCarryId: comp.carry,
  });

// Comp de Rengar (reroll 7): Lillia, Rengar, Cassiopeia, Rammus, Fiddlesticks, Shen, Ornn.
const rengar = comps.find((c) => c.carry === "DA_18_Rengar");

test("peça disputada pelos rivais recebe substituto que não está disputado e não derruba sinergias", () => {
  assert.ok(rengar, "comp de Rengar na cópia local");
  // 7 de 18 cópias de Rammus com dois rivais: disputado (> 35% da pool).
  const snap = snapshot(
    [piece("Shen", 2), piece("Vi", 2), piece("Sentinel", 2)],
    [
      [piece("Rammus", 2), piece("Rammus", 1)],
      [piece("Rammus", 1), piece("Rammus", 1)],
    ],
  );
  const flex = run(snap, rengar).previewFlex,
    rammus = flex.find((f) => f.name === "Rammus");
  assert.ok(rammus, "Rammus aparece nas substituições");
  assert.equal(rammus.contested, true);
  assert.equal(rammus.enemyCopies, 6);
  assert.deepEqual(rammus.rivals.sort(), ["Rival 1", "Rival 2"]);
  const pick = rammus.options.find((o) => o.id === rammus.suggest);
  assert.ok(pick, "há sugestão para a peça disputada");
  assert.equal(pick.contested, false);
  assert.ok(pick.traitDelta >= -1);
  assert.ok(!rengar.units.includes(pick.id), "substituto vem de fora da comp");
});

test("carry nunca é substituído, e cada substituto serve a uma peça só", () => {
  const snap = snapshot(
    [piece("Vi", 2), piece("Sentinel", 2), piece("Diana", 2)],
    [],
  );
  const flex = run(snap, rengar).previewFlex;
  assert.ok(!flex.some((f) => f.id === rengar.carry));
  const picks = flex.map((f) => f.suggest).filter(Boolean);
  assert.equal(new Set(picks).size, picks.length);
  // Sem disputa, só sugere trocar por algo que já é seu e mantém as sinergias.
  for (const f of flex.filter(
    (f) => f.suggest && !f.contested && !f.unreachable,
  )) {
    const o = f.options.find((x) => x.id === f.suggest);
    assert.equal(o.owned, true);
    assert.deepEqual(o.lost, []);
  }
});

test("peça que já é sua e não está sob pressão não recebe sugestão de troca", () => {
  const snap = snapshot(
    [piece("Shen", 2), piece("Ornn", 2), piece("Vi", 2), piece("Sentinel", 2)],
    [],
  );
  const flex = run(snap, rengar).previewFlex;
  for (const name of ["Shen", "Ornn"]) {
    const f = flex.find((x) => x.name === name);
    assert.ok(!f?.suggest, `${name} já é sua: sem sugestão`);
  }
});

// Evidência: o motor escolhe os trunfos, pede ao explorer as tabelas e a colocação de cada tabuleiro candidato, e
// decide pela colocação esperada. Aqui o "explorer" é sintético e responde a todas as perguntas, sem rede.
const { filterKey } = await import("./evidence.mjs");
const stats = {
  base: [4.47, 1e6],
  unit: {
    "DA_18_Ahri|1": [5.52, 148650],
    "DA_18_Ahri|2": [3.91, 354937],
    "DA_18_Ahri|3": [1.47, 7826],
    "DA_18_Ahri|2|3": [3.89, 265908],
    "DA_18_Leona|2|0": [4.4, 50000],
    "DA_18_Leona|2": [4.4, 50000],
    "DA_18_Rammus|2|0": [4.3, 50000],
    "DA_18_Rammus|2": [4.3, 50000],
    "DA_18_Rengar|2": [5.59, 66269],
    "DA_18_Rengar|3": [3.51, 98295],
    "DA_18_Rengar|2|1": [5.6, 20000],
    "DA_18_KhaZix|2": [5.16, 145930],
    "DA_18_KhaZix|3": [3.44, 145551],
    "DA_18_KhaZix|2|1": [5.2, 20000],
  },
  trait: {},
};
const baseOptions = (extra = {}) => ({
  level: 8,
  targetLevel: 8,
  gold: 40,
  bench: [],
  inventory: [],
  playerId: String(HERO),
  metaComps: comps,
  previewIds: [],
  stats,
  baseAvg: 4.47,
  conditional: new Map(),
  evidence: new Map(),
  ...extra,
});
// Roda o ciclo do servidor: responde as tabelas condicionais e os totais até o motor não pedir mais nada.
function settle(
  snap,
  opts,
  { table = () => ({ units: {}, traits: {} }), total },
) {
  let a = analyze(snap, catalog, opts);
  for (
    let i = 0;
    i < 6 && (a.conditionalRequests.length || a.evidenceRequests.length);
    i++
  ) {
    for (const f of a.conditionalRequests) opts.conditional.set(f, table(f));
    for (const f of a.evidenceRequests)
      opts.evidence.set(filterKey(f), total(f));
    a = analyze(snap, catalog, opts);
  }
  return a;
}
const ahriSnap = () =>
  snapshot(
    [
      piece("Ahri", 2, [
        "DA_JeweledGauntlet",
        "DA_ArchangelsStaff",
        "DA_BlueBuff",
      ]),
      piece("Leona", 2),
      piece("Rammus", 2),
    ],
    [[piece("Shen", 2)], [piece("Vi", 2)]],
  );

test("evidência manda: o tabuleiro em volta do trunfo pronto vence quando os dados dizem que rende mais", () => {
  const a = settle(ahriSnap(), baseOptions(), {
    table: () => ({
      units: { DA_18_Leona: [3.2, 20000], DA_18_Rammus: [3.3, 20000] },
      traits: {},
    }),
    // Com a Ahri 2★ de 3 itens (medida exata), 3,0; sem ela, as comps de meta medem 4,2.
    total: (f) =>
      f.some((x) => x.includes("DA_18_Ahri-1_2_3") && !x.includes(","))
        ? { avg: 3.0, games: 5000, top4: 70 }
        : { avg: 4.2, games: 5000, top4: 55 },
  });
  assert.equal(
    a.assets[0].id,
    "DA_18_Ahri",
    "Ahri 2★ com 3 itens é trunfo pronto",
  );
  const top = a.recommendations[0];
  assert.ok(
    top.board.some((u) => u.name === "Ahri"),
    `${top.title} tem a Ahri`,
  );
  assert.ok(
    top.evidence.basis[0].startsWith("Ahri 2★ 3 itens"),
    top.evidence.basis.join(" + "),
  );
});

test("evidência: tabuleiro medido melhor mas difícil de montar entra pela chance em E (sem degrau de 'aposta')", () => {
  const owned = ["DA_18_Ahri", "DA_18_Leona", "DA_18_Rammus"];
  const a = settle(
    ahriSnap(),
    baseOptions({ gold: 0, level: 4, targetLevel: 4 }),
    {
      // Toda pergunta que exige peça que você não tem mede 2,0 (ótima); só com as suas, 3,5.
      total: (f) =>
        f.every(
          (x) =>
            !x.startsWith("unit_tier_numitems_unique=") ||
            owned.some((id) => x.includes(`${id}-1_`)),
        )
          ? { avg: 3.5, games: 5000, top4: 60 }
          : { avg: 2.0, games: 5000, top4: 90 },
    },
  );
  for (const r of a.recommendations)
    assert.ok(
      r.evidence.expected >= 2.0 + (1 - r.evidence.chance) * 1.5 - 0.01,
      `${r.title}: ${r.evidence.expected} × chance ${r.evidence.chance}`,
    );
  // A ordem é a colocação esperada E (com a chance e a reserva dentro): uma aposta só lidera se o E dela for melhor.
  const e = (r) => r.components.expected.value;
  for (let i = 1; i < a.recommendations.length; i++)
    assert.ok(e(a.recommendations[i - 1]) <= e(a.recommendations[i]));
  const safe = a.recommendations.filter((r) => !r.evidence.bet);
  if (safe.length) assert.ok(e(a.recommendations[0]) <= e(safe[0]));
});

test("regra do Rival: sem o aprimoramento os dois rivais não ficam juntos; com Aminimigos, o plano usa os dois", () => {
  const snap = () =>
    snapshot(
      [
        piece("Rengar", 2, ["DA_Bloodthirster"]),
        piece("Kha'Zix", 2, ["DA_JeweledGauntlet"]),
        piece("Amumu", 1),
        piece("Vi", 1),
      ],
      [[piece("Shen", 2)], [piece("Leona", 2)]],
    );
  const total = () => ({ avg: 4.0, games: 5000, top4: 55 });
  const rivals = (r) =>
    r.board.filter((u) => u.name === "Rengar" || u.name === "Kha'Zix").length;
  const plain = settle(snap(), baseOptions({ level: 7, targetLevel: 7 }), {
    total,
  });
  // "Seu tabuleiro atual" já tem as duas peças (é o que você montou) e agora sobe pelo que você tem; a regra vale para o que o motor escolhe.
  for (const r of plain.recommendations.filter(
    (x) => x.title !== "Seu tabuleiro atual",
  ))
    assert.ok(
      rivals(r) < 2,
      `${r.title} junta os dois rivais sem o aprimoramento`,
    );
  const aug = settle(
    snap(),
    baseOptions({ level: 7, targetLevel: 7, augmentTraits: ["Rival"] }),
    {
      // Com o Aminimigos, os tabuleiros com Rival 3 (os dois rivais) medem melhor.
      total: (f) =>
        f.includes("trait=DA_18_Rival_3")
          ? { avg: 3.4, games: 5000, top4: 68 }
          : { avg: 4.0, games: 5000, top4: 55 },
    },
  );
  assert.deepEqual(
    new Set(aug.assets.map((x) => x.id)),
    new Set(["DA_18_Rengar", "DA_18_KhaZix"]),
    "os trunfos são as peças do aprimoramento",
  );
  assert.ok(
    aug.assets.every((x) => x.stars === 3),
    "Rengar e Kha'Zix miram 3★ (melhor colocação esperada)",
  );
  assert.equal(
    rivals(aug.recommendations[0]),
    2,
    `${aug.recommendations[0].title} usa os dois rivais`,
  );
});

test("confiança: no estágio 4 o plano em andamento só é trocado por vantagem acima da incerteza + custo de trocar", () => {
  const sticky = {
    id: "free:plano",
    units: ["DA_18_Ahri", "DA_18_Leona", "DA_18_Rammus", "DA_Taric18"],
    carry: "DA_18_Ahri",
    title: "Plano em andamento",
  };
  const run = (others) =>
    settle(
      ahriSnap(),
      baseOptions({
        sticky,
        stickyCompId: sticky.id,
        stage: { stage: 4, round: 2 },
      }),
      {
        // Pergunta com Taric = o plano em andamento (3,5); qualquer outra = as alternativas.
        total: (f) =>
          f.some((x) => x.includes("DA_Taric18-1_"))
            ? { avg: 3.5, games: 5000, top4: 60 }
            : { avg: others, games: 5000, top4: 62 },
      },
    );
  const close = run(3.4).recommendations[0];
  assert.equal(
    close.title,
    "Plano em andamento",
    "0,1 melhor não paga a troca no estágio 4",
  );
  assert.equal(close.evidence.switch?.kept, true);
  const far = run(1.6).recommendations[0];
  assert.notEqual(
    far.title,
    "Plano em andamento",
    "quase 2 colocações melhor pagam a troca",
  );
  assert.equal(far.evidence.switch?.kept, false);
});

test("score das comps: chance de montar vem do nível de agora; disputa dos rivais e peças suas mexem no score", () => {
  const total = () => ({ avg: 4.0, games: 5000, top4: 55 });
  const at = (level) =>
    settle(ahriSnap(), baseOptions({ level, targetLevel: level }), { total })
      .compRanking;
  const low = at(5),
    high = at(9);
  assert.ok(
    low.length > 5 &&
      low.every(
        (r) => r.score >= 0 && r.score <= 100 && r.chance >= 0 && r.chance <= 1,
      ),
  );
  assert.equal(low.filter((r) => r.best).length, 1, "só uma é a melhor");
  assert.equal(low[0].best, true, "a melhor é a primeira do ranking");
  // O nível usado vai no resultado: o melhor para o alcance entre o de agora e o alvo da comp (nunca abaixo do de agora).
  assert.ok(
    low.every((r) => r.level >= 5 && r.reach.level === r.level) &&
      high.every((r) => r.level >= 9),
    "o nível usado vai no resultado",
  );
  // Mais nível, mais chance de achar peças caras: o total das chances sobe.
  const sum = (list) => list.reduce((n, r) => n + r.chance, 0);
  assert.ok(
    sum(high) > sum(low),
    `chance total no 9 (${sum(high)}) maior que no 5 (${sum(low)})`,
  );
});

test("score das comps: disputa alta desconta o score", () => {
  const total = () => ({ avg: 4.0, games: 5000, top4: 55 });
  const quiet = settle(ahriSnap(), baseOptions(), { total }).compRanking,
    // Os rivais passam a jogar as mesmas peças (Ahri, Leona, Rammus) que a comp pede.
    busy = settle(
      snapshot(
        [
          piece("Ahri", 2, [
            "DA_JeweledGauntlet",
            "DA_ArchangelsStaff",
            "DA_BlueBuff",
          ]),
          piece("Leona", 2),
          piece("Rammus", 2),
        ],
        [
          [
            piece("Rammus", 2),
            piece("Leona", 2),
            piece("Alistar", 2),
            piece("Morgana", 2),
          ],
          [piece("Rammus", 2), piece("Veigar", 2), piece("Teemo", 2)],
        ],
      ),
      baseOptions(),
      { total },
    ).compRanking;
  const byId = new Map(quiet.map((r) => [r.id, r]));
  const worse = busy.filter((r) => r.dispute > (byId.get(r.id)?.dispute ?? 0));
  assert.ok(worse.length > 0, "há comps mais disputadas");
  for (const r of worse)
    assert.ok(
      r.contestFactor < (byId.get(r.id)?.contestFactor ?? 1),
      `${r.id} perde score com mais disputa`,
    );
});
