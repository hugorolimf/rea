/**
 * Qual build cada campeão usa: o motor único de itens (ver `../../planos/feitos/itens-motor-unico.md`).
 *
 * Regra: dentro de uma comp, a build de um campeão é a PUBLICADA na comp (`comp.builds[id]`, com `comp.buildStats[id]`:
 * variação de colocação e partidas), exatamente como a aba Comps a mostra em "Builds e 3★": os mesmos itens, as mesmas
 * cópias repetidas, os emblemas e a mesma ordem. Ninguém reordena, completa nem troca itens dessa lista.
 * Só sem build publicada (campeão fora da comp, comp sem build para ele, tabuleiro sem comp) entra a RESERVA, uma só e
 * declarada: a build geral da MetaTFT (`meta-builds.mjs`) e os pares campeão × item medidos (`meta-stats.mjs`), ajustados
 * pelo lobby e pelo que dá para montar; sem nenhum dado, a heurística por papel. Toda build diz de onde veio (`origin`).
 *
 * Puro (sem `node:*`, relógio ou aleatório) e só importa de `core/`: o servidor (plano, loja, carrossel, motor) e o
 * navegador (Comps, Formação, Ao vivo, overlay) chamam as mesmas funções. A situação de cada item (equipado, mover de X,
 * pronto no banco, monta agora, falta) é de `holdings.mjs`; o rótulo curto, de `champion-items.mjs`.
 */
import {
  addCoverage,
  baseItemId,
  coverageOf,
  isComponent,
  isEmblemItem,
  isManaItem,
  isThiefsGloves,
  recipeOf,
} from "../catalog/items.mjs";
import { fillRecipe, takeOne } from "./stock.mjs";

/** De onde veio a build: a publicada na comp, a reserva (build geral/medição) ou a heurística por papel. */
export const ORIGIN = Object.freeze({
  comp: "comp",
  reserve: "reserva",
  heuristic: "heuristica",
});

/** Rótulo da build sem nenhum dado de meta (a heurística por papel). */
export const HEURISTIC_LABEL = "heurística local (sem dado de meta)";

const finite = (v) => (Number.isFinite(v) ? v : null);

/**
 * Build publicada da comp para o campeão (a de "Builds e 3★"): `{ championId, items, delta, n, origin: "comp" }` ou
 * `null` se a comp não publica build para ele. `comp`: `{ builds, buildStats }` (de `/api/comps`, do motor ou da comp
 * fixada). `items` vem como publicado: com cópias repetidas, emblemas e na ordem da fonte.
 */
export function compBuild(comp, championId) {
  const items = comp?.builds?.[championId];
  if (!Array.isArray(items) || !items.length) return null;
  const st = comp?.buildStats?.[championId];
  return {
    championId,
    items: [...items],
    delta: finite(st?.delta),
    n: finite(st?.n),
    origin: ORIGIN.comp,
  };
}

/**
 * Builds publicadas das peças da comp na ordem da aba Comps: só as peças que estão na comp, o carry primeiro, as demais
 * na ordem publicada. `[{ championId, items, delta, n, origin }]`.
 */
export function compBuildRows(comp) {
  const units = new Set(comp?.units ?? []);
  return Object.keys(comp?.builds ?? {})
    .filter((id) => units.has(id))
    .sort((a, b) => (b === comp.carry) - (a === comp.carry))
    .map((id) => compBuild(comp, id))
    .filter(Boolean);
}

/**
 * Encolhimento da variação publicada (política deste helper, não medida): a fonte publica só a melhor build de cada
 * campeão, então a variação vem inflada; com K = 1500 a build do Rengar (2127 partidas, −0,24) fica em −0,14 e uma
 * build de 22 partidas quase não conta.
 */
export const BUILD_SHRINK_K = 1500;

/** Variação encolhida pelo número de partidas (`{ delta, n }` de `buildStats`): builds raras pesam pouco. */
export const shrunkDelta = (b) =>
  Number.isFinite(b?.delta) && b.n > 0
    ? (b.delta * b.n) / (b.n + BUILD_SHRINK_K)
    : 0;

/**
 * Ordem em que as builds da comp candidata disputam os itens do jogador (motor/score): o carry primeiro; depois as
 * peças de maior `priorityOf(id)` (o motor dá 0,5 às de dano e 0 aos tanques) e, entre elas, a build de maior ganho
 * encolhido. Só peças com build publicada.
 */
export function compSpendOrder(comp, carryId, priorityOf = () => 0) {
  const rest = Object.keys(compBuildMap(comp))
    .filter((u) => u !== carryId)
    .sort(
      (a, b) =>
        priorityOf(b) - priorityOf(a) ||
        shrunkDelta(comp.buildStats?.[a]) - shrunkDelta(comp.buildStats?.[b]),
    );
  return [carryId, ...rest];
}

/**
 * Campeões que a comp lista em `builds` (quem "leva itens" na comp), na ordem publicada. Não escolhe itens: a rolagem
 * (núcleo do time) e a pergunta de evidência do motor só precisam saber QUEM tem build.
 */
export const buildHolders = (comp) => Object.keys(comp?.builds ?? {});

/** Builds publicadas da comp como mapa `{ campeão: ids }` (o que a posse de itens comp a comp recebe). */
export function compBuildMap(comp) {
  return Object.fromEntries(
    Object.keys(comp?.builds ?? {})
      .map((id) => compBuild(comp, id))
      .filter(Boolean)
      .map((b) => [b.championId, b.items]),
  );
}

/** Reserva declarada: a build geral do campeão (`meta-builds.mjs`; Map ou objeto campeão → ids). */
export const reserveItems = (championId, metaBuilds) => [
  ...((metaBuilds instanceof Map
    ? metaBuilds.get(championId)
    : metaBuilds?.[championId]) ?? []),
];

/**
 * Itens que a peça pede, na ordem de prioridade: a build publicada da comp; sem ela, a reserva. É a lista que "Passar
 * itens", o item pronto do banco (loja), a dica de emblema e o plano de itens consultam (posição = `indexOf`).
 */
export function wantedItems(
  championId,
  { comp = null, metaBuilds = null } = {},
) {
  return (
    compBuild(comp, championId)?.items ?? reserveItems(championId, metaBuilds)
  );
}

/**
 * Entradas de `list` (ids ou `{ id }`) que os itens equipados ainda não cobrem, contando cópias: com `Voto ×3` na build e
 * um Voto equipado, sobram dois. Radiante vale o item base. Não muta.
 */
export function pendingItems(list = [], equipped = []) {
  const left = (equipped ?? []).map((e) => baseItemId(e?.id ?? e));
  return (list ?? []).filter(
    (x) => takeOne(left, baseItemId(x?.id ?? x)) === null,
  );
}

/**
 * Pontos da reserva (sem build publicada na comp): a lista da build geral mais os itens medidos no campeão, ajustados pelo
 * lobby; sem dado nenhum, a tabela por papel. Política do helper (não medida), a mesma de antes da centralização.
 */
function reserveScores(c, ctx, add) {
  const r = ctx.role(c),
    desc = c.ability?.desc ?? "",
    melee = (c.stats?.range ?? 1) <= 2,
    onhit = /attacks|per attack|soldier|attack speed/i.test(desc),
    aoe = /enemies|adjacent|splash|area/i.test(desc),
    highMana = (c.stats?.mana ?? 0) >= 70,
    lobby = ctx.lobby ?? {},
    { armor = 0, resists = 0, heals = 0, crit = 0, strong = false } = lobby,
    physicalShare = lobby.physicalShare ?? 0.5;
  const measuredIds = Object.keys(ctx.stats?.unitItem ?? {})
    .filter((k) => k.startsWith(c.apiName + "|"))
    .map((k) => k.slice(c.apiName.length + 1))
    .filter((id) => ctx.measured(c, id));
  const meta = [
    ...new Set([...reserveItems(c.apiName, ctx.metaBuilds), ...measuredIds]),
  ];
  if (meta.length) {
    // Ordem da meta manda; o lobby observado só desempata itens que já estão na lista.
    let rank = 0;
    for (const id of meta) {
      // A Luva de Ladrão entra na disputa: se for o melhor item do campeão, vira a build inteira (ver `championBuild`).
      if (isEmblemItem(id) || !ctx.buildable(id)) continue;
      rank++;
      let bonus = 0,
        why = "";
      if (coverageOf(id).includes("shredArmor") && armor) {
        bonus = 10;
        why = " Sobe pela frontline com armadura observada.";
      } else if (coverageOf(id).includes("shredMagic") && resists) {
        bonus = 10;
        why = " Sobe pela resistência mágica observada.";
      } else if (coverageOf(id).includes("wounds") && heals >= 2) {
        bonus = 10;
        why = " Sobe pela cura observada em rivais.";
      } else if (/DragonsClaw/.test(id) && physicalShare < 0.45) {
        bonus = 8;
        why = " Sobe pelo dano mágico do lobby.";
      } else if (/BrambleVest/.test(id) && (physicalShare > 0.55 || crit)) {
        bonus = 8;
        why = " Sobe pelo dano físico/crítico do lobby.";
      } else if (/GiantSlayer/.test(id) && strong) {
        bonus = 6;
        why = " Sobe pelos alvos resistentes de alto custo.";
      }
      const m = ctx.measured(c, id);
      // Medido: quanto o item melhora (ou piora) a colocação deste campeão; 0,1 de colocação vale 4 pontos.
      // Sem medição suficiente, vale a posição na lista publicada.
      add(
        id,
        m ? 110 - m.delta * 40 + bonus : 126 - rank * 6 + bonus,
        m
          ? `Em ${c.name}, ${ctx.effect(m)}.${why}`
          : `${rank}º item de ${c.name} na meta (${ctx.metaLabel}).${why}`,
      );
    }
    return true;
  }
  if (r === "tank") {
    add("DA_WarmogsArmor", 82, "Vida para sustentar a frontline.");
    add(
      "DA_GargoyleStoneplate",
      84,
      "Resistências ao receber foco de múltiplas unidades.",
    );
    add("DA_SteadfastHeart", 80, "Durabilidade para segurar a luta.");
    add(
      "DA_DragonsClaw",
      physicalShare < 0.45 ? 105 : 70,
      "Resistência mágica; sobe de prioridade contra dano mágico observado.",
    );
    add(
      "DA_BrambleVest",
      physicalShare > 0.55 || crit ? 103 : 65,
      "Armadura e proteção contra ataques; priorizado pelo perfil físico/crítico rival.",
    );
    add(
      "DA_SunfireCape",
      heals ? 110 : 68,
      "Feridas para enfrentar cura e regeneração; precisa alcançar os alvos.",
    );
    add(
      "DA_SpiritVisage",
      /heal|shield|restore/i.test(desc) ? 95 : 66,
      "Sustain e amplificação de proteção para esta habilidade.",
    );
  } else if (r === "ad") {
    add(
      "DA_InfinityEdge",
      95,
      "Crítico para amplificar o dano físico da habilidade.",
    );
    add("DA_Deathblade", 83, "Dano de ataque para escalar a habilidade.");
    add(
      "DA_LastWhisper",
      armor ? 108 : 78,
      "Reduz armadura; ganha prioridade contra a frontline resistente observada.",
    );
    add(
      "DA_GuinsoosRageblade",
      onhit ? 98 : 80,
      "Velocidade de ataque para ataques frequentes e lutas prolongadas.",
    );
    add(
      "DA_GiantSlayer",
      strong ? 95 : 75,
      "Ajuda a derrubar alvos resistentes de alto investimento.",
    );
    add(
      "DA_Bloodthirster",
      melee ? 106 : 63,
      "Sustain para um carry que precisa lutar perto dos inimigos.",
    );
    add(
      "DA_TitansResolve",
      melee ? 101 : 45,
      "Escala em combate prolongado para lutadores na linha de frente.",
    );
    add(
      "DA_SpearOfShojin",
      highMana ? 92 : 58,
      "Mana para conjurar uma habilidade de custo alto com mais frequência.",
    );
    add(
      "DA_Quicksilver",
      melee ? 86 : 69,
      "Opção de proteção contra controle; conferir o controle do próximo oponente.",
    );
  } else {
    add(
      "DA_RabadonsDeathcap",
      92,
      "AP para elevar o dano mágico da habilidade.",
    );
    add(
      "DA_JeweledGauntlet",
      94,
      "Crítico de habilidade para um carry mágico.",
    );
    add("DA_ArchangelsStaff", 86, "AP crescente para combates longos.");
    add(
      "DA_SpearOfShojin",
      highMana ? 105 : 78,
      "Mana para acelerar conjurações.",
    );
    add(
      "DA_BlueBuff",
      highMana ? 76 : 98,
      "Mana para habilidades de custo menor; escolha um único acelerador de mana.",
    );
    add(
      "DA_VoidStaff",
      resists ? 112 : 78,
      "Redução de resistência mágica contra os itens defensivos observados.",
    );
    add("DA_HextechGunblade", 87, "Sustain para o carry e apoio à frontline.");
    add(
      "DA_Morellonomicon",
      heals && aoe ? 116 : aoe ? 76 : 45,
      "Feridas aplicadas pela habilidade; favorece dano em área contra cura rival.",
    );
    add(
      "DA_NashorsTooth",
      onhit ? 105 : 72,
      "Ataques acelerados após conjurar; combina com este padrão de habilidade.",
    );
    add(
      "DA_GuinsoosRageblade",
      onhit ? 108 : 52,
      "Prioriza ataques repetidos; útil para habilidades de soldados/on-hit.",
    );
  }
  return false;
}

/**
 * Contexto da escolha de build, montado uma vez por análise (o plano em `tactics.mjs`):
 * - `items`: Map id → item do catálogo (`composition`, `name`); `role(c)`: papel do campeão (`core/catalog/champions.mjs`);
 * - `stats`: meta-stats (`unit`, `unitItem`); `metaBuilds`: build geral; `metaLabel`: rótulo da fonte;
 * - `inventory`: ids do banco; `lobby`: `{ armor, resists, heals, crit, physicalShare, strong }` (ameaça observada);
 * - `emblemTrait(id)`: sinergia que o emblema dá (`traitBook(...).emblems`), para a regra de traços.
 */
export function buildContext({
  items = new Map(),
  role = () => "ap",
  stats = null,
  metaBuilds = null,
  metaLabel = "",
  inventory = [],
  lobby = {},
  emblemTrait = () => null,
} = {}) {
  const item = (id) => {
    const i = items.get(id);
    return {
      id,
      name: i?.name ?? id,
      components: (i?.composition ?? []).map((part) => ({
        id: part,
        name: items.get(part)?.name ?? part,
      })),
    };
  };
  // Efeito medido de cada item num campeão (MetaTFT): colocação média com o item contra a dele em geral.
  const measured = (c, id) => {
    const avg = stats?.unit?.[c.apiName]?.[0] ?? null,
      m = stats?.unitItem?.[`${c.apiName}|${id}`];
    return m && avg != null && m[1] >= 300
      ? { delta: m[0] - avg, games: m[1] }
      : null;
  };
  const effect = (m) =>
    `${m.delta <= 0 ? "melhora" : "piora"} a colocação em ${Math.abs(m.delta).toFixed(2).replace(".", ",")} (medido em ${m.games.toLocaleString("pt-BR")} partidas)`;
  // Só item montável (receita de 2 componentes) ou já no banco: artefato vem da bigorna e componente não é item final.
  const buildable = (id) =>
    recipeOf(items.get(id)) !== null || (inventory ?? []).includes(id);
  return {
    items,
    item,
    role,
    stats,
    metaBuilds,
    metaLabel,
    inventory: inventory ?? [],
    lobby,
    emblemTrait,
    measured,
    effect,
    buildable,
  };
}

/**
 * Build de um campeão para o plano: a publicada na comp (se houver) ou a reserva, com a situação de montagem de cada
 * item e o que cabe nos slots livres agora.
 * - `c`: campeão do catálogo; `equipped`: ids equipados nele; `coverage`: Set de efeitos de cobertura da equipe (muta:
 *   soma os desta peça); `comp`: `{ builds, buildStats }` da comp (null = sem comp); `ctx`: `buildContext(...)`.
 * Devolve `{ championId, name, role, origin, reserve, source, delta, n, equipped, slotsFree, ideal, additions, note }`:
 * - `ideal`: até 3 itens na ordem (com build da comp, EXATAMENTE a de Comps, cópias e emblemas incluídos), cada um
 *   `{ id, name, components, score, reason, usesHeld, missing, craftable, inventoryNote, blocked? }`;
 * - `additions`: o que pôr nos slots livres agora, na mesma ordem (com build da comp) ou por pontos (reserva).
 */
export function championBuild(
  c,
  { equipped = [], coverage = new Set(), comp = null, ctx },
) {
  const published = compBuild(comp, c.apiName),
    role = ctx.role(c),
    scores = [];
  const add = (id, score, reason) => {
    if (ctx.items.has(id)) scores.push({ ...ctx.item(id), score, reason });
  };
  let fromData = false;
  if (published)
    published.items.forEach((id, i) => {
      const m = ctx.measured(c, id);
      add(
        id,
        126 - (i + 1) * 6,
        `${i + 1}º item de ${c.name} na build da comp (${ctx.metaLabel}).` +
          (m ? ` Em ${c.name}, ${ctx.effect(m)}.` : ""),
      );
    });
  else fromData = reserveScores(c, ctx, add);
  // Emblema só serve a quem ainda não tem a sinergia (regra de traços): fica na build publicada, marcado, e não se monta.
  for (const s of scores) {
    const trait = isEmblemItem(s.id) ? ctx.emblemTrait(s.id) : null;
    if (trait && (c.traits ?? []).includes(trait)) {
      s.blocked = true;
      s.reason += ` ${c.name} já tem ${trait}: o emblema não se equipa nele.`;
    }
  }
  if (!published)
    for (const s of scores) {
      const utility = coverageOf(s.id)[0] ?? null;
      if (
        utility &&
        coverage.has(utility) &&
        !equipped.some((i) => baseItemId(i) === s.id)
      ) {
        s.score -= 45;
        s.reason +=
          " A equipe já tem ou planeja esse efeito; evite duplicar sem necessidade de cobertura.";
      }
    }
  // Componente solto já equipado neste campeão vale como metade da receita: completar não gasta slot novo.
  const heldParts = equipped.filter(isComponent),
    stock = ctx.inventory;
  for (const s of scores) {
    const required = stock.includes(s.id)
      ? [s.id]
      : s.components.map((p) => p.id);
    // Banco (cada cópia uma vez) e, numa receita de 2, uma peça solta que a própria peça já leva (stock.mjs).
    const { missing, usesHeld } = fillRecipe(required, {
      stock,
      held: heldParts,
    });
    s.usesHeld = usesHeld;
    if (s.usesHeld) s.score += 30;
    s.missing = missing.map(ctx.item);
    s.craftable = required.length > 0 && missing.length === 0;
    s.inventoryNote =
      s.craftable && s.usesHeld
        ? "Completa o " +
          (ctx.items.get(s.usesHeld)?.name ?? "componente") +
          " que já está neste campeão com o do seu banco"
        : s.usesHeld && missing.length === 1
          ? "Usa o " +
            (ctx.items.get(s.usesHeld)?.name ?? "componente") +
            " já equipado; falta o outro componente"
          : s.craftable
            ? "Disponível com os itens/componentes livres informados"
            : missing.length === 1 && required.length > 1
              ? "Falta um componente para montar"
              : "Receita ainda incompleta";
    const meta = published || fromData;
    s.score += s.craftable
      ? meta
        ? 20
        : 45
      : (required.length - missing.length) * (meta ? 6 : 12);
  }
  // Com build da comp, a ordem é a publicada (Comps); na reserva, a dos pontos (um acelerador de mana só).
  const ranked = published
    ? scores
    : [...scores].sort((a, b) => b.score - a.score);
  // Luva de Ladrão na reserva: ocupa os 3 espaços, então só é a build quando é o melhor item do campeão — aí sozinha;
  // senão fica de fora. A lista de desejos (item-plan.mjs `reserveGloves`) segue a mesma regra.
  const glovesBuild =
    !published &&
    ranked.length > 0 &&
    isThiefsGloves(ranked[0].id) &&
    !ranked[0].blocked;
  const ideal = glovesBuild ? [ranked[0]] : [];
  for (const s of glovesBuild ? [] : ranked) {
    if (ideal.length === 3) break;
    if (!published && isThiefsGloves(s.id)) continue;
    if (!published && ideal.some((i) => isManaItem(i.id) && isManaItem(s.id)))
      continue;
    ideal.push(s);
  }
  const locked = equipped.some(isThiefsGloves),
    slotsFree = locked ? 0 : Math.max(0, 3 - equipped.length);
  const additions = [],
    heldLeft = [...heldParts];
  let freeUsed = 0;
  // O que já está equipado (cada cópia uma vez) não entra de novo; com build da comp, só itens dela e na ordem dela.
  for (const s of pendingItems(
    published || glovesBuild ? ideal : ranked,
    equipped,
  )) {
    if (freeUsed >= slotsFree && !heldLeft.length) break;
    // Item que não se monta (sem receita e fora do banco) e emblema bloqueado ficam só na build. A Luva de Ladrão só
    // se monta quando é a build reserva do campeão e ele está sem itens (ela ocupa os 3 espaços).
    if (
      s.blocked ||
      (isThiefsGloves(s.id) && !(glovesBuild && equipped.length === 0)) ||
      !ctx.buildable(s.id)
    )
      continue;
    // Completar a peça solta que a unidade já leva não gasta slot; começar um item novo gasta.
    const completesHeld =
      !!s.usesHeld && takeOne(heldLeft, s.usesHeld) !== null;
    if (!completesHeld) {
      if (s.usesHeld || freeUsed >= slotsFree || locked) continue;
      freeUsed++;
    }
    if (
      !published &&
      isManaItem(s.id) &&
      [...equipped, ...additions.map((i) => i.id)].some(isManaItem)
    )
      continue;
    additions.push(s);
  }
  addCoverage(coverage, [...equipped, ...additions.map((i) => i.id)]);
  const origin = published
    ? ORIGIN.comp
    : fromData
      ? ORIGIN.reserve
      : ORIGIN.heuristic;
  return {
    championId: c.apiName,
    name: c.name,
    role,
    origin,
    reserve: !published,
    source: origin === ORIGIN.heuristic ? HEURISTIC_LABEL : ctx.metaLabel,
    delta: published?.delta ?? null,
    n: published?.n ?? null,
    equipped: equipped.map(ctx.item),
    slotsFree,
    ideal,
    additions,
    note: locked
      ? "Luvas do Ladrão ocupam a build; não adicionar itens comuns."
      : slotsFree === 0
        ? "Três slots ocupados. Preserve os itens; a build ideal é referência para futuras cópias ou uso de removedor."
        : "Busque os itens sugeridos para os slots livres. Componentes disponíveis não foram lidos; as receitas são objetivos de build.",
  };
}
