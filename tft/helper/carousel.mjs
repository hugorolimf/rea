// Carrossel: qual componente pegar, a partir das builds recomendadas de cada campeão da comp.
//
// Ordem de valor: (1) componente que FECHA um item agora (a outra metade já está no banco ou equipada),
// (2) componente que começa o próximo item de quem mais importa. Quem importa: carry > tanque principal >
// demais; dentro de cada campeão, o 1º item da build vale mais que o 2º e o 3º.
// Cada componente do banco é usado uma vez só, na ordem de prioridade, antes de medir o que falta.

import { baseItemId, isComponent } from "./core/catalog/items.mjs";
import { takeOne } from "./core/items/stock.mjs";

const UNIT_WEIGHT = { carry: 3, tank: 1.6, other: 1 };
const ITEM_WEIGHT = [1, 0.75, 0.55]; // 1º, 2º e 3º item da build
const COMPLETES = 10,
  STARTS = 3,
  // Um componente que serve a várias receitas soma um pouco de cada uso extra, sem deixar um campeão
  // com muitas receitas parecidas dominar a escolha.
  EXTRA_USE = 0.25;

/**
 * `plans`: builds por campeão ({championId, name, role, equipped:[{id}], slotsFree, ideal:[{id, name,
 * components:[{id,name}]}]}), na ordem de prioridade; `inventory`: ids do banco (componentes e completos).
 * Devolve até `limit` componentes [{id, name, score, owned, rank, uses:[{champion, championId, item,
 * itemId, completesNow, reason}]}].
 * `covered`: "campeão:item" que vão chegar passando um item já montado de outro campeão (não pedir de novo).
 */
export function carouselPicks(
  plans,
  { carry = null, inventory = [], covered = new Set(), limit = 3 } = {},
) {
  const bank = [...inventory],
    wants = [];
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
    const recipes = (p.ideal ?? []).filter((r) => !equipped.includes(r.id));
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
      if (need.length) wants.push({ p, r, need, w, usedHeld });
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
  return [...picks.values()]
    .map((e) => {
      e.uses.sort((a, b) => b.points - a.points);
      const best = e.uses[0].points,
        rest = e.uses.slice(1).reduce((s, u) => s + u.points, 0);
      return { ...e, score: Math.round((best + EXTRA_USE * rest) * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e, i) => ({
      ...e,
      rank: i + 1,
      uses: e.uses.slice(0, 3).map(({ points, ...u }) => u),
    }));
}
