import { esc } from "../dom.js";
import { formatDuration, placeTone, sortUnits } from "../history.js";
import { getCatalog, itemPortrait, portrait, stars } from "./glyphs.js";

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
      const key = JSON.stringify(record);
      if (key === drawn) return;
      drawn = key;
      const { champions } = getCatalog(),
        p = record.placement,
        units = sortUnits(record.units ?? [], champions),
        time = formatDuration(record.durationSeconds);
      root.dataset.tone = placeTone(p);
      root.innerHTML = `
        <p class="ended-line"><b id="ended-title">${p >= 1 ? `${p}º` : "Encerrada"}</b>${time ? `<span>${esc(time)}</span>` : ""}<span class="ended-wait" title="O Ao vivo volta sozinho quando a próxima partida começar"><i aria-hidden="true"></i>próxima partida</span></p>
        <ul class="ended-board">${units
          .map((u) => {
            const c = champions.get(u.id);
            return `<li style="--ring-c:var(--cost-${c?.cost ?? 1})" title="${esc(c?.name ?? u.id)}">${portrait(u.id, c?.name ?? u.id, { size: 40 })}<b>${stars(u.stars)}</b><span>${(u.items ?? []).map((i) => itemPortrait({ id: i }, { size: 14 })).join("")}</span></li>`;
          })
          .join("")}</ul>`;
    },
  };
}
