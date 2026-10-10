import { isContested } from "./economy.mjs";
import { carouselPicks } from "./carousel.mjs";
import { baseItemId } from "./item-tiers.mjs";
import { emblemTraitMap, traitsWithEmblems } from "./v2/js/traits.js";
/**
 * Lista de itens desejados de um campeão: a build da comp escolhida primeiro, depois a build geral publicada.
 * Mesma ordem em build(), Passar itens (itemMoves) e item do banco (stage.mjs).
 */
export const wishlist = (id, compBuilds, metaBuilds) => [
  ...new Set([...(compBuilds?.[id] ?? []), ...(metaBuilds?.get(id) ?? [])]),
];
/** "campeão:item" de cada item já montado que a comp passa de um campeão para outro (Passar itens). */
const coveredByMoves = (moves) =>
  new Set(
    moves.flatMap((m) => (m.moves ?? []).map((x) => `${x.to.id}:${x.item.id}`)),
  );
export function tactics(analysis, catalog, options = {}) {
  const byId = new Map(catalog.champions.map((c) => [c.apiName, c]));
  const items = new Map(catalog.items.map((i) => [i.apiName, i]));
  const clean = baseItemId;
  // Cópias repetidas em campo: vale a de mais estrelas (e mais itens), como na reserva.
  const current = new Map();
  for (const u of analysis.self.units) {
    const prev = current.get(u.championName);
    if (
      !prev ||
      u.starLevel > prev.starLevel ||
      (u.starLevel === prev.starLevel &&
        (u.itemNames?.length ?? 0) > (prev.itemNames?.length ?? 0))
    )
      current.set(u.championName, u);
  }
  const reserve = new Map();
  for (const u of analysis.self.reserve ?? []) {
    if (
      !reserve.has(u.championName) ||
      u.starLevel > reserve.get(u.championName).starLevel
    )
      reserve.set(u.championName, u);
  }
  const role = (c) => {
    const known = options.metaRoles?.get(c.apiName);
    if (known) return known;
    const d = (c.ability?.desc ?? "").toLowerCase();
    if (c.stats.range <= 2 && /shield|heal|health|durability/.test(d))
      return "tank";
    return /physical damage/.test(d) && !/magic damage/.test(d) ? "ad" : "ap";
  };
  const chosen = analysis.opponents.find(
    (p) => String(p.id) === options.viewedPlayerId,
  );
  const enemies = chosen ? [chosen] : analysis.opponents;
  const units = enemies.flatMap((p) => p.units);
  let physical = 0,
    magical = 0,
    heals = 0,
    crit = 0,
    armor = 0,
    resists = 0;
  for (const u of units) {
    const c = byId.get(u.id);
    const weight = u.stars * Math.max(1, u.items.length + 1);
    if (u.role === "ad") physical += weight;
    else if (u.role === "ap") magical += weight;
    if (
      u.items.some((i) =>
        /Bloodthirster|HandOfJustice|SpiritVisage|HextechGunblade|Redemption/.test(
          i,
        ),
      ) ||
      /heal|restore.*health/i.test(c?.ability?.desc ?? "")
    )
      heals++;
    if (u.items.some((i) => /InfinityEdge/.test(i))) crit++;
    if (
      (c?.stats.armor ?? 0) >= 50 ||
      u.items.some((i) => /Bramble|Gargoyle|Steadfast/.test(i))
    )
      armor++;
    if (
      u.items.some((i) => /Dragon|SpiritVisage|Gargoyle|AdaptiveHelm/.test(i))
    )
      resists++;
  }
  const threat = {
    name: chosen ? chosen.name : "Lobby inteiro",
    physicalShare: physical + magical ? physical / (physical + magical) : 0.5,
    healingUnits: heals,
    critUnits: crit,
    armoredUnits: armor,
    resistantUnits: resists,
    method:
      "Inferido por habilidade, estrelas e itens observados; não por dano medido.",
  };
  // Emblemas montáveis (espátula/frigideira + componente) concedem a sinergia do nome a quem equipa.
  const traitNames = new Set(catalog.traits.map((t) => t.name));
  // Sinergias de uma peça do plano: as do campeão mais as de emblemas equipados nela (regra única em traits.js).
  const emblemTrait = emblemTraitMap(catalog.items, traitNames);
  const traitsOfUnit = (id, equipped) =>
    traitsWithEmblems(byId.get(id)?.traits ?? [], equipped, emblemTrait).traits;
  const emblemByTrait = new Map(
    catalog.items
      .filter((i) => /Emblem/.test(i.apiName) && i.composition?.length === 2)
      .map((i) => [i.name.replace(/ Emblem$/, ""), i])
      .filter(([name]) => traitNames.has(name)),
  );
  const item = (id) => {
    const i = items.get(id);
    return {
      id,
      name: i?.name ?? id,
      components: (i?.composition ?? []).map((id) => ({
        id,
        name: items.get(id)?.name ?? id,
      })),
    };
  };
  function build(c, equipped, coverage, compBuilds = null) {
    const r = role(c),
      desc = c.ability?.desc ?? "",
      melee = c.stats.range <= 2,
      onhit = /attacks|per attack|soldier|attack speed/i.test(desc),
      aoe = /enemies|adjacent|splash|area/i.test(desc),
      highMana = (c.stats.mana ?? 0) >= 70;
    const scores = [];
    const add = (id, score, reason) => {
      if (items.has(id)) scores.push({ ...item(id), score, reason });
    };
    // Efeito medido de cada item neste campeão (MetaTFT): colocação média com o item contra a dele em geral.
    // É o que diz se um item que o jogo te deu "faz sentido" nele, sem exigir a build ideal.
    const champAvg = options.stats?.unit?.[c.apiName]?.[0] ?? null,
      measured = (id) => {
        const m = options.stats?.unitItem?.[`${c.apiName}|${id}`];
        return m && champAvg != null && m[1] >= 300
          ? { delta: m[0] - champAvg, games: m[1] }
          : null;
      };
    // Com build da comp para este campeão, a lista publicada manda e a medição só desempata (sem itens de fora).
    const compBuild = !!compBuilds?.[c.apiName]?.length;
    const measuredIds = compBuild
      ? []
      : Object.keys(options.stats?.unitItem ?? {})
          .filter((k) => k.startsWith(c.apiName + "|"))
          .map((k) => k.slice(c.apiName.length + 1))
          .filter((id) => measured(id));
    const meta = [
      ...new Set([
        ...wishlist(c.apiName, compBuilds, options.metaBuilds),
        ...measuredIds,
      ]),
    ];
    // Só item montável (receita de 2 componentes) ou já no banco: artefato vem da bigorna e componente não é item final.
    const buildable = (id) =>
      (items.get(id)?.composition?.length ?? 0) === 2 ||
      (options.inventory ?? []).includes(id);
    if (meta?.length) {
      // Ordem da meta manda; o lobby observado só desempata itens que já estão na lista.
      const strong = units.some((u) => u.stars >= 2 && u.cost >= 3);
      let rank = 0;
      for (const id of meta) {
        if (/Emblem|ThiefsGloves/.test(id) || !buildable(id)) continue;
        rank++;
        let bonus = 0,
          why = "";
        if (/LastWhisper/.test(id) && armor) {
          bonus = 10;
          why = " Sobe pela frontline com armadura observada.";
        } else if (/VoidStaff/.test(id) && resists) {
          bonus = 10;
          why = " Sobe pela resistência mágica observada.";
        } else if (
          /SunfireCape|Morellonomicon|RedBuff/.test(id) &&
          heals >= 2
        ) {
          bonus = 10;
          why = " Sobe pela cura observada em rivais.";
        } else if (/DragonsClaw/.test(id) && threat.physicalShare < 0.45) {
          bonus = 8;
          why = " Sobe pelo dano mágico do lobby.";
        } else if (
          /BrambleVest/.test(id) &&
          (threat.physicalShare > 0.55 || crit)
        ) {
          bonus = 8;
          why = " Sobe pelo dano físico/crítico do lobby.";
        } else if (/GiantSlayer/.test(id) && strong) {
          bonus = 6;
          why = " Sobe pelos alvos resistentes de alto custo.";
        }
        const m = measured(id),
          effect = m
            ? `${m.delta <= 0 ? "melhora" : "piora"} a colocação em ${Math.abs(m.delta).toFixed(2).replace(".", ",")} (medido em ${m.games.toLocaleString("pt-BR")} partidas)`
            : "";
        if (compBuild)
          // Build da comp: vale a posição; a medição desempata no máximo ±2,5 (menos que um degrau de 6).
          add(
            id,
            126 -
              rank * 6 +
              Math.max(-2.5, Math.min(2.5, -(m?.delta ?? 0) * 10)) +
              bonus,
            rank +
              "º item de " +
              c.name +
              (compBuilds[c.apiName].includes(id)
                ? " na build da comp ("
                : " na meta (") +
              options.metaLabel +
              ")." +
              (m ? ` Em ${c.name}, ${effect}.` : "") +
              why,
          );
        // Medido: quanto o item melhora (ou piora) a colocação deste campeão; 0,1 de colocação vale 4 pontos.
        // Sem medição suficiente, vale a posição na lista publicada.
        else
          add(
            id,
            m ? 110 - m.delta * 40 + bonus : 126 - rank * 6 + bonus,
            m
              ? `Em ${c.name}, ${effect}.${why}`
              : rank +
                  "º item de " +
                  c.name +
                  " na meta (" +
                  options.metaLabel +
                  ")." +
                  why,
          );
      }
    } else if (r === "tank") {
      add("DA_WarmogsArmor", 82, "Vida para sustentar a frontline.");
      add(
        "DA_GargoyleStoneplate",
        84,
        "Resistências ao receber foco de múltiplas unidades.",
      );
      add("DA_SteadfastHeart", 80, "Durabilidade para segurar a luta.");
      add(
        "DA_DragonsClaw",
        threat.physicalShare < 0.45 ? 105 : 70,
        "Resistência mágica; sobe de prioridade contra dano mágico observado.",
      );
      add(
        "DA_BrambleVest",
        threat.physicalShare > 0.55 || crit ? 103 : 65,
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
        units.some((u) => u.stars >= 2 && u.cost >= 3) ? 95 : 75,
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
      add(
        "DA_HextechGunblade",
        87,
        "Sustain para o carry e apoio à frontline.",
      );
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
    for (const s of scores) {
      const utility =
        s.id === "DA_VoidStaff"
          ? "shredMagic"
          : s.id === "DA_LastWhisper"
            ? "shredArmor"
            : /SunfireCape|Morellonomicon|RedBuff/.test(s.id)
              ? "wounds"
              : null;
      // Item que a comp designa para esta unidade não é duplicata: é dela.
      if (
        utility &&
        !(compBuilds?.[c.apiName] ?? []).includes(s.id) &&
        coverage.has(utility) &&
        !equipped.some((i) => clean(i) === s.id)
      ) {
        s.score -= 45;
        s.reason +=
          " A equipe já tem ou planeja esse efeito; evite duplicar sem necessidade de cobertura.";
      }
    }
    // Componente solto já equipado neste campeão vale como metade da receita: completar não gasta slot novo.
    const heldParts = equipped.filter((i) => i.startsWith("DA_Component_"));
    for (const s of scores) {
      const stock = [...(options.inventory ?? [])],
        required = stock.includes(s.id)
          ? [s.id]
          : s.components.map((c) => c.id),
        missing = [],
        held = [...heldParts];
      s.usesHeld = null;
      for (const id of required) {
        const h = required.length === 2 && !s.usesHeld ? held.indexOf(id) : -1;
        if (h >= 0) {
          held.splice(h, 1);
          s.usesHeld = id;
          continue;
        }
        const at = stock.indexOf(id);
        if (at < 0) missing.push(id);
        else stock.splice(at, 1);
      }
      if (s.usesHeld) s.score += 30;
      s.missing = missing.map(item);
      s.craftable = required.length > 0 && missing.length === 0;
      s.inventoryNote =
        s.craftable && s.usesHeld
          ? "Completa o " +
            (items.get(s.usesHeld)?.name ?? "componente") +
            " que já está neste campeão com o do seu banco"
          : s.usesHeld && missing.length === 1
            ? "Usa o " +
              (items.get(s.usesHeld)?.name ?? "componente") +
              " já equipado; falta o outro componente"
            : s.craftable
              ? "Disponível com os itens/componentes livres informados"
              : missing.length === 1 && required.length > 1
                ? "Falta um componente para montar"
                : "Receita ainda incompleta";
      s.score += s.craftable
        ? meta?.length
          ? 20
          : 45
        : (required.length - missing.length) * (meta?.length ? 6 : 12);
    }
    scores.sort((a, b) => b.score - a.score);
    const chosenItems = [];
    for (const s of scores) {
      if (chosenItems.length === 3) break;
      if (
        chosenItems.some(
          (i) =>
            /BlueBuff|SpearOfShojin/.test(i.id) &&
            /BlueBuff|SpearOfShojin/.test(s.id),
        )
      )
        continue;
      chosenItems.push(s);
    }
    const occupied = equipped.length,
      locked = equipped.some((i) => /ThiefsGloves/.test(i));
    const slotsFree = locked ? 0 : Math.max(0, 3 - occupied);
    const additions = [],
      heldLeft = [...heldParts];
    let freeUsed = 0;
    for (const s of scores) {
      if (freeUsed >= slotsFree && !heldLeft.length) break;
      if (equipped.some((i) => clean(i) === s.id)) continue;
      const h = s.usesHeld ? heldLeft.indexOf(s.usesHeld) : -1;
      if (h >= 0) heldLeft.splice(h, 1);
      else if (s.usesHeld || freeUsed >= slotsFree || locked) continue;
      else freeUsed++;
      if (
        /BlueBuff|SpearOfShojin/.test(s.id) &&
        [...equipped, ...additions.map((i) => i.id)].some((i) =>
          /BlueBuff|SpearOfShojin/.test(i),
        )
      )
        continue;
      additions.push(s);
    }
    for (const i of [...equipped, ...additions.map((i) => i.id)]) {
      if (/VoidStaff/.test(i)) coverage.add("shredMagic");
      if (/LastWhisper/.test(i)) coverage.add("shredArmor");
      if (/SunfireCape|Morellonomicon|RedBuff/.test(i)) coverage.add("wounds");
    }
    return {
      championId: c.apiName,
      name: c.name,
      role: r,
      source: meta?.length
        ? options.metaLabel
        : "heurística local (sem dado de meta)",
      equipped: equipped.map(item),
      slotsFree,
      ideal: chosenItems,
      additions,
      note: locked
        ? "Luvas do Ladrão ocupam a build; não adicionar itens comuns."
        : slotsFree === 0
          ? "Três slots ocupados. Preserve os itens; a build ideal é referência para futuras cópias ou uso de removedor."
          : "Busque os itens sugeridos para os slots livres. Componentes disponíveis não foram lidos; as receitas são objetivos de build.",
    };
  }
  function plan(board, carry, compBuilds = null) {
    const planned = board.map((u) => {
      const c = byId.get(u.id);
      const pool = analysis.pool.find((p) => p.name === u.name),
        reroll =
          u.name === carry &&
          u.cost <= 2 &&
          (pool?.remainingUpper ?? 0) >= Math.max(0, 9 - (pool?.own ?? 0)) &&
          !isContested(pool);
      const targetStars = Math.max(u.owned ? u.stars : 1, reroll ? 3 : 2);
      return {
        ...u,
        currentStars: u.owned ? u.stars : 0,
        targetStars,
        range: c?.stats.range ?? 1,
        role: c ? role(c) : u.role,
      };
    });
    const occupied = new Set(),
      positions = [];
    const columns =
      options.side === "left" ? [1, 0, 2, 3, 4, 5, 6] : [5, 6, 4, 3, 2, 1, 0];
    function place(u, row, cols) {
      let cell;
      for (const r of [
        row,
        ...(row === 3 ? [2, 1, 0] : [0, 1, 2, 3].filter((r) => r !== row)),
      ]) {
        for (const col of cols) {
          if (!occupied.has(r + ":" + col)) {
            cell = { row: r, col };
            break;
          }
        }
        if (cell) break;
      }
      occupied.add(cell.row + ":" + cell.col);
      positions.push({
        ...cell,
        championId: u.id,
        name: u.name,
        stars: u.stars,
        currentStars: u.currentStars,
        targetStars: u.targetStars,
        role: u.role,
        reason:
          u.role === "tank"
            ? "Absorver o primeiro contato e proteger a equipe."
            : u.range >= 3
              ? "Manter alcance e proteção atrás da frontline."
              : "Entrar na luta sem receber sozinho todo o foco.",
      });
    }
    const ranged = planned
      .filter((u) => u.range >= 3)
      .sort((a, b) => (b.name === carry) - (a.name === carry));
    const frontline = planned
      .filter((u) => u.range < 3)
      .sort(
        (a, b) =>
          (b.role === "tank") - (a.role === "tank") ||
          (b.stars ?? 1) - (a.stars ?? 1),
      );
    for (const u of frontline)
      place(u, u.role === "tank" ? 0 : 1, [3, 2, 4, 1, 5, 0, 6]);
    for (const u of ranged) place(u, 3, columns);
    const incoming = planned.filter((u) => !current.has(u.id));
    const outgoing = analysis.self.units.filter(
      (u) => !planned.some((p) => p.id === u.championName),
    );
    const available = [...outgoing];
    const transitions = incoming.map((u) => {
      let i = available.findIndex((o) => {
        const c = byId.get(o.championName);
        return c && role(c) === u.role;
      });
      if (i < 0) i = available.length ? 0 : -1;
      const out = i >= 0 ? available.splice(i, 1)[0] : null;
      return {
        enter: { id: u.id, name: u.name },
        exit: out
          ? { id: out.championName, name: out.name, items: out.itemNames }
          : null,
        source: reserve.has(u.id) ? "reserve" : "shop",
        reason: reserve.has(u.id)
          ? "Já está na reserva informada. Prepare para entrar no campo, respeitando seu nível e os itens da unidade que sai."
          : out
            ? "Troca proposta para chegar à comp; compre e prepare a substituta antes de reservar a atual."
            : "Adicionar quando houver slot livre no seu nível.",
      };
    });
    // Força de uma unidade em campo: custo ponderado pelas estrelas, mais itens. Uma 2★ vale bem mais que a mesma 1★.
    const STAR = [0, 1, 1.8, 3.2],
      power = (cost, stars, items) =>
        cost * STAR[Math.max(0, Math.min(3, stars))] + items * 0.6;
    for (const t of transitions) {
      if (!t.exit) continue;
      const out = analysis.self.units.find((u) => u.championName === t.exit.id),
        outCost = byId.get(t.exit.id)?.cost ?? out?.price ?? 1,
        outStars = out?.starLevel ?? 1,
        outPower = power(outCost, outStars, out?.itemNames?.length ?? 0);
      const enterCost = byId.get(t.enter.id)?.cost ?? 1,
        copies = analysis.pool.find((p) => p.name === t.enter.name)?.own ?? 0,
        haveStars = copies >= 9 ? 3 : copies >= 3 ? 2 : copies >= 1 ? 1 : 0;
      // Os itens de quem sai passam para quem entra, então a comparação é só de corpo: custo e estrelas.
      const body = power(outCost, outStars, 0);
      let required = 1;
      while (required <= 3 && power(enterCost, required, 0) < body * 0.9)
        required++;
      Object.assign(t, {
        exitStars: outStars,
        exitPower: Math.round(outPower * 10) / 10,
        enterCopies: copies,
        enterStars: haveStars,
        requiredStars: required > 3 ? null : required,
        ready: required <= 3 && haveStars >= required,
      });
      if (t.ready)
        t.reason = `Pode trocar: ${t.enter.name} ${haveStars}★ já vale ${t.exit.name} ${outStars}★. Passe os itens na troca.`;
      else if (required > 3)
        t.reason = `Não troque: ${t.enter.name} (custo ${enterCost}) não alcança ${t.exit.name} ${outStars}★ (custo ${outCost}) nem em 3★. Mantenha ${t.exit.name}.`;
      else
        t.reason = `Segure ${t.exit.name} ${outStars}★ em campo. Só troque quando ${t.enter.name} estiver ${required}★ (você tem ${copies} de ${3 ** (required - 1)} cópias).`;
    }
    const counts = {},
      byEmblem = {};
    for (const u of planned) {
      const base = byId.get(u.id)?.traits ?? [];
      for (const t of traitsOfUnit(u.id, u.items)) {
        counts[t] = (counts[t] ?? 0) + 1;
        if (!base.includes(t)) byEmblem[t] = (byEmblem[t] ?? 0) + 1;
      }
    }
    const traits = Object.entries(counts).map(([name, count]) => {
      const t = catalog.traits.find((t) => t.name === name);
      return {
        name,
        count,
        // Peças que contam para a sinergia só por um emblema equipado.
        emblem: byEmblem[name] ?? 0,
        active: (t?.effects ?? []).some((e) => e.minUnits <= count),
        next:
          (t?.effects ?? []).find((e) => e.minUnits > count)?.minUnits ?? null,
      };
    });
    const coverage = new Set();
    for (const u of planned)
      for (const i of u.items ?? []) {
        if (/VoidStaff/.test(i)) coverage.add("shredMagic");
        if (/LastWhisper/.test(i)) coverage.add("shredArmor");
        if (/SunfireCape|Morellonomicon|RedBuff/.test(i))
          coverage.add("wounds");
      }
    // Carry primeiro; depois quem tem build na comp (fica com os efeitos dela), depois tanques.
    const itemOrder = [...planned].sort(
      (a, b) =>
        (b.name === carry) - (a.name === carry) ||
        !!compBuilds?.[b.id]?.length - !!compBuilds?.[a.id]?.length ||
        (b.role === "tank") - (a.role === "tank"),
    );
    const itemPlans = itemOrder.map((u) =>
      build(byId.get(u.id), u.items ?? [], coverage, compBuilds),
    );
    const traitOf = new Map(traits.map((t) => [t.name, t])),
      stockAll = options.inventory ?? [];
    for (const b of itemPlans)
      b.synergies = traitsOfUnit(
        b.championId,
        planned.find((u) => u.id === b.championId)?.items,
      )
        .map((n) => traitOf.get(n))
        .filter(Boolean)
        .map((t) => ({
          name: t.name,
          count: t.count,
          active: t.active,
          next: t.next,
        }));
    // Sinergia a uma unidade do próximo patamar: quem comprar, ou qual emblema montar e em quem.
    const synergyTips = traits
      .filter((t) => t.next && t.next - t.count === 1)
      .map((t) => {
        const units = catalog.champions
          .filter(
            (c) =>
              c.traits.includes(t.name) &&
              !c.traits.includes("Avatar") &&
              !planned.some((p) => p.id === c.apiName),
          )
          .sort((a, b) => a.cost - b.cost)
          .slice(0, 3)
          .map((c) => ({ id: c.apiName, name: c.name, cost: c.cost }));
        const e = emblemByTrait.get(t.name);
        let emblem = null;
        if (e) {
          const holders = itemPlans.filter(
            (b) =>
              b.slotsFree > 0 &&
              b.name !== carry &&
              !traitsOfUnit(
                b.championId,
                planned.find((u) => u.id === b.championId)?.items,
              ).includes(t.name),
          );
          const holder =
            holders.find((b) =>
              options.metaBuilds?.get(b.championId)?.includes(e.apiName),
            ) ??
            holders.find((b) => b.role === "tank") ??
            holders[0] ??
            null;
          const stock = [...stockAll],
            missing = [];
          for (const id of e.composition) {
            const at = stock.indexOf(id);
            if (at < 0) missing.push(id);
            else stock.splice(at, 1);
          }
          emblem = {
            ...item(e.apiName),
            holder: holder?.name ?? null,
            holderId: holder?.championId ?? null,
            craftable: stockAll.includes(e.apiName) || missing.length === 0,
            missing: missing.map(item),
          };
          if (holder && emblem.craftable)
            holder.synergyItem = { ...emblem, trait: t.name, to: t.next };
        }
        return {
          trait: t.name,
          count: t.count,
          next: t.next,
          activeNow: t.active,
          units,
          emblem,
        };
      })
      .sort(
        (a, b) =>
          Number(!!b.emblem?.craftable) - Number(!!a.emblem?.craftable) ||
          Number(b.activeNow) - Number(a.activeNow) ||
          b.count - a.count,
      )
      .slice(0, 5);
    // Mudanças de item: item em unidade que sai da comp, ou que não está na build de quem o carrega, vai para
    // quem o usa melhor entre as unidades que já estão em campo. Um removedor tira todos os itens de uma unidade.
    const wish = (id) => wishlist(id, compBuilds, options.metaBuilds);
    const slotsLeft = new Map(
      itemPlans
        .filter((b) => current.has(b.championId))
        .map((b) => [b.championId, b.slotsFree]),
    );
    const itemMoves = [];
    for (const source of analysis.self.units) {
      const held = (source.itemNames ?? [])
        .map(clean)
        .filter((id) => !/Emblem|ThiefsGloves/.test(id));
      const gloves = (source.itemNames ?? []).find((id) =>
        /ThiefsGloves/.test(id),
      );
      if (gloves) {
        // a luva vai inteira, e só para quem está sem nenhum item
        if (!planned.some((p) => p.id === source.championName)) {
          const target = itemPlans
            .filter(
              (b) =>
                b.championId !== source.championName &&
                current.has(b.championId) &&
                b.equipped.length === 0 &&
                b.name !== carry,
            )
            .sort(
              (a, b) =>
                Number(wish(b.championId).includes(gloves)) -
                Number(wish(a.championId).includes(gloves)),
            )[0];
          if (target) {
            slotsLeft.set(target.championId, 0);
            itemMoves.push({
              from: {
                id: source.championName,
                name: source.name,
                stars: source.starLevel,
              },
              leaving: true,
              moves: [
                {
                  item: item(gloves),
                  to: { id: target.championId, name: target.name },
                  rank: wish(target.championId).indexOf(gloves) + 1,
                  toCarry: false,
                },
              ],
              priority: 3,
            });
          }
        }
        continue;
      }
      if (!held.length) continue;
      const leaving = !planned.some((p) => p.id === source.championName),
        own = wish(source.championName),
        moves = [];
      for (const id of held) {
        if (!leaving && own.includes(id)) continue;
        const target = itemPlans
          .filter(
            (b) =>
              b.championId !== source.championName &&
              (slotsLeft.get(b.championId) ?? 0) > 0 &&
              wish(b.championId).includes(id) &&
              !b.equipped.some((e) => clean(e.id) === id),
          )
          .sort(
            (a, b) =>
              Number(b.name === carry) - Number(a.name === carry) ||
              wish(a.championId).indexOf(id) - wish(b.championId).indexOf(id),
          )[0];
        if (!target) continue;
        slotsLeft.set(target.championId, slotsLeft.get(target.championId) - 1);
        moves.push({
          item: item(id),
          to: { id: target.championId, name: target.name },
          rank: wish(target.championId).indexOf(id) + 1,
          toCarry: target.name === carry,
        });
      }
      if (moves.length)
        itemMoves.push({
          from: {
            id: source.championName,
            name: source.name,
            stars: source.starLevel,
          },
          leaving,
          moves,
          priority: moves.reduce(
            (n, m) => n + (m.toCarry ? 5 : 2) + (4 - Math.min(4, m.rank)),
            0,
          ),
        });
    }
    itemMoves.sort((a, b) => b.priority - a.priority);
    const removers = Number.isInteger(options.removers)
      ? options.removers
      : null;
    itemMoves.forEach((move, index) => {
      move.method = options.hasRemover
        ? "removedor"
        : removers === null
          ? "removedor (banco não lido)"
          : index < removers
            ? "removedor"
            : move.leaving
              ? "vender a unidade quando a substituta entrar"
              : "sem removedor disponível";
      // Unidade que fica só troca agora com removedor; a que sai, quando a substituta já pode entrar.
      move.now =
        move.method !== "sem removedor disponível" &&
        (!move.leaving ||
          transitions.find((t) => t.exit?.id === move.from.id)?.ready === true);
    });
    // Carrossel: o componente que fecha um item agora, depois o que começa o próximo item de quem mais
    // importa (carry, tanque, demais), com o banco distribuído entre as builds. Regra em carousel.mjs.
    const carousel = carouselPicks(itemPlans, {
      carry,
      inventory: options.inventory ?? [],
      covered: coveredByMoves(itemMoves),
    });
    return {
      carry: carry ?? planned[0]?.name,
      carousel,
      positions,
      transitions,
      traits,
      synergyTips,
      itemMoves,
      removers,
      itemPlans,
      board: planned,
      positionNote:
        "Proposta heurística; posições reais dos adversários, alcance de todas as habilidades e regras especiais de adjacency não foram capturados. Espelhe para proteger o carry após observar a arena.",
    };
  }
  for (const r of analysis.recommendations)
    Object.assign(r, plan(r.board, r.carry, r.meta?.builds ?? null));
  if (options.previewIds?.length) {
    const board = options.previewIds.map((id) => {
      const c = byId.get(id),
        u = current.get(id) ?? reserve.get(id);
      return {
        id,
        name: c.name,
        cost: c.cost,
        traits: c.traits,
        owned: !!u,
        inReserve: !current.has(id) && reserve.has(id),
        stars: u?.starLevel ?? 1,
        items: u?.itemNames ?? [],
      };
    });
    // Comp de meta fixada: usa as builds dela, como nas sugestões.
    analysis.preview = plan(
      board,
      board.find((u) => u.id === options.goalCarryId)?.name ??
        board.find((u) => byId.get(u.id).stats.range >= 3)?.name,
      options.goalComp?.builds ?? null,
    );
  }
  const observedBoard = analysis.self.units
    .filter((u) => byId.has(u.championName))
    .map((u) => {
      const c = byId.get(u.championName);
      return {
        id: u.championName,
        name: c.name,
        cost: c.cost,
        traits: c.traits,
        owned: true,
        stars: u.starLevel,
        items: u.itemNames ?? [],
      };
    });
  const goalCarry =
    analysis.preview?.carry ?? analysis.recommendations[0]?.carry;
  const currentCarry =
    observedBoard.find((u) => u.name === goalCarry) ??
    [...observedBoard].sort(
      (a, b) =>
        b.items.length - a.items.length || b.stars * b.cost - a.stars * a.cost,
    )[0];
  analysis.currentPlan = observedBoard.length
    ? plan(observedBoard, currentCarry?.name)
    : null;
  // Free items are caller-confirmed; equipped items remain attached to their observed owner.
  const coverage = new Set();
  for (const u of analysis.self.units)
    for (const id of u.itemNames ?? []) {
      if (/VoidStaff/.test(id)) coverage.add("shredMagic");
      if (/LastWhisper/.test(id)) coverage.add("shredArmor");
      if (/SunfireCape|Morellonomicon|RedBuff/.test(id)) coverage.add("wounds");
    }
  // Próximo item / Montar agora seguem a build da comp alvo (a mesma dos planos); quem não está nela usa a geral.
  // O preview ainda não tem `meta` (o servidor põe depois): as builds vêm da comp fixada.
  const target = analysis.preview ?? analysis.recommendations[0] ?? null,
    targetBuilds = analysis.preview
      ? (options.goalComp?.builds ?? null)
      : (target?.meta?.builds ?? null);
  const currentBuilds = analysis.self.units
    .filter((u) => byId.has(u.championName))
    .map((u) => ({
      ...build(
        byId.get(u.championName),
        u.itemNames ?? [],
        coverage,
        targetBuilds,
      ),
      stars: u.starLevel,
    }));
  for (const b of currentBuilds) {
    const planned = analysis.currentPlan?.itemPlans.find(
      (p) => p.championId === b.championId,
    );
    b.synergies = planned?.synergies ?? [];
    b.synergyItem = planned?.synergyItem ?? null;
  }
  // O que montar com o banco vale para a comp alvo inteira: as peças em campo e também as que ainda
  // vão entrar (o item fica guardado para elas). Cada campeão recebe no máximo 3 itens (slotsFree).
  const targetIds = new Set((target?.board ?? []).map((u) => u.id)),
    ownedIds = new Set(currentBuilds.map((b) => b.championId)),
    adviceBuilds = [
      ...currentBuilds,
      ...(target?.itemPlans ?? [])
        .filter((p) => !ownedIds.has(p.championId))
        .map((p) => ({ ...p, stars: 0 })),
    ];
  const inventory = options.inventory ?? [],
    remaining = [...inventory],
    choices = [],
    // Item já montado em outro campeão que a comp vai passar para este: não sugerir montar de novo.
    covered = coveredByMoves(target?.itemMoves ?? []);
  for (const b of adviceBuilds)
    for (const candidate of b.additions) {
      if (covered.has(`${b.championId}:${candidate.id}`)) continue;
      const parts = candidate.components.map((i) => i.id);
      if (candidate.usesHeld)
        parts.splice(parts.indexOf(candidate.usesHeld), 1);
      const required = inventory.includes(candidate.id)
        ? [candidate.id]
        : parts;
      const check = [...inventory],
        missing = [];
      for (const id of required) {
        const at = check.indexOf(id);
        if (at >= 0) check.splice(at, 1);
        else missing.push(id);
      }
      const inField = ownedIds.has(b.championId),
        inGoal = targetIds.has(b.championId);
      choices.push({
        championId: b.championId,
        champion: b.name,
        stars: b.stars,
        inField,
        inGoal,
        item: candidate,
        required,
        missing,
        ready: required.length > 0 && !missing.length,
        // Carry da comp primeiro; peça em campo da comp antes da que ainda vai entrar; temporária por último.
        rank:
          candidate.score +
          (required.length - missing.length) * 20 +
          (required.length && !missing.length ? 60 : 0) +
          (b.name === target?.carry ? 25 : 0) +
          (inGoal ? (inField ? 10 : 4) : -15),
      });
    }
  choices.sort((a, b) => b.rank - a.rank);
  const slots = new Map(adviceBuilds.map((b) => [b.championId, b.slotsFree]));
  for (const key of covered) {
    const id = key.split(":")[0];
    if (slots.has(id)) slots.set(id, Math.max(0, slots.get(id) - 1));
  }
  const ready = [];
  for (const c of choices) {
    // Completar um componente já equipado não ocupa slot novo.
    const needsSlot = !c.item.usesHeld;
    if (!c.ready || (needsSlot && !slots.get(c.championId))) continue;
    const check = [...remaining];
    let possible = true;
    for (const id of c.required) {
      const at = check.indexOf(id);
      if (at < 0) {
        possible = false;
        break;
      }
      check.splice(at, 1);
    }
    if (!possible) continue;
    remaining.splice(0, remaining.length, ...check);
    if (needsSlot) slots.set(c.championId, slots.get(c.championId) - 1);
    ready.push(c);
  }
  analysis.ownedItemAdvice = {
    synergyTips: analysis.currentPlan?.synergyTips ?? [],
    builds: currentBuilds,
    ready,
    near: choices
      .filter(
        (c) => !c.ready && c.missing.length === 1 && c.required.length > 1,
      )
      .slice(0, 6),
    inventory: inventory.map(item),
    remaining: remaining.map(item),
    source:
      "Itens equipados: snapshot. Itens livres: entrada manual; não foram capturados automaticamente.",
  };
  analysis.matchup = threat;
  return analysis;
}
