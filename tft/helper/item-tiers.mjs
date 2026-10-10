// Tier de itens e atributos: classificação, normalização dos números do CommunityDragon e o tier a partir
// da colocação média publicada (MetaTFT). Funções puras, usadas pelo servidor e por build-items.mjs.

/**
 * Categorias exibidas, na ordem das abas. Sem tier (`tiered: false`): componente e consumível no fim da
 * partida são sobra ou uso pontual, então a colocação média não mede quão bom o item é.
 */
export const KINDS = [
  { key: "completed", label: "Completos", tiered: true },
  { key: "artifact", label: "Artefatos", tiered: true },
  { key: "radiant", label: "Radiantes", tiered: true },
  { key: "emblem", label: "Emblemas", tiered: true },
  { key: "component", label: "Componentes", tiered: false },
  { key: "other", label: "Outros", tiered: false },
];
const TIERED = new Set(KINDS.filter((k) => k.tiered).map((k) => k.key));
export const TIERS = ["S", "A", "B", "C", "D"];
// Cortes no desvio padronizado (z) da média encolhida em relação à média da categoria; z > 0 é melhor.
const CUTS = [1, 0.4, -0.4, -1];
// Variância da colocação de uma partida (1..8 uniforme): (8² − 1) / 12.
export const PLACEMENT_VAR = 63 / 12;

/**
 * Consumíveis ocupam espaço no banco, mas não são itens para montar nem equipar (Removedor, Duplicadores, Reforjador,
 * Poções, Boosters, Melhoria do Mestre-Artesão, Baú da Sorte): ficam fora de toda análise de itens.
 */
export const CONSUMABLE =
  /Consumable_|Reforger|Potion|Booster|Masterwork|LuckyItemChest/;
export const isConsumable = (id) => CONSUMABLE.test(id ?? "");

/** Id do item base de um radiante ("DA_TitansResolve_Radiant" e "DA_VoidStaffRadiant" viram o item comum). */
export const baseItemId = (id) => id.replace(/_?Radiant$/, "");

/** Tipo do item pelo id do set atual e pela receita. */
export function kindOf(id, from = []) {
  if (id.startsWith("DA_Component_")) return "component";
  // Itens de aprimoramento e consumíveis também têm "Radiant"/"Artifact" no nome; só contam os itens de fato.
  if (/Potion|Upgrade|Radiantize|Artifactinate|Chest/i.test(id)) return "other";
  if (/_?Radiant$/.test(id)) return "radiant";
  if (/^DA_(Item_)?Artifact_/.test(id)) return "artifact";
  if (/Emblem/i.test(id)) return "emblem";
  if (from.length === 2 && from.every((c) => c.startsWith("DA_Component_")))
    return "completed";
  return "other";
}

/**
 * Atributos da barra de status do item. O CommunityDragon mistura frações (AD 0,35) e pontos percentuais
 * (AD 10 no componente): os percentuais viram sempre pontos (35, 10).
 */
const STAT_SOURCES = [
  ["AD", ["AD"], true],
  ["AP", ["AP"], false],
  ["AS", ["AS", "AttackSpeed"], true],
  ["AR", ["Armor"], false],
  ["MR", ["MagicResist"], false],
  ["HP", ["Health"], false],
  ["Mana", ["Mana", "CombatStartMana"], false],
  ["ManaRegen", ["ManaRegen"], false],
  ["Crit", ["CritChance"], true],
  ["Omnivamp", ["StatOmnivamp", "Omnivamp"], true],
  // Só a durabilidade da barra de status; "DamageReduction" é efeito passivo (ex.: invulnerabilidade).
  ["Durability", ["BaseDurability"], true],
];
export function normalizeStats(effects = {}) {
  const out = {};
  for (const [key, names, pct] of STAT_SOURCES) {
    const v = names
      .map((n) => effects[n])
      .find((x) => typeof x === "number" && x !== 0);
    if (v === undefined) continue;
    const n = pct && Math.abs(v) <= 1 ? v * 100 : v;
    out[key] = Math.round(n * 10) / 10;
  }
  return out;
}

const number = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
/**
 * Descrição legível: troca @Variável@ (e @Variável*100@) pelos efeitos, remove ícones, marcações e regras,
 * e mantém as quebras de linha do texto original.
 */
export function renderDesc(desc, effects = {}) {
  const values = new Map(
    Object.entries(effects).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return (
    String(desc ?? "")
      .replace(/<(tftitemrules|rules)>[\s\S]*?<\/\1>/gi, "")
      .replace(/\{\{[^}]*\}\}/g, "")
      .replace(/%i:[^%]*%/g, "")
      .replace(/@([^@*]+)(\*100)?@/g, (_, key, hundred) => {
        const v = values.get(key.trim().toLowerCase());
        // Valor calculado pelo jogo em combate (não publicado nos efeitos): "X", como nos aprimoramentos.
        return typeof v === "number" ? number(hundred ? v * 100 : v) : "X";
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+/g, " ")
      .split("\n")
      .map((line) => line.trim())
      // Linhas que só teriam o valor desconhecido ("X", "Cura de aliado: X") não informam nada.
      .filter((line) => line && !/^(?:[^:]*:\s*)?X%?$/.test(line))
      .join("\n")
  );
}

const tierOf = (z) => TIERS[CUTS.findIndex((c) => z >= c)] ?? "D";

/**
 * Junta catálogo e desempenho e calcula o tier dentro de cada categoria.
 * Bayes empírico: a média de colocação de cada item (ruído PLACEMENT_VAR / n) é puxada para a média da
 * categoria na proporção do ruído frente à variância real entre itens (τ²). τ² vem do estimador de
 * DerSimonian–Laird, que pesa cada item pela precisão: um item raro e extremo não infla a régua.
 * Item raro não vira S por sorte; com milhares de partidas a média publicada praticamente fica.
 * O tier vem de z = (média da categoria − média encolhida) / τ.
 */
export function itemTiers(items, stats = {}) {
  const out = items.map((item) => {
    const s = stats[item.id];
    return {
      ...item,
      perf:
        s && s.count > 0 && Number.isFinite(s.avg)
          ? {
              n: s.count,
              avg: s.avg,
              pick: s.pick ?? null,
              units: s.units ?? [],
            }
          : null,
    };
  });
  const byKind = new Map();
  for (const item of out)
    if (item.perf)
      byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
  for (const list of byKind.values()) {
    // DerSimonian–Laird: pesos de precisão w = n / σ² estimam τ² a partir da heterogeneidade Q.
    const m = list.length,
      w = list.map((i) => i.perf.n / PLACEMENT_VAR),
      sw = w.reduce((a, b) => a + b, 0),
      sw2 = w.reduce((a, b) => a + b * b, 0),
      fixed = list.reduce((s, i, k) => s + w[k] * i.perf.avg, 0) / sw;
    const q = list.reduce((s, i, k) => s + w[k] * (i.perf.avg - fixed) ** 2, 0),
      tau2 = m > 1 ? Math.max((q - (m - 1)) / (sw - sw2 / sw), 1e-4) : 1e-4,
      tau = Math.sqrt(tau2);
    // Referência = média de efeitos aleatórios (pesos 1/(v + τ²)): o item típico da categoria, e não a
    // média por partida, que os itens mais populares dominariam.
    const re = list.map((i) => 1 / (PLACEMENT_VAR / i.perf.n + tau2)),
      mean =
        list.reduce((s, i, k) => s + re[k] * i.perf.avg, 0) /
        re.reduce((a, b) => a + b, 0);
    for (const item of list) {
      const p = item.perf,
        v = PLACEMENT_VAR / p.n,
        shrink = v / (v + tau2),
        post = shrink * mean + (1 - shrink) * p.avg,
        z = (mean - post) / tau;
      Object.assign(p, {
        mean: Math.round(mean * 1e4) / 1e4,
        post: Math.round(post * 1e4) / 1e4,
        delta: Math.round((post - mean) * 1e4) / 1e4,
        z: Math.round(z * 1e3) / 1e3,
        se: Math.round(Math.sqrt(v) * 1e4) / 1e4,
        shrink: Math.round(shrink * 1e4) / 1e4,
        tier: TIERED.has(item.kind) ? tierOf(z) : null,
      });
    }
    list
      .sort((a, b) => a.perf.post - b.perf.post)
      .forEach((item, i) => {
        item.perf.rank = i + 1;
        item.perf.of = m;
      });
  }
  return out;
}
