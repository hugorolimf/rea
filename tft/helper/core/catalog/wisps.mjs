/**
 * Wisps (fogos-fátuos) do Set 18 "Enchanted Wilds": identificação, classificação e a regra de compra.
 *
 * O GEP (e a leitura de tela) entrega o Wisp como uma entrada comum da loja (`shop_pieces`, ex.: `slot_5: { name:
 * "DA_AbandonShip18" }`): não é campeão e nunca entra na pool nem nos alvos de rolagem. Aqui a entrada é resolvida por um
 * catálogo (`wisps.json`, gerado por `build-wisps.mjs` a partir do CommunityDragon) e recebe tipo, categoria, condição e a
 * recomendação de compra. ESM puro: carrega igual no servidor e no navegador (nada de `node:*`, relógio ou aleatório).
 *
 * O que é FATO (catálogo) e o que é INFERÊNCIA: o CommunityDragon traz só `apiName`, nome, descrição e ícone. Categoria,
 * condição e "exige posição" são deduzidos da descrição (`classifyWisp`) e valem como pista, não como dado do jogo; preço
 * e "some abaixo de 20 de vida" vêm das notas de patch citadas em `pesquisa/05-set18-meta-e-mecanicas.md` (`WISP_FACTS`).
 * O que não se sabe fica `null` e a recomendação o trata como incerto.
 */
import { interestOf } from "../economy/gold.mjs";
import { pressureOf } from "../economy/pressure.mjs";
import { parseStage } from "../state/clock.mjs";

/** Tipo principal (um só por Wisp, nesta precedência): custo 0 > condicional > combate > comum. */
export const WISP_TYPES = Object.freeze([
  "comum",
  "condicional",
  "combate",
  "custo0",
]);

/** Categorias (as 7 do jogo, nomes em português). `null` = a descrição não permitiu decidir. */
export const WISP_CATEGORIES = Object.freeze([
  "campeao",
  "combate",
  "loja",
  "ouro-xp",
  "item",
  "arriscada",
  "outra",
]);

/** Tipos de condição de ativação deduzidos da descrição. */
export const WISP_CONDITIONS = Object.freeze([
  "traco",
  "posicao",
  "combate",
  "estado",
]);

/** Veredictos da recomendação. */
export const WISP_VERDICTS = Object.freeze([
  "comprar",
  "avaliar",
  "pular",
  "incerto",
]);

/**
 * Fatos publicados pela Riot (patch 18.1 a 18.4) e usados pela regra. Cada um com a fonte; nada aqui vem do catálogo.
 * `zeroCost`: nomes (em inglês) dos Wisps de custo 0 que só aparecem entre `from` e `to` com menos de `goldBelow` de ouro.
 * `prices`: preço em ouro por nome, só onde a pesquisa traz um único valor (os ambíguos, como "Smurfing 6/5g", ficam de
 * fora: o tooltip do jogo manda). `vanish`: Wisps que deixam de aparecer com menos de `hp` de vida.
 */
export const WISP_FACTS = Object.freeze({
  source:
    "pesquisa/05-set18-meta-e-mecanicas.md secao 3.1 (notas oficiais 18.4)",
  zeroCost: Object.freeze({
    names: Object.freeze([
      "Drizzle",
      "Grove Armor",
      "Returning Friend",
      "Room for a Shroom",
    ]),
    from: Object.freeze({ stage: 4, round: 1 }),
    to: Object.freeze({ stage: 5, round: 7 }),
    goldBelow: 10,
  }),
  prices: Object.freeze({
    "Backrow Star": 1,
    Barrier: 3,
    Cutpurse: 2,
    Payday: 3,
    "All Fives": 8,
    "Three Me": 10,
    "Forest Guide": 6,
    "Improved Reach": 1,
    "Circle of Elders": 45,
    "Hero Of Prophecy": 35,
    Grandmaster: 18,
    "Nature's Wrath": 15,
  }),
  ambiguousPrices: Object.freeze({
    Smurfing: "6/5g",
    "Search Party": "1g/0g",
  }),
  vanish: Object.freeze({
    hp: 20,
    pattern: /KnickKnack|Thingamajig|Doodad|GoldenGoose|Gambit|Barter/,
  }),
  /** Depois do estágio 5 todo segundo Wisp é de Combate. */
  combatFromStage: 5,
  /** Gold/XP baratos (1 a 5 g) nos estágios 2-3 "quase sempre valem" (NoxuTFT, opinião). */
  cheapGold: Object.freeze({ maxGold: 5, stages: Object.freeze([2, 3]) }),
});

/* ---------- Texto ---------- */

/** Chave de comparação de nomes: sem acento, minúscula, só letras e números. */
const nameKey = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Descrição do catálogo sem marcas de formatação: `@Valor@` vira X, tags e quebras somem. */
export const cleanWispText = (text) =>
  String(text ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/@[^@]*@%?/g, "X")
    .replace(/\s+/g, " ")
    .trim();

/* ---------- Classificação pela descrição ---------- */

const CLASSES =
  "marksmen|marksman|casters?|fighters?|tanks?|assassins?|archers?|precision|lunar|solar|inferno|rivals?|coven";

/** Condições de ativação, na ordem em que valem. Cada uma casa um trecho da descrição limpa. */
const CONDITIONS = [
  {
    kind: "posicao",
    re: /\b(per adjacent ally|no adjacent allies|alone in their row|per front-row unit|front center champion)\b/i,
  },
  { kind: "traco", re: new RegExp("\\b(" + CLASSES + ")\\b", "i") },
  {
    kind: "combate",
    re: /\b(for each ally champion|survives combat|whenever an ally dies|first ally to die|first allied champion to die|first champion to die|first X champions to die|champion deaths|ally deaths|explode on death|on death)\b/i,
  },
  {
    kind: "estado",
    re: /\b(without an item|missing player health|leftmost benched|champions without items|your one-star champions|1-star champions|inactive traits|lowest star)\b/i,
  },
];

/** Categoria pela descrição limpa (primeira regra que casa). */
const CATEGORIES = [
  [
    "arriscada",
    /sell your board|lose X components|sacrificed|kill everyone|flip a coin|six-sided|opponent gains|items removed|heads/i,
  ],
  ["outra", /random wisps?/i],
  [
    "campeao",
    /joins your team|^gain (?:a |an |one of each |\d |two |three |X )?(?:random |temporary )?(?:\d-star |X-star )?(?:\d-cost |X-cost )?(?:copies of )?(?:a )?(?:\d-cost )?champion|^gain a (?:leona|rengar)|gain a copy of the first|permanently transforms|^clone |worth of random champions|^gain \d random|^gain one of each|^gain a (?:random )?(?:\d-star )?\d[ -]cost/i,
  ],
  [
    "loja",
    /reroll your shop|shop rerolls|free reroll|gain X rerolls|gain a reroll|\d?\s*rerolls this round|fill your shop|each of your shops|shop slots|overrun the shop|shop rerolls for free/i,
  ],
  [
    "ouro-xp",
    /gain X (?:gold|xp)|drop X gold|gold equal|X gold for every|gold for every|sells for X gold/i,
  ],
  [
    "item",
    /component|consumable|anvil|reforger|emblem|potion|remover|radiant|thief's gloves|warmog|bramble|giant's belt|recommended item|temporary item|item store|items cost|equippable|artifact|stacking items|tank item|duplicator/i,
  ],
  [
    "combate",
    /combat|seconds|shield|attack speed|damage|health|armor|magic resist|stun|mana|primal buff|baron buff|slow|execute|untargetable|heal|range|critical|dodge|shred|sunder|burn|wound|attack|kill/i,
  ],
];

/**
 * Classifica um Wisp pela descrição do catálogo. Devolve só deduções, nunca preço:
 * `{ categoria, condicional, condicaoTipo, condicao, exigePosicao, naoClassificado }`. `categoria` é null (e
 * `naoClassificado` true) quando nenhuma regra casou; `condicao` é o trecho da descrição que justifica.
 */
export function classifyWisp(raw) {
  const text = cleanWispText(raw?.desc),
    // "random tank item" é o item, não a classe Tank.
    forTraits = text.replace(/tank items?/gi, "");
  let categoria = null;
  for (const [name, re] of CATEGORIES)
    if (re.test(text)) {
      categoria = name;
      break;
    }
  let condicaoTipo = null,
    condicao = null;
  for (const c of CONDITIONS) {
    const m = c.re.exec(c.kind === "traco" ? forTraits : text);
    if (m) {
      condicaoTipo = c.kind;
      condicao = m[0];
      break;
    }
  }
  return {
    categoria,
    condicional: condicaoTipo !== null,
    condicaoTipo,
    condicao,
    exigePosicao: condicaoTipo === "posicao",
    naoClassificado: categoria === null,
  };
}

/** Tipo principal de um Wisp já classificado (precedência de `WISP_TYPES`). */
export const wispType = ({ custoZero, condicional, categoria }) =>
  custoZero
    ? "custo0"
    : condicional
      ? "condicional"
      : categoria === "combate"
        ? "combate"
        : "comum";

/** Fatos de pesquisa para um nome (inglês) e apiName: custo 0, preço único e se some com pouca vida. */
export function wispFacts(name, apiName) {
  const key = nameKey(name),
    pick = (table) =>
      Object.entries(table).find(([n]) => nameKey(n) === key)?.[1] ?? null;
  const zero = WISP_FACTS.zeroCost.names.some((n) => nameKey(n) === key),
    gold = pick(WISP_FACTS.prices),
    note = pick(WISP_FACTS.ambiguousPrices);
  const z = WISP_FACTS.zeroCost;
  return {
    custoZero: zero,
    custo: zero
      ? {
          ouro: 0,
          janela: `${z.from.stage}-${z.from.round} a ${z.to.stage}-${z.to.round}, com menos de ${z.goldBelow} de ouro`,
          fonte: WISP_FACTS.source,
        }
      : gold !== null
        ? { ouro: gold, janela: null, fonte: WISP_FACTS.source }
        : null,
    custoNota: note,
    somePorVida: WISP_FACTS.vanish.pattern.test(apiName ?? "")
      ? WISP_FACTS.vanish.hp
      : null,
  };
}

/* ---------- Catálogo e identificação ---------- */

/**
 * Índice do catálogo (`wisps.json#wisps`): por apiName e por nome (inglês e português). `entries` aceita lista ou Map.
 * Nunca muta o que recebe.
 */
export function createWispBook(entries) {
  const list = [
      ...(entries instanceof Map ? entries.values() : (entries ?? [])),
    ],
    byId = new Map(),
    byName = new Map();
  for (const w of list) {
    byId.set(w.id, w);
    for (const n of [w.name, w.nameEn, w.namePt]) {
      const k = nameKey(n);
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(w);
    }
  }
  // Entre a versão base e a melhorada (Blossom, `_Upgrade`) com o mesmo nome, a base vem primeiro.
  for (const group of byName.values())
    group.sort(
      (a, b) =>
        Number(!!a.melhorado) - Number(!!b.melhorado) ||
        a.id.length - b.id.length,
    );
  return { list, byId, byName, size: list.length };
}

/**
 * Resolve uma entrada da loja para o Wisp do catálogo, ou null. `entry` é o texto cru (apiName do GEP ou nome lido da
 * tela) ou o cartão `{ text, id, name, apiName }` que o leitor monta. apiName exato vence; um cartão que já virou
 * campeão (`id` não nulo e fora do catálogo de Wisps) nunca é Wisp; por último vale o nome (a base antes da melhorada).
 */
export function resolveWisp(entry, book) {
  if (!entry || !book?.byId) return null;
  const card = typeof entry === "string" ? { text: entry } : entry,
    texts = [card.apiName, card.wispId, card.id, card.text, card.name].filter(
      (v) => typeof v === "string" && v.trim(),
    );
  for (const t of texts) {
    const hit = book.byId.get(t.trim());
    if (hit) return hit;
  }
  if (typeof card.id === "string" && card.id) return null;
  for (const t of [card.text, card.name]) {
    const group = book.byName.get(nameKey(t));
    if (group?.length) return group[0];
  }
  return null;
}

/** O leitor (GEP) já marcou a carta como Wisp (`wisp: true`), mesmo que o catálogo não o conheça? */
const flagged = (entry) => typeof entry === "object" && entry?.wisp === true;

/**
 * A entrada da loja é um Wisp? Vale o catálogo (`resolveWisp`) ou a marca do leitor (`wisp: true`): um Wisp novo, que
 * o catálogo ainda não tem, continua fora dos campeões.
 */
export const isWisp = (entry, book) =>
  resolveWisp(entry, book) !== null || flagged(entry);

/** Wisp que o leitor reconheceu e o catálogo não tem: só identidade, sem tipo nem preço (a regra o trata como incerto). */
const unknownWisp = (card) => {
  const id = card?.wispId ?? card?.id ?? card?.text ?? card?.name ?? null;
  return {
    id,
    name: card?.wispName ?? card?.name ?? card?.text ?? id,
    desconhecido: true,
    tipo: null,
    categoria: null,
    condicional: false,
    custo: null,
  };
};

/**
 * Separa a loja lida em Wisps e o resto: `[{ slot (1..), wisp, card }]` só dos Wisps; vazios e campeões ficam fora.
 * Wisp marcado pelo leitor mas ausente do catálogo vem como `wisp.desconhecido`.
 */
export function wispsInShop(shop, book) {
  const out = [];
  (shop ?? []).forEach((card, i) => {
    const wisp =
      resolveWisp(card, book) ?? (flagged(card) ? unknownWisp(card) : null);
    if (wisp) out.push({ slot: i + 1, wisp, card });
  });
  return out;
}

/**
 * Os Wisps de uma leitura de estado (`screen`): usa `screen.wisps` quando o leitor GEP já os expõe (lista de ids/textos
 * ou de `{ slot, id, name, known }`) e, sem ele, identifica pelo catálogo na loja lida (`screen.shop`). Mesma forma de
 * `wispsInShop`. Do leitor, tudo o que ele lista é Wisp (os desconhecidos viram `wisp.desconhecido`); do texto cru sem
 * marca, só o que o catálogo reconhece.
 */
export function wispsOfScreen(screen, book) {
  if (Array.isArray(screen?.wisps)) {
    const out = [];
    screen.wisps.forEach((w, i) => {
      const card = typeof w === "string" ? { text: w } : w;
      if (!card) return;
      const wisp =
        resolveWisp(card, book) ??
        (typeof w === "string" ? null : unknownWisp(card));
      if (wisp)
        out.push({
          slot: Number.isInteger(card.slot) ? card.slot : i + 1,
          wisp,
          card,
        });
    });
    return out;
  }
  return wispsInShop(screen?.shop, book);
}

/** Troca por `null` os Wisps de uma loja, para que o motor nunca os leia como campeões. */
export const withoutWisps = (shop, book) =>
  (shop ?? []).map((card) => (isWisp(card, book) ? null : card));

/* ---------- Regra de compra ---------- */

const stageOf = (stage) =>
  typeof stage === "string"
    ? parseStage(stage)
    : Number.isInteger(stage?.stage) && Number.isInteger(stage?.round)
      ? stage
      : null;

const atOrAfter = (at, ref) =>
  at.stage > ref.stage || (at.stage === ref.stage && at.round >= ref.round);

/** A rodada está na janela dos Wisps de custo 0 (de `from` a `to`, inclusive)? null sem estágio. */
export function inZeroCostWindow(stage) {
  const at = stageOf(stage);
  if (!at) return null;
  const z = WISP_FACTS.zeroCost;
  return (
    atOrAfter(at, z.from) && !atOrAfter(at, { ...z.to, round: z.to.round + 1 })
  );
}

const label = (w) => w?.namePt ?? w?.name ?? w?.nameEn ?? w?.id ?? "Wisp";

/**
 * Recomendação de compra de UM Wisp. Não compra "no automático": cada veredito traz o motivo e, em `incertezas`, o que
 * não se sabia. Entradas do contexto (todas opcionais; ausente = desconhecido, nunca um padrão):
 * - `hp`, `pressure` (faixa "healthy"|"hurt"|"danger"|"critical" de `pressureOf`; sem ela, deduzida de `hp`);
 * - `stage` ("4-1" ou `{ stage, round }`), `gold`;
 * - `rolldown`: true/false se há rolldown comprometido agora (null = não sei);
 * - `boardFit`: true/false se o tabuleiro já atende a condição do Wisp (null = não verificado).
 * Devolve `{ veredito, motivo, regra, incertezas }` com `veredito` em `WISP_VERDICTS`, ou null sem Wisp.
 */
export function decideWisp(wisp, ctx = {}) {
  if (!wisp) return null;
  const incertezas = [],
    at = stageOf(ctx.stage),
    gold = Number.isFinite(ctx.gold) ? ctx.gold : null,
    hp = Number.isFinite(ctx.hp) ? ctx.hp : null,
    band =
      ctx.pressure ?? (hp !== null ? pressureOf({ hp, stage: at }).band : null),
    risk = band === null ? null : band === "danger" || band === "critical",
    verdict = (veredito, motivo, regra) => ({
      veredito,
      motivo,
      regra,
      incertezas,
    });
  const cost = Number.isFinite(wisp.custo?.ouro) ? wisp.custo.ouro : null;

  // Wisp que a Riot tira com pouca vida: aparecer assim é sinal de leitura errada, não de oportunidade.
  if (hp !== null && wisp.somePorVida != null && hp < wisp.somePorVida)
    return verdict(
      "incerto",
      `Este Wisp some com menos de ${wisp.somePorVida} de vida: confira a leitura da loja.`,
      "some-por-vida",
    );
  if (wisp.desconhecido) {
    incertezas.push("Wisp fora do catálogo: sem tipo, condição nem preço");
    return verdict(
      "incerto",
      "Wisp que o catálogo não conhece: leia o tooltip do jogo antes de comprar.",
      "desconhecido",
    );
  }
  if (wisp.consolacao)
    return verdict(
      "incerto",
      "É o prêmio de consolo da loja sem Wisp (ouro); não confirmei que dê para comprar.",
      "consolo",
    );

  // Custo 0: só aparece com pouco ouro entre 4-1 e 5-7, e não tira nada do bolso.
  if (wisp.tipo === "custo0") {
    const inWindow = inZeroCostWindow(at);
    if (inWindow === null)
      incertezas.push("estágio não lido: o custo 0 só vale entre 4-1 e 5-7");
    else if (inWindow === false)
      incertezas.push("fora de 4-1 a 5-7 o preço deste Wisp não é de custo 0");
    if (
      inWindow !== false &&
      (gold === null || gold < WISP_FACTS.zeroCost.goldBelow)
    )
      return verdict(
        "comprar",
        "Custo 0 (só aparece com menos de 10 de ouro entre 4-1 e 5-7): não gasta ouro.",
        "custo0",
      );
  }

  // Rolldown comprometido: o ouro é do alvo; o Wisp só entra com vida crítica e efeito de combate imediato.
  if (ctx.rolldown === true) {
    if (band === "critical" && wisp.categoria === "combate")
      return verdict(
        "avaliar",
        "Vida crítica: Wisp de combate pode valer, mas há rolldown em andamento; pese o ouro.",
        "rolldown-vida",
      );
    return verdict(
      "pular",
      "Meio de rolldown comprometido: Wisp que não é o alvo tira ouro da rolagem.",
      "rolldown",
    );
  }
  if (ctx.rolldown == null)
    incertezas.push("não sei se há rolldown em andamento");

  // Condição de ativação: posição exige entortar o tabuleiro; as outras só pagam se o tabuleiro as atende.
  let unverified = false;
  if (wisp.condicional) {
    const cond = wisp.condicao ?? "condição";
    if (wisp.exigePosicao && ctx.boardFit !== true)
      return verdict(
        "pular",
        `Condição de posição ("${cond}"): obriga a entortar o tabuleiro por um Wisp.`,
        "condicao-posicao",
      );
    if (ctx.boardFit === false)
      return verdict(
        "pular",
        `Condição não atendida pelo seu tabuleiro ("${cond}").`,
        "condicao-falha",
      );
    if (ctx.boardFit == null) {
      unverified = true;
      incertezas.push(`condição não verificada no seu tabuleiro ("${cond}")`);
    }
  }
  const cap = (v, motivo, regra) =>
    verdict(unverified && v === "comprar" ? "avaliar" : v, motivo, regra);

  if (wisp.categoria === "arriscada")
    return verdict(
      "avaliar",
      "Arriscada: só se o plano aguenta o pior resultado.",
      "arriscada",
    );

  // Combate: depois do estágio 5 todo segundo Wisp é de Combate; vale quando a luta decide (vida em risco).
  if (wisp.categoria === "combate") {
    if (at === null || risk === null) {
      if (at === null) incertezas.push("estágio não lido");
      if (risk === null) incertezas.push("vida não lida");
      return verdict(
        "incerto",
        "Wisp de combate: sem estágio e vida lidos não dá para dizer se a luta decide.",
        "combate-incerto",
      );
    }
    if (at.stage >= WISP_FACTS.combatFromStage)
      return risk
        ? cap(
            "comprar",
            "Estágio 5+ com a vida em risco: a luta decide e o efeito é imediato.",
            "combate-vida",
          )
        : verdict(
            "avaliar",
            "Estágio 5+ e vida folgada: só se este combate decide algo.",
            "combate-folgado",
          );
    return risk
      ? verdict(
          "avaliar",
          "Vida em risco: o efeito de combate pode ajudar, mas o ouro ainda rende mais em peças.",
          "combate-cedo-vida",
        )
      : verdict(
          "pular",
          "Wisp de combate sem a vida em risco: guarde o ouro.",
          "combate-cedo",
        );
  }

  // Demais categorias: o preço e os juros decidem.
  if (cost === null) {
    incertezas.push("preço fora do catálogo (o tooltip do jogo manda)");
    return verdict(
      "avaliar",
      "Preço desconhecido: vale se for melhor que (preço ÷ 2) rerolls e não derrubar os juros.",
      "preco-desconhecido",
    );
  }
  const cheapEarly =
    ["ouro-xp", "loja"].includes(wisp.categoria) &&
    cost <= WISP_FACTS.cheapGold.maxGold &&
    at !== null &&
    WISP_FACTS.cheapGold.stages.includes(at.stage);
  if (gold === null) {
    incertezas.push("ouro não lido: os juros não foram avaliados");
    return cheapEarly
      ? cap(
          "comprar",
          `Econômico e barato (${cost}g) nos estágios 2-3.`,
          "barato-cedo",
        )
      : verdict(
          "avaliar",
          `Custa ${cost}g; sem o ouro lido não avalio os juros.`,
          "sem-ouro",
        );
  }
  const keeps = interestOf(gold - cost) === interestOf(gold);
  if (keeps)
    return cap(
      "comprar",
      cost === 0
        ? "Custo 0: não gasta ouro."
        : `Custa ${cost}g e mantém o patamar de juros.`,
      "juros-mantem",
    );
  if (cheapEarly && risk !== true)
    return cap(
      "comprar",
      `Econômico e barato (${cost}g) nos estágios 2-3, mesmo derrubando um patamar de juros.`,
      "barato-cedo",
    );
  return risk
    ? verdict(
        "avaliar",
        `Custa ${cost}g e derruba um patamar de juros; com a vida em risco só se for decisivo.`,
        "juros-derruba-vida",
      )
    : verdict(
        "pular",
        `Custa ${cost}g e derruba um patamar de juros sem ser decisivo.`,
        "juros-derruba",
      );
}

/** Nome para exibição do Wisp (pt-BR quando o catálogo tem; senão o inglês). */
export const wispLabel = label;
