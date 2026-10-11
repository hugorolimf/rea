// Rodar com: node --test tft/helper/v2/js/
// O painel é desenhado com DOM; aqui um DOM mínimo (só o que dom.js e panel.js usam) confere o Roll que o
// jogador vê: veredito, orçamento, nota de juros, peças na loja e uma linha por peça do time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.kids = [];
    this.attrs = {};
    this.dataset = {};
    this.hidden = false;
    this.title = "";
    this.parent = null;
    this._html = "";
    this._text = "";
    this.style = { setProperty() {} };
  }
  get children() {
    return this.kids.filter((k) => k instanceof FakeNode);
  }
  get firstChild() {
    return this.kids[0] ?? null;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  append(...nodes) {
    for (const n of nodes) {
      if (n instanceof FakeNode) n.parent = this;
      this.kids.push(n);
    }
  }
  replaceChildren(...nodes) {
    this.kids = [];
    this.append(...nodes);
  }
  insertBefore(node, ref) {
    node.remove();
    const at = ref ? this.kids.indexOf(ref) : -1;
    node.parent = this;
    if (at < 0) this.kids.push(node);
    else this.kids.splice(at, 0, node);
  }
  remove() {
    if (this.parent)
      this.parent.kids = this.parent.kids.filter((k) => k !== this);
    this.parent = null;
  }
  querySelector(tag) {
    for (const k of this.kids) {
      if (!(k instanceof FakeNode)) continue;
      if (k.tag === tag) return k;
      const deep = k.querySelector(tag);
      if (deep) return deep;
    }
    return null;
  }
  set innerHTML(v) {
    this._html = String(v);
  }
  get innerHTML() {
    return this._html;
  }
  set textContent(v) {
    this._text = String(v);
  }
  get textContent() {
    return this._text;
  }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (_ns, tag) => new FakeNode(tag),
  createTextNode: (text) => String(text),
  documentElement: new FakeNode("html"),
};
globalThis.matchMedia = () => ({ matches: false });
globalThis.CSS = { supports: () => false };

const { mountPanel } = await import("./ui/panel.js");
const { buildModel } = await import("./model.js");
const { strategy } = await import("../../strategy.mjs");
const { makeState } = await import("../../tests/fixtures.mjs");

const base = JSON.parse(
  readFileSync(new URL("../../live-mock-base.json", import.meta.url), "utf8"),
);
const rivals = { count: 7, cost: 2, stars: 1, size: 6 };
const panelFor = (opts, tweak) => {
  const state = structuredClone(base.state),
    rec = structuredClone(base.rec),
    s = makeState({
      gold: 75,
      hp: 80,
      level: 8,
      stage: "4-2",
      rivals,
      ...opts,
    });
  tweak?.(s);
  state.seen = {
    stage: "4-2",
    gold: s.options.gold,
    level: 8,
    xp: "23/68",
    items: [],
  };
  rec.metadata.actionable = true;
  rec.self.health = s.analysis.self.health;
  rec.recommendations[0].strategy = strategy(s.plan, s.analysis, s.options);
  const root = new FakeNode("div"),
    panel = mountPanel(root);
  panel.update(buildModel({ state, rec }).plan.panel);
  const section = (cls) => root.kids.find((k) => k.attrs.class?.includes(cls));
  return { root, roll: section("roll") };
};
const part = (roll, cls) => roll.kids.find((k) => k.attrs.class === cls);

test("painel Roll: veredito, orçamento e uma linha por peça do time, com a evolução e a chance", () => {
  const { roll } = panelFor({ extra: { Aphelios: 1 } }, (s) => {
    s.plan.meta.builds = { TFT_Amumu: [] };
  });
  const head = roll.kids[0].kids.find((k) => k.tag === "b");
  assert.equal(head.textContent, "rolar");
  assert.equal(head.dataset.tone, "go");
  const call = part(roll, "call");
  assert.match(call.innerHTML, /Vale rolar/);
  assert.match(call.innerHTML, /de evoluir alguma peça/);
  const spend = part(roll, "spend");
  assert.equal(spend.hidden, false);
  assert.match(spend.innerHTML, /<b>\d+g<\/b>/);
  assert.match(spend.innerHTML, /pare em 50g/);
  const rows = part(roll, "targets").children;
  assert.ok(rows.length >= 4 && rows.length <= 6, `${rows.length} linhas`);
  const aph = rows.find((r) => r.innerHTML.includes("Aphelios"));
  assert.match(aph.innerHTML, /2→3|1→2★/);
  assert.match(aph.innerHTML, /class="in-roll"/);
  assert.equal(aph.dataset.status, "ok");
  const amumu = rows.find((r) => r.innerHTML.includes("Amumu"));
  assert.match(
    amumu.innerHTML,
    /class="frac">3\/9</,
    "3★ mostra a fração, não nove pips",
  );
  assert.match(amumu.innerHTML, /class="core"/, "core marcado");
  assert.equal(
    part(roll, "roll-note").hidden,
    true,
    "sem queda de juros, sem nota",
  );
});

test("painel Roll: guardar mostra o motivo, esconde o orçamento e mantém a lista", () => {
  const { roll } = panelFor({});
  assert.equal(
    roll.kids[0].kids.find((k) => k.tag === "b").textContent,
    "não rolar",
  );
  assert.match(part(roll, "call").innerHTML, /Só \d+% de evoluir alguma peça/);
  assert.equal(part(roll, "spend").hidden, true);
  assert.ok(part(roll, "targets").children.length >= 4);
});

test("painel Roll: inviável marcada com o substituto, peça na loja acesa e nota de juros", () => {
  const { roll } = panelFor(
    {
      gold: 53,
      hp: 25,
      enemy: { Rakan: 16 },
      shop: [
        {
          slot: 2,
          id: "TFT_Sentinel",
          name: "Sentinel",
          cost: 2,
          action: "comprar",
          reason: "peça da meta",
        },
      ],
    },
    (s) => {
      s.plan.flex = [
        {
          id: "TFT_Rakan",
          suggest: "TFT_Vi",
          options: [{ id: "TFT_Vi", name: "Vi", cost: 3, owned: true }],
        },
      ];
    },
  );
  assert.equal(
    roll.kids[0].kids.find((k) => k.tag === "b").dataset.tone,
    "danger",
  );
  const rows = part(roll, "targets").children,
    rakan = rows.find((r) => r.innerHTML.includes("Rakan")),
    sentinel = rows.find((r) => r.innerHTML.includes("Sentinel"));
  // O substituto é um chip de campeão (imagem; sem catálogo carregado aqui, o marcador com o nome em texto).
  assert.match(
    rakan.innerHTML,
    /class="bad">inviável · <span class="rt[^"]*" data-kind="champion"[^>]*>(<[^>]+>)*Vi</,
  );
  assert.equal(rakan.dataset.status, "inviavel");
  assert.equal(sentinel.dataset.shop, "buy");
  assert.match(sentinel.innerHTML, /in-shop/);
  const hits = part(roll, "shop-hits");
  assert.equal(hits.hidden, false);
  assert.match(
    hits.innerHTML,
    /data-kind="champion"[^>]*>(<[^>]+>)*Sentinel<\/span><\/span> ×1 · 2g/,
  );
  const note = part(roll, "roll-note");
  assert.equal(note.hidden, false);
  assert.match(note.innerHTML, /derruba os juros de \+5 para \+\d/);
});
