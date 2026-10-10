import { esc } from "../dom.js";
import {
  activeTraits,
  formatDuration,
  placeTone,
  queueLabel,
  sortUnits,
  summarize,
} from "../history.js";
import { getCatalog, portrait, stars, traitIcon } from "./glyphs.js";

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
// Sinergia com o ícone do jogo (máscara tingida pela cor do patamar); sem ícone, só o texto.
const chip = (t) => {
  const icon = traitIcon(t.name);
  return `<span class="chip" data-tier="${t.tier}">${icon ? `<em class="trait-icon" style="--icon:url('${esc(icon)}')" aria-hidden="true"></em>` : ""}${esc(t.name)} ${t.count}</span>`;
};

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
      .join(" · ");
  return `<li class="match" data-tone="${tone}" data-game="${esc(r.gameId)}" tabindex="0" role="link" title="Rever esta partida no Ao vivo">
    <span class="place" title="${r.placement >= 1 ? `${r.placement}º lugar` : "Colocação não observada"}">${place(r.placement)}</span>
    <div class="match-body">
      <div class="match-head"><small>${esc(meta)}</small>${(r.augments ?? []).map((a) => `<span class="chip aug" title="Aprimoramento marcado na partida">${esc(a.name)}</span>`).join("")}${syn.map(chip).join("")}</div>
      <div class="match-units">${
        units
          .map((u) => {
            const c = champions.get(u.id);
            return `<span class="unit" style="--ring-c:var(--cost-${c?.cost ?? 1})">${portrait(u.id, c?.name ?? u.id, { size: 34 })}<b>${stars(u.stars)}</b></span>`;
          })
          .join("") || '<small class="muted">Tabuleiro não registrado.</small>'
      }</div>
    </div>
  </li>`;
}

/** Tela de histórico: resumo e lista das partidas registradas. */
export function mountHistory(root) {
  const summary = root.querySelector("#history-summary"),
    list = root.querySelector("#history-list");
  const open = (e) => {
    const li = e.target.closest("[data-game]");
    if (li) location.hash = `#partida/${li.dataset.game}`;
  };
  list.addEventListener("click", open);
  list.addEventListener("keydown", (e) => e.key === "Enter" && open(e));
  return {
    update(records) {
      const s = summarize(records);
      summary.innerHTML = [
        ["Partidas", s.games],
        ["Colocação média", s.average == null ? "—" : s.average.toFixed(1)],
        ["Top 4", s.top4 == null ? "—" : `${Math.round(s.top4 * 100)}%`],
        ["Vitórias", s.wins],
      ]
        .map(
          ([label, value]) =>
            `<div class="stat"><span class="eyebrow">${label}</span><strong>${value}</strong></div>`,
        )
        .join("");
      list.innerHTML = records.length
        ? records.map(row).join("")
        : '<li class="history-empty">Nenhuma partida registrada ainda. Cada partida entra aqui quando termina para você.</li>';
    },
    error(message) {
      list.innerHTML = `<li class="history-empty">${esc(message)}</li>`;
    },
  };
}
