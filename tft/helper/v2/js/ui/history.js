import { esc } from "../dom.js";
import {
  activeTraits,
  formatDuration,
  placeTone,
  queueLabel,
  sortUnits,
  summarize,
} from "../history.js";
import { getCatalog, glyph, portrait, stars, traitIcon } from "./glyphs.js";

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
};
const place = (p) => (p >= 1 ? `${p}º` : "?");
const dec = (v, d = 1) => v.toFixed(d).replace(".", ",");
/** Texto do selo por faixa: a cor nunca é o único canal. */
const TONE_LABEL = {
  win: "Vitória",
  top: "Top 4",
  bottom: "Fora do top 4",
  unknown: "Sem colocação",
};
// Sinergia com o ícone do jogo (máscara tingida pela cor do patamar); sem ícone, só o texto.
const chip = (t) => {
  const icon = traitIcon(t.name);
  return `<span class="chip" data-tier="${t.tier}">${icon ? `<em class="trait-icon" style="--icon:url('${esc(icon)}')" aria-hidden="true"></em>` : ""}${esc(t.name)} ${t.count}</span>`;
};

/**
 * Tendência: média das 5 partidas mais recentes contra a das anteriores (o servidor devolve a mais nova primeiro).
 * Só existe com pelo menos 8 partidas com colocação; menor colocação é melhor.
 */
function trend(records) {
  const placed = records
    .map((r) => r.placement)
    .filter((p) => Number.isInteger(p) && p >= 1);
  if (placed.length < 8) return null;
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length,
    recent = avg(placed.slice(0, 5)),
    older = avg(placed.slice(5)),
    delta = older - recent;
  return { delta, recent };
}

function row(r) {
  const { champions, traits, emblems } = getCatalog(),
    tone = placeTone(r.placement),
    units = sortUnits(r.units ?? [], champions),
    syn = activeTraits(units, champions, traits, 4, emblems),
    meta = [
      queueLabel(r.queue),
      formatDuration(r.durationSeconds),
      when(r.endedAt),
    ]
      .filter(Boolean)
      .join(" · "),
    label = `Rever a partida: ${r.placement >= 1 ? `${r.placement}º lugar` : "colocação não observada"}${meta ? `, ${meta}` : ""}`;
  return `<li><a class="match" href="#partida/${encodeURIComponent(r.gameId)}" data-tone="${tone}" aria-label="${esc(label)}">
    <span class="place"><b>${place(r.placement)}</b><small>${TONE_LABEL[tone]}</small></span>
    <span class="match-body">
      <span class="match-head"><small>${esc(meta)}</small>${(r.augments ?? []).map((a) => `<span class="chip" data-tone="violet">${esc(a.name)}</span>`).join("")}${syn.map(chip).join("")}</span>
      <span class="match-units">${
        units
          .map((u) => {
            const c = champions.get(u.id);
            return `<span class="unit" style="--ring-c:var(--cost-${c?.cost ?? 1})">${portrait(u.id, c?.name ?? u.id, { size: 34 })}<b>${stars(u.stars)}</b></span>`;
          })
          .join("") ||
        '<small class="match-none">Tabuleiro não registrado.</small>'
      }</span>
    </span>
    <span class="match-go" aria-hidden="true"><span>Rever</span>${glyph("next")}</span>
  </a></li>`;
}

/** Cartões do resumo: número grande e uma linha que o explica. */
function summaryHtml(records) {
  const s = summarize(records),
    t = trend(records),
    top4n = s.top4 == null ? 0 : Math.round(s.top4 * s.placed);
  const trendHtml = !t
    ? `<small>${s.placed} com colocação</small>`
    : Math.abs(t.delta) < 0.1
      ? "<small>Estável nas últimas 5</small>"
      : `<small data-good="${t.delta > 0 ? "1" : "0"}">${t.delta > 0 ? "▲" : "▼"} ${dec(Math.abs(t.delta))} ${t.delta > 0 ? "melhor" : "pior"} nas últimas 5 (média ${dec(t.recent)})</small>`;
  return [
    ["Partidas", s.games, `<small>${s.placed} com colocação</small>`],
    [
      "Colocação média",
      s.average == null ? "—" : dec(s.average),
      s.average == null ? "<small>Sem colocação observada</small>" : trendHtml,
    ],
    [
      "Top 4",
      s.top4 == null ? "—" : `${Math.round(s.top4 * 100)}%`,
      s.top4 == null
        ? "<small>Sem colocação observada</small>"
        : `<small>${top4n} de ${s.placed}</small>`,
    ],
    [
      "Vitórias",
      s.wins,
      s.placed
        ? `<small>${Math.round((s.wins / s.placed) * 100)}% das partidas</small>`
        : "<small>Sem colocação observada</small>",
    ],
  ]
    .map(
      ([label, value, hint]) =>
        `<div class="card stat"><span class="eyebrow">${label}</span><strong>${value}</strong>${hint}</div>`,
    )
    .join("");
}

const stateHtml = ({ tone = "", name, title, text, action = "" }) =>
  `<section class="state"${tone ? ` data-tone="${tone}" role="alert"` : ""}>${glyph(name)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</section>`;

/** Tela de histórico: resumo e lista das partidas registradas; cada partida abre a revisão em `#partida/<id>`. */
export function mountHistory(root) {
  const summary = root.querySelector("#history-summary"),
    list = root.querySelector("#history-list"),
    box = document.createElement("div");
  box.className = "history-state";
  root.append(box);
  summary.setAttribute("role", "group");
  summary.setAttribute("aria-label", "Resumo das partidas");
  // Carregando: blocos do tamanho do conteúdo final, sem deslocar a tela.
  summary.innerHTML = Array.from(
    { length: 4 },
    () =>
      '<div class="card stat" aria-hidden="true"><div class="skeleton-line"></div></div>',
  ).join("");
  list.innerHTML = Array.from(
    { length: 3 },
    () =>
      '<li class="match-skel" aria-hidden="true"><div class="skeleton-line"></div></li>',
  ).join("");
  list.setAttribute("aria-busy", "true");

  /** Só reescreve o nó quando o HTML mudou (o histórico chega de novo a cada partida registrada). */
  const sigs = new WeakMap();
  const setHtml = (el, html) => {
    if (sigs.get(el) === html) return;
    sigs.set(el, html);
    el.innerHTML = html;
  };
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-retry]"))
      document.dispatchEvent(
        new CustomEvent("tft:retry", { detail: { view: "history" } }),
      );
  });
  return {
    update(records) {
      list.removeAttribute("aria-busy");
      const empty = !records.length;
      summary.hidden = empty;
      list.hidden = empty;
      if (empty) {
        setHtml(
          box,
          stateHtml({
            name: "inbox",
            title: "Nenhuma partida registrada ainda",
            text: "Cada partida entra aqui quando termina para você, com a colocação e o tabuleiro final.",
            action:
              '<p>Deixe o helper aberto na tela Ao vivo durante a próxima partida.</p><a class="btn btn-go" href="#ao-vivo">Ir para o Ao vivo</a>',
          }),
        );
        return;
      }
      setHtml(box, "");
      setHtml(summary, summaryHtml(records));
      setHtml(list, records.map(row).join(""));
    },
    error(message) {
      list.removeAttribute("aria-busy");
      summary.hidden = true;
      list.hidden = true;
      setHtml(
        box,
        stateHtml({
          tone: "danger",
          name: "warn",
          title: "Não foi possível carregar o histórico",
          text: message || "O servidor não respondeu.",
          action: `<p>Confira se o servidor do helper está rodando e tente de novo.</p><button type="button" class="btn btn-go" data-retry>${glyph("roll")}Tentar de novo</button>`,
        }),
      );
    },
  };
}
