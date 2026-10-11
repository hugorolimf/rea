// Rodar com: node --test tft/helper/v2/js/
// Plano de itens na aba Comps: o cartão consome `compRanking[].itemPlan` do motor (item-plan.mjs) e mostra os itens que o
// jogador tem distribuídos pelos campeões de maior impacto, com os valores acumulando; a lista de desejos vem separada e
// sem a leitura do banco nunca há atribuição.
import test from "node:test";
import assert from "node:assert/strict";
import { planView } from "./comp-items.js";
// dom.js lê matchMedia ao carregar: um stub mínimo basta para importar a tela.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const { setCatalog } = await import("./ui/glyphs.js");
const { itemPlanBlock } = await import("./ui/comps.js");

const champ = (name, cost) => ({ name, cost, icon: `/img/${name}.png` });
const item = (name) => ({ name, icon: `/img/${name}.png`, kind: "completed" });
const champions = new Map([
  ["C_Aphelios", champ("Aphelios", 4)],
  ["C_Amumu", champ("Amumu", 2)],
  ["C_Lillia", champ("Lillia", 3)],
]);
const items = new Map([
  ["DA_Item_InfinityEdge", item("Infinity Edge")],
  ["DA_Item_Bloodthirster", item("Bloodthirster")],
  ["DA_Item_BrambleVest", item("Bramble Vest")],
  ["DA_Item_WarmogsArmor", item("Warmog Armor")],
  ["DA_Item_Redemption", item("Redemption")],
  ["DA_Component_GiantsBelt", item("Giants Belt")],
  ["DA_Component_ChainVest", item("Chain Vest")],
  ["DA_Component_NeedlesslyLargeRod", item("Large Rod")],
]);
setCatalog({
  champions,
  items,
  traits: new Map(),
  traitIcons: new Map(),
});

const C = (id) => ({ id, name: champions.get(id).name });
const I = (id) => ({ id, name: items.get(id).name, radiant: false });
const asg = (champion, itemId, extra) => ({
  champion: C(champion),
  item: I(itemId),
  measured: 0.5,
  value: 0.5,
  confidence: 0.95,
  samples: 100000,
  source: "par",
  kind: "bank",
  situation: "banco",
  from: null,
  componentsNeeded: [],
  ...extra,
});
const wish = [
  {
    champion: C("C_Lillia"),
    items: [
      {
        item: { id: "DA_Item_Redemption", name: "Redemption" },
        value: 0.25,
        confidence: 0.8,
        samples: 20000,
        source: "par",
        componentsNeeded: [
          "DA_Component_NeedlesslyLargeRod",
          "DA_Component_ChainVest",
        ],
      },
    ],
  },
];
// Como o motor entrega: atribuições por valor, campeões por impacto, total e desejos.
const plan = (extra = {}) => ({
  active: true,
  bankRead: true,
  assignments: [
    asg("C_Aphelios", "DA_Item_InfinityEdge", { value: 0.47, measured: 0.48 }),
    asg("C_Aphelios", "DA_Item_Bloodthirster", {
      value: 0.3,
      measured: 0.3,
      kind: "on",
      situation: "equipado",
    }),
    asg("C_Amumu", "DA_Item_BrambleVest", {
      value: 0.2,
      measured: 0.21,
      kind: "move",
      situation: "mover",
      from: "Lillia",
    }),
    asg("C_Amumu", "DA_Item_WarmogsArmor", {
      value: 0.18,
      measured: 0.2,
      kind: "craft",
      situation: "montar",
      componentsNeeded: ["DA_Component_GiantsBelt", "DA_Component_ChainVest"],
    }),
  ],
  total: 1.15,
  champions: [
    { champion: C("C_Aphelios"), total: 0.77, items: 2, rank: 1 },
    { champion: C("C_Amumu"), total: 0.38, items: 2, rank: 2 },
  ],
  wishlist: wish,
  limitations: [],
  ...extra,
});
const imgs = (html) => (html.match(/<img /g) ?? []).length;
const MINUS = "−";

test("planView: campeões por impacto, valores acumulando e desejos separados", () => {
  assert.equal(planView(null), null);
  assert.equal(planView(undefined), null);
  const v = planView(plan());
  assert.equal(v.read, true);
  assert.equal(v.total, 1.15);
  assert.deepEqual(
    v.groups.map((g) => [g.champion.name, g.total, g.acc]),
    [
      ["Aphelios", 0.77, 0.77],
      ["Amumu", 0.38, 1.15],
    ],
  );
  assert.deepEqual(
    v.groups[0].items.map((a) => a.item.id),
    ["DA_Item_InfinityEdge", "DA_Item_Bloodthirster"],
    "maior valor primeiro dentro do campeão",
  );
  assert.equal(v.wishlist.length, 1);
  assert.ok(
    !v.groups.some((g) =>
      g.items.some((a) => a.item.id === "DA_Item_Redemption"),
    ),
    "o que só está na lista de desejos não vira atribuição",
  );
});

test("planView: campeão que o motor não listou entra no fim e sem total do motor a soma vale", () => {
  const p = plan({ total: undefined, champions: [] });
  const v = planView(p);
  assert.deepEqual(
    v.groups.map((g) => g.champion.id),
    ["C_Aphelios", "C_Amumu"],
  );
  assert.equal(v.total, 1.15);
});

test("planView: sem a leitura do banco nunca há atribuição, só os desejos", () => {
  const v = planView(plan({ bankRead: false, active: false }));
  assert.equal(v.read, false);
  assert.deepEqual(v.groups, []);
  assert.equal(v.total, 0);
  assert.equal(v.wishlist.length, 1);
  // Plano sem o campo `bankRead` conta como lido (o motor sempre o informa; ausente = formato antigo com atribuições).
  assert.equal(planView({ assignments: [], champions: [] }).read, true);
});

test("tela: itens distribuídos pelos campeões de maior impacto, com estado, componentes em imagem e total", () => {
  const html = itemPlanBlock(plan(), champions, { id: "cmp" });
  assert.match(html, /Seus itens nesta comp/);
  assert.doesNotMatch(html, /Seus itens no carry/);
  // Dois campeões (não um carry só), na ordem de impacto, cada um com retrato e anel de custo.
  const order = [
    ...html.matchAll(/<li class="cp-champ" data-rank="(\d)"/g),
  ].map((m) => m[1]);
  assert.deepEqual(order, ["1", "2"]);
  assert.ok(html.indexOf("Aphelios") < html.indexOf("Amumu"));
  assert.match(
    html,
    /data-kind="champion" title="Aphelios" style="--ring-c:var\(--cost-4\)"/,
  );
  assert.match(
    html,
    /data-kind="champion" title="Amumu" style="--ring-c:var\(--cost-2\)"/,
  );
  // Valores: por item, por campeão e acumulados até o total do plano.
  assert.ok(html.includes(`${MINUS}0,47`), "valor do item");
  assert.ok(html.includes(`${MINUS}0,77`), "soma do primeiro campeão");
  assert.ok(html.includes(`acumulado ${MINUS}1,15`), "acumulado do segundo");
  assert.match(html, new RegExp(`class="cp-total"[^>]*>${MINUS}1,15<`));
  // Estado de cada item.
  assert.match(html, /data-state="bank"[^>]*>.*?no banco/s);
  assert.match(html, /data-state="on"[^>]*>.*?equipado/s);
  assert.match(html, /mover de <span class="rt"[^>]*title="Lillia"/);
  // Montar: os dois componentes como imagem.
  const craft = html.match(/<li data-state="craft".*?<\/li>/s)[0];
  assert.equal(imgs(craft), 3, "item + 2 componentes");
  assert.match(craft, /class="cb-recipe"/);
  assert.match(craft, /montar/);
  // Imagem de item em todo item atribuído e na lista de desejos.
  assert.ok(html.includes("/img/Infinity Edge.png"));
  assert.ok(html.includes("/img/Redemption.png"));
});

test("tela: a lista de desejos fica separada das atribuições, recolhida quando o banco foi lido", () => {
  const closed = itemPlanBlock(plan(), champions, { id: "cmp" }),
    wishAt = closed.indexOf('class="cp-wish"');
  assert.ok(wishAt > closed.lastIndexOf('class="cp-champ"'));
  assert.match(closed, /<details class="cp-wish" data-more="cmp:wish">/);
  assert.match(closed, /Lista de desejos/);
  const wishHtml = closed.slice(wishAt);
  assert.match(wishHtml, /title="Lillia"/);
  assert.match(wishHtml, /class="cb-recipe"/);
  assert.ok(wishHtml.includes(`${MINUS}0,25`));
  // O que o jogador vê aberto continua aberto no próximo desenho.
  assert.match(
    itemPlanBlock(plan(), champions, { id: "cmp", openWish: true }),
    /<details class="cp-wish" data-more="cmp:wish" open>/,
  );
});

test("tela: banco não lido mostra o aviso e só os desejos, sem inventar atribuição", () => {
  // O plano chega com atribuições e total (defeito simulado): a tela as ignora.
  const html = itemPlanBlock(
    plan({ bankRead: false, active: false }),
    champions,
    {
      id: "cmp",
      emblems: [
        {
          id: "DA_Item_InfinityEdge",
          trait: "Bastion",
          state: "ready",
          recipe: [],
          missing: [],
        },
      ],
    },
  );
  assert.match(html, /Banco não lido/i);
  assert.match(html, /data-read="false"/);
  assert.doesNotMatch(
    html,
    /cp-champs|cp-champ"|cp-total|data-state=|cb-emblem/,
  );
  assert.match(html, /<div class="cp-wish">/);
  assert.doesNotMatch(html, /<details/);
  assert.match(html, /title="Lillia"/);
  assert.ok(!html.includes("Infinity Edge.png"));
});

test("tela: banco lido sem item que renda diz isso e mantém os desejos", () => {
  const html = itemPlanBlock(
    plan({ assignments: [], champions: [], total: 0 }),
    champions,
    { id: "cmp" },
  );
  assert.match(html, /Nenhum item seu/);
  assert.doesNotMatch(html, /cp-champs|cp-total|Banco não lido/);
  assert.match(html, /Lista de desejos/);
});

test("tela: emblemas úteis do banco aparecem abaixo do plano; sem plano, nada", () => {
  const html = itemPlanBlock(plan(), champions, {
    id: "cmp",
    emblems: [
      {
        id: "DA_Item_Redemption",
        trait: "Bastion",
        state: "ready",
        recipe: [],
        missing: [],
      },
    ],
  });
  assert.match(html, /class="cb-emblem" data-trait="Bastion"/);
  assert.ok(html.indexOf("cp-emblems") > html.lastIndexOf('class="cp-champ"'));
  assert.equal(itemPlanBlock(null, champions), "");
});
