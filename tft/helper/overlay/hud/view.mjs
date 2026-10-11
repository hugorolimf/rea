/**
 * Modelo de tela do overlay: função pura, sem DOM e sem imports. Converte a resposta de `GET /api/overlay` (cache de
 * `/api/state` e `/api/recommend`) nos textos, ids e seções que a página desenha. Não decide nada de jogo: o veredito
 * de rolagem, o próximo item e o plano vêm prontos do servidor; aqui só se reorganiza o que já foi calculado.
 *
 * Por ser carregada no navegador (origem do servidor, `/overlay/*`) e no Node (testes), esta camada não importa os
 * módulos da interface: recebe-os em `deps`, e `hud.mjs` injeta os reais de `/v2/js/*`.
 */

/** Idade (ms) a partir da qual uma leitura ou análise do cache é tratada como velha. */
export const STALE_AFTER_MS = 120_000;

/** Por que não há análise: ela só existe enquanto a interface web do helper está aberta e visível em algum lugar. */
export const WAITING_TITLE =
  "A análise só existe enquanto a interface web do helper está aberta e visível em algum lugar. O overlay mostra o que ela já calculou e nunca pede uma análise própria.";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const brief = (x) => ({ id: x?.id ?? null, name: x?.name ?? "" });
const placeText = (p) => (p >= 1 ? `${p}º lugar` : "colocação não observada");

const LEVEL_SOURCE = {
  lido: "observado pelo jogo",
  derivado: "mínimo derivado do XP passivo: não foi lido",
  estimado: "estimado pelo tabuleiro: não foi lido",
};

/** "12 s" ou "5 min": idade legível de uma leitura. */
export function ageText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 180 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/** Idade atual de um item do cache: a que o servidor informou mais o tempo local desde que a resposta chegou. */
const ageOf = (slot, elapsed) =>
  num(slot?.ageMs) === null ? null : slot.ageMs + elapsed;

/** Linhas de um grupo de passos do modelo (`plan.steps`), na ordem do servidor. */
const stepRows = (model, id) =>
  (model.plan?.steps ?? []).find((s) => s.id === id)?.rows ?? [];

/**
 * Metadados de ritmo (idade, ao vivo, fase, mesmo jogo) vêm da leitura mais recente do estado, como na interface
 * (`main.js`): a análise guardada pode ser de alguns segundos atrás. `stateStale`: o cache do estado envelheceu e
 * nada nele vale como ao vivo.
 */
function adjusted(state, rec, stateStale) {
  if (!rec) return null;
  if (!state) return rec;
  const { ageSeconds, phase, sameGame } = state;
  return {
    ...rec,
    metadata: {
      ...rec.metadata,
      ageSeconds,
      actionable: stateStale ? false : state.actionable,
      phase,
      sameGame,
    },
  };
}

/** A análise guardada é de outra partida que a do estado (começou uma nova depois dela): não vale. */
const ofOtherGame = (state, rec) =>
  state?.match?.id != null &&
  rec?.metadata?.gameId != null &&
  String(state.match.id) !== String(rec.metadata.gameId);

/** Constrói o modelo da interface com as mesmas guardas de `main.js`: partida nova sem tabuleiro próprio não tem análise. */
function modelOf(state, rec, buildModel) {
  if (state?.match?.status === "live" && state.match.boardReady === false)
    return buildModel({ state: { ...state, estimatedLevel: null }, rec: null });
  return buildModel({ state, rec });
}

/** Faixa superior: fase, nível, ouro, vida, GEP e indicador ao vivo. */
function barOf(model, stateStale) {
  const { hero, status, plan } = model,
    lv = hero.level,
    keep = num(plan?.panel?.economy?.keep),
    gain = num(plan?.panel?.economy?.interest),
    cost = num(plan?.panel?.level?.cost);
  const prefix =
    hero.levelSource === "derivado"
      ? "≥"
      : hero.levelSource === "estimado"
        ? "~"
        : "";
  const live = status.live
    ? { kind: "live", text: "ao vivo" }
    : status.waiting
      ? { kind: "waiting", text: "nova partida" }
      : status.ended
        ? {
            kind: "ended",
            text: status.placement
              ? `encerrada · ${status.placement}º`
              : "encerrada",
          }
        : { kind: "snapshot", text: "snapshot" };
  return {
    stage: hero.stage ? `${hero.stage.stage}-${hero.stage.round}` : null,
    level:
      lv == null
        ? null
        : {
            text: `${prefix}${lv}`,
            source: hero.levelSource,
            // "≥" e "~" não são leituras: só o nível observado ("lido") fica firme.
            uncertain: hero.levelSource !== "lido",
            title: `Nível ${lv} (${
              hero.levelFrom === "gep"
                ? "observado pelo GEP (TFTAcademy)"
                : (LEVEL_SOURCE[hero.levelSource] ?? hero.levelSource)
            }${
              hero.levelUsed != null && hero.levelUsed !== lv
                ? `; a análise usou o nível ${hero.levelUsed}`
                : ""
            })`,
          },
    xp: hero.xp ? { text: `${hero.xp.have}/${hero.xp.total}`, cost } : null,
    gold:
      hero.gold == null
        ? null
        : {
            value: hero.gold,
            interest: gain,
            title:
              [
                hero.goldFrom === "gep"
                  ? "Ouro observado pelo GEP (TFTAcademy)"
                  : null,
                keep != null ? `Piso desta decisão: ${keep}g` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Ouro",
          },
    // O jogo grava vida negativa de quem foi eliminado; na tela, eliminado é 0.
    hp: hero.hp == null ? null : Math.max(0, hero.hp),
    gep: status.gep
      ? {
          state: status.gep.state,
          short: status.gep.short,
          label: status.gep.label,
        }
      : null,
    live,
    stale: stateStale,
  };
}

/** Veredito de rolagem do servidor em um cartão curto; só com a partida ao vivo. */
function rollOf(model) {
  const r = model.plan?.panel?.roll;
  if (!r || !model.status.live) return null;
  const c = r.call;
  if (!c && !r.pill.text) return null;
  return {
    tone: r.pill.tone,
    pill: r.pill.text,
    kind: c?.kind ?? "",
    title: c?.title ?? "",
    reason: c?.reason ?? "",
    budget: num(c?.budget),
    // Nível em que o servidor manda rolar (o veredito "wait" diz "espere o nível N").
    at: num(c?.at?.level) ?? num(r.at),
    spend: r.go ? { gold: r.spend, shops: r.shops, keep: num(r.keep) } : null,
    interest: r.interest ? { from: r.interest.from, to: r.interest.to } : null,
  };
}

/** Linhas do "Próximo item": quem recebe, o item, a receita e a situação de cada componente. */
function nextOf(model, deps) {
  return stepRows(model, "next").map((r) => {
    const rec = deps.nextItemRecipe(r.item, deps.catalogItems ?? new Map(), {
        bank: r.bank ?? null,
      }),
      parts = (rec?.parts ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        state: p.state,
        stateText: deps.partState?.[p.state] ?? p.state,
      })),
      missing = parts.filter((p) => p.state === "missing").length;
    return {
      key: r.key,
      unit: { ...brief(r.unit), stars: num(r.unit?.stars) ?? 0 },
      item: rec?.item ?? brief(r.item),
      base: rec?.base ?? null,
      parts,
      complete: !!rec?.complete,
      // Item cuja receita ainda não fecha: o ícone principal sai tracejado.
      incomplete: parts.length > 0 && !rec?.complete,
      note: !parts.length
        ? ""
        : rec.complete
          ? "monta"
          : missing
            ? `falta ${missing}`
            : "",
    };
  });
}

/** Quantos campeões o cartão de itens mostra (o carry primeiro); o espaço do overlay é o limite, a interface lista todos. */
export const CHAMPS_SHOWN = 4;

/**
 * Itens recomendados de cada campeão em campo (passo "Itens dos campeões" do modelo): todos os até 3 itens da build, na
 * ordem, cada um com a situação segundo o banco (equipado, no banco, monta agora, mover, falta N); `next` marca o destaque.
 */
function champsOf(model) {
  return stepRows(model, "builds")
    .slice(0, CHAMPS_SHOWN)
    .map((r) => ({
      key: r.key,
      unit: {
        ...brief(r.unit),
        cost: num(r.unit?.cost),
        stars: num(r.unit?.stars) ?? 0,
      },
      carry: !!r.carry,
      // Build de reserva (a comp não publica build para o campeão): o overlay a marca, como a interface.
      reserve: r.reserve === true,
      note: r.note ?? "",
      items: (r.items ?? []).map((i) => ({
        item: brief(i.item),
        kind: i.kind,
        text: i.text ?? "",
        label: i.label ?? "",
        mark: i.mark ?? "plus",
        tone: i.tone ?? "wait",
        from: i.from ? brief(i.from) : null,
        next: !!i.next,
      })),
    }));
}

/** "Equipar" (peça em campo e banco) em versão resumida. */
function equipOf(model) {
  return stepRows(model, "equip").map((r) =>
    r.kind === "equip"
      ? {
          key: r.key,
          kind: "equip",
          unit: { ...brief(r.unit), stars: num(r.unit?.stars) ?? 0 },
          items: (r.items ?? []).map(brief),
          inField: !!r.inField,
        }
      : {
          key: r.key,
          kind: "bank",
          item: brief(r.item),
          to: r.to ? brief(r.to) : null,
          reason: r.reason ?? "",
          inField: !!r.inField,
        },
  );
}

/** "Passar itens": de quem sai cada item e para quem vai; `now` quando dá para fazer agora. */
function movesOf(model) {
  return stepRows(model, "moves").map((r) => ({
    key: r.key,
    from: { ...brief(r.from), stars: num(r.from?.stars) ?? 0 },
    moves: (r.moves ?? []).map((m) => ({
      item: brief(m.item),
      to: brief(m.to),
    })),
    now: !!r.now,
    method: r.method ?? "",
  }));
}

/** Itens do plano por campeão: o que está equipado e o que a build ainda pede (com a situação de cada um). */
function buildsOf(model, bank, deps) {
  const out = [];
  for (const c of model.plan?.cells ?? []) {
    if (!c.build) continue;
    const equipped = (c.build.equipped ?? []).map(brief),
      wanted = deps
        .buildStates(c, bank)
        .filter((s) => s.state.kind !== "on")
        .map((s) => ({
          ...brief(s.item),
          kind: s.state.kind,
          text: s.state.text ?? "",
        }));
    if (!equipped.length && !wanted.length) continue;
    out.push({
      id: c.id,
      name: c.name,
      cost: c.cost,
      stars: c.stars,
      carry: c.carry,
      equipped,
      wanted,
    });
  }
  // O carry primeiro; a ordem das demais é a da formação.
  return out.sort((a, b) => Number(b.carry) - Number(a.carry));
}

/** Plano em andamento: título, carry, peças da comp em campo e o checklist curto de `planProgress`. */
function planOf(model, rec, deps) {
  if (!model.plan) return null;
  const view = deps.planView(rec?.planProgress, model.status.live),
    sc = model.plan.score;
  return {
    title: view?.title ?? model.plan.title,
    // Código do Planejador do jogo da comp exibida (botão "Copiar comp", keys.mjs); null com o motivo em `teamCodeError`.
    teamCode: model.plan.teamCode ?? null,
    teamCodeError: model.plan.teamCodeError ?? null,
    carry: model.plan.carry
      ? { id: model.plan.carryId, name: model.plan.carry }
      : null,
    pinned: model.status.pinned,
    onBoard: model.plan.progress,
    score: sc ? { value: sc.value, best: sc.best } : null,
    progress: view
      ? {
          pct: view.pct,
          done: view.done,
          total: view.total,
          since: view.since,
        }
      : null,
    challenger: view?.challenger ?? null,
    // Alcance do plano em uma linha (peças que tem, em campo e na reserva, o que falta e a chance no prazo).
    reach: view?.reach ?? null,
    next: (view?.next ?? []).map((s) => ({ kind: s.kind, text: s.text })),
    units: (view?.units ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      cost: u.cost ?? null,
      carry: !!u.carry,
      status: u.status,
      statusText: u.statusText,
      line: u.line,
      fraction: u.fraction,
      lost: u.lost,
    })),
    items: (view?.items ?? []).map((i) => ({
      key: i.key,
      itemId: i.itemId,
      name: i.name,
      unitId: i.unitId,
      unit: i.unit,
      status: i.status,
      statusText: i.statusText,
      missing: i.missing,
    })),
  };
}

/** Texto não vazio ou null. */
const str = (v) => (typeof v === "string" && v ? v : null);

/** Quantas peças do carrossel o cartão mostra (o resto vira "+N"); o espaço do overlay é o limite, não o servidor. */
export const CAROUSEL_SHOWN = 5;

/**
 * Carrossel (`state.carousel` do servidor, app/carousel-view.mjs): só enquanto o servidor diz que estamos nele
 * (`active === true`) e a leitura do estado não está velha. `from`: "reading" (peças lidas do carrossel, em ordem de valor)
 * ou "priority" (o carrossel NÃO foi lido: lista do que pegar se aparecer); o cartão diz qual das duas é. Nada é recalculado
 * aqui. Devolve `{ from, stage, source, confidence, note, total, picks, more }` ou null.
 */
function carouselOf(stateBody, stateStale, deps) {
  const c = stateBody?.carousel;
  if (stateStale || c?.active !== true) return null;
  // O servidor manda ids (e o nome só quando o plano o conhece): o nome que falta vem do catálogo da interface.
  const champ = (id, name) => ({
      id,
      name: name || deps?.catalog?.champions?.get(id)?.name || "",
    }),
    thing = (id, name) => ({
      id,
      name: name || deps?.catalog?.items?.get(id)?.name || "",
    });
  const picks = (Array.isArray(c.picks) ? c.picks : []).map((p) => ({
    rank: num(p?.rank),
    slot: num(p?.slot),
    champion: p?.championId ? champ(p.championId, p.championName) : null,
    item: thing(p?.itemId ?? null, p?.itemName),
    kind: str(p?.kind) ?? "unknown",
    score: num(p?.score),
    reason: str(p?.reason) ?? "",
    completes: p?.completesNow === true,
    target: p?.target?.id ? thing(p.target.id, p.target.name) : null,
    forChampion: p?.forChampionId
      ? champ(p.forChampionId, p.forChampion)
      : null,
  }));
  return {
    from: c.from === "reading" || c.from === "priority" ? c.from : null,
    stage: str(c.stage),
    source: str(c.source),
    confidence: str(c.confidence),
    note: str(c.note),
    total: picks.length,
    picks: picks.slice(0, CAROUSEL_SHOWN),
    more: Math.max(0, picks.length - CAROUSEL_SHOWN),
  };
}

/**
 * Aprimoramentos (oferta lida do jogo pelo GEP, `state.seen.augmentOffer`): o cartão aparece enquanto a escolha está aberta
 * no jogo, com as cartas na ordem da última análise (`rec.augmentAdvice`, só se for desta mesma oferta). Sem fonte (GEP
 * fora), aparece só na rodada de aprimoramento, dizendo "sem fonte". A regra é a da interface (`deps.augOfferView`, de
 * /v2/js/augs.js); sem ela, ou com a leitura velha, não há cartão. Devolve o modelo de `augOfferView` ou null.
 */
function augmentsOf(stateBody, recBody, stateStale, deps) {
  if (stateStale || typeof deps?.augOfferView !== "function") return null;
  const seen = stateBody?.seen ?? null;
  try {
    const v = deps.augOfferView(seen, recBody?.augmentAdvice ?? null);
    if (v.open) return v;
    // Sem fonte, só na rodada de aprimoramento (`augmentRound`, da trilha da interface) vale um cartão.
    return v.source?.state === "sem-fonte" && v.augmentRound ? v : null;
  } catch {
    return null;
  }
}

/** Campeão referido por nome (`replaces` do servidor é o nome) ou por objeto: sempre `{ id, name }` ou null. */
const refOf = (x) =>
  !x
    ? null
    : typeof x === "string"
      ? { id: null, name: x }
      : { id: x.id ?? null, name: x.name ?? "" };

/**
 * Lista "Comprar" do modelo da interface já cruzada com a loja de agora (`row.shop`, de `shop-match.js`): é daqui que a
 * dica de compra sabe em que espaço da loja está a peça. `status` é a nota do cabeçalho da lista (ou null).
 */
function buyOf(model) {
  const step = (model.plan?.steps ?? []).find((s) => s.id === "buy");
  if (!step) return null;
  return {
    rows: step.rows.map((r) => ({
      key: r.key,
      unit: brief(r.unit),
      how: r.how ?? "slot",
      replaces: refOf(r.replaces),
      broke: !!r.broke,
      want: num(r.want) ?? 1,
      reason: str(r.reason) ?? str(r.unit?.reason),
      // Cópia de peça que você já tem (`how: "copy"`): o que ela fecha (core/pool/buy-copies.mjs); null para peça nova.
      copy: r.copy ?? null,
      shop: r.shop ?? null,
    })),
    status: step.note
      ? {
          state: step.note.state,
          text: step.note.text,
          title: step.note.title ?? "",
        }
      : null,
  };
}

/** Wisps da loja agora (só ao vivo e com a função e o catálogo injetados); um dado estranho nunca derruba a tela. */
function wispsOf(model, seen, rec, deps) {
  if (!model.status.live || typeof deps.wispsView !== "function") return [];
  try {
    const list = deps.wispsView(seen, {
      catalog: deps.catalog,
      hero: model.hero,
      rec,
      roll: model.plan?.panel?.roll,
    });
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Economia do plano exibido, como o servidor calculou (`strategy.panels.economy`); campos ausentes viram null. */
function economyOf(rec) {
  const e = (rec?.preview ?? rec?.recommendations?.[0])?.strategy?.panels
    ?.economy;
  if (!e) return null;
  return {
    gold: num(e.gold),
    interest: num(e.interest),
    next: num(e.next),
    keep: num(e.keep),
    after: num(e.after),
    pressure: str(e.pressure),
    text: str(e.text),
    // Aviso de vida do servidor (só na faixa de perigo): a linha "Vida 28: role por upgrades do plano…" e o gatilho.
    alert: str(e.alert?.text),
    alertWhy: str(e.alert?.why),
  };
}

/** Nível do plano exibido (`strategy.panels.leveling`, com `go` e `passive` só ao vivo, como no modelo da interface). */
function levelOf(model) {
  const lv = model.plan?.panel?.level;
  if (!lv) return null;
  return {
    level: num(lv.level),
    go: lv.go === true,
    cost: num(lv.cost),
    passive: lv.passive === true,
    finalLevel: num(lv.finalLevel),
    verdict: str(lv.verdict),
    text: str(lv.text),
  };
}

/**
 * Origem declarada de um dado do estado visto (`seen.sources.<chave>`, de GET /api/state): "gep", "game-log", "derived"
 * ou null se não informada.
 */
const sourceOf = (seen, key) => str(seen?.sources?.[key]);

/**
 * De onde vêm os dados (chip do GEP, campos sem fonte, origem da loja, do ouro e do nível), para o indicador de saúde.
 * `missing`: nomes para o usuário dos campos do jogador sem fonte (`status.gep.missing`), ou [] se nenhum.
 */
function sourcesOf(model, seen, bar) {
  const shop = sourceOf(seen, "shop");
  const missing = model.status.gep?.missing;
  return {
    gep: bar?.gep ?? null,
    missing: Array.isArray(missing) ? missing : [],
    shopSource: shop === "gep" ? shop : null,
    goldSource: sourceOf(seen, "gold"),
    levelSource: sourceOf(seen, "level"),
  };
}

/**
 * Modelo de tela. `feed`: última resposta completa de `/api/overlay` (ou null se nunca chegou). Opções:
 * `catalogReady` (retratos e nomes dependem do catálogo), `now` e `receivedAt` (relógio injetado: ms local agora e
 * quando `feed` chegou), `offline` (o servidor parou de responder) e `deps` (`buildModel`, `planView`,
 * `nextItemRecipe`, `partState`, `buildStates`, `catalogItems`; opcionais: `wispsView` e `catalog`, para os Wisps).
 *
 * Devolve `{ status, message, notices, dim, bar, roll, items, builds, plan, sections, buy, wisps, economy, level,
 * sources, carousel }` (os quatro últimos e `buy`/`wisps` alimentam as dicas ancoradas de `hints.mjs`):
 * - `status`: "loading" | "no-state" | "waiting" | "ended" | "idle" | "ready";
 * - `message`: texto central dos estados sem plano (`{ text, detail, title }`) ou null;
 * - `notices`: avisos discretos (`{ kind, text, title }`): servidor sem resposta, leitura ou análise velhas, outro jogo;
 * - `dim`: a análise ou a leitura está velha, o que esmaece o corpo;
 * - `sections`: ids das seções com dado, na ordem de desenho (as vazias ficam de fora);
 * - `buy`: `{ rows: [{ key, unit, how, replaces, broke, want, reason, shop }], status }` ou null (`shop` = cruzamento
 *   com a loja de `shop-match.js`);
 * - `wisps`: `[]` ou o resultado de `deps.wispsView` (só ao vivo);
 * - `economy` e `level`: `{ gold, interest, next, keep, after, pressure, text, alert, alertWhy }` e `{ level, go, cost, passive,
 *   finalLevel, verdict, text }` do plano exibido, ou null;
 * - `sources`: `{ gep, missing, shopSource, goldSource, levelSource }` (de onde vem cada dado do jogador; `missing` =
 *   campos sem fonte, como "ouro" e "loja", quando o GEP não está ativo);
 * - `carousel`: o cartão do carrossel enquanto o servidor diz que estamos nele (ver `carouselOf`), ou null;
 * - `augments`: o cartão dos aprimoramentos enquanto a escolha está aberta no jogo (ou "sem fonte" na rodada dela; ver
 *   `augmentsOf`), ou null.
 */
export function overlayView(
  feed,
  {
    catalogReady = true,
    now = 0,
    receivedAt = now,
    offline = false,
    deps,
  } = {},
) {
  const empty = {
    status: "loading",
    message: null,
    notices: [],
    dim: false,
    bar: null,
    roll: null,
    items: null,
    builds: [],
    plan: null,
    sections: [],
    buy: null,
    wisps: [],
    economy: null,
    level: null,
    sources: null,
    carousel: null,
    augments: null,
  };
  const notices = [];
  // Selo discreto com a idade da última resposta: a página continua com os últimos dados (o overlay não troca de página).
  const silentMs = Math.max(0, now - receivedAt);
  if (offline)
    notices.push({
      kind: "offline",
      text: `sem resposta do servidor${silentMs >= 1000 ? ` há ${ageText(silentMs)}` : ""}`,
      title:
        "O helper não respondeu às últimas consultas. O desenho abaixo é a última leitura recebida.",
    });
  if (!catalogReady)
    return {
      ...empty,
      notices,
      message: { text: "carregando dados do jogo", detail: "", title: "" },
    };
  const stateBody = feed?.state?.body ?? null,
    recBody = feed?.recommendation?.body ?? null;
  if (!stateBody && !recBody)
    return {
      ...empty,
      status: feed ? "no-state" : "loading",
      notices,
      message: {
        text: feed ? "aguardando a leitura da partida" : "conectando ao helper",
        detail: "",
        title: feed ? WAITING_TITLE : "",
      },
    };

  // Análise de outra partida é como análise nenhuma.
  const usable = ofOtherGame(stateBody, recBody) ? null : recBody;
  const elapsed = Math.max(0, now - receivedAt),
    stateAge = ageOf(feed.state, elapsed),
    recAge = usable ? ageOf(feed.recommendation, elapsed) : null,
    stateStale = stateAge !== null && stateAge > STALE_AFTER_MS,
    recStale = recAge !== null && recAge > STALE_AFTER_MS;
  if (stateStale)
    notices.push({
      kind: "state-old",
      text: `leitura de há ${ageText(stateAge)}`,
      title:
        "O estado do jogo guardado pelo servidor está velho; nada nele vale como ao vivo até a próxima leitura.",
    });
  else if (recStale)
    notices.push({
      kind: "analysis-old",
      text: `análise de há ${ageText(recAge)}`,
      title:
        "A análise guardada pelo servidor está velha; ela só é refeita enquanto a interface web do helper está aberta e visível.",
    });

  const rec = adjusted(stateBody, usable, stateStale),
    model = modelOf(stateBody, rec, deps.buildModel),
    bar = barOf(model, stateStale),
    { status } = model,
    base = {
      ...empty,
      notices,
      bar,
      dim: stateStale || recStale,
      sources: sourcesOf(model, stateBody?.seen, bar),
      // O carrossel vem do estado, não da análise: aparece mesmo sem plano (ver carouselOf).
      carousel: carouselOf(stateBody, stateStale, deps),
      // Aprimoramentos também vêm do estado (a oferta do GEP); a análise só ordena as cartas.
      augments: augmentsOf(stateBody, usable, stateStale, deps),
    };
  if (status.sameGame === false)
    notices.push({
      kind: "other-game",
      text: "snapshot de outro jogo",
      title: "Snapshot de outro jogo: não use como decisão ao vivo.",
    });

  if (status.waiting)
    return {
      ...base,
      carousel: null,
      augments: null,
      status: "waiting",
      message: {
        text: "Nova partida",
        detail: `Aguardando o jogo publicar o primeiro tabuleiro (costuma levar de 1 a 4 minutos).${
          status.lastMatch
            ? ` Partida anterior: ${placeText(status.lastMatch.placement)}.`
            : ""
        }`,
        title: "Os dados da partida anterior foram descartados.",
      },
    };
  if (status.ended)
    return {
      ...base,
      carousel: null,
      augments: null,
      status: "ended",
      message: {
        text: status.placement
          ? `Partida encerrada · ${placeText(status.placement)}`
          : "Partida encerrada",
        detail: status.awaitingFinal
          ? "Aguardando o tabuleiro final para registrar a colocação."
          : "",
        title: "",
      },
    };
  if (!model.plan)
    return {
      ...base,
      status: "idle",
      message: {
        text: usable ? "sem comp sugerida nesta análise" : "aguardando análise",
        detail: "",
        title: WAITING_TITLE,
      },
    };

  const bank = Array.isArray(stateBody?.seen?.items)
      ? stateBody.seen.items
      : [],
    roll = rollOf(model),
    items = {
      next: nextOf(model, deps),
      equip: equipOf(model),
      moves: movesOf(model),
      champs: champsOf(model),
      champsMore: Math.max(0, stepRows(model, "builds").length - CHAMPS_SHOWN),
    },
    hasItems =
      items.next.length ||
      items.equip.length ||
      items.moves.length ||
      items.champs.length,
    builds = buildsOf(model, bank, deps),
    plan = planOf(model, rec, deps);
  return {
    ...base,
    status: "ready",
    roll,
    items: hasItems ? items : null,
    builds,
    plan,
    buy: buyOf(model),
    wisps: wispsOf(model, stateBody?.seen, rec, deps),
    economy: economyOf(rec),
    level: levelOf(model),
    sections: [
      base.augments && "augments",
      base.carousel && "carousel",
      roll && "roll",
      hasItems && "items",
      builds.length && "builds",
      plan && "plan",
    ].filter(Boolean),
  };
}
