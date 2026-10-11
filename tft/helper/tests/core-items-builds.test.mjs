// Rodar com: node --test tft/helper/tests/core-items-builds.test.mjs
// Motor único de itens (core/items/builds.mjs + scenarios.mjs; planos/feitos/itens-motor-unico.md): para o mesmo
// campeão na mesma comp, Comps ("Builds e 3★" e "Seus itens"), plano/Ao vivo, Formação, overlay, carrossel, loja, motor
// (posse comp a comp) e plano de itens recomendam a MESMA build, na mesma ordem, com cópias e emblemas; a reserva só
// aparece sem build publicada e vem marcada.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildContext,
  championBuild,
  compBuild,
  compBuildMap,
  compBuildRows,
  compSpendOrder,
  pendingItems,
  reserveItems,
  wantedItems,
} from "../core/items/builds.mjs";
import {
  buildSourceNote,
  championItemsView,
  formationBuilds,
} from "../core/items/scenarios.mjs";
import { buildStates, classifyHoldings } from "../core/items/holdings.mjs";
import { championItems } from "../core/items/champion-items.mjs";
import { championRole } from "../core/catalog/champions.mjs";
import { traitBook } from "../core/catalog/traits.mjs";
import { carouselPicks } from "../carousel.mjs";
import { buildItemPlan } from "../item-plan.mjs";
import { itemValueTable } from "../item-value.mjs";
import { compItems } from "../v2/js/comp-items.js";
import { realCatalog } from "../v2/js/catalog-fixture.mjs";
import { buildModel } from "../v2/js/model.js";
import { planView } from "../v2/js/plan.js";
import { PART_STATE, nextItemRecipe } from "../v2/js/next-item.js";
import { overlayView } from "../overlay/hud/view.mjs";
import { loadContext, loadSnapshots, runScenario } from "./golden/harness.mjs";
import { scenarios } from "./golden/scenarios.mjs";

const json = (rel) =>
  JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const catalog = json("../catalog.json");
const uiCatalog = realCatalog();
const ctx = await loadContext();
const comps = ctx.metaComps.comps;
const byId = new Map(catalog.champions.map((c) => [c.apiName, c]));
const items = new Map(catalog.items.map((i) => [i.apiName, i]));
const book = traitBook(catalog);
const buildCtx = (extra = {}) =>
  buildContext({
    items,
    role: (c) => championRole(c, ctx.meta.roles),
    stats: ctx.boardStats,
    metaBuilds: ctx.meta.builds,
    metaLabel: ctx.meta.label,
    emblemTrait: (id) => book.emblems.get(id) ?? null,
    ...extra,
  });
const ids = (list) => list.map((x) => x?.id ?? x?.item?.id ?? x);
const ARCH = "DA_ArchangelsStaff",
  ROD = "DA_Component_NeedlesslyLargeRod",
  TEAR = "DA_Component_TearOfTheGoddess";

/* ---------- (a) a mesma build em toda parte, comp a comp ---------- */

test("(a) cada campeão de cada comp do meta recebe a build de Comps em todas as partes", () => {
  const value = itemValueTable({
    stats: ctx.boardStats,
    itemStats: ctx.meta.items,
    metaBuilds: ctx.meta.builds,
  });
  let checked = 0;
  for (const comp of comps) {
    const rows = compBuildRows(comp);
    // Comps ("Builds e 3★"): só peças da comp, o carry primeiro, os itens como publicados com delta e partidas.
    for (const r of rows) {
      assert.ok(comp.units.includes(r.championId));
      assert.deepEqual(r.items, comp.builds[r.championId]);
      assert.equal(r.delta, comp.buildStats[r.championId]?.delta ?? null);
      assert.equal(r.n, comp.buildStats[r.championId]?.n ?? null);
    }
    if (rows.some((r) => r.championId === comp.carry))
      assert.equal(rows[0].championId, comp.carry);
    // Plano (tactics → championBuild): a Formação, o Ao vivo e o overlay desenham `ideal`.
    const coverage = new Set(),
      plans = rows
        .filter((r) => byId.has(r.championId))
        .map((r) =>
          championBuild(byId.get(r.championId), {
            coverage,
            comp,
            ctx: buildCtx(),
          }),
        );
    const cells = formationBuilds({
      itemPlans: plans,
      goalIds: new Set(comp.units),
    });
    // Motor: a posse comp a comp recebe as mesmas builds, na ordem de gasto do motor (o carry primeiro).
    const holdings = classifyHoldings({
      builds: compBuildMap(comp),
      order: compSpendOrder(comp, comp.carry),
      goalIds: new Set(comp.units),
      compositionOf: (id) => items.get(id)?.composition ?? [],
    });
    // Plano de itens: a lista de desejos, sem nenhum item seu, é a build inteira.
    const itemPlan = buildItemPlan({
      units: plans.map((p) => ({ id: p.championId, name: p.name })),
      bankRead: true,
      valueOf: value.valueOf,
      rankedOf: value.rankedOf,
      buildOf: (id) => compBuild(comp, id)?.items ?? null,
    });
    // Comps "Seus itens no carry" (v2/js/comp-items.js).
    const bank = compItems(comp, {
      bank: [],
      items: uiCatalog.items,
      champions: uiCatalog.champions,
    });
    for (const p of plans) {
      const want = comp.builds[p.championId].slice(0, 3);
      assert.equal(p.origin, "comp", `${comp.id}:${p.championId}`);
      assert.equal(p.reserve, false);
      assert.deepEqual(ids(p.ideal), want, `${comp.id}:${p.championId} plano`);
      assert.equal(p.delta, comp.buildStats[p.championId]?.delta ?? null);
      const cell = { id: p.championId, build: cells.get(p.championId) };
      assert.deepEqual(
        ids(championItemsView(cell, []).items),
        want,
        `${comp.id}:${p.championId} Ao vivo/overlay`,
      );
      assert.deepEqual(
        wantedItems(p.championId, { comp, metaBuilds: ctx.meta.builds }),
        comp.builds[p.championId],
        `${comp.id}:${p.championId} loja/Passar itens`,
      );
      if (holdings.entries.has(p.championId))
        assert.deepEqual(
          ids(holdings.entries.get(p.championId)),
          comp.builds[p.championId],
          `${comp.id}:${p.championId} motor`,
        );
      assert.deepEqual(
        ids(
          itemPlan.wishlist.find((w) => w.champion.id === p.championId)
            ?.items ?? [],
        ),
        comp.builds[p.championId],
        `${comp.id}:${p.championId} plano de itens`,
      );
      const row = bank.units.find((u) => u.unit === p.championId);
      if (row)
        assert.deepEqual(
          row.rows.map((x) => x.want),
          comp.builds[p.championId],
          `${comp.id}:${p.championId} Comps/Seus itens`,
        );
      checked++;
    }
  }
  assert.ok(checked > 100, `poucas builds conferidas: ${checked}`);
});

test("(a) ponta a ponta: plano, Formação, Ao vivo, overlay e carrossel dos cenários do golden seguem Comps", () => {
  const base = json("../live-mock-base.json"),
    snapshots = loadSnapshots(),
    deps = {
      buildModel,
      planView,
      nextItemRecipe,
      partState: PART_STATE,
      buildStates,
      catalogItems: uiCatalog.items,
    };
  const compById = new Map(comps.map((c) => [String(c.id), c]));
  let plansChecked = 0,
    viewsChecked = 0;
  for (const scenario of scenarios)
    for (const out of runScenario(ctx, scenario, snapshots)) {
      const rec = out.response;
      for (const plan of [...(rec.recommendations ?? []), rec.preview]) {
        if (!plan?.itemPlans) continue;
        const comp = compById.get(String(plan.meta?.id)) ?? null;
        for (const p of plan.itemPlans) {
          const published = compBuild(comp, p.championId);
          if (published) {
            assert.deepEqual(ids(p.ideal), published.items.slice(0, 3));
            assert.equal(p.origin, "comp");
            // O que entra nos slots livres ("Próximo item") sai da build da comp, na ordem dela.
            for (const a of p.additions)
              assert.ok(
                published.items.includes(a.id),
                `${p.championId}: ${a.id}`,
              );
          } else {
            // (b) Reserva só sem build publicada, e marcada.
            assert.equal(p.reserve, true, `${scenario.id}:${p.championId}`);
            assert.notEqual(p.origin, "comp");
          }
          plansChecked++;
        }
        // Carrossel: cada componente sugerido serve a um item da build (motor único) de quem o pede.
        for (const pick of plan.carousel ?? [])
          for (const use of pick.uses) {
            const owner = plan.itemPlans.find(
              (p) => p.championId === use.championId,
            );
            assert.ok(
              ids(owner.ideal).includes(use.itemId),
              `${scenario.id}: ${pick.id} para ${use.itemId}`,
            );
          }
      }
      // Formação + Ao vivo + overlay a partir da mesma resposta.
      const shown = rec.preview ?? rec.recommendations?.[0];
      if (!shown?.itemPlans?.length) continue;
      const comp = compById.get(String(shown.meta?.id)) ?? null,
        state = structuredClone(base.state);
      state.screen = { ...state.screen, items: [] };
      const model = buildModel({ state, rec });
      for (const c of model.plan?.cells ?? []) {
        if (!c.build) continue;
        const published = compBuild(comp, c.id);
        if (published)
          assert.deepEqual(
            ids(c.build.ideal),
            published.items.slice(0, 3),
            `Formação ${c.id}`,
          );
        assert.equal(c.build.reserve, !published);
        viewsChecked++;
      }
      const view = overlayView(
        {
          unchanged: false,
          rev: "1",
          state: { at: 0, ageMs: 500, body: state },
          recommendation: { at: 0, ageMs: 800, body: rec },
        },
        { catalogReady: true, now: 10_000, receivedAt: 10_000, deps },
      );
      for (const b of view.builds ?? []) {
        const published = compBuild(comp, b.id);
        if (!published) continue;
        // Itens da formação no overlay: equipados + os que a build ainda pede, todos da build da comp.
        for (const i of [...b.equipped, ...b.wanted])
          assert.ok(
            published.items.includes(i.id) || b.equipped.includes(i),
            `overlay ${b.id}: ${i.id}`,
          );
      }
    }
  assert.ok(plansChecked > 100 && viewsChecked > 10);
});

/* ---------- (b) reserva declarada ---------- */

test("(b) sem build publicada na comp, a build é a reserva (geral da MetaTFT), marcada; com ela, nunca a reserva", () => {
  const comp = comps.find((c) => c.builds?.[c.carry]?.length),
    outsider = catalog.champions.find(
      (c) =>
        !comp.builds?.[c.apiName] &&
        reserveItems(c.apiName, ctx.meta.builds).length >= 3,
    );
  const b = championBuild(outsider, { comp, ctx: buildCtx() });
  assert.equal(b.origin, "reserva");
  assert.equal(b.reserve, true);
  assert.equal(b.delta, null);
  for (const i of b.ideal)
    assert.ok(
      reserveItems(outsider.apiName, ctx.meta.builds).includes(i.id) ||
        ctx.boardStats.unitItem?.[`${outsider.apiName}|${i.id}`],
      `${i.id} fora da reserva declarada`,
    );
  assert.match(buildSourceNote(b), /reserva/);
  // Com build publicada, nada da build geral entra (antes ela completava cópias repetidas e emblemas descartados).
  const carry = championBuild(byId.get(comp.carry), { comp, ctx: buildCtx() });
  assert.equal(carry.origin, "comp");
  assert.match(buildSourceNote(carry), /^Build da comp/);
  // Sem comp nenhuma (tabuleiro atual): também reserva.
  assert.equal(
    championBuild(byId.get(comp.carry), { comp: null, ctx: buildCtx() })
      .reserve,
    true,
  );
});

/* ---------- (c) carrossel ---------- */

test("(c) carrossel: o componente que fecha a 2ª cópia da build publicada (Cassiopeia: Arcanjo ×2 + Gunblade)", () => {
  const comp = comps.find(
      (c) => c.builds?.DA_18_Cassiopeia?.filter((x) => x === ARCH).length === 2,
    ),
    cass = byId.get("DA_18_Cassiopeia");
  assert.ok(comp, "o meta congelado tem a build Arcanjo ×2");
  // Um Arcanjo já equipado; o banco tem um Bastão: o Lágrima fecha o SEGUNDO Arcanjo (antes, a cópia sumia da conta).
  const plan = championBuild(cass, {
    equipped: [ARCH],
    comp,
    ctx: buildCtx({ inventory: [ROD] }),
  });
  assert.deepEqual(ids(plan.ideal), comp.builds.DA_18_Cassiopeia);
  assert.deepEqual(ids(pendingItems(plan.ideal, [ARCH])), [
    ARCH,
    "DA_HextechGunblade",
  ]);
  const picks = carouselPicks([plan], {
    carry: cass.name,
    inventory: [ROD],
  });
  assert.equal(picks[0].id, TEAR);
  assert.equal(picks[0].uses[0].itemId, ARCH);
  assert.equal(picks[0].uses[0].completesNow, true);
});

/* ---------- (d) cópias, radiantes e emblemas ---------- */

test("(d) cópias repetidas: cada cópia equipada ou no banco cobre uma linha só", () => {
  const vow = "DA_ProtectorsVow",
    cell = {
      id: "DA_Sentinel18",
      build: {
        ideal: [vow, vow, vow].map((id) => ({
          id,
          name: "Voto",
          components: [],
        })),
        equipped: [{ id: vow, name: "Voto" }],
        owners: [],
        moves: [],
      },
    };
  assert.deepEqual(
    buildStates(cell, [vow]).map((s) => s.state.kind),
    ["on", "ready", "need"],
  );
  // Radiante equipado vale o item base, uma cópia.
  cell.build.equipped = [{ id: `${vow}Radiant`, name: "Voto radiante" }];
  assert.deepEqual(
    buildStates(cell, []).map((s) => s.state.kind),
    ["on", "need", "need"],
  );
  assert.deepEqual(pendingItems([vow, vow, vow], [`${vow}Radiant`]), [
    vow,
    vow,
  ]);
});

test("(d) emblema da build publicada: fica na build; só monta em quem não tem a sinergia (regra de traços)", () => {
  const [emblemId, trait] = [...book.emblems].find(([id]) =>
      book.recipes.some((r) => r.id === id),
    ),
    recipe = book.recipes.find((r) => r.id === emblemId).parts,
    has = catalog.champions.find((c) => c.traits.includes(trait)),
    lacks = catalog.champions.find(
      (c) => !c.traits.includes(trait) && c.traits.length,
    ),
    other = "DA_WarmogsArmor";
  for (const c of [has, lacks]) {
    const comp = {
      units: [c.apiName],
      builds: { [c.apiName]: [emblemId, other] },
      buildStats: { [c.apiName]: { delta: -0.3, n: 900 } },
    };
    const b = championBuild(c, {
      comp,
      ctx: buildCtx({ inventory: [...recipe] }),
    });
    // A build é a publicada, nos dois casos (igual a Comps).
    assert.deepEqual(ids(b.ideal), [emblemId, other]);
    const blocked = c === has;
    assert.equal(!!b.ideal[0].blocked, blocked);
    // Quem já tem a sinergia não recebe o emblema nos slots; quem não tem, monta com o banco.
    assert.equal(ids(b.additions).includes(emblemId), !blocked);
    const shown = championItems(
      { id: c.apiName, build: { ...b, owners: [], moves: [], equipped: [] } },
      [...recipe],
    );
    assert.equal(shown[0].label === "não equipa", blocked);
  }
});
