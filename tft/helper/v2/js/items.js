/**
 * Tela "Itens": atributos, filtros, faixas de tier, grade de receitas e matriz de atributos.
 * Funções puras sobre o que /api/items devolve; o DOM fica em ui/items.js.
 */

/** Atributos da barra de status, na ordem em que aparecem. `hue` vira a cor (OKLCH); `col` é o rótulo curto da matriz. */
export const ATTRS = [
  {
    key: "AD",
    label: "Dano de Ataque",
    short: "AD",
    col: "AD",
    unit: "%",
    hue: 45,
  },
  {
    key: "AP",
    label: "Poder de Habilidade",
    short: "AP",
    col: "AP",
    unit: "",
    hue: 300,
  },
  {
    key: "AS",
    label: "Velocidade de Ataque",
    short: "VA",
    col: "VA",
    unit: "%",
    hue: 95,
  },
  { key: "AR", label: "Armadura", short: "AR", col: "AR", unit: "", hue: 70 },
  {
    key: "MR",
    label: "Resistência Mágica",
    short: "RM",
    col: "RM",
    unit: "",
    hue: 255,
  },
  { key: "HP", label: "Vida", short: "Vida", col: "Vida", unit: "", hue: 150 },
  {
    key: "Mana",
    label: "Mana inicial",
    short: "Mana",
    col: "Mana",
    unit: "",
    hue: 215,
  },
  {
    key: "ManaRegen",
    label: "Regeneração de Mana",
    short: "Regen",
    col: "Reg",
    unit: "",
    hue: 200,
  },
  {
    key: "Crit",
    label: "Chance de Crítico",
    short: "Crit",
    col: "Crit",
    unit: "%",
    hue: 25,
  },
  {
    key: "Omnivamp",
    label: "Onivampirismo",
    short: "Oniv",
    col: "Oni",
    unit: "%",
    hue: 350,
  },
  {
    key: "Durability",
    label: "Durabilidade",
    short: "Dur",
    col: "Dur",
    unit: "%",
    hue: 230,
  },
];
const BY_KEY = new Map(ATTRS.map((a) => [a.key, a]));

/** Categorias com tier (componentes e "outros" não têm: média de fim de partida não mede o item). */
export const TIER_KINDS = ["completed", "artifact", "radiant", "emblem"];
export const TIERS = ["S", "A", "B", "C", "D"];

/** Ordem clássica da grade de receitas: dano, mana, defesa, utilidade. */
export const COMPONENTS = [
  "BFSword",
  "RecurveBow",
  "NeedlesslyLargeRod",
  "TearOfTheGoddess",
  "ChainVest",
  "NegatronCloak",
  "GiantsBelt",
  "SparringGloves",
  "Spatula",
  "FryingPan",
].map((c) => `DA_Component_${c}`);

/** "+35%", "+15", "+1" — valor do atributo como aparece no jogo. */
export function formatStat(key, value) {
  const unit = BY_KEY.get(key)?.unit ?? "",
    n = String(Math.round(value * 10) / 10).replace(".", ",");
  return `${value > 0 ? "+" : ""}${n}${unit}`;
}
/** Atributos do item na ordem de ATTRS, com rótulo e valor formatado. */
export const statList = (item) =>
  ATTRS.filter((a) => typeof item.stats?.[a.key] === "number").map((a) => ({
    ...a,
    value: item.stats[a.key],
    text: formatStat(a.key, item.stats[a.key]),
  }));

const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Filtra por categoria, atributos (o item precisa ter todos os marcados) e texto: nome em pt-BR ou inglês,
 * sinergia do emblema e nome dos componentes da receita, sem diferenciar acentos.
 */
export function filterItems(
  items,
  { kind = null, attrs = [], query = "" } = {},
  names = new Map(),
) {
  const q = fold(query).trim();
  return items.filter((i) => {
    if (kind && i.kind !== kind) return false;
    if (attrs.some((a) => typeof i.stats?.[a] !== "number")) return false;
    if (!q) return true;
    const hay = [
      i.name,
      i.nameEn,
      i.trait,
      ...(i.from ?? []).map((c) => names.get(c)),
    ]
      .map(fold)
      .join(" ");
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}

/** Faixas S–D (ordenadas pela média encolhida) e, por último, itens sem estatística. */
export function tierRows(items) {
  const byPost = (a, b) => a.perf.post - b.perf.post;
  const rows = TIERS.map((tier) => ({
    tier,
    items: items.filter((i) => i.perf?.tier === tier).sort(byPost),
  }));
  const none = items
    .filter((i) => !i.perf)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return none.length ? [...rows, { tier: null, items: none }] : rows;
}

/**
 * Grade componente × componente: cada célula é o item montado com o par (simétrica). Itens de receita
 * igual a outra (variações) ficam com o primeiro encontrado; radiantes e artefatos não têm receita.
 */
export function recipeGrid(items) {
  const byPair = new Map();
  for (const i of items)
    if (i.from?.length === 2) {
      const key = [...i.from].sort().join("+");
      if (!byPair.has(key)) byPair.set(key, i);
    }
  const comps = COMPONENTS.map(
      (id) => items.find((i) => i.id === id) ?? { id, name: id },
    ),
    cells = comps.map((a) =>
      comps.map((b) => byPair.get([a.id, b.id].sort().join("+")) ?? null),
    );
  return { components: comps, cells };
}

/** Matriz item × atributo: colunas com algum valor, máximo de cada coluna e linhas ordenadas. */
export function attrMatrix(items, sortKey = null) {
  const columns = ATTRS.filter((a) =>
    items.some((i) => typeof i.stats?.[a.key] === "number"),
  ).map((a) => ({
    ...a,
    max: Math.max(...items.map((i) => i.stats?.[a.key] ?? 0)),
  }));
  const rows = [...items].sort((a, b) =>
    sortKey
      ? (b.stats?.[sortKey] ?? -Infinity) - (a.stats?.[sortKey] ?? -Infinity) ||
        a.name.localeCompare(b.name, "pt-BR")
      : (a.perf?.post ?? 99) - (b.perf?.post ?? 99) ||
        a.name.localeCompare(b.name, "pt-BR"),
  );
  return { columns, rows };
}

/** Contagem de itens por categoria, na ordem das abas do servidor. */
export const kindCounts = (items, kinds) =>
  kinds
    .map((k) => ({ ...k, count: items.filter((i) => i.kind === k.key).length }))
    .filter((k) => k.count);

/**
 * Banco de itens lido da tela, como o painel o mostra: `bank` com todo espaço reconhecido (repetidos e consumíveis
 * incluídos, na ordem do banco), `items` só o que a análise usa e `unknown` os espaços ocupados sem ícone
 * reconhecido. Null enquanto a tela não foi lida (ou é uma partida revista, sem leitura).
 */
export function bankReading(screen) {
  if (!screen || !Array.isArray(screen.items)) return null;
  const bank = Array.isArray(screen.bank) ? screen.bank : screen.items,
    unknown = Number.isInteger(screen.unknownItems) ? screen.unknownItems : 0;
  return { bank, items: screen.items, unknown };
}

/**
 * Texto sobre os espaços ocupados do banco que o leitor não reconheceu (null se não há). Eles NÃO entram na análise e nada é
 * adivinhado; a chance de serem componentes é só a proporção de componentes entre os espaços reconhecidos (estimativa,
 * dada quando há ao menos 3 reconhecidos).
 */
export function unknownNote(reading) {
  if (!reading || !(reading.unknown > 0)) return null;
  const n = reading.unknown,
    known = reading.bank.filter((id) => typeof id === "string"),
    components = known.filter((id) => id.startsWith('DA_Component_')).length,
    head = `${n} ${n === 1 ? "espaço ocupado" : "espaços ocupados"} sem ícone reconhecido: fora da análise (nada é adivinhado).`;
  return known.length >= 3
    ? `${head} Estimativa: ${Math.round((components / known.length) * 100)}% dos reconhecidos são componentes.`
    : head;
}

/** Mesmos itens, com as mesmas quantidades, em qualquer ordem. */
export function sameItems(a, b) {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((id, i) => id === sorted[i]);
}

/** Posição (0..1) de uma colocação média na régua 1º–8º, para o marcador do detalhe. */
export const placeScale = (avg, lo = 3, hi = 6) =>
  Math.min(1, Math.max(0, (avg - lo) / (hi - lo)));
