import { esc } from "../dom.js";
import { compItems, planView } from "../comp-items.js";
import { compBuildRows } from "../../../core/items/builds.mjs";
import {
  SORTS,
  STYLES,
  activeTraits,
  disputeLevel,
  filterComps,
  itemUpgrade,
  mergeComps,
  scoreOf,
  sortComps,
} from "../comps.js";
import { compOwnership, ownership } from "../roster.js";
import {
  champName,
  getCatalog,
  glyph,
  itemName,
  itemPortrait,
  portrait,
  traitIcon,
  unitPortrait,
} from "./glyphs.js";
import { nameChip, richText } from "./rich-text.js";

const PREFS = "tft-compass-comps-filters";
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : "—");
const thousands = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")} mil` : String(n);

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? "null");
    if (p && typeof p === "object")
      return {
        query: "",
        style: STYLES.some((s) => s.key === p.style) ? p.style : "",
        sort: SORTS.some((s) => s.key === p.sort) ? p.sort : "score",
      };
  } catch {}
  return { query: "", style: "", sort: "score" };
}
function savePrefs({ style, sort }) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ style, sort }));
  } catch {}
}

// Selo de onde está a peça (roster.js): visto verde = em campo; banco azul = na reserva (também quando há cópia em campo
// e outra na reserva). O texto ("na reserva", "2 cópias: 1 em campo, 1 na reserva") vai na dica e no leitor de tela.
const OWN_BADGE = {
  field: ["badge-mine", "check"],
  reserve: ["badge-bench", "bank"],
  both: ["badge-bench", "bank"],
};
const ownBadge = (o) =>
  OWN_BADGE[o.state]
    ? `<i class="badge-own ${OWN_BADGE[o.state][0]}" title="${esc(o.text)}">${glyph(OWN_BADGE[o.state][1])}${o.state === "both" ? `<b aria-hidden="true">${o.reserve.pieces}</b>` : ""}</i>`
    : "";
/** "4/9 em campo · +1 na reserva" do cartão (compOwnership de roster.js); sem GEP, avisa que a reserva não foi lida. */
export const ownCount = (o) =>
  `<span class="own-count" title="${esc(o.text)}"><b>${o.field}/${o.size}</b> em campo${o.reserve ? ` <b class="own-bench">+${o.reserve}</b> na reserva` : ""}${o.benchKnown ? "" : ' <small class="own-unread">· reserva não lida</small>'}</span>`;

function units(c) {
  const { champions } = getCatalog();
  return [...c.units]
    .sort(
      (a, b) =>
        (champions.get(b)?.cost ?? 0) - (champions.get(a)?.cost ?? 0) ||
        (b === c.carry) - (a === c.carry),
    )
    .map((id) => {
      const ch = champions.get(id),
        carry = id === c.carry,
        o = ownership(c.roster ?? null, id),
        cls = [
          o.state === "field" || o.state === "both" ? "is-mine" : "",
          o.state === "reserve" ? "is-bench" : "",
          carry ? "is-carry" : "",
        ]
          .filter(Boolean)
          .join(" ");
      return `<li class="${cls}" data-own="${o.state}" style="--ring-c:var(--cost-${ch?.cost ?? 1})">${portrait(id, ch?.name ?? id, { size: 38, badge: `${carry ? `<i class="badge-carry" title="Carry">${glyph("crown")}</i>` : ""}${ownBadge(o)}` })}<span class="comp-unit-name">${esc(ch?.name ?? id)}</span>${carry ? '<span class="sr"> (carry)</span>' : ""}${o.label ? `<span class="sr"> (${esc(o.text)})</span>` : ""}</li>`;
    })
    .join("");
}

const num = (v, d = 2) => v.toFixed(d).replace(".", ",");
const signed = (v) => `${v > 0 ? "+" : "−"}${num(Math.abs(v))}`;
// Itens que o motor encontrou com você (prontos ou montáveis) para as builds desta comp.
const heldItems = (c) =>
  new Set((c.fit?.itemGains ?? []).flatMap((g) => [...g.ready, ...g.craft]));

function details(c) {
  const held = heldItems(c),
    { champions } = getCatalog(),
    // Builds publicadas das peças da comp, carry primeiro: o motor único de itens (core/items/builds.mjs) é a fonte que
    // Ao vivo, Formação, overlay, carrossel e loja também usam.
    builds = compBuildRows(c);
  const rows = builds
    .map(({ championId: id, items, delta, n }) => {
      const ch = champions.get(id);
      return `<li>${portrait(id, ch?.name ?? id, { size: 28 })}<b>${esc(ch?.name ?? id)}</b><span class="comp-items">${items.map((i) => `<span class="comp-item${held.has(i) ? " is-held" : ""}" title="${esc(itemName(i))}${held.has(i) ? " · você tem ou monta" : ""}">${itemPortrait({ id: i }, { size: 26 })}</span>`).join("")}</span>${delta !== null ? `<small class="comp-build-stat" title="Variação publicada da colocação com esta build, contra outras builds de 3 itens neste campeão na comp">${signed(delta)} · ${thousands(n ?? 0)} partidas</small>` : ""}</li>`;
    })
    .join("");
  const stars3 = (c.stars3 ?? [])
    .map((id) =>
      nameChip("champion", id, champions.get(id)?.name ?? id, { size: 24 }),
    )
    .join(" ");
  return `${rows ? `<ul class="comp-builds">${rows}</ul><p class="comp-build-note">A fonte publica só a melhor build de cada campeão; a variação vem inflada e o motor a usa com desconto.</p>` : '<p class="muted">Sem builds publicadas para esta comp.</p>'}${stars3 ? `<p class="comp-3star"><b>3★:</b> ${stars3}</p>` : ""}`;
}

const BANK_TEXT = {
  on: () => "equipado",
  ready: () => "pronto no banco",
  radiant: () => "radiante no banco",
  craft: () => "monta agora",
  half: (r) => `falta ${r.missing.map((id) => itemName(id)).join(" + ")}`,
  missing: (r) => (r.recipe.length ? "falta montar" : "não está no banco"),
};
const bankItem = (r, { unit, champions, trait = null }) => {
  const parts =
      r.recipe.length && ["craft", "half", "missing"].includes(r.state)
        ? `<span class="cb-recipe">${r.recipe.map((id) => `<span class="${r.state === "missing" || r.missing.includes(id) ? "miss" : "got"}">${itemPortrait({ id }, { size: 18 })}</span>`).join("")}</span>`
        : "",
    text = r.state === "unread" ? "" : BANK_TEXT[r.state](r);
  return `<li${trait ? ` class="cb-emblem" data-trait="${esc(trait)}"` : ""} data-state="${r.state}" title="${esc(`${itemName(r.want ?? r.id)}${text ? " · " + text : ""}`)}">${unit ? portrait(unit, champions.get(unit)?.name ?? unit, { size: 20 }) : ""}${itemPortrait({ id: r.want ?? r.id }, { size: 30 })}${parts}${text ? `<small>${richText(text, { size: 16 })}</small>` : ""}${trait ? `<em>${esc(trait)}</em>` : ""}</li>`;
};

/**
 * Itens do banco que combinam com o carry da comp (ver comp-items.js): a build publicada do carry com o que está pronto,
 * equipado, monta agora ou falta; emblemas que dão ao carry uma sinergia da comp; peças com algo do banco; e o que ficou de fora.
 * `r` é o resultado de `compItems`; sem leitura do banco, mostra só a build do carry.
 */
export function compItemsBlock(r, champions = getCatalog().champions) {
  const [carry, ...others] = r.units;
  if (!carry) return "";
  const rows = (u) =>
      u.rows.map((row) =>
        bankItem(r.read ? row : { ...row, state: "unread" }, {
          unit: null,
          champions,
        }),
      ),
    emblems = r.emblems.map((e) =>
      bankItem(e, { unit: null, champions, trait: e.trait }),
    ),
    more = others.filter(
      (u) => r.read && u.rows.some((x) => x.state !== "missing"),
    ),
    unused = r.unused.length
      ? `<span class="cb-unused" title="${esc(r.unused.map((u) => `${itemName(u.id)}: ${u.reason}`).join("\n"))}">${r.unused.length} do banco sem uso nesta comp</span>`
      : "",
    left = r.excluded.length
      ? `<span class="cb-unused" title="${esc(r.excluded.map(itemName).join(", "))}">${r.excluded.length} consumível${r.excluded.length === 1 ? "" : "is"} fora da lista (não é para montar)</span>`
      : "";
  return `<div class="comp-bank" data-read="${r.read}">
    <p class="cb-head">${glyph("items")}<span>${r.read ? "Seus itens no carry" : "Itens ideais do carry (banco não lido)"}</span>${portrait(carry.unit, champions.get(carry.unit)?.name ?? carry.unit, { size: 22 })}</p>
    <ul class="cb-list" aria-label="Itens do carry">${rows(carry).join("")}${emblems.join("")}</ul>
    ${more.map((u) => `<ul class="cb-list cb-other" aria-label="Itens de ${esc(champions.get(u.unit)?.name ?? u.unit)}">${u.rows.map((row) => bankItem(row, { unit: u.unit, champions })).join("")}</ul>`).join("")}
    ${unused || left ? `<p class="cb-foot">${unused}${left}</p>` : ""}
  </div>`;
}

// Plano de itens do motor (item-plan.mjs): o que fazer com cada item, em texto (nomes de campeões viram imagem em richText).
const planText = (a) => {
  switch (a.kind) {
    case "on":
      return "equipado";
    case "bank":
      return "no banco";
    case "move":
    case "moveStay":
      return a.from ? `mover de ${a.from}` : "mover";
    case "craft":
      return "montar";
    case "craftMove":
      return a.from ? `montar com peças de ${a.from}` : "montar";
    default:
      return a.situation ?? "";
  }
};
// Componentes em imagem (a receita do item que falta montar ou ainda não se tem).
const recipeImages = (ids = []) =>
  ids?.length
    ? `<span class="cb-recipe">${ids.map((id) => `<span class="got">${itemPortrait({ id }, { size: 18 })}</span>`).join("")}</span>`
    : "";
// Valor em colocações: menor é melhor, como o resto da aba ("média 4,10 (−0,12)").
const placing = (v) => (Number.isFinite(v) ? signed(-v) : "—");
const planItem = (a) => {
  const name = a.item.name ?? itemName(a.item.id),
    text = planText(a),
    weak = !(a.confidence >= 0.5),
    basis = [
      Number.isFinite(a.samples) ? `${thousands(a.samples)} partidas` : "",
      a.source === "build-meta" ? "estimado pela build de meta" : "",
    ].filter(Boolean);
  return `<li data-state="${esc(a.kind)}"${weak ? ' data-weak=""' : ""} title="${esc(`${name}: ${text}${a.item.radiant ? " (radiante)" : ""}. Melhora ${num(a.value)} na colocação (medido ${num(a.measured)}${basis.length ? "; " + basis.join(", ") : ""})`)}">${itemPortrait({ id: a.item.id, name }, { size: 30 })}${recipeImages(a.componentsNeeded)}<small><b>${placing(a.value)}</b> · ${richText(text, { size: 16 })}${a.item.radiant ? " · radiante" : ""}</small></li>`;
};
// Item da lista de desejos: da build publicada da comp (`source: "build-comp"`, como em "Builds e 3★") ou, sem ela, da
// reserva medida. Sem valor medido do par campeão × item, só o item.
const wishItem = (w) => {
  const name = w.item.name ?? itemName(w.item.id),
    fromComp = w.source === "build-comp",
    measured = Number.isFinite(w.value)
      ? `melhora ${num(w.value)} na colocação (medido${Number.isFinite(w.samples) ? `, ${thousands(w.samples)} partidas` : ""})`
      : "sem medição do par",
    title = `${name}: ${fromComp ? "da build publicada da comp" : "reserva"}; ${measured}`;
  return `<li${fromComp ? "" : ' data-reserve="1"'} title="${esc(title)}">${itemPortrait({ id: w.item.id, name }, { size: 26 })}${recipeImages(w.componentsNeeded)}<small>${placing(w.value)}</small></li>`;
};

/**
 * Plano de itens da comp (`fit.itemPlan` do motor): os itens que você tem, distribuídos pelos campeões de maior impacto
 * (vários carries), cada um com o estado (equipado, no banco, mover de quem, montar com os componentes em imagem) e o valor;
 * os valores somam por campeão e no total. A lista de desejos (o que o meta valoriza e você ainda não tem) vem separada.
 * Sem leitura do banco não há atribuição: só o aviso e a lista de desejos. `emblems` são os emblemas do banco úteis à comp.
 */
export function itemPlanBlock(
  plan,
  champions = getCatalog().champions,
  { id = "", openWish = false, emblems = [] } = {},
) {
  const v = planView(plan);
  if (!v) return "";
  const groups = v.groups
      .map(
        (g, i) =>
          `<li class="cp-champ" data-rank="${i + 1}"><div class="cp-who">${nameChip("champion", g.champion.id, g.champion.name ?? champName(g.champion.id), { size: 30, legend: true })}<span class="cp-sum" title="Soma dos itens deste campeão; acumulado até aqui no plano"><b>${placing(g.total)}</b><small>acumulado ${placing(g.acc)}</small></span></div><ul class="cp-items" aria-label="Itens de ${esc(g.champion.name ?? g.champion.id)}">${g.items.map(planItem).join("")}</ul></li>`,
      )
      .join(""),
    wish = v.wishlist
      .map(
        (w) =>
          `<li class="cp-wish-champ">${nameChip("champion", w.champion.id, w.champion.name ?? champName(w.champion.id), { size: 26, legend: true })}<ul class="cp-items cp-wish-items">${w.items.map(wishItem).join("")}</ul></li>`,
      )
      .join(""),
    wishTitle = `Lista de desejos: o que falta da build de cada campeão (a da comp; sem ela, a reserva medida) (${v.wishlist.length} campeã${v.wishlist.length === 1 ? "o" : "os"})`,
    wishBlock = !wish
      ? ""
      : v.read
        ? `<details class="cp-wish" data-more="${esc(id)}:wish"${openWish ? " open" : ""}><summary>${esc(wishTitle)}</summary><ul class="cp-wish-list">${wish}</ul></details>`
        : `<div class="cp-wish"><p class="cp-sub">${esc(wishTitle)}</p><ul class="cp-wish-list">${wish}</ul></div>`,
    emblemList =
      v.read && emblems.length
        ? `<ul class="cb-list cp-emblems" aria-label="Emblemas do banco">${emblems.map((e) => bankItem(e, { unit: null, champions, trait: e.trait })).join("")}</ul>`
        : "";
  return `<div class="comp-bank comp-plan" data-read="${v.read}">
    <p class="cb-head">${glyph("items")}<span>${v.read ? "Seus itens nesta comp" : "Itens do meta para esta comp"}</span>${v.read && v.groups.length ? `<b class="cp-total" title="Soma das melhoras medidas dos itens do plano, em colocações (os valores se sobrepõem; no score entram com retorno decrescente)">${placing(v.total)}</b>` : ""}</p>
    ${v.read ? "" : '<p class="cp-note" data-unread="">Banco não lido: sem a leitura do banco não dá para dizer quais dos seus itens vão para quem. Abaixo, só os itens que o meta mais valoriza em cada campeão.</p>'}
    ${v.read && !v.groups.length ? '<p class="cp-note">Nenhum item seu (banco ou tabuleiro) tem valor medido nesta comp.</p>' : ""}
    ${groups ? `<ul class="cp-champs">${groups}</ul>` : ""}
    ${emblemList}
    ${wishBlock}
  </div>`;
}

// Sinergia ativa da comp com o ícone do jogo (máscara tingida); sem ícone, só o texto.
const traitChip = ({ name: trait, count }) => {
  const icon = traitIcon(trait);
  return `<li class="chip">${icon ? `<em class="trait-icon" style="--icon:url('${esc(icon)}')" aria-hidden="true"></em>` : ""}${esc(trait)} ${count}</li>`;
};

/**
 * Estado vazio ou de erro como item de lista (`.state` de components.css): ícone, o que aconteceu e o que fazer.
 * `body` é HTML já escapado por quem chama; `action` é o botão (ou vazio).
 */
export const stateItem = ({ icon, title, body, action = "", tone = "" }) =>
  `<li class="comps-state"><section class="state"${tone ? ` data-tone="${tone}"` : ""}>${glyph(icon)}<h3>${esc(title)}</h3>${body}${action}</section></li>`;
const retryButton = `<button type="button" class="btn btn-go" data-retry>${glyph("roll")}Tentar de novo</button>`;

/**
 * Cartão de uma comp (o mesmo da aba Comps e do modal do HUD). `actions: false` tira o botão de seguir/liberar (o modal
 * tem o dele); `synergies: true` acrescenta as sinergias ativas da comp.
 */
function card(
  c,
  { goalId, open, openWish = false, items, actions = true, synergies = false },
) {
  const pinned = c.id === goalId,
    f = c.fit,
    dispute = disputeLevel(f?.dispute),
    up = itemUpgrade(c),
    sc = scoreOf(c);
  const { champions } = getCatalog();
  // Com o plano de itens do motor (comp avaliada na partida): os itens que você tem distribuídos pelos campeões de maior
  // impacto, mais a lista de desejos. Sem plano (comp fora do ranking ou motor antigo), a build publicada do carry.
  const placed = compItems(c, items),
    bank = f?.itemPlan
      ? itemPlanBlock(f.itemPlan, champions, {
          id: c.id,
          openWish,
          emblems: placed.read ? placed.emblems : [],
        })
      : compItemsBlock(placed, champions);
  // Com seus itens: nova média esperada e de onde vem (campeão e itens da build que você tem ou monta).
  const edge = up
    ? `<p class="comp-edge">${glyph("items")}<span>Com seus itens: média <b>${num(up.avg)}</b> (${signed(-up.gain)})</span><small>${f.itemGains
        .map(
          (g) =>
            `${nameChip("champion", g.unit, champions.get(g.unit)?.name ?? g.unit, { size: 18 })}: ${[
              ...g.ready.map((i) =>
                nameChip("item", i, itemName(i), { size: 18 }),
              ),
              ...g.craft.map(
                (i) =>
                  `${nameChip("item", i, itemName(i), { size: 18 })} (montar)`,
              ),
            ].join(" ")}`,
        )
        .join(" · ")}</small></p>`
    : "";
  // O critério: a vitória esperada (W, a medida que ordena as comps), a colocação esperada ao lado e, quando o motor
  // manda, a linha do porquê.
  const fit = f
    ? [
        Number.isFinite(f.win)
          ? `<span class="chance" title="Chance de terminar em 1º com esta comp, para você agora: a vitória medida na MetaTFT da comp com as suas peças, a estrela que você alcança na peça-chave e os seus itens nos campeões certos, pesada pela chance de montá-la no prazo. Maior é melhor; é ela que ordena as comps."><b>${String(Math.round(f.win * 10) / 10).replace(".", ",")}%</b> de vitória</span>`
          : "",
        Number.isFinite(f.expected)
          ? `<span title="Colocação esperada para você com esta comp (a mesma conta, em colocação média). Menor é melhor; é informação, não ordena."><b>${String(Math.round(f.expected * 10) / 10).replace(".", ",")}º</b> esperado</span>`
          : sc?.chance != null
            ? `<span class="chance" title="Chance de achar as peças principais que faltam com o seu nível${sc.level ? " " + sc.level : ""} e as lojas ao alcance">chance de montar <b>${sc.chance}%</b></span>`
            : "",
        c.roster
          ? ownCount(compOwnership(c.roster, c.units))
          : `<span><b>${f.owned}/${f.size}</b> já em campo</span>`,
        f.carryWanted
          ? `<span>itens do carry <b>${Math.floor(f.carryItems)}/${f.carryWanted}</b></span>`
          : "",
        dispute
          ? `<span class="dispute" data-level="${dispute}">disputa ${dispute}</span>`
          : "",
      ]
        .filter(Boolean)
        .join("") +
      (f.why ? `<span class="comp-why">${richText(f.why)}</span>` : "")
    : '<span class="muted">Encaixe indisponível nesta leitura</span>';
  // O cartão fixado ganha o tom âmbar do `.card`, mas só na lista (no modal a moldura some e o rodapé já diz "Escolhida").
  return `<li class="comp card" data-id="${esc(c.id)}"${pinned ? ` data-pinned=""${actions ? ' data-tone="amber"' : ""}` : ""}>
    <header class="comp-head">
      ${sc ? `<span class="score" data-band="${sc.band}" title="Score 0-100: a colocação esperada (E) numa régua (2º = 100, 6º = 0). E já leva a força da comp, os seus itens, o que você já tem dela, a chance de montá-la no prazo e a disputa.">${sc.score}</span>` : '<span class="score" data-band="none" title="O score aparece com uma leitura do tabuleiro">—</span>'}
      <h3>${richText(c.title, { size: 22 })}</h3>
      <div class="comp-tags">
        <span class="chip">${esc(c.style.label)}</span>
        ${c.match ? `<span class="chip" title="Sinergia ativa nesta comp">${esc(c.match.name)} ×${c.match.count}</span>` : ""}
        ${sc?.best ? '<span class="chip chip-best" title="Maior score para você agora">Melhor comp</span>' : f?.suggested ? '<span class="chip chip-go" title="Entre as 3 sugeridas para esta partida">Sugerida</span>' : ""}
        ${pinned ? `<span class="chip chip-amber">${glyph("flag")} Seguindo</span>` : ""}
      </div>
    </header>
    <ul class="comp-units" aria-label="Campeões da comp">${units(c)}</ul>
    ${synergies ? `<ul class="comp-traits" aria-label="Sinergias ativas">${activeTraits(c, champions, getCatalog().traits).map(traitChip).join("")}</ul>` : ""}
    <p class="comp-stats"><span>média <b>${c.avg.toFixed(2)}</b></span><span>top 4 <b>${pct(c.top4)}</b></span><span>1º <b>${pct(c.win)}</b></span><span>${thousands(c.games)} partidas</span></p>
    <p class="comp-fit">${fit}</p>
    ${bank}
    ${edge}
    <div class="comp-actions">
      ${actions ? (pinned ? `<button type="button" class="btn" data-release>${glyph("x")}Liberar</button>` : `<button type="button" class="btn ${sc?.best ? "btn-solid" : "btn-go"}" data-pick="${esc(c.id)}">${glyph("flag")}Seguir esta comp</button>`) : ""}
      <details class="comp-more" data-more="${esc(c.id)}"${open ? " open" : ""}><summary>Builds e 3★</summary>${details(c)}</details>
    </div>
  </li>`;
}
export { card as compCard };

/**
 * Contexto dos cartões a partir dos dados da tela de comps (`update` de `mountComps`): as comps de meta já juntas ao
 * encaixe da partida, o banco/equipados para o plano de itens e o catálogo. Usado pela aba Comps e pelo modal do HUD.
 */
export function compsContext(data) {
  const { champions, traits, items } = getCatalog();
  return {
    all: mergeComps(data.comps ?? [], data.ranking ?? []).map((c) => ({
      ...c,
      // Onde está cada peça sua (campo e reserva do GEP): roster.js, a mesma regra do modal, do HUD e do Ao vivo.
      roster: data.roster ?? null,
    })),
    items: {
      bank: data.bank ?? null,
      equipped: data.equipped ?? {},
      items: items ?? new Map(),
      champions,
      breakpoints: traits,
    },
    champions,
    traits,
  };
}

/**
 * Tela de seleção de comp. `onPick(id)` fixa uma comp; `onRelease()` volta às sugestões automáticas.
 * `update({comps, ranking, autoTitle, roster, bank, equipped, goalId, source})` redesenha só quando algo visível mudou;
 * `roster` é o de `rosterOf` (roster.js): suas peças em campo e na reserva;
 * `bank` é o banco de itens lido (null sem fonte) e `equipped`, {campeão: itens} do seu tabuleiro.
 */
export function mountComps(root, { onPick, onRelease }) {
  const $ = (id) => root.querySelector(`#${id}`),
    prefs = loadPrefs(),
    openIds = new Set();
  let data = null,
    drawn = "";

  $("comps-style").innerHTML = STYLES.map(
    (s) =>
      `<button type="button" data-style="${s.key}" aria-pressed="${s.key === prefs.style}">${s.label}</button>`,
  ).join("");
  $("comps-sort").innerHTML = SORTS.map(
    (s) =>
      `<option value="${s.key}"${s.key === prefs.sort ? " selected" : ""}>${s.label}</option>`,
  ).join("");

  const changed = () => {
    savePrefs(prefs);
    drawn = "";
    draw();
  };
  // O contador vive dentro da barra de filtros (fixa ao rolar); o aviso de encaixe fica logo acima da grade.
  const hint = document.createElement("p");
  hint.className = "comps-hint";
  root.querySelector(".comps-filters")?.append($("comps-count"));
  $("comps-grid").before(hint);
  $("comps-grid").setAttribute("aria-label", "Comps de meta");

  let typing = 0;
  /** Volta a mostrar todas as comps (busca e estilo); a ordenação escolhida continua. */
  const clearFilters = () => {
    clearTimeout(typing);
    prefs.query = "";
    prefs.style = "";
    $("comps-q").value = "";
    for (const x of $("comps-style").children)
      x.setAttribute("aria-pressed", String(x.dataset.style === ""));
    changed();
  };
  $("comps-q").addEventListener("input", (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      prefs.query = e.target.value;
      changed();
    }, 120);
  });
  $("comps-style").addEventListener("click", (e) => {
    const b = e.target.closest("[data-style]");
    if (!b) return;
    prefs.style = b.dataset.style;
    for (const x of $("comps-style").children)
      x.setAttribute("aria-pressed", String(x === b));
    changed();
  });
  $("comps-sort").addEventListener("change", (e) => {
    prefs.sort = e.target.value;
    changed();
  });
  root.addEventListener(
    "toggle",
    (e) => {
      const id = e.target.dataset?.more;
      if (id) e.target.open ? openIds.add(id) : openIds.delete(id);
    },
    true,
  );
  root.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) onPick(pick.dataset.pick);
    if (e.target.closest("[data-release]")) onRelease();
    if (e.target.closest("[data-clear]")) clearFilters();
    // O main.js escuta o pedido e recarrega a lista de comps.
    if (e.target.closest("[data-retry]"))
      document.dispatchEvent(
        new CustomEvent("tft:retry", { detail: { view: "comps" } }),
      );
  });

  /** Foco que sobrevive ao redesenho da grade: guarda um seletor do controle ativo e o restabelece depois. */
  function focusKeeper() {
    const a = document.activeElement;
    if (!a || !$("comps-grid").contains(a)) return () => {};
    const card = a.closest(".comp")?.dataset.id,
      sel =
        a.matches("summary") && a.parentElement?.dataset.more
          ? `details[data-more="${CSS.escape(a.parentElement.dataset.more)}"] > summary`
          : card && a.matches("[data-pick]")
            ? `.comp[data-id="${CSS.escape(card)}"] [data-pick]`
            : null;
    return () => sel && $("comps-grid").querySelector(sel)?.focus();
  }

  function draw() {
    if (!data) return;
    const { champions, traits, items: itemsCtx, all } = compsContext(data),
      list = sortComps(filterComps(all, prefs, champions, traits), prefs.sort),
      goal = all.find((c) => c.id === data.goalId) ?? null,
      // Título do plano que o Ao vivo mostra (vem de main.js), não deduzido do ranking.
      auto = data.autoTitle ?? null;
    const key = JSON.stringify([
      list.map((c) => [c.id, c.fit]),
      data.goalId,
      auto,
      data.swapCount,
      data.roster,
      data.bank,
      data.equipped,
      data.source,
      data.lobby,
    ]);
    if (key === drawn) return;
    drawn = key;
    $("comps-source").innerHTML = data.source
      ? `<span class="chip" title="Estatísticas de partidas publicadas">${esc(data.source)}</span>`
      : "";
    $("comps-goal").innerHTML = goal
      ? `${glyph("flag")}<p>Seguindo <b>${richText(goal.title)}</b>${data.swapCount ? ` com ${data.swapCount} substituição(ões)` : ""}. O Ao vivo, as trocas e a economia usam esta comp ${data.lobby ? "até você liberar ou a próxima partida começar (a escolha do lobby não passa para a partida)" : "até você liberar ou a partida acabar"}.</p><button type="button" class="btn" data-release>Liberar</button>`
      : `${glyph("roll")}<p>Automático: o Ao vivo segue a melhor sugestão da leitura${auto ? ` (agora <b>${richText(auto)}</b>)` : ""}, que pode mudar a cada leitura. Fixe uma comp para manter a direção.</p>`;
    $("comps-goal").dataset.pinned = goal ? "1" : "0";
    $("comps-count").textContent = `${list.length} de ${all.length} comps`;
    hint.textContent = data.ranking.length
      ? ""
      : "O encaixe na partida aparece quando houver uma leitura do tabuleiro.";
    const restore = focusKeeper();
    $("comps-grid").innerHTML = list.length
      ? list
          .map((c) =>
            card(c, {
              goalId: data.goalId,
              open: openIds.has(c.id),
              openWish: openIds.has(`${c.id}:wish`),
              items: itemsCtx,
            }),
          )
          .join("")
      : all.length
        ? stateItem({
            icon: "inbox",
            title: "Nenhuma comp com esses filtros",
            body: "<p>Tente outro nome de campeão ou sinergia, ou volte a mostrar todos os estilos de nível.</p>",
            action: `<button type="button" class="btn" data-clear>Limpar filtros</button>`,
          })
        : stateItem({
            icon: "inbox",
            title: "Nenhuma comp de meta carregada",
            body: "<p>O servidor não trouxe a lista de comps. Tente de novo em instantes.</p>",
            action: retryButton,
          });
    restore();
  }

  return {
    update(next) {
      data = next;
      draw();
    },
    error(message) {
      // Sem isto, o próximo `update` com os mesmos dados seria ignorado e o erro ficaria na tela.
      drawn = "";
      $("comps-count").textContent = "";
      hint.textContent = "";
      $("comps-grid").innerHTML = stateItem({
        icon: "warn",
        tone: "danger",
        title: "Não foi possível carregar as comps",
        body: `<p>${esc(message)}</p><p>Confira se o servidor do helper está rodando e tente de novo.</p>`,
        action: retryButton,
      });
    },
  };
}
