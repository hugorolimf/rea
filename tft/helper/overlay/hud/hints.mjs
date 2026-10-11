/**
 * Dicas ancoradas do overlay: função pura (sem DOM, sem imports) que transforma o modelo de tela (`view.mjs`) em uma
 * lista curta de dicas, cada uma presa a um elemento do jogo (espaço da loja, banco de itens, ouro, nível). Não decide
 * nada de jogo: o que comprar, rolar, passar ou montar já vem calculado pelo servidor e cruzado com a loja pela interface
 * web (`shop-match.js`); aqui só se escolhe o que mostrar, em que ordem e com que âncora. Nenhuma dica diz algo que a
 * interface web não diga.
 *
 * Rodam no navegador (a página do HUD) e no Node (testes): sem `node:*`.
 */

/** Categorias que o jogador liga e desliga. "alert" (perigo de vida) não está aqui: nunca é desligável. */
export const HINT_CATEGORIES = ["buy", "items", "gold", "wisp", "learn"];

/** Quantidade de dicas: pouca, normal ou tudo. */
export const VERBOSITY_LEVELS = ["minimal", "normal", "detailed"];

/**
 * Padrão: tudo ligado, menos "learn" (textos explicativos longos); verbosidade MÍNIMA (leitura de relance: ícones,
 * retratos e números; as frases vão para a dica do mouse no modo interativo e para o "?"). O jogador aumenta no "?".
 */
export const DEFAULT_HINT_SETTINGS = Object.freeze({
  categories: Object.freeze({
    buy: true,
    items: true,
    gold: true,
    wisp: true,
    learn: false,
  }),
  verbosity: "minimal",
});

/** Por verbosidade: prioridade mínima e teto de dicas mostradas. */
const LIMITS = {
  minimal: { floor: 70, max: 3 },
  normal: { floor: 40, max: 5 },
  detailed: { floor: 0, max: 8 },
};

const NONE = { kind: "none" };
const rank = (verbosity) => VERBOSITY_LEVELS.indexOf(verbosity);
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const count = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Ajustes de dicas a partir de qualquer valor (arquivo local, mensagem da página): nunca lança; o que não for válido
 * volta ao padrão. Devolve sempre um objeto novo e completo.
 */
export function parseHintSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {},
    cats =
      src.categories && typeof src.categories === "object"
        ? src.categories
        : {};
  const categories = {};
  for (const c of HINT_CATEGORIES)
    categories[c] =
      typeof cats[c] === "boolean"
        ? cats[c]
        : DEFAULT_HINT_SETTINGS.categories[c];
  return {
    categories,
    verbosity: VERBOSITY_LEVELS.includes(src.verbosity)
      ? src.verbosity
      : DEFAULT_HINT_SETTINGS.verbosity,
  };
}

/* ---------- Geração ---------- */

/**
 * Monta uma dica completa. `h`: `{ id, category, priority, tone, anchors, text, why, action, icon, parts, pulse,
 * probable, min }`. `stale` (dado velho) tira o pulso. `minVerbosity` é um campo a mais do contrato: a verbosidade
 * mínima em que a dica aparece, quando ela difere do que a prioridade sozinha daria (null = vale a prioridade).
 */
function make(h, stale) {
  const anchors = h.anchors ?? [];
  return {
    id: h.id,
    category: h.category,
    priority: h.priority,
    tone: h.tone,
    anchor: anchors[0] ?? NONE,
    anchors,
    text: h.text,
    // Forma curta (ícone + número/imagens) da verbosidade mínima; a frase inteira (`text`) vai para a dica do mouse.
    short: text(h.short),
    why: text(h.why),
    action: text(h.action),
    icon: h.icon ?? null,
    parts: h.parts ?? null,
    pulse: !!h.pulse && !stale,
    probable: !!h.probable,
    stale,
    minVerbosity: h.min ?? null,
  };
}

const glyphIcon = (id, name) => ({ kind: "glyph", id, name });
const names = (list) =>
  (list ?? [])
    .map((x) => x?.name)
    .filter(Boolean)
    .join(", ");
const firstLine = (s) => text(String(s ?? "").split("\n")[0]);

/** Perigo de vida: a faixa que o servidor usou na economia (danger/critical). Sem âncora, salvo o veredito de estabilizar. */
function alertHints(view, mk) {
  const pressure = view.economy?.pressure;
  if (pressure !== "danger" && pressure !== "critical") return [];
  const roll = view.roll,
    stabilize = roll?.kind === "danger",
    hp = count(view.bar?.hp);
  return [
    mk({
      id: "alert:hp",
      category: "alert",
      priority: 100,
      tone: "danger",
      anchors: stabilize ? [{ kind: "gold" }] : [],
      // A linha do servidor diz o que fazer pela decisão tomada, sem contradizer o plano; sem ela, só a faixa.
      text:
        text(view.economy?.alert) ??
        `${pressure === "critical" ? "Vida crítica" : "Vida em perigo"}${hp !== null ? ` (${hp} de vida)` : ""}`,
      short: `❤ ${hp ?? "!"}`,
      why: text(view.economy?.alertWhy) ?? roll?.reason,
      action: stabilize ? roll.title : null,
      icon: glyphIcon("warn", "Vida em perigo"),
      pulse: true,
    }),
  ];
}

/** Compra: peças do plano que estão na loja agora, ancoradas nos espaços certos (só os que o plano manda comprar). */
function buyHints(view, mk) {
  const out = [];
  for (const row of view.buy?.rows ?? []) {
    const shop = row.shop;
    if (!shop) continue;
    const slots = (shop.slots ?? []).filter(Number.isInteger),
      n = Number.isInteger(shop.buy) && shop.buy > 0 ? shop.buy : slots.length,
      broke = row.broke === true || shop.broke === true;
    out.push(
      mk({
        id: `buy:${row.unit?.id ?? row.key}`,
        category: "buy",
        priority: 90,
        tone: broke ? "amber" : "go",
        anchors: slots.slice(0, n).map((slot) => ({ kind: "shop", slot })),
        text: `Compre ${row.unit?.name ?? ""}${row.copy?.text ? ` (${row.copy.text})` : ""}`.trim(),
        // O retrato do campeão vem do ícone; a palavra só confirma a ação.
        short: broke ? "sem ouro" : "Comprar",
        why: row.reason ?? firstLine(shop.title),
        action: broke ? "sem ouro" : shop.buyText,
        icon: {
          kind: "champion",
          id: row.unit?.id ?? null,
          name: row.unit?.name ?? "",
        },
        pulse: !broke,
        probable: shop.probable === true,
      }),
    );
  }
  return out;
}

/** Vereditos de Wisp: prioridade, tom e verbosidade mínima. "pular" só aparece no modo detalhado. */
const WISP = {
  comprar: { priority: 80, tone: "go", pulse: true },
  avaliar: { priority: 60, tone: "amber" },
  pular: { priority: 40, tone: "info", min: "detailed" },
  incerto: { priority: 40, tone: "info" },
};

/** Wisps (fogos-fátuos) na loja: o veredito e o motivo vêm de `core/catalog/wisps.mjs` via `wispsView`. */
function wispHints(view, mk) {
  const out = [];
  for (const w of view.wisps ?? []) {
    const spec = Object.hasOwn(WISP, w.veredito)
        ? WISP[w.veredito]
        : WISP.incerto,
      slot = Number.isInteger(w.slot) ? w.slot : null;
    out.push(
      mk({
        id: `wisp:${slot ?? "x"}:${w.id ?? w.name ?? ""}`,
        category: "wisp",
        priority: spec.priority,
        tone: spec.tone,
        anchors: slot === null ? [] : [{ kind: "shop", slot }],
        text: `Wisp ${w.name ?? ""}: ${w.vereditoTexto ?? w.veredito ?? "incerto"}`,
        short: w.vereditoTexto ?? w.veredito ?? "?",
        why: w.motivo,
        icon: { kind: "wisp", id: w.id ?? null, name: w.name ?? "" },
        pulse: !!spec.pulse,
        min: spec.min,
      }),
    );
  }
  return out;
}

const ROLL_TONE = { go: "go", danger: "danger" };

/** Rolagem, nível e juros: o veredito do servidor (rolar, esperar, segurar) e os cartões passivos de ouro e nível. */
function goldHints(view, mk) {
  const out = [],
    roll = view.roll,
    spend = roll?.spend;
  if (spend && spend.gold > 0) {
    const why = [
      roll.reason,
      roll.interest
        ? `Rolar derruba os juros de +${roll.interest.from} para +${roll.interest.to} por rodada.`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    out.push(
      mk({
        id: "gold:roll",
        category: "gold",
        priority: 70,
        tone: ROLL_TONE[roll.tone] ?? "amber",
        anchors: [{ kind: "gold" }],
        text: `Role até ${spend.gold}g`,
        short: `${spend.gold}g${spend.keep != null ? ` ⚑${spend.keep}g` : ""}`,
        why,
        action: spend.keep != null ? `pare em ${spend.keep}g` : null,
        icon: glyphIcon("coin", "Rolar"),
        pulse: true,
      }),
    );
  } else if (roll?.kind === "wait") {
    out.push(
      mk({
        id: "gold:wait",
        category: "gold",
        priority: 70,
        tone: "amber",
        anchors: [{ kind: "level" }],
        text:
          roll.at != null
            ? `Vale esperar o nível ${roll.at}`
            : "Vale esperar o próximo nível",
        short: roll.at != null ? `Nv ${roll.at}` : "Nv +1",
        why: roll.reason,
        icon: glyphIcon("clock", "Esperar"),
      }),
    );
  } else if (["hold", "blocked", "none"].includes(roll?.kind)) {
    out.push(
      mk({
        id: "gold:hold",
        category: "gold",
        priority: 40,
        tone: "info",
        anchors: [{ kind: "gold" }],
        text: "Não role",
        short: "não role",
        why: roll.reason,
        icon: glyphIcon("pause", "Não rolar"),
      }),
    );
  }
  const interest = count(view.bar?.gold?.interest);
  if (interest !== null && interest > 0)
    out.push(
      mk({
        id: "gold:interest",
        category: "gold",
        priority: 30,
        tone: "info",
        anchors: [{ kind: "gold" }],
        text: `Juros: +${interest}g por rodada`,
        short: `+${interest}g`,
        action:
          view.economy?.next != null
            ? `próximo patamar em ${view.economy.next}g`
            : null,
        icon: glyphIcon("coin", "Juros"),
        min: "normal",
      }),
    );
  const level = view.level;
  if (level?.go)
    out.push(
      mk({
        id: "level:up",
        category: "gold",
        priority: 75,
        tone: "go",
        anchors: [{ kind: "level" }],
        text: "Suba de nível",
        short: level.cost != null ? `Nv↑ ${level.cost}g` : "Nv↑",
        why: level.text,
        action: level.cost != null ? `${level.cost}g` : null,
        icon: glyphIcon("up", "Subir de nível"),
        pulse: true,
      }),
    );
  const shown = view.bar?.level?.text ?? count(level?.level);
  if (shown != null)
    out.push(
      mk({
        id: "level:seal",
        category: "gold",
        priority: 20,
        tone: "info",
        anchors: [{ kind: "level" }],
        text: `Nível ${shown}${view.bar?.xp?.text ? ` · XP ${view.bar.xp.text}` : ""}`,
        short: `Nv ${shown}`,
        icon: glyphIcon("up", "Nível"),
        min: "detailed",
      }),
    );
  return out;
}

/** Itens: passar (do banco ou de outro campeão), equipar o que já dá e montar o próximo item. */
function itemHints(view, mk) {
  const out = [],
    bank = [{ kind: "bank" }],
    items = view.items;
  for (const row of items?.moves ?? [])
    for (const m of row.moves ?? [])
      out.push(
        mk({
          id: `move:${m.item?.id ?? m.item?.name}>${m.to?.id ?? m.to?.name}`,
          category: "items",
          priority: row.now ? 65 : 35,
          tone: row.now ? "go" : "info",
          anchors: bank,
          text: `Passe ${m.item?.name ?? ""} de ${row.from?.name ?? ""} para ${m.to?.name ?? ""}`,
          // Nomes viram retratos no desenho: [item] [de] → [para].
          short: `${m.item?.name ?? ""} ${row.from?.name ?? ""} → ${m.to?.name ?? ""}`,
          why: row.method,
          action: row.now ? "passar agora" : null,
          icon: {
            kind: "item",
            id: m.item?.id ?? null,
            name: m.item?.name ?? "",
          },
          pulse: row.now === true,
        }),
      );
  for (const r of items?.equip ?? []) {
    if (!r.inField) continue;
    const list = r.kind === "equip" ? r.items : [r.item],
      target = r.kind === "equip" ? r.unit : r.to;
    if (!target || !list?.length) continue;
    out.push(
      mk({
        id:
          r.kind === "equip"
            ? `equip:${target.id ?? target.name}`
            : `equip:${target.id ?? target.name}:${list[0].id ?? list[0].name}`,
        category: "items",
        priority: 60,
        tone: "go",
        anchors: bank,
        text: `Equipe ${names(list)} em ${target.name ?? ""}`,
        short: `${names(list)} → ${target.name ?? ""}`,
        why: r.kind === "bank" ? r.reason : null,
        icon: {
          kind: "item",
          id: list[0].id ?? null,
          name: list[0].name ?? "",
        },
        pulse: true,
      }),
    );
  }
  for (const r of items?.next ?? []) {
    out.push(
      mk({
        id: `next:${r.unit?.id ?? r.key}`,
        category: "items",
        priority: r.complete ? 55 : 30,
        tone: r.complete ? "go" : "info",
        anchors: bank,
        text: `Monte ${r.item?.name ?? ""} em ${r.unit?.name ?? ""}`,
        short: `${r.item?.name ?? ""} → ${r.unit?.name ?? ""}`,
        action: r.note,
        icon: {
          kind: "item",
          id: r.item?.id ?? null,
          name: r.item?.name ?? "",
        },
        parts: (r.parts ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          state: p.state,
        })),
        pulse: r.complete === true,
      }),
    );
  }
  return out;
}

/** "Aprender": os textos explicativos que o servidor já entrega, sem porquê separado. Categoria desligada por padrão. */
function learnHints(view, mk) {
  const sources = [
    ["economy", view.economy?.text, "gold"],
    ["level", view.level?.text, "level"],
    ["roll", view.roll?.text, "gold"],
  ];
  return sources
    .filter(([, t]) => text(t))
    .map(([id, t, kind]) =>
      mk({
        id: `learn:${id}`,
        category: "learn",
        priority: 20,
        tone: "info",
        anchors: [{ kind }],
        text: t,
      }),
    );
}

/** Roda um gerador sem deixar um dado estranho do servidor derrubar a tela: ele só deixa de dar dicas. */
const safely = (gen, view, mk) => {
  try {
    return gen(view, mk);
  } catch {
    return [];
  }
};

/* ---------- Filtro ---------- */

/** Ordem estável: prioridade maior primeiro, depois `id`. */
const byPriority = (a, b) =>
  b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A dica cabe na verbosidade? `minVerbosity` manda quando existe; senão vale o piso de prioridade. */
function fits(hint, verbosity) {
  if (hint.category === "learn") return true;
  if (hint.minVerbosity) return rank(verbosity) >= rank(hint.minVerbosity);
  return hint.priority >= LIMITS[verbosity].floor;
}

/** Aplica categorias, verbosidade e teto. `alert` nunca é filtrado nem cortado; o teto conta as dicas de alerta. */
function select(hints, settings) {
  const s = parseHintSettings(settings),
    limit = LIMITS[s.verbosity],
    sorted = (Array.isArray(hints) ? hints : [])
      .filter((h) => h && typeof h === "object")
      .sort(byPriority),
    alerts = sorted.filter((h) => h.category === "alert"),
    enabled = sorted.filter(
      (h) => h.category !== "alert" && s.categories[h.category] === true,
    ),
    fitting = enabled.filter((h) => fits(h, s.verbosity)),
    shown = fitting.slice(0, Math.max(0, limit.max - alerts.length));
  return {
    shown: [...alerts, ...shown].sort(byPriority),
    // Cortadas pela verbosidade ou pelo teto; categorias que o jogador desligou não contam como "ocultas".
    hidden: enabled.length - shown.length,
  };
}

/**
 * Aplica categorias, verbosidade e teto a uma lista de dicas e as devolve ordenadas por prioridade (desempate por
 * `id`). Minimal: prioridade 70 ou mais, no máximo 3; normal: 40 ou mais, até 5; detailed: tudo, até 8. `alert` nunca é
 * cortado; `learn`, quando ligada, ignora o piso de prioridade.
 */
export function filterHints(hints, settings) {
  return select(hints, settings).shown;
}

/**
 * Dicas do momento. Só existem com o modelo de tela pronto e a partida ao vivo; fora disso a lista é vazia.
 * Devolve `{ hints, total, hidden }`: `total` = quantas dicas foram geradas; `hidden` = quantas das categorias ligadas
 * o filtro de verbosidade deixou de fora.
 */
export function buildHints(view, settings) {
  const none = { hints: [], total: 0, hidden: 0 };
  if (!view || view.status !== "ready" || view.bar?.live?.kind !== "live")
    return none;
  const stale = view.dim === true,
    mk = (h) => make(h, stale),
    seen = new Set(),
    all = [alertHints, buyHints, wispHints, goldHints, itemHints, learnHints]
      .flatMap((gen) => safely(gen, view, mk))
      .filter((h) => !seen.has(h.id) && seen.add(h.id));
  const { shown, hidden } = select(all, settings);
  return { hints: shown, total: all.length, hidden };
}
