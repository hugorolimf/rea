// Carrossel: qual componente pegar, a partir das builds recomendadas de cada campeão da comp.
//
// Ordem de valor: (1) componente que FECHA um item agora (a outra metade já está no banco ou equipada),
// (2) componente que começa um item bom de um campeão da comp. O peso de cada item é o ganho dele no campeão NESTA comp
// (`options` de cada build, core/items/item-priority.mjs: qualquer item bom, não só os 3 da build): quem tem mais
// vantagem com o item pesa mais. Sem essa lista (comp sem dado), a build de cada campeão: o 1º item vale mais que o 2º e
// o 3º. Nenhuma preferência pelo carry (regra do usuário: a vantagem decide).
// Cada componente do banco é usado uma vez só, na ordem de prioridade, antes de medir o que falta.
//
// Duas saídas com a mesma conta:
//  - `carouselPicks`: SEM leitura do carrossel, os componentes mais úteis para pegar "se aparecer" (lista de prioridade);
//  - `rankCarouselOffer`: COM a leitura do que o carrossel oferece (GEP `carousel_pieces`: um campeão com um item em cada
//    peça), as peças ofertadas em ordem de valor para o plano.

import {
  anvilKind,
  baseItemId,
  isArtifact,
  isComponent,
  isEmblemItem,
  isEmblemTool,
  isThiefsGloves,
} from "./core/catalog/items.mjs";
import { pendingItems } from "./core/items/builds.mjs";
import { itemPriority } from "./core/items/item-priority.mjs";
import { takeOne } from "./core/items/stock.mjs";

const UNIT_WEIGHT = 1;
const ITEM_WEIGHT = [1, 0.75, 0.55]; // 1º, 2º e 3º item da build
// Peso de um item pelo ganho dele no campeão (colocações): o melhor item de um campeão (~0,35) pesa ~1, como o 1º item
// da build na regra sem lista.
const GAIN_WEIGHT = 3;
const COMPLETES = 10,
  STARTS = 3,
  // Um componente que serve a várias receitas soma um pouco de cada uso extra, sem deixar um campeão
  // com muitas receitas parecidas dominar a escolha.
  EXTRA_USE = 0.25,
  // Item COMPLETO da build oferecido pronto: poupa os dois componentes (mais que fechar um item com a metade que falta).
  DIRECT = 12,
  // Emblema de uma sinergia que o plano usa; ferramenta de emblema (Espátula, Frigideira) sem emblema pedido; o carry ou
  // uma peça do plano que vem junto com o item. Valores da mesma escala dos pontos acima, pesos heurísticos.
  EMBLEM_IN_PLAN = 4,
  EMBLEM_TOOL = 1.5,
  UNIT_BONUS = 1;

/**
 * Pontuação de cada componente que o plano ainda pede. `plans`: builds por campeão ({championId, name, role,
 * equipped:[{id}], slotsFree, ideal:[{id, name, components:[{id,name}]}]}), na ordem de prioridade; `inventory`: ids do
 * banco; `covered`: "campeão:item" que chegam passando um item já montado de outro campeão. Devolve `{ components,
 * direct }`: `components` = [{id, name, score, owned, uses:[{champion, championId, item, itemId, completesNow, points,
 * reason}]}] em ordem de valor; `direct` = receitas ainda pedidas `{p, r, w}` (para valorar o item pronto no carrossel).
 */
/**
 * Valor de pegar um componente ou item no carrossel pela mesma regra do "Próximo item" (core/items/item-priority.mjs): o
 * quanto ele aumenta o ganho total da melhor distribuição dos seus itens entre os campeões da comp. Respeita o que o
 * próximo item já vai montar (componentes reservados), as vagas e as bigornas. `gainWith(id)` → `{ gain, use }`, com
 * `use` o item novo que ele fecha (e para quem), ou null.
 */
function marginalScorer(plans, inventory, covered, holders = []) {
  const members = plans.map((p) => ({
      id: p.championId,
      name: p.name,
      stars: p.stars ?? 0,
      inField: (p.equipped ?? []).length > 0,
      equipped: (p.equipped ?? []).map((e) => e?.id ?? e),
      slotsFree: p.slotsFree,
    })),
    byId = new Map(plans.map((p) => [p.championId, p.options ?? []])),
    runAll = (bank) =>
      itemPriority({
        members,
        optionsOf: (id) => byId.get(id) ?? [],
        bank,
        covered,
        holders,
      }),
    run = (bank) => runAll(bank).ready,
    total = (ready) => ready.reduce((n, c) => n + c.gain, 0),
    keyOf = (c) => `${c.championId}:${c.item.id}`,
    baseAll = runAll(inventory),
    base = baseAll.ready,
    baseTotal = total(base),
    baseKeys = new Set(base.map(keyOf)),
    memo = new Map();
  // Vagas que sobram depois do que o próximo item já monta, e o que ele já monta (o "começa" não repete).
  const slotsLeft = new Map(plans.map((p) => [p.championId, p.slotsFree ?? 0]));
  // A Luva de Ladrão planejada ocupa as 3 vagas.
  for (const c of base)
    if (!c.item.usesHeld || isThiefsGloves(c.item.id))
      slotsLeft.set(
        c.championId,
        (slotsLeft.get(c.championId) ?? 0) -
          (isThiefsGloves(c.item.id) ? 3 : 1),
      );
  const gainWith = (id) => {
    if (!memo.has(id)) {
      const ready = run([...inventory, id]),
        // Quem recebe o próprio item (item pronto ou da bigorna): a linha que gasta exatamente ele.
        placed =
          ready.find(
            (c) =>
              c.required.length === 1 &&
              baseItemId(c.required[0]) === baseItemId(id),
          ) ?? null,
        use =
          ready
            .filter((c) => !baseKeys.has(keyOf(c)))
            .sort((a, b) => b.gain - a.gain)[0] ?? null;
      memo.set(id, {
        gain: Math.max(0, total(ready) - baseTotal),
        use,
        placed,
      });
    }
    return memo.get(id);
  };
  gainWith.planned = baseKeys;
  gainWith.slotsLeft = slotsLeft;
  // Os itens do "Próximo item" a um componente de fechar (a mesma ordem que a tela mostra).
  gainWith.near = baseAll.near;
  return gainWith;
}

/** Valor do carrossel pela regra do "Próximo item" (planos com a lista de itens da comp). Mesma saída de `scorePlans`. */
function scoreByMarginal(plans, inventory, covered, holders = []) {
  const gainWith = marginalScorer(plans, inventory, covered, holders),
    parts = new Map();
  for (const p of plans)
    for (const o of p.options ?? [])
      for (const c of o.components ?? [])
        if (isComponent(c.id) && !isEmblemTool(c.id) && !parts.has(c.id))
          parts.set(c.id, c.name);
  const components = [];
  for (const [id, name] of parts) {
    const m = gainWith(id),
      owned = inventory.filter((x) => x === id).length;
    if (m.gain > 1e-9 && m.use) {
      const g = m.gain.toFixed(2).replace(".", ",");
      components.push({
        id,
        name,
        owned,
        score: Math.round(GAIN_WEIGHT * COMPLETES * m.gain * 100) / 100,
        uses: [
          {
            champion: m.use.champion,
            championId: m.use.championId,
            item: m.use.item.name,
            itemId: m.use.item.id,
            completesNow: true,
            points: GAIN_WEIGHT * COMPLETES * m.gain,
            reason: `Fecha ${m.use.item.name} em ${m.use.champion}: a melhor distribuição dos seus itens soma +${g}.`,
          },
        ],
      });
      continue;
    }
    // Não fecha nada agora: começa o item de maior ganho que o usa, em quem ainda tem vaga.
    const start = plans
      .filter((p) => (gainWith.slotsLeft.get(p.championId) ?? 0) > 0)
      .flatMap((p) =>
        (p.options ?? [])
          .filter(
            (o) =>
              !gainWith.planned.has(`${p.championId}:${o.id}`) &&
              // A luva só começa em quem tem as 3 vagas livres.
              (!isThiefsGloves(o.id) ||
                (gainWith.slotsLeft.get(p.championId) ?? 0) >= 3) &&
              (o.components ?? []).some((c) => c.id === id),
          )
          .map((o) => ({ p, o })),
      )
      .sort((a, b) => b.o.gain - a.o.gain)[0];
    if (!start) continue;
    components.push({
      id,
      name,
      owned,
      score: Math.round(GAIN_WEIGHT * STARTS * start.o.gain * 100) / 100,
      uses: [
        {
          champion: start.p.name,
          championId: start.p.championId,
          item: start.o.name,
          itemId: start.o.id,
          completesNow: false,
          points: GAIN_WEIGHT * STARTS * start.o.gain,
          reason: `Começa ${start.o.name} para ${start.p.name}.`,
        },
      ],
    });
  }
  components.sort((a, b) => b.score - a.score);
  return { components, direct: [], gainWith };
}

function scorePlans(
  plans,
  { carry = null, inventory = [], covered = new Set(), holders = [] } = {},
) {
  if (plans.some((p) => (p.options ?? []).length))
    return scoreByMarginal(plans, inventory, covered, holders);
  const bank = [...inventory],
    wants = [],
    direct = [];
  // Cada cópia do banco serve a um uso só (core/items/stock.mjs).
  const take = (id) => takeOne(bank, id) !== null;
  for (const p of plans) {
    const unit = UNIT_WEIGHT,
      // Radiante equipado conta como o item base da build.
      equipped = (p.equipped ?? []).map((e) => baseItemId(e.id)),
      held = equipped.filter(isComponent);
    let slots = p.slotsFree ?? 0;
    // A build vem do motor único (core/items/builds.mjs): a de Comps quando a comp a publica. Cada cópia equipada cobre
    // uma linha (Voto ×3 com um equipado ainda pede dois); emblema que a peça não pode usar (regra de traços) fica fora.
    // Com a lista de itens bons da comp, cada item é uma ALTERNATIVA para as vagas do campeão (só o item já pronto ocupa
    // vaga); sem ela, a build do campeão, item a item.
    const byGain = Array.isArray(p.options) && p.options.length > 0,
      recipes = byGain
        ? p.options.filter((o) => !equipped.includes(o.id))
        : pendingItems(p.ideal ?? [], equipped).filter((r) => !r.blocked);
    recipes.forEach((r, i) => {
      const w = byGain
        ? GAIN_WEIGHT * (r.gain ?? 0)
        : unit * (ITEM_WEIGHT[i] ?? 0.45);
      // Item pronto no banco, ou já montado em outro campeão e que será passado para este: só ocupa a vaga.
      if (covered.has(`${p.championId}:${r.id}`) || take(r.id)) {
        if (slots > 0) slots--;
        return;
      }
      if (r.components?.length !== 2) return;
      const need = [];
      let usedHeld = false;
      // Alternativa (lista por ganho): mede o que falta numa cópia do banco e das peças soltas, sem gastar o que as outras
      // alternativas também podem usar.
      const loose = byGain ? [...held] : held,
        stock = byGain ? [...bank] : bank;
      for (const part of r.components) {
        // Uma peça solta que a unidade já leva fecha o item (uma só por item); as demais saem do banco.
        if (!usedHeld && takeOne(loose, part.id) !== null) usedHeld = true;
        else if (takeOne(stock, part.id) === null) need.push(part);
      }
      // Completar um componente já equipado não gasta vaga; começar um item novo gasta (na lista de alternativas, só
      // exige vaga livre).
      if (!usedHeld) {
        if (slots <= 0) return;
        if (!byGain) slots--;
      }
      if (need.length) {
        wants.push({ p, r, need, w, usedHeld });
        direct.push({ p, r, w });
      }
    });
  }
  const picks = new Map();
  for (const want of wants) {
    const completes = want.need.length === 1,
      points = want.w * (completes ? COMPLETES : STARTS);
    for (const part of want.need.filter(
      (x, i, l) => l.findIndex((y) => y.id === x.id) === i,
    )) {
      const entry = picks.get(part.id) ?? {
        id: part.id,
        name: part.name,
        owned: inventory.filter((id) => id === part.id).length,
        uses: [],
      };
      entry.uses.push({
        champion: want.p.name,
        championId: want.p.championId,
        item: want.r.name,
        itemId: want.r.id,
        completesNow: completes,
        points,
        reason: completes
          ? `Fecha ${want.r.name} em ${want.p.name}: a outra metade já está ${want.usedHeld ? "equipada" : "no banco"}.`
          : `Começa ${want.r.name} para ${want.p.name}.`,
      });
      picks.set(part.id, entry);
    }
  }
  const components = [...picks.values()]
    .map((e) => {
      e.uses.sort((a, b) => b.points - a.points);
      const best = e.uses[0].points,
        rest = e.uses.slice(1).reduce((s, u) => s + u.points, 0);
      return { ...e, score: Math.round((best + EXTRA_USE * rest) * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score);
  return { components, direct };
}

/**
 * Componentes a pegar, do que mais vale ao que menos vale, até `limit`: [{id, name, score, owned, rank, uses:[{champion,
 * championId, item, itemId, completesNow, reason}]}]. Mesmos parâmetros de `scorePlans`; é a lista de prioridade
 * "se aparecer", sem leitura do que o carrossel oferece.
 */
export function carouselPicks(
  plans,
  {
    carry = null,
    inventory = [],
    covered = new Set(),
    holders = [],
    limit = 3,
  } = {},
) {
  return scorePlans(plans, { carry, inventory, covered, holders })
    .components.slice(0, limit)
    .map((e, i) => ({
      ...e,
      rank: i + 1,
      uses: e.uses.slice(0, 3).map(({ points, ...u }) => u),
    }));
}

/**
 * Peças do carrossel (`slots`: [{slot, id, text, item, itemText}] do GEP, o campeão e o item que ele traz) em ordem de valor
 * para o plano. Valor do item: componente = o da lista de prioridade (fecha/começa item de quem importa); item completo da
 * build de alguém = pronto, sem gastar dois componentes; emblema = vale se o plano usa a sinergia; o resto vale 0. A isso soma
 * um bônus pequeno se o campeão da peça é uma peça do plano. Devolve [{rank, slot, championId, championName,
 * itemId, itemName, kind, score, reason, completesNow, forChampion, forChampionId, target}] sem cortar a lista (`kind`: component | item | emblem |
 * tool | unknown). Opções: as de `carouselPicks` mais `traits` ([{name, count}] do plano), `emblemTrait(itemId)` (sinergia
 * do emblema ou null) e `nameOf(id)` (nome para mostrar; sem ele o nome é null e a interface usa o do catálogo).
 */
export function rankCarouselOffer(
  plans,
  slots,
  {
    carry = null,
    inventory = [],
    covered = new Set(),
    traits = [],
    emblemTrait = () => null,
    nameOf = () => null,
    holders = [],
  } = {},
) {
  const { components, direct, gainWith } = scorePlans(plans, {
    carry,
    inventory,
    covered,
    holders,
  });
  const byComponent = new Map(components.map((c) => [c.id, c])),
    planTraits = new Map((traits ?? []).map((t) => [t.name, t])),
    units = new Map(plans.map((p) => [p.championId, p]));
  const rows = (slots ?? []).map((s, order) => {
    const itemId = s.item ?? null,
      champ = s.id ? units.get(s.id) : null,
      bonus = champ ? UNIT_BONUS : 0;
    let kind = "unknown",
      points = 0,
      reason = "",
      completesNow = false,
      forChampion = null,
      forChampionId = null,
      target = null;
    if (itemId && isComponent(itemId) && !isEmblemTool(itemId)) {
      kind = "component";
      const hit = byComponent.get(itemId);
      if (hit) {
        points = hit.score;
        reason = hit.uses[0].reason;
        completesNow = hit.uses[0].completesNow;
        forChampion = hit.uses[0].champion;
        forChampionId = hit.uses[0].championId ?? null;
        target = { id: hit.uses[0].itemId, name: hit.uses[0].item };
      } else reason = "Nenhuma build do plano usa este componente.";
    } else if (itemId && isEmblemTool(itemId)) {
      kind = "tool";
      points = EMBLEM_TOOL;
      reason =
        "Forma um emblema (você escolhe a sinergia); nenhuma build do plano pede.";
    } else if (itemId && isEmblemItem(itemId)) {
      kind = "emblem";
      const trait = emblemTrait(itemId),
        used = trait ? planTraits.get(trait) : null;
      if (used) {
        points = EMBLEM_IN_PLAN;
        reason = `Emblema de ${trait}: o plano usa a sinergia (${used.count ?? "?"} peça${used.count === 1 ? "" : "s"}).`;
      } else
        reason = trait
          ? `Emblema de ${trait}: o plano não usa essa sinergia.`
          : "Emblema de uma sinergia que o plano não usa.";
    } else if (itemId && gainWith) {
      // Item pronto oferecido: o quanto ele soma à melhor distribuição dos seus itens (a regra do "Próximo item").
      kind = "item";
      const m = gainWith(itemId);
      if (m.gain > 1e-9 && m.use) {
        points = GAIN_WEIGHT * DIRECT * m.gain;
        forChampion = m.use.champion;
        forChampionId = m.use.championId;
        completesNow = true;
        reason = `Item pronto para ${m.use.champion} (+${m.gain.toFixed(2).replace(".", ",")} no total): poupa dois componentes.`;
      } else
        reason = "Item completo que não melhora a distribuição dos seus itens.";
    } else if (itemId) {
      kind = "item";
      const base = baseItemId(itemId),
        hit = direct.find((d) => baseItemId(d.r.id) === base);
      if (hit) {
        points = hit.w * DIRECT;
        forChampion = hit.p.name;
        forChampionId = hit.p.championId ?? null;
        completesNow = true;
        reason = `Item pronto da build de ${hit.p.name}: poupa dois componentes.`;
      } else reason = "Item completo que nenhuma build do plano pede.";
    } else reason = "Peça sem item lido.";
    const unitNote = champ ? ` ${champ.name} é peça do plano.` : "";
    return {
      slot: s.slot ?? order + 1,
      championId: s.id ?? null,
      // Nome só quando se sabe (o plano ou `nameOf`); o id do GEP não é nome: a interface resolve pelo catálogo.
      championName: champ?.name ?? nameOf(s.id) ?? null,
      itemId,
      itemName: nameOf(itemId) ?? null,
      kind,
      score: Math.round((points + bonus) * 100) / 100,
      reason: `${reason}${unitNote}`.trim(),
      completesNow,
      forChampion,
      forChampionId,
      target,
      order,
    };
  });
  return rows
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ order, ...row }, i) => ({ rank: i + 1, ...row }));
}

/**
 * Bigornas do banco como um carrossel de montagem: a bigorna abre uma escolha entre opções sorteadas, então a recomendação é
 * a ordem de preferência, com a mesma régua do carrossel (o quanto cada opção soma à melhor distribuição dos seus itens,
 * core/items/item-priority.mjs). Componente: os componentes (fecha antes de começa). Item completo: os itens de receita
 * comum da comp. Artefato: os artefatos que a comp usa. `plans` com `options` (tactics.mjs); `inventory`: ids do banco
 * (as bigornas ficam fora da conta); `covered`: "campeão:item" que chegam por "Passar itens".
 * Devolve `[{ id, kind, count, picks: [{ rank, id, name, gain, completesNow, champion, championId, target, reason }] }]`.
 */
export function anvilPicks(
  plans,
  { inventory = [], covered = new Set(), holders = [], limit = 5 } = {},
) {
  const anvils = new Map();
  for (const id of inventory) {
    const kind = anvilKind(id);
    if (!kind) continue;
    const a = anvils.get(kind) ?? { id, kind, count: 0 };
    a.count++;
    anvils.set(kind, a);
  }
  if (!anvils.size || !plans.some((p) => (p.options ?? []).length)) return [];
  const bank = inventory.filter((id) => !anvilKind(id)),
    scored = scoreByMarginal(plans, bank, covered, holders),
    gainWith = scored.gainWith,
    pct = (g) => g.toFixed(2).replace(".", ",");
  // Itens da comp que cabem numa bigorna de item ou de artefato, cada um no campeão em que soma mais.
  const itemsFor = (fits) => {
    const best = new Map();
    for (const p of plans)
      for (const o of p.options ?? [])
        if (fits(o) && !best.has(o.id)) best.set(o.id, o);
    return [...best.values()]
      .map((o) => ({ o, m: gainWith(o.id) }))
      .filter(({ m }) => m.gain > 1e-9 && m.use)
      .sort((a, b) => b.m.gain - a.m.gain)
      .map(({ o, m }) => {
        const to = m.placed ?? m.use;
        return {
          id: o.id,
          name: o.name,
          gain: m.gain,
          completesNow: true,
          champion: to.champion,
          championId: to.championId,
          target: null,
          reason: `${o.name} em ${to.champion}: a melhor distribuição dos seus itens soma +${pct(m.gain)}.`,
        };
      });
  };
  const out = [];
  for (const a of anvils.values()) {
    // Bigorna de componente: primeiro o que fecha os itens do "Próximo item" (na ordem dele), depois o resto pela régua.
    const nearFirst = [];
    if (a.kind === "component")
      for (const c of gainWith.near ?? []) {
        const id = c.missing?.[0];
        if (!id || nearFirst.some((x) => x.id === id)) continue;
        const name =
          (c.item.components ?? []).find((x) => x.id === id)?.name ?? id;
        nearFirst.push({
          id,
          name,
          gain: c.gain,
          completesNow: true,
          champion: c.champion,
          championId: c.championId,
          target: { id: c.item.id, name: c.item.name },
          reason: `Fecha ${c.item.name} em ${c.champion}, o próximo item (+${pct(c.gain)}).`,
        });
      }
    const list =
      a.kind === "component"
        ? [
            ...nearFirst,
            ...scored.components
              .filter((c) => !nearFirst.some((x) => x.id === c.id))
              .map((c) => ({
                id: c.id,
                name: c.name,
                gain:
                  c.uses[0].points /
                  (GAIN_WEIGHT * (c.uses[0].completesNow ? COMPLETES : STARTS)),
                completesNow: c.uses[0].completesNow,
                champion: c.uses[0].champion,
                championId: c.uses[0].championId,
                target: { id: c.uses[0].itemId, name: c.uses[0].item },
                reason: c.uses[0].reason,
              })),
          ]
        : itemsFor(
            a.kind === "artifact"
              ? (o) => isArtifact(o.id)
              : (o) =>
                  (o.components ?? []).length === 2 &&
                  !isEmblemItem(o.id) &&
                  !isArtifact(o.id),
          );
    if (list.length)
      out.push({
        ...a,
        picks: list.slice(0, limit).map((x, i) => ({ rank: i + 1, ...x })),
      });
  }
  return out;
}
