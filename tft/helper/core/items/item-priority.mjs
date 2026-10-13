/**
 * Prioridade dos itens (regra do usuário): com os itens que você TEM, o que montar e para quem. Vale só para os campeões
 * da comp do plano (o titular de cada vaga, nunca o temporário: o item pode ir no temporário e sair quando o titular
 * chegar, mas é do titular). Qualquer item bom do campeão NA COMP entra, não só os 3 da build publicada: a lista e o ganho
 * vêm de `compItemOptions` (builds.mjs; MetaTFT `comp_builds`). A ordem é o ganho do item no campeão: quem tem mais
 * vantagem com o item recebe primeiro; cada componente e item do banco é gasto uma vez e cada campeão tem 3 vagas.
 *
 * Uma regra, todos os cenários: "Próximo item" (montar agora / falta 1), item pronto do banco, "Passar itens" e carrossel
 * leem o mesmo ganho. Puro; carrega igual no servidor e no navegador.
 */
import {
  baseItemId,
  isComponent,
  isThiefsGloves,
  isConsumable,
} from "../catalog/items.mjs";
import { compItemOptions } from "./builds.mjs";
import { fillRecipe, spend, takeOne } from "./stock.mjs";

/** Vagas de item por campeão. */
export const ITEM_SLOTS = 3;
/**
 * Teto da busca da melhor distribuição: nós visitados e opções prontas consideradas (as de maior ganho). A regra roda
 * dezenas de vezes por leitura (próximo item, carrossel, bigornas, cada plano e no processo principal): o teto mantém cada
 * rodada em poucos milissegundos; acima dele fica a melhor encontrada (nunca pior que a gulosa).
 */
const MAX_NODES = 2_000,
  MAX_OPTIONS = 24;

/**
 * Itens bons de cada campeão da comp, já com a receita: `[{ id, name, gain, n, inBuild, components: [{ id, name }] }]`,
 * maior ganho primeiro. Sem dado da comp (`itemPicks` nem build publicada), `fallback(id)` dá os ids (a build de reserva),
 * com ganho decrescente simbólico. `recipeOf(id)` → ids dos componentes; `nameOf(id)`; `blocked(unitId, itemId)`: o
 * campeão não pode usar o item (emblema da sinergia que já tem).
 */
export function itemOptionsOf(
  comp,
  championId,
  {
    recipeOf = () => [],
    nameOf = (id) => id,
    blocked = () => false,
    fallback = () => [],
  } = {},
) {
  const listed = compItemOptions(comp, championId),
    base = listed.length
      ? listed
      : [...new Set((fallback(championId) ?? []).map(baseItemId))].map(
          (id, i) => ({ id, gain: 0.05 / (i + 1), n: null, inBuild: false }),
        );
  return base
    .filter(
      (o) =>
        !isComponent(o.id) && !isConsumable(o.id) && !blocked(championId, o.id),
    )
    .map((o) => ({
      ...o,
      name: nameOf(o.id),
      components: (recipeOf(o.id) ?? []).map((c) => ({
        id: c,
        name: nameOf(c),
      })),
    }));
}

/**
 * O que fazer com os seus itens, em ordem de prioridade.
 * - `members`: campeões da comp `[{ id, name, stars, inField, equipped: ids, slotsFree }]` (sem os temporários);
 * - `optionsOf(id)`: `itemOptionsOf` do campeão; `bank`: ids do banco; `covered`: Set
 *   "campeão:item" que já chegam por "Passar itens" (não montar de novo).
 * Devolve `{ ready, near, remaining }`:
 * - `ready`: a distribuição de maior ganho total do que dá para fazer agora: item completo do banco (`required = [id]`)
 *   ou montar com componentes (do banco; numa receita, um componente solto que o campeão já leva: `usesHeld`). As
 *   bigornas são uma escolha entre opções sorteadas, como o carrossel: `anvilPicks` em carousel.mjs;
 * - `near`: a um componente de fechar (`missing` com 1 id), do maior ganho ao menor, sem repetir o mesmo item.
 * Cada linha: `{ championId, champion, stars, inField, inGoal: true, item: { id, name, gain, components, usesHeld },
 * gain, required, missing, ready }`.
 */
export function itemPriority({
  members = [],
  optionsOf = () => [],
  bank = [],
  covered = new Set(),
  holders = [],
} = {}) {
  const base = (m, o) => ({
    championId: m.id,
    champion: m.name,
    stars: m.stars ?? 0,
    inField: !!m.inField,
    inGoal: true,
    gain: o.gain,
  });
  const candidates = [];
  for (const m of members) {
    const equipped = (m.equipped ?? []).map(baseItemId),
      held = equipped.filter(isComponent);
    for (const o of optionsOf(m.id) ?? []) {
      if (equipped.includes(o.id) || covered.has(`${m.id}:${o.id}`)) continue;
      const parts = (o.components ?? []).map((c) => c.id);
      const whole = bank.some((b) => baseItemId(b) === o.id);
      const fill = whole
        ? { missing: [], usesHeld: null }
        : parts.length === 2
          ? fillRecipe(parts, { stock: bank, held })
          : { missing: parts.length ? parts : [o.id], usesHeld: null };
      const required = whole
        ? [bank.find((b) => baseItemId(b) === o.id)]
        : parts.filter(
            (p, i) => !(fill.usesHeld === p && parts.indexOf(p) === i),
          );
      const item = {
        id: o.id,
        name: o.name,
        gain: o.gain,
        components: o.components ?? [],
        usesHeld: fill.usesHeld,
      };
      candidates.push({
        ...base(m, o),
        item,
        required,
        missing: fill.missing,
        ready: required.length > 0 && !fill.missing.length,
      });
    }
  }
  // Componente numa peça FORA da comp (o temporário, por exemplo): fecha a receita de um campeão da comp montada nela; o
  // item fica com ela e passa para o titular quando ela é vendida ou trocada (ao vender, o item volta ao banco). O ganho e
  // a vaga são os do titular.
  for (const h of holders) {
    const held = (h.equipped ?? []).map(baseItemId).filter(isComponent);
    if (!held.length) continue;
    for (const m of members) {
      const equipped = (m.equipped ?? []).map(baseItemId);
      for (const o of optionsOf(m.id) ?? []) {
        if (equipped.includes(o.id) || covered.has(`${m.id}:${o.id}`)) continue;
        const parts = (o.components ?? []).map((c) => c.id);
        if (parts.length !== 2) continue;
        for (const part of new Set(held)) {
          const at = parts.indexOf(part);
          if (at < 0) continue;
          const other = parts[1 - at],
            missing = bank.includes(other) ? [] : [other];
          candidates.push({
            ...base(m, o),
            item: {
              id: o.id,
              name: o.name,
              gain: o.gain,
              components: o.components ?? [],
              usesHeld: part,
            },
            holder: { id: h.id, name: h.name ?? h.id },
            required: [other],
            missing,
            ready: !missing.length,
          });
        }
      }
    }
  }
  // Quem tem mais vantagem com o item primeiro; empate: a peça em campo (joga agora).
  candidates.sort(
    (a, b) => b.gain - a.gain || Number(b.inField) - Number(a.inField),
  );
  // Vagas de cada campeão. Luva de Ladrão: quem já a leva não recebe mais nada; recomendada, ela ocupa as 3 vagas (só
  // entra em quem está com as 3 livres, e depois dela ele não recebe outro item).
  const slots = new Map(
      members.map((m) => [
        m.id,
        (m.equipped ?? []).some(isThiefsGloves)
          ? 0
          : Number.isFinite(m.slotsFree)
            ? m.slotsFree
            : ITEM_SLOTS,
      ]),
    ),
    need = (c) => (isThiefsGloves(c.item.id) ? ITEM_SLOTS : 1),
    taken = new Set(),
    remaining = [...bank],
    ready = [];
  // Componente solto que cada campeão já leva (fecha uma receita sem ocupar vaga), gasto uma vez.
  const heldOf = new Map(
    [...members, ...holders].map((m) => [
      m.id,
      (m.equipped ?? []).map(baseItemId).filter(isComponent),
    ]),
  );
  // Quem carrega o componente usado: o portador fora da comp, ou o próprio campeão.
  const holderOf = (c) => c.holder?.id ?? c.championId;
  const keyOf = (c) => `${c.championId}:${c.item.id}`,
    // Ocupa vaga: item novo, e a Luva de Ladrão sempre (mesmo fechada com a metade que o campeão já leva).
    usesSlot = (c) =>
      !c.item.usesHeld || !!c.holder || isThiefsGloves(c.item.id);
  const fits = (c) =>
    !taken.has(keyOf(c)) &&
    (!c.item.usesHeld || heldOf.get(holderOf(c))?.includes(c.item.usesHeld)) &&
    (!usesSlot(c) || slots.get(c.championId) >= need(c)) &&
    !spend(remaining, c.required).missing.length;
  // Aplica uma escolha e devolve como desfazê-la.
  const apply = (c) => {
    const before = [...remaining],
      held = heldOf.get(holderOf(c)),
      heldBefore = [...(held ?? [])];
    remaining.splice(0, remaining.length, ...spend(remaining, c.required).left);
    if (c.item.usesHeld) takeOne(held, c.item.usesHeld);
    if (usesSlot(c)) slots.set(c.championId, slots.get(c.championId) - need(c));
    taken.add(keyOf(c));
    return () => {
      remaining.splice(0, remaining.length, ...before);
      if (held) held.splice(0, held.length, ...heldBefore);
      if (usesSlot(c))
        slots.set(c.championId, slots.get(c.championId) + need(c));
      taken.delete(keyOf(c));
    };
  };
  // Distribuição de maior ganho total (não só o maior primeiro): busca exata sobre as opções prontas, partindo da gulosa
  // (o maior ganho primeiro) e cortando o ramo que nem somando tudo o que resta passa a melhor. O banco é pequeno; acima
  // de MAX_NODES fica a melhor encontrada (nunca pior que a gulosa).
  const options = candidates.filter((c) => c.ready).slice(0, MAX_OPTIONS),
    suffix = new Array(options.length + 1).fill(0);
  for (let i = options.length - 1; i >= 0; i--)
    suffix[i] = suffix[i + 1] + Math.max(0, options[i].gain);
  let best = { total: -Infinity, pick: [] },
    nodes = 0;
  const picked = [];
  (function search(i, total) {
    if (total > best.total + 1e-9) best = { total, pick: [...picked] };
    if (i >= options.length || ++nodes > MAX_NODES) return;
    if (total + suffix[i] <= best.total + 1e-9) return;
    const c = options[i];
    if (fits(c)) {
      const undo = apply(c);
      picked.push(c);
      search(i + 1, total + c.gain);
      picked.pop();
      undo();
    }
    search(i + 1, total);
  })(0, 0);
  for (const c of best.pick) apply(c);
  ready.push(...best.pick);
  ready.sort((a, b) => b.gain - a.gain);
  // A um componente: o mesmo item aparece uma vez (no campeão que mais ganha com ele) e só para quem ainda tem vaga.
  const seen = new Set(),
    near = [];
  for (const c of candidates) {
    if (c.ready || c.missing.length !== 1 || c.required.length < 1) continue;
    if (taken.has(`${c.championId}:${c.item.id}`)) continue;
    if (seen.has(c.item.id) || !(slots.get(c.championId) >= need(c))) continue;
    // A metade que você tem precisa estar sobrando depois do que já vai ser montado.
    const have = [...c.required];
    for (const m of c.missing) takeOne(have, m);
    if (spend(remaining, have).missing.length) continue;
    seen.add(c.item.id);
    near.push(c);
  }
  return { ready, near, remaining };
}
