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

  /**
   * Faixa compacta (verbosidade mínima): uma linha de ícone + número (fase, ouro, nível, vida); XP, juros e a origem de
   * cada leitura vão na dica do mouse. Chips só quando dizem algo: partida não ao vivo e GEP fora do normal.
   */
  function compactBar(view) {
    const b = view.bar;
    const cell = (icon, value, title, extra = "") =>
      `<span class="cell cell-c"${extra} title="${esc(title)}">${icon}<b>${esc(value)}</b></span>`;
    const cells = b
      ? [
          b.stage ? cell(glyph("flag"), b.stage, "Estágio e rodada") : "",
          b.gold
            ? cell(
                glyph("coin"),
                b.gold.value,
                [
                  b.gold.title,
                  b.gold.interest != null
                    ? `+${b.gold.interest} de juros`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                ` data-stale="${b.gold.stale ? 1 : 0}"`,
              )
            : "",
          b.level
            ? cell(
                glyph("up"),
                b.level.text,
                [
                  b.level.title,
                  b.xp
                    ? `XP ${b.xp.text}${b.xp.cost != null ? ` · ${b.xp.cost}g` : ""}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                ` data-uncertain="${b.level.uncertain ? 1 : 0}"`,
              )
            : "",
          b.hp != null
            ? cell('<span class="op" aria-hidden="true">❤</span>', b.hp, "Vida")
            : "",
        ].join("")
      : "";
    const chips = b
      ? `${b.live.kind !== "live" ? `<span class="chip live-chip" data-kind="${esc(b.live.kind)}">${esc(b.live.text)}</span>` : ""}${b.gep && b.gep.state !== "ativo" ? `<span class="chip gep-chip" data-state="${esc(b.gep.state)}" title="${esc(b.gep.label)}">${esc(b.gep.short)}</span>` : ""}`
      : "";
    const notes = view.notices
      .map(
        (n) =>
          `<span class="chip note" data-kind="${esc(n.kind)}" title="${esc(n.title)}">${glyph("warn")}${esc(n.text)}</span>`,
      )
      .join("");
    return b || notes
      ? `${cells ? `<div class="cells cells-c" data-stale="${b?.stale ? 1 : 0}">${cells}</div>` : ""}${chips || notes ? `<div class="chips">${chips}${notes}</div>` : ""}`
      : "";
  }

  /** Faixa superior e avisos discretos. `o.compact`: forma de relance (`compactBar`). */
  function bar(view, o = {}) {
    if (o.compact) return compactBar(view);
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
            ? `<span class="cell" title="${esc(b.gold.title)}"><small class="lbl">Ouro</small><b>${esc(b.gold.value)}</b>${b.gold.interest != null ? `<small class="sub go">+${esc(b.gold.interest)} juros</small>` : ""}</span>`
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
  function message(view, o = {}) {
    const m = view.message;
    if (!m) return "";
    // Compacto: só a frase curta; o detalhe vai para a dica do mouse.
    if (o.compact)
      return `<p class="msg" title="${esc([m.detail, m.title].filter(Boolean).join(" · "))}">${esc(m.text)}</p>`;
    return `<p class="msg" title="${esc(m.title)}">${esc(m.text)}</p>${m.detail ? `<p class="detail">${esc(m.detail)}</p>` : ""}`;
  }

  /** Veredito de rolagem (cartão com `aria-live` fixo no contêiner). */
  function roll(view, o = {}) {
    const r = view.roll;
    if (!r) return "";
    if (o.compact) {
      // Uma linha: ícone de rolar, o selo (rolar/segurar) e os números; o porquê vai na dica do mouse.
      const nums = r.spend
        ? `<b>${esc(r.spend.gold)}g</b>${r.spend.keep != null ? `<span>${glyph("flag")}${esc(r.spend.keep)}g</span>` : ""}`
        : r.budget != null
          ? `<span>${esc(r.budget)}g</span>`
          : "";
      const why = [
        r.title,
        r.reason,
        r.spend ? `até ${r.spend.shops} lojas` : null,
        r.interest
          ? `rolar derruba os juros de +${r.interest.from} para +${r.interest.to}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<p class="spend roll-c" data-kind="${esc(r.kind)}" title="${esc(why)}">${glyph("roll")}${r.pill ? `<b class="pill" data-tone="${esc(r.tone)}">${esc(r.pill)}</b>` : ""}${nums}</p>`;
    }
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

  /**
   * Carrossel: o que pegar. Com a leitura do carrossel (`from: "reading"`) cada linha é o item da peça (sem o retrato do
   * campeão que o traz) em ordem de valor para o plano; sem ela (`"priority"`) é a lista do que pegar SE aparecer, e o selo diz isso.
   * Tudo em imagens: o motivo vai no tooltip da linha.
   */
  /**
   * Linha do carrossel: só o ícone do item (a ordem de prioridade e a recomendada marcada); o campeão que vem com o item e
   * quem o usa ficam só na dica do mouse, sem retrato.
   */
  const carHead = (p) =>
    `${p.rank != null ? `<b class="rank">${esc(p.rank)}</b>` : ""}${p.rank === 1 ? `<i class="car-best" title="recomendada">${glyph("check")}</i>` : ""}`;
  const carTitle = (p, extra = null) =>
    [
      p.reason,
      p.champion?.name ? `vem com ${p.champion.name}` : null,
      p.forChampion?.name ? `para ${p.forChampion.name}` : null,
      extra,
    ]
      .filter(Boolean)
      .join(" · ");

  function carousel(view, o = {}) {
    const c = view.carousel;
    if (!c) return "";
    if (o.compact) return compactCarousel(c);
    const reading = c.from === "reading",
      ranked = c.picks.some((p) => p.score !== null),
      tag = reading
        ? ranked
          ? "lido do jogo"
          : "lido, sem nota"
        : c.from === "priority"
          ? "prioridade"
          : "";
    const title = [
      reading
        ? "Peças do carrossel lidas do jogo (GEP), em ordem de valor para o plano."
        : "O carrossel não foi lido: lista do que pegar se aparecer.",
      c.note,
      c.source === "schedule"
        ? "Carrossel estimado pelo calendário (x-4)."
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    const row = (p) => {
      const target =
        !reading || p.kind === "component"
          ? p.target
            ? `${op("→")}<span class="car-target${p.completes ? " is-close" : ""}">${item(p.target, 24)}</span>`
            : ""
          : "";
      return `<li class="line car-row" data-first="${p.rank === 1 ? 1 : 0}" data-complete="${p.completes ? 1 : 0}" title="${esc(carTitle(p))}">${carHead(p)}${p.item.id ? item(p.item, 30) : ""}${target}</li>`;
    };
    return `<header><span class="eyebrow">Carrossel</span>${tag ? `<b class="pill" data-tone="${reading && ranked ? "go" : "amber"}" title="${esc(title)}">${esc(tag)}</b>` : ""}</header>${
      c.picks.length
        ? `<ul class="lines car-list" aria-label="Peças do carrossel em ordem de valor">${c.picks.map(row).join("")}</ul>${c.more ? `<p class="detail">+${esc(c.more)} peça${c.more > 1 ? "s" : ""}</p>` : ""}`
        : `<p class="detail" title="${esc(title)}">${esc(c.note ?? "sem recomendação agora")}</p>`
    }`;
  }

  /** Carrossel compacto: só as imagens (peça + item → alvo), sem cabeçalho; a origem e o porquê vão na dica do mouse. */
  function compactCarousel(c) {
    if (!c.picks.length)
      return `<p class="msg" title="${esc(c.note ?? "")}">${glyph("eye")} carrossel</p>`;
    const reading = c.from === "reading";
    const row = (p) => {
      const target =
        (!reading || p.kind === "component") && p.target
          ? `${op("→")}<span class="car-target${p.completes ? " is-close" : ""}">${item(p.target, 24)}</span>`
          : "";
      return `<li class="line car-row" data-first="${p.rank === 1 ? 1 : 0}" data-complete="${p.completes ? 1 : 0}" title="${esc(carTitle(p, reading ? null : "o carrossel não foi lido: pegue se aparecer"))}">${carHead(p)}${p.item.id ? item(p.item, 30) : ""}${target}</li>`;
    };
    return `<ul class="lines car-list" aria-label="Carrossel: o que pegar">${c.picks.slice(0, 3).map(row).join("")}</ul>`;
  }

  /**
   * Aprimoramentos compactos: as cartas em uma linha cada (nome curto), a recomendada marcada, "troque" como ícone; o
   * porquê, a colocação esperada e a comp vão na dica do mouse. Sem fonte: um selo curto.
   */
  function compactAugments(a) {
    if (!a.open)
      return `<p class="msg" title="${esc([a.source?.text, a.source?.title].filter(Boolean).join(" · "))}">${glyph("warn")} aprim.: sem fonte</p>`;
    const row = (c) => {
      const why = [
        c.reasons?.[0],
        c.expected != null
          ? `colocação esperada ${c.expected.toFixed(2).replace(".", ",")}º`
          : null,
        c.reroll ? "troque esta carta" : c.rerolled ? "já trocada" : null,
        c.unknown ? "fora do catálogo" : null,
        a.comp ? `para ${a.comp}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<li class="line aug-row" data-best="${c.best ? 1 : 0}" data-unknown="${c.unknown ? 1 : 0}" title="${esc(`${c.name}${why ? ` · ${why}` : ""}`)}">${c.best ? glyph("check") : ""}<span class="aug-name">${esc(c.name)}</span>${c.reroll ? `<span class="aug-swap" aria-label="troque">${glyph("roll")}</span>` : ""}</li>`;
    };
    return `<ul class="lines aug-list" aria-label="Cartas da oferta, da melhor para a pior">${a.cards.map(row).join("")}</ul>`;
  }

  /**
   * Aprimoramentos: enquanto a escolha está aberta no jogo, as cartas (lidas pelo GEP) na ordem da análise, com a
   * recomendada em destaque e o aviso de troca; sem fonte, só o aviso. O texto é o nome do aprimoramento (não é campeão
   * nem item); o porquê vai no tooltip da linha.
   */
  function augments(view, o = {}) {
    const a = view.augments;
    if (!a) return "";
    if (o.compact) return compactAugments(a);
    if (!a.open)
      return `<header><span class="eyebrow">Aprimoramentos</span><b class="pill" data-tone="amber" title="${esc(a.source?.title ?? "")}">sem fonte</b></header><p class="detail" title="${esc(a.source?.title ?? "")}">${esc(a.source?.text ?? "aprimoramentos: sem fonte")}</p>`;
    const row = (c) => {
      const why = [c.reasons?.[0], c.unknown ? "fora do catálogo" : null]
        .filter(Boolean)
        .join(" ");
      const swap = c.reroll
        ? `<span class="aug-swap">${glyph("roll")}troque</span>`
        : c.rerolled
          ? `<span class="aug-swapped">trocado</span>`
          : "";
      return `<li class="line aug-row" data-best="${c.best ? 1 : 0}" data-unknown="${c.unknown ? 1 : 0}" title="${esc(why)}">${c.rank != null ? `<b class="rank">${esc(c.rank)}</b>` : ""}<span class="aug-name">${c.best ? glyph("check") : ""}${esc(c.name)}</span>${c.expected != null ? `<small class="aug-exp">${esc(c.expected.toFixed(2).replace(".", ","))}º</small>` : ""}${swap}</li>`;
    };
    const tag = a.pending ? "analisando" : "lido do jogo";
    return `<header><span class="eyebrow">Aprimoramento${a.stage ? ` ${esc(a.stage)}` : ""}</span><b class="pill" data-tone="${a.pending ? "amber" : "go"}" title="${esc(a.source?.title ?? "")}">${tag}</b></header><ul class="lines aug-list" aria-label="Cartas da oferta, da melhor para a pior">${a.cards.map(row).join("")}</ul>${a.comp ? `<p class="detail">para ${richText(a.comp)}</p>` : ""}`;
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

  const PART_TONE = { done: "equipped", go: "bank", wait: "missing" };

  /**
   * Itens recomendados de um campeão em campo: todos (até 3), na ordem da build, cada um com a marca da situação (equipado,
   * no banco, monta agora, mover, falta N) e a palavra curta; o próximo a resolver ganha destaque. Estado nunca só por cor.
   */
  function champRow(r) {
    const cells = r.items
      .map((i) => {
        const label = `${i.item.name}: ${i.text || i.label}`,
          from = i.from?.id
            ? `<span class="bi-from" aria-hidden="true">${portrait(i.from.id, i.from.name, { size: 14, hidden: true })}</span>`
            : "";
        return `<span class="bi" data-kind="${esc(i.kind)}" data-next="${i.next ? 1 : 0}" role="img" aria-label="${esc(label)}" title="${esc(label)}"><span class="nx-part" data-state="${PART_TONE[i.tone] ?? "missing"}">${item(i.item, 24, { hidden: true })}<i class="nx-mark">${glyph(i.mark)}</i></span><small class="bi-lbl" data-tone="${esc(i.tone)}">${from}${esc(i.label)}</small></span>`;
      })
      .join("");
    return `<li class="line" data-carry="${r.carry ? 1 : 0}">${mini(r.unit)}<span class="bi-list" role="group" aria-label="Itens recomendados de ${esc(r.unit.name)}">${cells}</span>${r.reserve ? `<small class="bi-src" title="${esc(r.note ?? "")}">reserva</small>` : ""}</li>`;
  }

  /**
   * "Montar agora" para a comp do plano: "[item] = [componente]+[componente] → [campeão]", "pronto: [item] → [campeão]",
   * "segure [item] em [temporário] → para [titular]" e "falta [componente] para [item] [campeão]". Só imagens e a palavra
   * da ação; a frase inteira vai na dica do mouse.
   */
  const partsHtml = (parts) =>
    parts
      .map(
        (p) =>
          `<span class="nx-part" data-state="${esc(p.state ?? "missing")}">${item(p, 20, { hidden: true })}</span>`,
      )
      .join(op("+"));
  function buildRow(b) {
    const body =
      b.kind === "craft"
        ? `${item(b.item, 26)}${op("=")}${partsHtml(b.parts)}${op("→")}${mini(b.unit)}`
        : b.kind === "ready"
          ? `<small class="bn-w">pronto:</small>${item(b.item, 26)}${op("→")}${mini(b.unit)}`
          : b.kind === "hold"
            ? `<small class="bn-w">segure</small>${item(b.item, 26)}<small class="bn-w">em</small>${mini(b.unit)}${op("→")}<small class="bn-w">para</small>${mini(b.for)}`
            : `<small class="bn-w">falta</small>${partsHtml(b.parts)}<small class="bn-w">para</small>${item(b.item, 26)}${mini(b.unit, 20)}`;
    return `<li class="line bn-row" data-kind="${esc(b.kind)}" data-carry="${b.carry ? 1 : 0}" title="${esc(b.text)}">${body}</li>`;
  }
  const buildGroup = (it) =>
    it.build?.length
      ? `<h3 class="eyebrow">Montar agora</h3><ul class="lines">${it.build.map(buildRow).join("")}</ul>${it.buildRest?.length ? `<p class="detail" title="${esc(it.buildRest.join("\n"))}">+${esc(it.buildRest.length)} na dica</p>` : ""}`
      : "";

  /** Itens: montar agora, próximo item, itens de cada campeão, equipar e passar itens. */
  function items(view, o = {}) {
    const it = view.items;
    if (!it) return "";
    if (o.compact) {
      // Só imagens: próximo item (a nota vai na dica do mouse), o carry e o que dá para equipar ou passar agora.
      const next = it.next.map((r) =>
        nextRow({ ...r, note: null }).replace(
          '<li class="line">',
          `<li class="line" title="${esc([`${r.item.name} → ${r.unit.name}`, r.note].filter(Boolean).join(" · "))}">`,
        ),
      );
      const carry = (it.champs ?? []).filter((r) => r.carry).map(champRow);
      const rows = [
        ...next,
        ...carry,
        ...it.equip.filter((r) => r.inField !== false).map(equipRow),
        ...it.moves.filter((r) => r.now).map(moveRow),
      ];
      const built = (it.build ?? []).map(buildRow);
      return rows.length || built.length
        ? `${built.length ? `<ul class="lines">${built.join("")}</ul>` : ""}${rows.length ? `<ul class="lines">${rows.join("")}</ul>` : ""}`
        : "";
    }
    const group = (label, rows, draw) =>
      rows.length
        ? `<h3 class="eyebrow">${label}</h3><ul class="lines">${rows.map(draw).join("")}</ul>`
        : "";
    return `${buildGroup(it)}${group("Próximo item", it.next, nextRow)}${group("Itens dos campeões", it.champs ?? [], champRow)}${it.champsMore > 0 ? `<p class="detail">+${esc(it.champsMore)} ${it.champsMore === 1 ? "campeão" : "campeões"} com item pendente</p>` : ""}${group("Equipar", it.equip, equipRow)}${group("Passar itens", it.moves, moveRow)}`;
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
    return `${head}${meter}${facts.length ? `<p class="detail">${facts.join(" · ")}</p>` : ""}${p.challenger ? `<p class="detail">${glyph("pause")} ${richText(p.challenger, { size: 16 })}</p>` : ""}${p.reach ? `<p class="detail">${richText(`Alcance: ${p.reach}`, { size: 16 })}</p>` : ""}${next}${units}${things}`;
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
   * modo. `state`: `{ health, mode, hasHost, fit }` (`health` de `healthOf`, `mode` normalizado, `fit` de `fitSummary`:
   * tamanho detectado da janela do jogo, escala efetiva e o que foi recolhido por falta de espaço; opcional).
   */
  function dock({ health, mode, hasHost, fit, notices = [] }) {
    // Avisos da faixa de estado (servidor sem resposta, leitura ou análise velha, outro jogo) quando a faixa está oculta.
    const notes = (Array.isArray(notices) ? notices : [])
      .map(
        (n) =>
          `<span class="chip note" data-kind="${esc(n.kind)}" title="${esc(n.title)}">${glyph("warn")}${esc(n.text)}</span>`,
      )
      .join("");
    const dots = (health ?? [])
      .map((h) => {
        const ok = h.ok === true ? "1" : h.ok === false ? "0" : "?";
        return `<i class="dot" data-id="${esc(h.id)}" data-ok="${ok}" role="img" aria-label="${esc(h.text)}" title="${esc(h.text)}&#10;${esc(h.title)}"></i>`;
      })
      .join("");
    // O dock é o de sempre ("?", pontos de saúde e o estado do modo). O tamanho detectado e a escala efetiva ficam na dica
    // do mouse dos pontos e na ajuda; o selo de tamanho só aparece quando a escala bateu no piso ou no teto (um aviso).
    const size =
      fit?.short && fit.limit
        ? `<span class="chip dock-fit" data-limit="${esc(fit.limit)}" title="${esc(fit.title)}">${esc(fit.short)}</span>`
        : "";
    const foldedTitle = `Recolhido por falta de espaço: ${(fit?.collapsedLabels ?? []).join(", ")}. Volta sozinho quando houver espaço.`;
    const folded = fit?.collapsed?.length
      ? `<span class="chip dock-fold" title="${esc(foldedTitle)}">${glyph("warn")}${esc(fit.collapsed.length)} recolhido${fit.collapsed.length > 1 ? "s" : ""}</span>`
      : "";
    // Compacto (verbosidade mínima, opção do "?"): o estado aparece só quando não é o normal (integrado) e o recolhido
    // vira só o número.
    const compact = mode?.hints?.verbosity === "minimal";
    const label = modeLabel(mode);
    const modeChip =
      compact && label === "integrado"
        ? ""
        : `<span class="chip dock-mode" title="Estado do overlay">${esc(label)}</span>`;
    const foldedChip =
      compact && fit?.collapsed?.length
        ? `<span class="chip dock-fold" title="${esc(foldedTitle)}">${glyph("warn")}${esc(fit.collapsed.length)}</span>`
        : folded;
    return `<div class="dock-row">${hasHost ? `<button type="button" class="dock-help" data-hit data-act="help" aria-pressed="${mode.help ? "true" : "false"}" title="Ajuda e configurações do overlay">?</button>` : ""}<span class="dock-dots" role="group" aria-label="Saúde das fontes"${fit?.title ? ` title="${esc(fit.title)}"` : ""}>${dots}</span>${modeChip}${compact ? "" : size}${foldedChip}</div>${notes ? `<div class="chips dock-notes">${notes}</div>` : ""}`;
  }

  /** Aviso fixo de tela cheia exclusiva (o overlay não aparece sobre o jogo nesse modo). */
  function banner(mode) {
    const fs = mode?.game?.fullscreen;
    if (!fs?.warn) return "";
    return `<p class="fs-warn">${glyph("warn")}<span>${esc(fs.text || "Tela cheia exclusiva: use janela ou janela sem borda para ver o overlay.")}</span></p>`;
  }

  return {
    bar,
    message,
    roll,
    items,
    builds,
    plan,
    carousel,
    augments,
    dock,
    banner,
  };
}
