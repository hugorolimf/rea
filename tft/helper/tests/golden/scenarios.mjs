// Cenários do golden do pipeline (M0). Cada um é uma entrada do `POST /api/recommend`: o tabuleiro congelado em
// fixtures/snapshots (capturas reais anonimizadas, ver scripts/golden-freeze.mjs), o que o cliente envia (`client`) e o
// que o servidor leria da tela (`seen`). `steps` encadeia chamadas da MESMA partida (plano em andamento e cache da base
// persistem entre elas); cada passo só declara o que muda em relação ao anterior.
//
// Entradas dependentes de meta (ids de comps, itens do carry, aprimoramentos) saem de funções do contexto congelado:
// os cenários não repetem dados que já vivem nas cópias de meta.
import { makeAugmentEmblem } from "./harness.mjs";

const COMPONENTS = [
  "DA_Component_BFSword",
  "DA_Component_ChainVest",
  "DA_Component_NeedlesslyLargeRod",
  "DA_Component_GiantsBelt",
  "DA_Component_RecurveBow",
  "DA_Component_TearOfTheGoddess",
  "DA_Component_SparringGloves",
  "DA_Component_NegatronCloak",
];

const comp = (ctx, i) => ctx.metaComps.comps[i];
/** Itens prontos da build do carry da comp `i` (ids do catálogo). */
const carryBuild = (ctx, i) => comp(ctx, i).builds?.[comp(ctx, i).carry] ?? [];
/** Cartas de loja (`seen.shop`) com estas unidades; `null` = slot vazio. */
const shop = (...ids) => ids.map((id) => (id ? { id } : null));
const units = (ctx, i, n = 5) => comp(ctx, i).units.slice(0, n);

/** Aprimoramentos de set 18 com emblema (primeiros por id) e um sem emblema, para os cenários de aprimoramento. */
function augments(ctx) {
  const emblem = makeAugmentEmblem(ctx.catalog),
    sorted = [...ctx.augmentList]
      .filter((a) => a.id.startsWith("DA_"))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    withEmblem: sorted.filter((a) => emblem(a)?.item).slice(0, 2),
    plain: sorted.filter((a) => !emblem(a)).slice(0, 4),
  };
}

export const scenarios = [
  {
    id: "opening-lvl3",
    desc: "Abertura: 3 peças, nível 3, 2-1, sem itens nem loja lida.",
    snapshot: "opening-3u",
    client: { level: 3, gold: 8 },
    seen: { stage: "2-1", xp: "2/6" },
  },
  {
    id: "early-lvl5-shop",
    desc: "2-5, nível 5, 5 peças, loja lida com peças de uma comp de meta e 2 componentes no banco.",
    snapshot: "early-5u",
    client: { level: 5, gold: 22 },
    seen: (ctx) => ({
      stage: "2-5",
      xp: "6/20",
      shop: shop(...units(ctx, 0, 5)),
      items: COMPONENTS.slice(0, 2),
    }),
  },
  {
    id: "mid-lvl7-streak",
    desc: "4-1, nível 7, 7 peças, 4 componentes no banco, sequência de 2 derrotas e queda de vida recente.",
    snapshot: "mid-7u",
    client: { level: 7, gold: 36 },
    seen: (ctx) => ({
      stage: "4-1",
      xp: "20/56",
      shop: shop(...units(ctx, 1, 4), null),
      items: COMPONENTS.slice(0, 4),
    }),
    streak: { kind: "loss", length: 2, inferred: true },
    trend: { avgLoss: 9, recentLosses: 2 },
  },
  {
    id: "late-lvl9-critical",
    desc: "5-2, nível 9, vida 19 (crítica), 12 g, itens prontos no banco.",
    snapshot: "late-hp19",
    client: { level: 9, gold: 12 },
    seen: (ctx) => ({
      stage: "5-2",
      xp: "30/68",
      shop: shop(...units(ctx, 2, 5)),
      items: carryBuild(ctx, 0).slice(0, 3),
    }),
    streak: { kind: "loss", length: 3, inferred: true },
    trend: { avgLoss: 15, recentLosses: 3 },
  },
  {
    id: "items-bank-lvl8",
    desc: "4-2, nível 8, 17 itens espalhados, 8 componentes no banco, 54 g.",
    snapshot: "items-8u",
    client: { level: 8, gold: 54 },
    seen: (ctx) => ({
      stage: "4-2",
      xp: "23/68",
      shop: shop(...units(ctx, 0, 5)),
      items: [...COMPONENTS, ...carryBuild(ctx, 0).slice(0, 1)],
    }),
  },
  {
    id: "pinned-comp-swap",
    desc: "Comp fixada pelo usuário com uma troca de peça e nível alvo 9 (plano `preview`).",
    snapshot: "items-8u",
    client: (ctx) => {
      const c = comp(ctx, 3),
        out = c.units.find((u) => u !== c.carry),
        inn = comp(ctx, 0).units.find((u) => !c.units.includes(u));
      return {
        level: 8,
        gold: 54,
        targetLevel: 9,
        goalCompId: c.id,
        goalSwaps: [{ out, in: inn }],
      };
    },
    seen: {
      stage: "4-2",
      xp: "23/68",
      items: COMPONENTS.slice(0, 4),
    },
  },
  {
    id: "augments-chosen-offer",
    desc: "Dois aprimoramentos escolhidos (com emblema) e uma oferta de três lida da tela.",
    snapshot: "items-8u",
    client: (ctx) => {
      const a = augments(ctx);
      return {
        level: 8,
        gold: 54,
        augments: a.withEmblem.map((x) => x.id),
        augmentsKnown: true,
      };
    },
    seen: (ctx) => ({
      stage: "4-2",
      xp: "23/68",
      items: COMPONENTS.slice(0, 3),
      augments: augments(ctx)
        .plain.slice(0, 3)
        .map((x) => x.id),
    }),
  },
  {
    id: "auto-comp-swaps",
    desc: "Troca de peça do usuário aplicada à comp de meta no ranking automático.",
    snapshot: "mid-7u",
    client: (ctx) => {
      const c = comp(ctx, 0),
        out = c.units.find((u) => u !== c.carry),
        inn = comp(ctx, 1).units.find((u) => !c.units.includes(u));
      return {
        level: 7,
        gold: 36,
        compSwaps: { [c.id]: [{ out, in: inn }] },
      };
    },
    seen: { stage: "4-1", xp: "20/56" },
  },
  {
    id: "plan-sequence",
    desc: "Mesma partida em 3 leituras (4-1, 5-2, 5-2 com menos ouro): adoção, manutenção e progresso do plano.",
    snapshot: "mid-7u",
    steps: [
      {
        client: { level: 7, gold: 36 },
        seen: { stage: "4-1", xp: "20/56", items: COMPONENTS.slice(0, 4) },
      },
      {
        snapshot: "late-hp19",
        client: { level: 9, gold: 30 },
        seen: { stage: "5-2", xp: "30/68" },
      },
      { client: { gold: 22 } },
    ],
  },
  {
    id: "shop-cache-d1",
    desc: "D1: depois de adotado o plano, só a loja muda (leitura 3); a base vem do cache sem a loja (compScore defasado).",
    snapshot: "items-8u",
    steps: [
      {
        client: { level: 8, gold: 54 },
        seen: (ctx) => ({
          stage: "4-2",
          xp: "23/68",
          shop: shop(...units(ctx, 0, 5)),
          items: COMPONENTS.slice(0, 4),
        }),
      },
      {},
      {
        seen: (ctx) => ({
          shop: shop(...units(ctx, 5, 5)),
        }),
      },
    ],
  },
  {
    id: "eliminated-recorded",
    desc: "Partida gravada em live-mock-base.json: Hero eliminado (vida -10), 7 rivais.",
    snapshot: "mock-base",
    client: {
      level: 8,
      gold: 0,
      levelEstimated: true,
      levelSource: "estimado",
    },
    seen: { stage: "5-6" },
  },
  {
    id: "gold-unknown",
    desc: "D14: ouro e XP não lidos (null).",
    snapshot: "mid-7u",
    client: { level: 7, gold: null },
    seen: { stage: "4-1" },
  },
  {
    id: "viewed-rival",
    desc: "Tabuleiro de um rival consultado (viewedBoard com sinergias de emblemas).",
    snapshot: "items-8u",
    client: { level: 8, gold: 54, viewedPlayerId: "9000001" },
    seen: { stage: "4-2", xp: "23/68" },
  },
  {
    id: "rich-lvl10",
    desc: "Ouro de três dígitos (120 g), nível 10, 5-1.",
    snapshot: "reroll-3star",
    client: { level: 10, gold: 120, targetLevel: 10 },
    seen: (ctx) => ({
      stage: "5-1",
      xp: "40/68",
      shop: shop(...units(ctx, 4, 5)),
      items: carryBuild(ctx, 1).slice(0, 2),
    }),
  },
  {
    id: "reroll-hidden-banks",
    desc: "Três estrelas na mesa, nível 6 e bancos ocultos dos rivais estimados pelo rastreador.",
    snapshot: "reroll-3star",
    client: { level: 6, gold: 40 },
    seen: (ctx) => ({
      stage: "3-5",
      xp: "10/36",
      shop: shop(...units(ctx, 2, 5)),
    }),
  },
  {
    id: "danger-hp27",
    desc: "Vida 27, 4-5, nível 8: perigo, itens e peças repetidas.",
    snapshot: "danger-hp27",
    client: { level: 8, gold: 18 },
    seen: (ctx) => ({
      stage: "4-5",
      xp: "50/68",
      shop: shop(...units(ctx, 0, 5)),
      items: COMPONENTS.slice(0, 5),
    }),
    streak: { kind: "loss", length: 4, inferred: true },
    trend: { avgLoss: 14, recentLosses: 4 },
  },
  {
    id: "replay-final",
    desc: "Partida revista: tabuleiros finais, sem leitura de tela, sem plano em andamento.",
    snapshot: "danger-hp27",
    metadata: { actionable: false, phase: "Replay", sameGame: null },
    client: { level: 8, gold: null, replayGameId: "9100003" },
  },
];

/** Valor de um campo do cenário: funções recebem o contexto congelado. */
export const resolve = (value, ctx) =>
  typeof value === "function" ? value(ctx) : value;
