import { esc } from "../dom.js";
import { formatDuration, placeTone, sortUnits } from "../history.js";
import { getCatalog, glyph, itemPortrait, portrait, stars } from "./glyphs.js";

/** Faixa da colocação: texto do selo e tom do chip (a cor nunca é o único canal). */
const BAND = {
  win: { label: "Vitória", tone: "gold" },
  top: { label: "Top 4", tone: "go" },
  bottom: { label: "Fora do top 4", tone: "" },
  unknown: { label: "Colocação não observada", tone: "amber" },
};

/**
 * Partida encerrada: no lugar das ações da partida que acabou, só a colocação, a duração e o tabuleiro
 * final. O Ao vivo volta sozinho quando a próxima começar. O registro vem do histórico; enquanto ele
 * não existe, o tabuleiro sai da última leitura do arquivo.
 */
export function mountEnded(root) {
  let drawn = "";
  return {
    update({ status, rec }) {
      if (!status.ended) return;
      const last = status.lastMatch,
        record =
          last && String(last.gameId) === String(status.gameId)
            ? last
            : {
                placement: status.placement,
                durationSeconds: null,
                units: (rec?.self?.units ?? []).map((u) => ({
                  id: u.championName,
                  stars: u.starLevel,
                  items: u.itemNames ?? [],
                })),
              };
      const key = JSON.stringify([record, !!status.awaitingFinal]);
      if (key === drawn) return;
      drawn = key;
      const { champions } = getCatalog(),
        p = record.placement,
        tone = placeTone(p),
        band = BAND[tone],
        units = sortUnits(record.units ?? [], champions),
        time = formatDuration(record.durationSeconds);
      root.dataset.tone = tone;
      root.innerHTML = `
        <div class="ended-hero">
          <h2 class="ended-place" id="ended-title"><b>${p >= 1 ? `${p}º` : "—"}</b> <span>${p >= 1 ? "lugar" : "sem colocação"}</span></h2>
          <div class="ended-meta">
            <p class="eyebrow">Partida encerrada</p>
            <p class="ended-tags"><span class="chip"${band.tone ? ` data-tone="${band.tone}"` : ""}>${esc(band.label)}</span>${time ? `<span class="ended-time">${glyph("clock")}${esc(time)}</span>` : ""}</p>
            ${p >= 1 ? "" : `<p class="ended-note">${status.awaitingFinal ? "Aguardando o tabuleiro final para registrar a colocação." : "O jogo não publicou a colocação desta partida."}</p>`}
          </div>
        </div>
        <section class="ended-final" aria-labelledby="ended-board-title">
          <h3 class="eyebrow" id="ended-board-title">Tabuleiro final</h3>
          ${
            units.length
              ? `<ul class="ended-board">${units
                  .map((u) => {
                    const c = champions.get(u.id);
                    return `<li style="--ring-c:var(--cost-${c?.cost ?? 1})">${portrait(u.id, c?.name ?? u.id, { size: 48 })}<b>${stars(u.stars)}</b><span>${(u.items ?? []).map((i) => itemPortrait({ id: i }, { size: 18 })).join("")}</span></li>`;
                  })
                  .join("")}</ul>`
              : '<p class="ended-note">Tabuleiro final não registrado.</p>'
          }
        </section>
        <p class="ended-wait"><i aria-hidden="true"></i>O Ao vivo volta sozinho quando a próxima partida começar. <a class="link" href="#historico">Ver no Histórico</a></p>`;
    },
  };
}
