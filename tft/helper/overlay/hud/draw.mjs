/**
 * HTML de cada seção do overlay a partir do modelo de `view.mjs`. Só monta texto: nenhum nome de campeão ou de item
 * aparece sozinho (retratos e chips da interface, `ui`), e todo texto vindo do servidor é escapado por eles.
 * As funções de apresentação da interface (`/v2/js/ui/*`) entram por injeção para esta camada rodar também nos testes.
 *
 * `ui`: `{ esc, glyph, portrait, unitPortrait, itemPortrait, nameChip, richText, stars }`.
 */
export function createDraw(ui) {
  const {
    esc,
    glyph,
    portrait,
    unitPortrait,
    itemPortrait,
    nameChip,
    richText,
    stars,
  } = ui;

  const op = (t) => `<span class="op" aria-hidden="true">${t}</span>`;
  /** Campeão como imagem (nome só para leitor de tela e tooltip), com as estrelas ao lado. */
  const mini = (u, size = 24) =>
    `<span class="mini" title="${esc(u.name)}">${portrait(u.id, u.name, { size, hidden: true })}<b class="sr">${esc(u.name)}</b>${u.stars ? `<i class="st">${stars(u.stars)}</i>` : ""}</span>`;
  const item = (i, size = 24, extra = {}) =>
    itemPortrait({ id: i.id, name: i.name }, { size, ...extra });

  const PART_MARK = {
    bank: "bank",
    equipped: "check",
    missing: "plus",
    unknown: "clock",
  };

  /** Faixa superior e avisos discretos. */
  function bar(view) {
    const b = view.bar;
    const cells = b
      ? [
          b.stage
            ? `<span class="cell" title="Estágio e rodada"><small class="lbl">Fase</small><b>${esc(b.stage)}</b></span>`
            : "",
          b.level
            ? `<span class="cell" data-uncertain="${b.level.uncertain ? 1 : 0}" title="${esc(b.level.title)}"><small class="lbl">Nível</small><b>${esc(b.level.text)}</b>${b.xp ? `<small class="sub">${esc(b.xp.text)} XP${b.xp.cost != null ? ` · ${esc(b.xp.cost)}g` : ""}</small>` : ""}</span>`
            : "",
          b.gold
            ? `<span class="cell" data-stale="${b.gold.stale ? 1 : 0}" title="${esc(b.gold.title)}"><small class="lbl">Ouro</small><b>${esc(b.gold.value)}</b>${b.gold.interest != null ? `<small class="sub go">+${esc(b.gold.interest)} juros</small>` : ""}</span>`
            : "",
          b.hp != null
            ? `<span class="cell" title="Vida"><small class="lbl">Vida</small><b>${esc(b.hp)}</b></span>`
            : "",
        ].join("")
      : "";
    const chips = b
      ? `<span class="chip live-chip" data-kind="${esc(b.live.kind)}">${esc(b.live.text)}</span>${b.gep ? `<span class="chip gep-chip" data-state="${esc(b.gep.state)}" title="${esc(b.gep.label)}">${esc(b.gep.short)}</span>` : ""}`
      : "";
    const notes = view.notices
      .map(
        (n) =>
          `<span class="chip note" data-kind="${esc(n.kind)}" title="${esc(n.title)}">${glyph("warn")}${esc(n.text)}</span>`,
      )
      .join("");
    return b || notes
      ? `${cells ? `<div class="cells" data-stale="${b?.stale ? 1 : 0}">${cells}</div>` : ""}<div class="chips">${chips}${notes}</div>`
      : "";
  }

  /** Estados sem plano (carregando, aguardando análise, partida encerrada ou nova partida). */
  function message(view) {
    const m = view.message;
    if (!m) return "";
    return `<p class="msg" title="${esc(m.title)}">${esc(m.text)}</p>${m.detail ? `<p class="detail">${esc(m.detail)}</p>` : ""}`;
  }

  /** Veredito de rolagem (cartão com `aria-live` fixo no contêiner). */
  function roll(view) {
    const r = view.roll;
    if (!r) return "";
    const spend = r.spend
      ? `<p class="spend"><b>${esc(r.spend.gold)}g</b><span>até ${esc(r.spend.shops)} lojas</span>${r.spend.keep != null ? `<span>${glyph("flag")}pare em ${esc(r.spend.keep)}g</span>` : ""}</p>`
      : r.budget != null
        ? `<p class="spend"><span>orçamento ${esc(r.budget)}g</span></p>`
        : "";
    return `<header><span class="eyebrow">Rolagem</span>${r.pill ? `<b class="pill" data-tone="${esc(r.tone)}">${esc(r.pill)}</b>` : ""}</header>${
      r.title || r.reason
        ? `<p class="call" data-kind="${esc(r.kind)}">${r.title ? `<b>${richText(r.title)}</b> ` : ""}${richText(r.reason)}</p>`
        : ""
    }${spend}${r.interest ? `<p class="detail">Rolar derruba os juros de +${esc(r.interest.from)} para +${esc(r.interest.to)} por rodada.</p>` : ""}`;
  }

  /** Linha do "Próximo item": quem recebe, o item e a receita com a situação de cada componente. */
  function nextRow(r) {
    const main = item(r.item, 30, { ring: r.incomplete ? "is-dashed" : "" });
    if (!r.parts.length) return `<li class="line">${mini(r.unit)}${main}</li>`;
    const base = r.base ? `${item(r.base, 24)}${op("=")}` : "",
      recipe = r.parts
        .map((p) => {
          const label = `${p.name}: ${p.stateText}`;
          return `<span class="nx-part" data-state="${esc(p.state)}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${item(p, 24, { hidden: true })}<i class="nx-mark">${glyph(PART_MARK[p.state] ?? "clock")}</i></span>`;
        })
        .join(op("+"));
    return `<li class="line">${mini(r.unit)}<span class="nx-item" data-complete="${r.complete ? 1 : 0}">${main}</span>${op("=")}${base}<span class="nx-recipe" role="group" aria-label="Receita de ${esc(r.item.name)}">${recipe}</span>${r.note ? `<small class="nx-note" data-tone="${r.complete ? "go" : "amber"}">${esc(r.note)}</small>` : ""}</li>`;
  }

  const equipRow = (r) =>
    r.kind === "equip"
      ? `<li class="line">${r.items.map((i) => item(i, 26)).join("")}${op("→")}${mini(r.unit)}<i class="mark ${r.inField ? "ok" : "wait"}" title="${r.inField ? "montável com seu banco" : "prepare a entrada em campo"}">${glyph(r.inField ? "check" : "clock")}</i></li>`
      : `<li class="line">${item(r.item, 26)}${op("→")}${r.to ? mini(r.to) : `<span class="stash" title="${esc(r.reason)}">${glyph("bank")}</span>`}</li>`;

  const moveRow = (r) =>
    `<li class="line">${mini(r.from)}${r.moves.map((m) => `<span class="mv">${item(m.item, 24)}${op("→")}${mini(m.to, 22)}</span>`).join("")}<i class="mark ${r.now ? "ok" : "wait"}" title="${r.now ? "agora" : "planejar"}">${glyph(r.now ? "check" : "clock")}</i></li>`;

  /** Itens: próximo item, equipar e passar itens. */
  function items(view) {
    const it = view.items;
    if (!it) return "";
    const group = (label, rows, draw) =>
      rows.length
        ? `<h3 class="eyebrow">${label}</h3><ul class="lines">${rows.map(draw).join("")}</ul>`
        : "";
    return `${group("Próximo item", it.next, nextRow)}${group("Equipar", it.equip, equipRow)}${group("Passar itens", it.moves, moveRow)}`;
  }

  /** Itens por campeão: equipados (cheios) e os que a build ainda pede (tracejados). */
  function builds(view) {
    if (!view.builds.length) return "";
    const li = (b) =>
      `<li class="bd" data-carry="${b.carry ? 1 : 0}">${unitPortrait(b.id, b.name, b.cost, 26)}<span class="bd-items">${b.equipped.map((i) => item(i, 20)).join("")}${b.wanted.map((i) => `<span class="want" data-kind="${esc(i.kind)}" role="img" aria-label="${esc(i.name)}${i.text ? `: ${esc(i.text)}` : ""}" title="${esc(i.name)}${i.text ? ` · ${esc(i.text)}` : ""}">${item(i, 20, { hidden: true })}</span>`).join("")}</span></li>`;
    return `<h3 class="eyebrow">Itens da formação</h3><ul class="bds">${view.builds.map(li).join("")}</ul>`;
  }

  const UNIT_MARK = { done: "check", partial: "clock", missing: "plus" };
  const ITEM_MARK = {
    built: "check",
    ready: "up",
    move: "swap",
    missing: "plus",
  };

  /** Plano: comp, peças em campo, próximos passos e o checklist de peças e itens. */
  function plan(view) {
    const p = view.plan;
    if (!p) return "";
    const head = `<header><span class="eyebrow">Plano</span>${p.carry && !String(p.title ?? "").includes(p.carry.name) ? nameChip("champion", p.carry.id, p.carry.name, { size: 22 }) : ""}<b class="title">${richText(p.title, { size: 18 })}</b>${p.progress ? `<span class="chip ${p.progress.pct >= 100 ? "chip-go" : ""}" title="passos concluídos do plano">${esc(p.progress.done)}/${esc(p.progress.total)}</span>` : ""}</header>`;
    const meter = p.progress
      ? `<span class="meter" style="--p:${Math.max(0, Math.min(1, p.progress.pct / 100))}" role="img" aria-label="${esc(p.progress.pct)}% do plano"><i></i></span>`
      : "";
    const facts = [
      p.onBoard
        ? `${esc(p.onBoard.have)}/${esc(p.onBoard.total)} peças em campo`
        : "",
      p.score
        ? `score ${esc(p.score.value)}${p.score.best ? " · melhor comp" : ""}`
        : "",
      p.pinned ? "comp fixada" : "",
      p.progress?.since ? esc(p.progress.since) : "",
    ].filter(Boolean);
    const next = p.next.length
      ? `<ol class="steps">${p.next
          .slice(0, 3)
          .map(
            (s) =>
              `<li data-kind="${esc(s.kind)}">${richText(s.text, { size: 18 })}</li>`,
          )
          .join("")}</ol>`
      : "";
    const units = p.units.length
      ? `<ul class="pn-units" aria-label="Peças do plano">${p.units
          .map(
            (u) =>
              `<li data-status="${esc(u.status)}"${u.lost ? " data-lost" : ""} title="${esc(u.name)} · ${esc(u.line)}">${unitPortrait(u.id, `${u.name}: ${u.statusText}`, u.cost, 30)}<i class="mark">${glyph(UNIT_MARK[u.status] ?? "plus")}</i><span class="bar" style="--p:${u.fraction}" aria-hidden="true"><i></i></span></li>`,
          )
          .join("")}</ul>`
      : "";
    const things = p.items.length
      ? `<ul class="pn-items" aria-label="Itens do plano">${p.items
          .map(
            (i) =>
              `<li data-status="${esc(i.status)}" title="${esc(i.name)} · ${esc(i.statusText)}${i.missing.length ? ` · falta ${esc(i.missing.join(" + "))}` : ""}">${item({ id: i.itemId, name: i.name }, 24, { hidden: true })}<b class="sr">${esc(i.name)}: ${esc(i.statusText)}</b><i class="mark">${glyph(ITEM_MARK[i.status] ?? "plus")}</i></li>`,
          )
          .join("")}</ul>`
      : "";
    return `${head}${meter}${facts.length ? `<p class="detail">${facts.join(" · ")}</p>` : ""}${p.challenger ? `<p class="detail">${glyph("pause")} ${richText(p.challenger, { size: 16 })}</p>` : ""}${next}${units}${things}`;
  }

  /** Rótulo do estado do overlay no dock. */
  const modeLabel = (mode) =>
    mode.calibrating
      ? "calibrando"
      : mode.interactive
        ? "interativo"
        : mode.mode === "integrated"
          ? "integrado"
          : "painel";

  /**
   * Dock: botão "?" (ajuda; só clicável no modo interativo), pontos de saúde das fontes (cor + tooltip) e o estado do
   * modo. `state`: `{ health, mode, hasHost }` (`health` de `healthOf`, `mode` normalizado).
   */
  function dock({ health, mode, hasHost }) {
    const dots = (health ?? [])
      .map((h) => {
        const ok = h.ok === true ? "1" : h.ok === false ? "0" : "?";
        return `<i class="dot" data-id="${esc(h.id)}" data-ok="${ok}" role="img" aria-label="${esc(h.text)}" title="${esc(h.text)}&#10;${esc(h.title)}"></i>`;
      })
      .join("");
    return `<div class="dock-row">${hasHost ? `<button type="button" class="dock-help" data-hit data-act="help" aria-pressed="${mode.help ? "true" : "false"}" title="Ajuda e configurações do overlay">?</button>` : ""}<span class="dock-dots" role="group" aria-label="Saúde das fontes">${dots}</span><span class="chip dock-mode" title="Estado do overlay">${esc(modeLabel(mode))}</span></div>`;
  }

  /** Aviso fixo de tela cheia exclusiva (o overlay não aparece sobre o jogo nesse modo). */
  function banner(mode) {
    const fs = mode?.game?.fullscreen;
    if (!fs?.warn) return "";
    return `<p class="fs-warn">${glyph("warn")}<span>${esc(fs.text || "Tela cheia exclusiva: use janela ou janela sem borda para ver o overlay.")}</span></p>`;
  }

  return { bar, message, roll, items, builds, plan, dock, banner };
}
