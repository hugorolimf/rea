// Carrossel: qual componente pegar, a partir das builds recomendadas de cada campeão da comp.
//
// Ordem de valor: (1) componente que FECHA um item agora (a outra metade já está no banco ou equipada),
// (2) componente que começa o próximo item de quem mais importa. Quem importa: carry > tanque principal >
// demais; dentro de cada campeão, o 1º item da build vale mais que o 2º e o 3º.
// Cada componente do banco é usado uma vez só, na ordem de prioridade, antes de medir o que falta.
//
// Duas saídas com a mesma conta:
//  - `carouselPicks`: SEM leitura do carrossel, os componentes mais úteis para pegar "se aparecer" (lista de prioridade);
//  - `rankCarouselOffer`: COM a leitura do que o carrossel oferece (GEP `carousel_pieces`: um campeão com um item em cada
//    peça), as peças ofertadas em ordem de valor para o plano.

import {
  baseItemId,
  isComponent,
  isEmblemItem,
  isEmblemTool,
} from "./core/catalog/items.mjs";
import { pendingItems } from "./core/items/builds.mjs";
import { takeOne } from "./core/items/stock.mjs";

const UNIT_WEIGHT = { carry: 3, tank: 1.6, other: 1 };
const ITEM_WEIGHT = [1, 0.75, 0.55]; // 1º, 2º e 3º item da build
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
  UNIT_BONUS = { carry: 3, plan: 1 };

/**
 * Pontuação de cada componente que o plano ainda pede. `plans`: builds por campeão ({championId, name, role,
 * equipped:[{id}], slotsFree, ideal:[{id, name, components:[{id,name}]}]}), na ordem de prioridade; `inventory`: ids do
 * banco; `covered`: "campeão:item" que chegam passando um item já montado de outro campeão. Devolve `{ components,
 * direct }`: `components` = [{id, name, score, owned, uses:[{champion, championId, item, itemId, completesNow, points,
 * reason}]}] em ordem de valor; `direct` = receitas ainda pedidas `{p, r, w}` (para valorar o item pronto no carrossel).
 */
function scorePlans(
  plans,
  { carry = null, inventory = [], covered = new Set() } = {},
) {
  const bank = [...inventory],
    wants = [],
    direct = [];
  // Cada cópia do banco serve a um uso só (core/items/stock.mjs).
  const take = (id) => takeOne(bank, id) !== null;
  for (const p of plans) {
    const unit =
        p.name === carry
          ? UNIT_WEIGHT.carry
          : p.role === "tank"
            ? UNIT_WEIGHT.tank
            : UNIT_WEIGHT.other,
      // Radiante equipado conta como o item base da build.
      equipped = (p.equipped ?? []).map((e) => baseItemId(e.id)),
      held = equipped.filter(isComponent);
    let slots = p.slotsFree ?? 0;
    // A build vem do motor único (core/items/builds.mjs): a de Comps quando a comp a publica. Cada cópia equipada cobre
    // uma linha (Voto ×3 com um equipado ainda pede dois); emblema que a peça não pode usar (regra de traços) fica fora.
    const recipes = pendingItems(p.ideal ?? [], equipped).filter(
      (r) => !r.blocked,
    );
    recipes.forEach((r, i) => {
      const w = unit * (ITEM_WEIGHT[i] ?? 0.45);
      // Item pronto no banco, ou já montado em outro campeão e que será passado para este: só ocupa a vaga.
      if (covered.has(`${p.championId}:${r.id}`) || take(r.id)) {
        if (slots > 0) slots--;
        return;
      }
      if (r.components?.length !== 2) return;
      const need = [];
      let usedHeld = false;
      for (const part of r.components) {
        // Uma peça solta que a unidade já leva fecha o item (uma só por item); as demais saem do banco.
        if (!usedHeld && takeOne(held, part.id) !== null) usedHeld = true;
        else if (!take(part.id)) need.push(part);
      }
      // Completar um componente já equipado não gasta vaga; começar um item novo gasta.
      if (!usedHeld) {
        if (slots <= 0) return;
        slots--;
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
  { carry = null, inventory = [], covered = new Set(), limit = 3 } = {},
) {
  return scorePlans(plans, { carry, inventory, covered })
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
 * um bônus pequeno se o campeão da peça é o carry (ou uma peça do plano). Devolve [{rank, slot, championId, championName,
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
  } = {},
) {
  const { components, direct } = scorePlans(plans, {
    carry,
    inventory,
    covered,
  });
  const byComponent = new Map(components.map((c) => [c.id, c])),
    planTraits = new Map((traits ?? []).map((t) => [t.name, t])),
    units = new Map(plans.map((p) => [p.championId, p]));
  const rows = (slots ?? []).map((s, order) => {
    const itemId = s.item ?? null,
      champ = s.id ? units.get(s.id) : null,
      bonus = !champ
        ? 0
        : champ.name === carry
          ? UNIT_BONUS.carry
          : UNIT_BONUS.plan;
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
    const unitNote = champ
      ? ` ${champ.name} ${champ.name === carry ? "é o carry do plano" : "é peça do plano"}.`
      : "";
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
