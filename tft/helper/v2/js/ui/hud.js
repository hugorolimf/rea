import { el, svg, setVars, esc } from "../dom.js";
import { clamp, polar } from "../math.js";
import { interestTiers, maxInterestGold } from "../../../core/economy/gold.mjs";
import { POLICY } from "../../../core/economy/policy.mjs";
import { HP } from "../../../core/economy/tables.mjs";
import { glyph } from "./glyphs.js";
import { nameChip } from "./rich-text.js";

const R = 26,
  GAUGE_START = 135,
  GAUGE_SWEEP = 270;

/** Anel com trilho e preenchimento; o progresso é a custom property --p (0..1), animada por @property. */
const ring = (cls, ...extra) =>
  svg(
    "svg",
    { viewBox: "0 0 64 64", class: `ring ${cls}`, "aria-hidden": "true" },
    svg("circle", {
      class: "ring-track",
      cx: 32,
      cy: 32,
      r: R,
      pathLength: 100,
    }),
    svg("circle", {
      class: "ring-fill",
      cx: 32,
      cy: 32,
      r: R,
      pathLength: 100,
    }),
    ...extra,
  );
/**
 * Número animado por contador CSS (@property --n); sem requestAnimationFrame. O contador é só visual (`aria-hidden`):
 * o valor real vai em um `.sr` ao lado, que não anima.
 */
const num = () => el("span", { class: "num", "aria-hidden": "true" });
const setNum = (node, value, scale = 1) => {
  if (value == null) node.dataset.empty = "";
  else {
    delete node.dataset.empty;
    node.style.setProperty("--n", Math.round(value * scale));
  }
};
/** Só escreve no DOM o que mudou (o HUD é relido a cada leitura do servidor). */
const setText = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};
const setTitle = (node, text) => {
  if (node.title !== text) node.title = text;
};
/** Célula do HUD: rótulo pequeno em cima e um corpo que reserva a altura do anel (sem pulos de altura). */
const cell = (cls, label, ...kids) =>
  el(
    "div",
    { class: `hud-cell ${cls}` },
    el("span", { class: "eyebrow" }, label),
    el("div", { class: "hud-body" }, ...kids),
  );
/** Faixas de cor do score da comp (mesmas de ui/comps.js e js/comps.js): alto ≥ 60, médio ≥ 40. */
const bandOf = (v) => (v >= 60 ? "high" : v >= 40 ? "mid" : "low");

/**
 * HUD da partida. `onOpenGoal(botão)` abre o modal da comp sugerida a partir do botão da célula "Meta"; o botão é
 * passado para o modal devolver o foco a ele ao fechar.
 */
export function mountHud(root, { onOpenGoal = null } = {}) {
  /* Fase */
  const stageNum = el("strong", { class: "stage-num" }, "—"),
    rounds = el(
      "ol",
      { class: "rounds", "aria-hidden": "true" },
      ...Array.from({ length: 7 }, () => el("li")),
    ),
    liveDot = el("span", { class: "live-dot", "aria-hidden": "true" }),
    liveText = el("span", { class: "live-text" }),
    gepChip = el("span", { class: "chip gep-chip", hidden: "" });
  /* Vida */
  const hpNum = num(),
    hpSr = el("span", { class: "sr" }),
    hpBar = el("div", { class: "hp-bar", "aria-hidden": "true" }, el("i"));
  /* Nível */
  const lvlNum = el("strong", { class: "ring-center" }, "—"),
    lvlRing = ring("ring-level"),
    xpText = el("small", { class: "hud-sub" }),
    lvlWrap = el("div", { class: "ring-wrap" }, lvlRing, lvlNum);
  /* Ouro */
  const ticks = Array.from({ length: interestTiers() + 1 }, (_, i) => {
      const deg = GAUGE_START + (GAUGE_SWEEP * i) / interestTiers(),
        a = polar(32, 32, R + 4, deg),
        b = polar(32, 32, R + 7, deg);
      return svg("line", {
        class: "tick",
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
      });
    }),
    floor = svg("circle", { class: "floor-mark", r: 2.6, cx: 32, cy: 32 }),
    goldGauge = ring("ring-gold", ...ticks, floor),
    goldNum = num(),
    goldSr = el("span", { class: "sr" }),
    interest = el("span", { class: "chip chip-go" }),
    keepText = el("small", { class: "hud-sub" }),
    goldWrap = el(
      "div",
      { class: "ring-wrap" },
      goldGauge,
      el("strong", { class: "ring-center" }, goldNum, goldSr),
    );
  /* Meta */
  const goalRing = ring("ring-goal"),
    goalText = el("strong", { class: "ring-center" }, "—"),
    goalSub = el("div", { class: "hud-meta" }),
    // Abre o modal da comp sugerida (ver ui/comp-modal.js); sem ele, cai para a aba Comps.
    goalLink = el(
      "button",
      {
        type: "button",
        class: "btn btn-sm btn-go goal-link",
        "aria-haspopup": "dialog",
        onclick: (e) =>
          onOpenGoal ? onOpenGoal(e.currentTarget) : (location.hash = "#comps"),
      },
      "Escolher comp",
    ),
    goalWrap = el("div", { class: "ring-wrap" }, goalRing, goalText);

  const hpCell = cell(
    "hud-hp",
    "Vida",
    el(
      "div",
      { class: "hp" },
      el("strong", { class: "hp-num" }, hpNum, hpSr),
      hpBar,
    ),
  );
  root.append(
    cell(
      "hud-stage",
      "Fase",
      el(
        "div",
        { class: "hud-stack" },
        el(
          "div",
          { class: "hud-line" },
          stageNum,
          el("span", { class: "hud-live" }, liveDot, liveText),
        ),
        el("div", { class: "hud-line" }, rounds, gepChip),
      ),
    ),
    hpCell,
    cell(
      "hud-level",
      "Nível",
      lvlWrap,
      el("div", { class: "hud-stack" }, xpText),
    ),
    cell(
      "hud-gold",
      "Ouro",
      goldWrap,
      el("div", { class: "hud-stack" }, interest, keepText),
    ),
    cell(
      "hud-goal",
      "Meta",
      goalWrap,
      el("div", { class: "hud-stack" }, goalSub, goalLink),
    ),
  );
  const stageNode = root.querySelector(".hud-stage");
  return {
    update(model) {
      const { hero, status, plan } = model;
      /* Fase */
      setText(
        stageNum,
        hero.stage ? `${hero.stage.stage}-${hero.stage.round}` : "—",
      );
      [...rounds.children].forEach((li, i) => {
        const state = !hero.stage
          ? ""
          : i + 1 < hero.stage.round
            ? "done"
            : i + 1 === hero.stage.round
              ? "now"
              : "";
        if (li.dataset.state !== state) li.dataset.state = state;
      });
      stageNode.dataset.live = status.live ? "1" : "0";
      // Estado da fonte GEP: o chip confirma que o Overwolf/TFTAcademy alimentam o helper (ou que caiu para a leitura de
      // tela); a dica traz o texto completo e o indicador "ao vivo" repete o rótulo para quem passa o mouse.
      setTitle(liveText, status.gep?.label ?? "");
      gepChip.hidden = !status.gep;
      const gepState = status.gep?.state ?? "";
      gepChip.dataset.state = gepState;
      gepChip.dataset.tone =
        gepState === "ativo"
          ? "go"
          : gepState === "obsoleto" || gepState === "esquema-desconhecido"
            ? "amber"
            : "";
      setText(gepChip, status.gep?.short ?? "");
      setTitle(gepChip, status.gep?.label ?? "");
      setText(
        liveText,
        status.live
          ? "ao vivo"
          : status.waiting
            ? "nova partida"
            : status.ended
              ? status.placement
                ? `encerrada · ${status.placement}º`
                : "encerrada"
              : "snapshot",
      );
      /* Vida */
      // O jogo grava vida negativa de quem foi eliminado; na tela, eliminado é 0.
      const hp = hero.hp == null ? null : Math.max(0, hero.hp);
      setNum(hpNum, hp);
      setText(hpSr, hp == null ? "Vida não lida" : `Vida ${hp}`);
      setVars(hpBar, {
        "--p": hero.hp == null ? 0 : clamp(hero.hp / HP.max),
      });
      // Barra "baixa" = faixa de perigo da política (POLICY.hp.danger).
      const low = hero.hp != null && hero.hp <= POLICY.hp.danger ? "1" : "0";
      hpBar.dataset.low = low;
      hpCell.dataset.low = low;
      /* Nível */
      // "≥N" = piso derivado do XP passivo e "~N" = estimado pelo tabuleiro: nenhum dos dois é leitura.
      setText(
        lvlNum,
        hero.level == null
          ? "—"
          : hero.levelSource === "derivado"
            ? `≥${hero.level}`
            : hero.levelSource === "estimado"
              ? `~${hero.level}`
              : String(hero.level),
      );
      lvlWrap.dataset.stale =
        hero.levelStale || hero.levelSource !== "tela" ? "1" : "0";
      const xp = hero.xp,
        cost = plan?.panel?.level?.cost,
        next = plan?.panel?.level?.go;
      setVars(lvlRing, { "--p": xp ? clamp(xp.have / (xp.total || 1)) : 0 });
      lvlRing.dataset.go = next ? "1" : "0";
      setText(
        xpText,
        xp
          ? `${xp.have}/${xp.total} XP${cost != null ? ` · ${cost}g` : ""}`
          : "XP não lido",
      );
      setTitle(
        lvlWrap,
        `Nível ${hero.level ?? "?"} (${
          hero.levelFrom === "gep"
            ? "lido do GEP (TFTAcademy), sem leitura de tela"
            : ({
                tela: "lido da tela",
                derivado: "mínimo derivado do XP passivo: não foi lido",
                estimado: "estimado pelo tabuleiro: não foi lido",
              }[hero.levelSource] ?? hero.levelSource)
        }${hero.levelStale ? "; leitura velha ou em conflito com o XP" : ""}${
          hero.levelUsed != null && hero.levelUsed !== hero.level
            ? `; a análise usou o nível ${hero.levelUsed}`
            : ""
        })`,
      );
      /* Ouro */
      setNum(goldNum, hero.gold);
      setText(
        goldSr,
        hero.gold == null ? "Ouro não lido" : `Ouro ${hero.gold}`,
      );
      goldWrap.dataset.stale = hero.goldStale ? "1" : "0";
      setVars(goldGauge, {
        "--p": hero.gold == null ? 0 : clamp(hero.gold / maxInterestGold()),
      });
      const keep = plan?.panel?.economy?.keep;
      if (keep != null && keep <= maxInterestGold()) {
        const p = polar(
          32,
          32,
          R,
          GAUGE_START + GAUGE_SWEEP * clamp(keep / maxInterestGold()),
        );
        floor.setAttribute("cx", p.x);
        floor.setAttribute("cy", p.y);
        floor.style.display = "";
      } else floor.style.display = "none";
      const gain = plan?.panel?.economy?.interest;
      setText(interest, gain != null ? `+${gain} juros` : "");
      interest.hidden = gain == null;
      // O piso da decisão também aparece em texto (a marca no anel é só um ponto).
      setText(keepText, keep != null ? `piso ${keep}g` : "");
      keepText.hidden = keep == null;
      /* Título único: motivo do esmaecimento + piso da decisão */
      setTitle(
        goldWrap,
        [
          hero.goldFrom === "gep"
            ? "Ouro do GEP (TFTAcademy), sem leitura de tela"
            : null,
          hero.goldStale
            ? "Última leitura do ouro; a tela está coberta agora"
            : null,
          keep != null ? `Piso desta decisão: ${keep}g` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Ouro",
      );
      /* Meta */
      const g = plan?.progress,
        bench = plan?.reserve;
      setVars(goalRing, { "--p": g?.total ? clamp(g.have / g.total) : 0 });
      setText(goalText, g ? `${g.have}/${g.total}` : "—");
      // "N/M" = peças da comp em campo; as que estão só na reserva viram "+K na reserva" ao lado (roster.js).
      setTitle(
        goalWrap,
        bench?.text ? `Peças da comp: ${bench.text}` : "Peças da comp",
      );
      const sc = plan?.score;
      // O carry é a imagem dele (nome só para leitor de tela); o resto são textos fixos, o score e números.
      const state = status.pinned ? "fixada" : plan ? "sugerida" : "",
        html = [
          state ? `<span class="hud-tag">${esc(state)}</span>` : "",
          bench?.count
            ? `<span class="chip" data-tone="blue" title="${esc(bench.text)}">${glyph("bank")}+${esc(bench.count)} na reserva</span>`
            : "",
          sc
            ? `<span class="score" data-band="${bandOf(sc.value)}"><span class="sr">score </span>${esc(sc.value)}</span>`
            : "",
          sc?.best
            ? `<span class="chip" data-tone="gold">${glyph("crown")}melhor comp</span>`
            : "",
          sc?.expected != null
            ? `<span class="hud-tag">${String(Math.round(sc.expected * 10) / 10).replace(".", ",")}º esperado${sc.top4 != null ? ` · ${Math.round(sc.top4)}% top 4` : ""}</span>`
            : sc?.chance != null
              ? `<span class="hud-tag">chance ${Math.round(sc.chance * 100)}%</span>`
              : "",
          plan?.carry
            ? `<span class="hud-tag">carry ${nameChip("champion", plan.carryId, plan.carry, { size: 18 })}</span>`
            : "",
        ]
          .filter(Boolean)
          .join("");
      // Reescreve só se mudou: refazer o HTML a cada leitura recarregaria a imagem do carry.
      if (goalSub.dataset.sig !== html) {
        goalSub.dataset.sig = html;
        goalSub.innerHTML = html;
      }
      setText(goalLink, status.pinned ? "Trocar comp" : "Escolher comp");
      setTitle(
        goalLink,
        status.pinned
          ? "Ver a comp escolhida e as sugestões; trocar ou desfazer"
          : "Ver a comp sugerida e as outras sugestões; escolher uma",
      );
      // Partida revista: só leitura, a escolha valeria para a partida de agora.
      goalLink.hidden = !!status.replay;
      // O "N/M" do anel são as peças da comp que já estão em campo (não a posição entre as sugestões).
      setTitle(
        goalWrap,
        plan
          ? `${g ? `${g.have}/${g.total} peças da comp já em campo · ` : ""}${plan.title}${sc ? ` · score ${sc.value}/100 (colocação esperada${sc.expected != null ? ` ${String(Math.round(sc.expected * 10) / 10).replace(".", ",")}º` : ""}, já com o alcance, os seus itens e aprimoramentos)${sc.chance != null ? ` · chance de montar ${Math.round(sc.chance * 100)}%${sc.chancePlan != null ? ` (nível alvo: ${Math.round(sc.chancePlan * 100)}%)` : ""}` : ""}` : ""}`
          : "",
      );
    },
  };
}
