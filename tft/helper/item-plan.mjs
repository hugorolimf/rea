// Plano de itens de uma comp: quais dos SEUS itens vão para quais campeões da comp, somando o valor medido de cada
// item no campeão (item-value.mjs) menos o custo de mover/montar (HOLD_VALUE, item-holdings.mjs). Não existe "o carry":
// os campeões de maior impacto saem da soma dos valores dos itens que você tem. Puro e sem I/O.
//
// Problema: atribuir itens a campeões, no máximo SLOTS por campeão, sem gastar o mesmo item ou componente duas vezes,
// maximizando a soma dos valores. Tamanhos pequenos (≤ 10 campeões, ≤ ~30 itens/componentes). Sem montagens é uma
// atribuição de máximo peso com capacidade (cada campeão vira SLOTS vagas): resolvida EXATAMENTE pelo algoritmo húngaro.
// Os componentes tornam o problema combinatório (um componente serve a uma receita só): enumeram-se os conjuntos de
// montagens possíveis e úteis (até MAX_CRAFT_SETS e MAX_RECIPES: bancos reais têm poucos componentes e o tempo da análise é limitado), resolve-se cada um exatamente e
// fica o melhor. O resultado é o ótimo enquanto couberem todos os conjuntos (tests/item-plan.test.mjs confere com força
// bruta); acima disso (muitos componentes soltos), o melhor entre os testados.
//
// Custo de ação (já posicionado > banco > mover > montar), valor do item × fator:
//   equipado nesse campeão 1; banco 0,98; peça que sai 0,95; peça que fica 0,90; montar 0,90; montar com
//   componentes de outras peças 0,85.
// Limites registrados: valor aditivo (a fonte não dá rendimento decrescente por slot, só o teto de 3 itens), um campeão
// não leva duas cópias do mesmo item no plano, item sem valor positivo em nenhum campeão fica de fora, itens que já
// estão num campeão que fica e não entram no plano continuam onde estão.

import { baseItem } from "./v2/js/item-source.js";
import { HOLD_VALUE } from "./item-holdings.mjs";
import { isPlanItem } from "./item-value.mjs";

/** Itens por campeão. */
export const SLOTS = 3;
/**
 * Pontos do motor (escala de colocação esperada × 20) que o total do plano vale. A soma de valores medidos passa
 * de 4 colocações com 15 itens, o que nenhum tabuleiro ganha de verdade (os valores têm viés de "partida rica" e
 * se sobrepõem), então o total entra saturando: PLAN_POINTS_MAX × (1 − e^(−total / PLAN_SCALE)). Cada item a mais
 * ainda soma, com retorno decrescente. Política deste helper, não medida.
 */
export const PLAN_POINTS_MAX = 25;
export const PLAN_SCALE = 2;
export const planPoints = (total) =>
  PLAN_POINTS_MAX * (1 - Math.exp(-Math.max(0, total) / PLAN_SCALE));
const EPS = 1e-9;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const isPart = (id) =>
  id.startsWith('DA_Component_') && !/Spatula|FryingPan/.test(id);
/** Alternativas de montagem testadas por comp (conjuntos de componentes que viram itens); passando disso, as de maior valor. */
const MAX_CRAFT_SETS = 4;
/** Receitas consideradas por comp: as de maior valor em algum campeão (limite de tempo da análise). */
const MAX_RECIPES = 5;
const FROM_RANK = { bank: 0, leaving: 1, unit: 2 };
const SITUATION = {
  on: "equipado",
  bank: "banco",
  move: "mover",
  moveStay: "mover",
  craft: "montar",
  craftMove: "montar",
};

/**
 * Atribuição de máximo peso (algoritmo húngaro, O(n²·m)): `weights[linha][coluna]`, linhas = itens, colunas = vagas.
 * Cada item pode ficar sem vaga (colunas extras de peso 0). Devolve, por linha, a coluna escolhida (≥ nº de vagas =
 * sem vaga).
 */
function assign(weights) {
  const n = weights.length;
  if (!n) return [];
  const slotsN = weights[0].length,
    m = slotsN + n,
    // Custo = −peso; colunas além das vagas (sem vaga) custam 0. Linhas e colunas começam em 1.
    cost = weights.map((row) => {
      const c = new Float64Array(m + 1);
      for (let j = 0; j < slotsN; j++) c[j + 1] = -row[j];
      return c;
    }),
    u = new Float64Array(n + 1),
    v = new Float64Array(m + 1),
    p = new Int32Array(m + 1),
    way = new Int32Array(m + 1),
    minv = new Float64Array(m + 1),
    seen = new Uint8Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    seen.fill(0);
    do {
      seen[j0] = 1;
      const i0 = p[j0],
        row = cost[i0 - 1],
        ui = u[i0];
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (seen[j]) continue;
        const cur = row[j] - ui - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (seen[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array(n).fill(slotsN);
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
  return out;
}

/**
 * `units`: campeões da comp [{ id, name, owned, equipped: ids equipados na peça sua, se ela existe }];
 * `leaving`: peças suas que saem da comp [{ name, items }]; `bank`: ids do banco; `bankRead`: o banco foi lido?
 * (sem leitura não há atribuição: só a lista de desejos do meta); `recipes`: Map item → [componente, componente];
 * `valueOf`/`rankedOf`: item-value.mjs; `nameOf(id)`: nome para a tela.
 * Devolve `{ active, bankRead, assignments, total, champions, wishlist, limitations }`:
 * - `assignments`: [{ champion:{id,name}, item:{id,name,radiant}, measured, value, confidence, samples, source,
 *   kind, situation, from, componentsNeeded }] (`value` = medido × custo de ação, o que soma no total);
 * - `champions`: campeões ordenados pelo valor que seus itens somam (os "carries" que emergem dos seus itens);
 * - `wishlist`: por campeão, os melhores itens do meta que você AINDA não tem (separada das atribuições).
 */
export function buildItemPlan({
  units = [],
  leaving = [],
  bank = [],
  bankRead = true,
  recipes = new Map(),
  valueOf,
  rankedOf = () => [],
  wantsOf = (u) => new Set(rankedOf(u).map((x) => x.id)),
  nameOf = (id) => id,
  wishLimit = 5,
}) {
  const named = (u) => ({ id: u.id, name: u.name ?? u.id });
  const limitations = [
    "Valor aditivo por item: a fonte não dá rendimento decrescente por posição, só o limite de 3 itens por campeão.",
    "Valor = colocação média do campeão contra a do campeão com o item, encolhida pela amostra; mistura o efeito do item com partidas fortes.",
  ];

  // Recursos do jogador: itens completos e componentes, cada um com de onde vem.
  const insts = [],
    parts = [],
    cap = new Map();
  for (const u of units) {
    const equipped = u.equipped ?? [];
    // Emblema, artefato e afins ficam na peça e ocupam vaga; os demais entram no plano.
    cap.set(
      u.id,
      Math.max(
        0,
        SLOTS -
          equipped.filter((id) => !isPlanItem(baseItem(id)) && !isPart(id))
            .length,
      ),
    );
    for (const raw of equipped) {
      const id = baseItem(raw),
        from = { type: "unit", unitId: u.id, name: u.name ?? u.id };
      if (isPlanItem(id)) insts.push({ id, raw, radiant: id !== raw, from });
      else if (isPart(raw)) parts.push({ id: raw, from });
    }
  }
  for (const l of leaving)
    for (const raw of l.items ?? []) {
      const id = baseItem(raw),
        from = { type: "leaving", name: l.name };
      if (isPlanItem(id)) insts.push({ id, raw, radiant: id !== raw, from });
      else if (isPart(raw)) parts.push({ id: raw, from });
    }
  for (const raw of bank) {
    const id = baseItem(raw),
      from = { type: "bank", name: "banco" };
    if (isPlanItem(id)) insts.push({ id, raw, radiant: id !== raw, from });
    else if (isPart(raw)) parts.push({ id: raw, from });
  }
  const craftable = new Map(
    [...recipes].filter(
      ([id, c]) => isPlanItem(id) && c?.length === 2 && c.every(isPart),
    ),
  );

  const slots = new Map(units.map((u) => [u.id, []]));
  const idOf = (o) => (o.t === "i" ? insts[o.i].id : o.id);
  function kindOf(o, unitId) {
    if (o.t === "i") {
      const f = insts[o.i].from;
      return f.type === "bank"
        ? "bank"
        : f.type === "leaving"
          ? "move"
          : f.unitId === unitId
            ? "on"
            : "moveStay";
    }
    return [parts[o.a], parts[o.b]].every(
      (p) =>
        p.from.type === "bank" ||
        (p.from.type === "unit" && p.from.unitId === unitId),
    )
      ? "craft"
      : "craftMove";
  }
  // Valor medido (positivo) de um item num campeão, uma consulta por par.
  const measured = new Map(units.map((u) => [u.id, new Map()]));
  const measure = (u, o) => {
    const id = idOf(o),
      memo = measured.get(u);
    if (!memo.has(id)) {
      const m = valueOf(u, id);
      memo.set(id, m && m.value > 0 ? m : null);
    }
    return memo.get(id);
  };
  const val = (u, o) => {
    const m = measure(u, o);
    return m ? m.value * HOLD_VALUE[kindOf(o, u)] : 0;
  };

  const active = bankRead && valueOf;
  if (active && (insts.length || parts.length)) {
    // Só entram as opções com valor positivo em algum campeão da comp (a lista medida dele): o resto não soma.
    const wants = new Map(units.map((u) => [u.id, wantsOf(u.id)])),
      useful = (id) => units.some((u) => wants.get(u.id).has(id)),
      fixed = insts
        .map((x, i) => ({ t: "i", i }))
        .filter((o) => useful(idOf(o)));
    // Receitas úteis que os componentes permitem. Cada conjunto de montagens possíveis (sem repetir componente) é uma
    // alternativa; para cada uma o resto é um problema de atribuição com capacidade, resolvido exatamente.
    const best1 = (id) =>
        Math.max(
          ...units.map((u) => measure(u.id, { t: "c", id })?.value ?? 0),
        ),
      recipesUseful = [...craftable.keys()]
        .filter(useful)
        .sort((a, b) => best1(b) - best1(a))
        .slice(0, MAX_RECIPES),
      craftSets = [];
    const used = new Set();
    function pickParts(recipe) {
      const chosen = [];
      for (const need of craftable.get(recipe)) {
        const at = parts
          .map((p, i) => [p, i])
          .filter(
            ([p, i]) => p.id === need && !used.has(i) && !chosen.includes(i),
          )
          .sort(
            ([a], [b]) => FROM_RANK[a.from.type] - FROM_RANK[b.from.type],
          )[0]?.[1];
        if (at == null) return null;
        chosen.push(at);
      }
      return { t: "c", id: recipe, a: chosen[0], b: chosen[1] };
    }
    // Só os conjuntos maximais importam: uma montagem a mais nunca piora (fica sem vaga se não rende), então basta testar
    // os conjuntos aos quais não dá para acrescentar outra montagem com os componentes que sobram.
    (function walk(from, picked) {
      if (craftSets.length >= MAX_CRAFT_SETS) return;
      let extended = false;
      for (let r = 0; r < recipesUseful.length; r++) {
        const o = pickParts(recipesUseful[r]);
        if (!o) continue;
        extended = true;
        if (r < from) continue;
        used.add(o.a);
        used.add(o.b);
        picked.push(o);
        walk(r, picked);
        picked.pop();
        used.delete(o.a);
        used.delete(o.b);
      }
      if (!extended) craftSets.push([...picked]);
    })(0, []);
    if (!craftSets.length) craftSets.push([]);

    const columns = units.flatMap((u) =>
      Array.from({ length: cap.get(u.id) }, () => u.id),
    );
    // Resolve um conjunto de opções. Duas cópias do mesmo item no mesmo campeão não valem (política: uma por campeão):
    // quando a solução repete, ramifica proibindo uma das cópias ali e fica com a melhor (poucos níveis; limite abaixo).
    function solve(opts, weights, forbidden = new Set(), depth = 0) {
      const w = forbidden.size
          ? weights.map((row, r) =>
              row.map((x, c) =>
                forbidden.has(r * columns.length + c) ? 0 : x,
              ),
            )
          : weights,
        pick = assign(w),
        seen = new Map();
      let clash = null,
        total = 0;
      pick.forEach((c, r) => {
        if (c >= columns.length || w[r][c] <= EPS) return;
        total += w[r][c];
        const k = columns[c] + "|" + idOf(opts[r]);
        if (seen.has(k)) clash ??= { u: columns[c], rows: [seen.get(k), r] };
        else seen.set(k, r);
      });
      if (!clash) return { total, opts, pick, weights: w };
      if (depth >= 6) {
        // Sem solução limpa em poucos níveis: mantém uma cópia por campeão.
        const keep = new Set();
        pick.forEach((c, r) => {
          const k = columns[c] + "|" + idOf(opts[r]);
          if (c < columns.length && keep.has(k)) pick[r] = columns.length;
          else keep.add(k);
        });
        return {
          total: pick.reduce(
            (n, c, r) => n + (c < columns.length ? w[r][c] : 0),
            0,
          ),
          opts,
          pick,
          weights: w,
        };
      }
      let bestBranch = null;
      for (const r of clash.rows) {
        const next = new Set(forbidden);
        columns.forEach(
          (u, c) => u === clash.u && next.add(r * columns.length + c),
        );
        const got = solve(opts, weights, next, depth + 1);
        if (!bestBranch || got.total > bestBranch.total + EPS) bestBranch = got;
      }
      return bestBranch;
    }
    let best = null;
    const fixedWeights = fixed.map((o) => columns.map((u) => val(u, o))),
      craftRows = new Map(),
      rowOf = (o) => {
        const k = `${o.id}|${o.a}|${o.b}`;
        if (!craftRows.has(k))
          craftRows.set(
            k,
            columns.map((u) => val(u, o)),
          );
        return craftRows.get(k);
      };
    // Sem montar nada primeiro; cada conjunto de montagens só é resolvido se o teto dele (o melhor valor de cada montagem
    // somado) puder passar o melhor até aqui.
    best = solve(fixed, fixedWeights);
    const noCraft = best.total;
    for (const crafts of craftSets) {
      if (!crafts.length) continue;
      const bound =
        noCraft + crafts.reduce((n, o) => n + Math.max(...rowOf(o)), 0);
      if (bound <= best.total + EPS) continue;
      const opts = [...fixed, ...crafts],
        got = solve(opts, [...fixedWeights, ...crafts.map(rowOf)]);
      if (!best || got.total > best.total + EPS) best = got;
    }
    if (best)
      best.pick.forEach((c, r) => {
        if (c < columns.length && best.weights[r][c] > EPS)
          slots.get(columns[c]).push(best.opts[r]);
      });
  }

  const byId = new Map(units.map((u) => [u.id, u]));
  const assignments = [];
  for (const [u, list] of slots)
    for (const o of list) {
      const m = measure(u, o),
        kind = kindOf(o, u),
        id = idOf(o),
        src = o.t === "i" ? insts[o.i] : null,
        from =
          o.t === "i"
            ? src.from.type === "unit" && src.from.unitId === u
              ? null
              : src.from.name
            : [...new Set([parts[o.a], parts[o.b]].map((p) => p.from.name))]
                .filter((n) => n !== "banco")
                .join(" e ") || null;
      assignments.push({
        champion: named(byId.get(u)),
        item: { id, name: nameOf(id), radiant: !!src?.radiant },
        measured: m.value,
        value: round(m.value * HOLD_VALUE[kind]),
        confidence: m.confidence,
        samples: m.samples,
        source: m.source,
        kind,
        situation: SITUATION[kind],
        from,
        componentsNeeded: o.t === "c" ? [parts[o.a].id, parts[o.b].id] : [],
      });
    }
  assignments.sort((a, b) => b.value - a.value);
  const perChampion = new Map();
  for (const a of assignments) {
    const c = perChampion.get(a.champion.id) ?? {
      champion: a.champion,
      total: 0,
      items: 0,
    };
    c.total = round(c.total + a.value);
    c.items++;
    perChampion.set(a.champion.id, c);
  }
  const champions = [...perChampion.values()]
    .sort((a, b) => b.total - a.total)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  // Lista de desejos: melhores itens do meta que você ainda não tem (com o banco lido) para cada campeão da comp.
  const have = new Set(
    bankRead
      ? [...insts.map((x) => x.id), ...assignments.map((a) => a.item.id)]
      : [],
  );
  const wishlist = units
    .map((u) => ({
      champion: named(u),
      items: rankedOf(u.id)
        .filter((x) => isPlanItem(x.id) && !have.has(x.id))
        .slice(0, wishLimit)
        .map(({ id, m }) => ({
          item: { id, name: nameOf(id) },
          value: m.value,
          confidence: m.confidence,
          samples: m.samples,
          source: m.source,
          componentsNeeded: recipes.get(id) ?? [],
        })),
    }))
    .filter((w) => w.items.length)
    .sort((a, b) => b.items[0].value - a.items[0].value);

  return {
    active: !!active,
    bankRead,
    assignments,
    total: round(assignments.reduce((n, a) => n + a.value, 0)),
    champions,
    wishlist,
    limitations,
  };
}
