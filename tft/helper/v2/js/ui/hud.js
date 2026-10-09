import { el, svg, setVars } from "../dom.js";
import { clamp, polar } from "../math.js";
import { INTEREST_CAP, INTEREST_STEP } from "../model.js";

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
/** Número animado por contador CSS (@property --n); sem requestAnimationFrame. */
const num = () => el("span", { class: "num" });
const setNum = (node, value, scale = 1) => {
  if (value == null) node.dataset.empty = "";
  else {
    delete node.dataset.empty;
    node.style.setProperty("--n", Math.round(value * scale));
  }
};
const cell = (cls, label, ...kids) =>
  el(
    "div",
    { class: `hud-cell ${cls}` },
    el("span", { class: "eyebrow" }, label),
    ...kids,
  );

export function mountHud(root) {
  /* Fase */
  const stageNum = el("strong", { class: "stage-num" }, "—"),
    rounds = el(
      "ol",
      { class: "rounds", "aria-hidden": "true" },
      ...Array.from({ length: 7 }, () => el("li")),
    ),
    liveDot = el("span", { class: "live-dot" }),
    liveText = el("span", { class: "live-text" });
  /* Vida */
  const hpNum = num(),
    hpBar = el("div", { class: "hp-bar" }, el("i"));
  /* Nível */
  const lvlNum = el("strong", { class: "ring-center" }, "—"),
    lvlRing = ring("ring-level"),
    xpText = el("small", { class: "sub" }),
    lvlWrap = el("div", { class: "ring-wrap" }, lvlRing, lvlNum);
  /* Ouro */
  const ticks = Array.from(
      { length: INTEREST_CAP / INTEREST_STEP + 1 },
      (_, i) => {
        const deg =
            GAUGE_START + (GAUGE_SWEEP * i) / (INTEREST_CAP / INTEREST_STEP),
          a = polar(32, 32, R + 4, deg),
          b = polar(32, 32, R + 7, deg);
        return svg("line", {
          class: "tick",
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
        });
      },
    ),
    floor = svg("circle", { class: "floor-mark", r: 2.6, cx: 32, cy: 32 }),
    goldGauge = ring("ring-gold", ...ticks, floor),
    goldNum = num(),
    interest = el("b", { class: "chip chip-go" }),
    goldWrap = el(
      "div",
      { class: "ring-wrap" },
      goldGauge,
      el("strong", { class: "ring-center" }, goldNum),
    );
  /* Meta */
  const goalRing = ring("ring-goal"),
    goalText = el("strong", { class: "ring-center" }, "—"),
    goalSub = el("small", { class: "sub" }),
    goalWrap = el("div", { class: "ring-wrap" }, goalRing, goalText);

  root.append(
    cell(
      "hud-stage",
      "Fase",
      el("div", { class: "stack" }, stageNum, rounds),
      el("div", { class: "live" }, liveDot, liveText),
    ),
    cell(
      "hud-hp",
      "Vida",
      el(
        "div",
        { class: "hp" },
        hpBar,
        el("strong", { class: "hp-num" }, hpNum),
      ),
    ),
    cell(
      "hud-level",
      "Nível",
      el(
        "div",
        { class: "pair" },
        lvlWrap,
        el("div", { class: "stack" }, xpText),
      ),
    ),
    cell(
      "hud-gold",
      "Ouro",
      el(
        "div",
        { class: "pair" },
        goldWrap,
        el("div", { class: "stack" }, interest),
      ),
    ),
    cell(
      "hud-goal",
      "Meta",
      el(
        "div",
        { class: "pair" },
        goalWrap,
        el("div", { class: "stack" }, goalSub),
      ),
    ),
  );
  const stageNode = root.querySelector(".hud-stage");
  return {
    update(model) {
      const { hero, status, plan } = model;
      /* Fase */
      stageNum.textContent = hero.stage
        ? `${hero.stage.stage}-${hero.stage.round}`
        : "—";
      [...rounds.children].forEach((li, i) => {
        li.dataset.state = !hero.stage
          ? ""
          : i + 1 < hero.stage.round
            ? "done"
            : i + 1 === hero.stage.round
              ? "now"
              : "";
      });
      stageNode.dataset.live = status.live ? "1" : "0";
      liveText.textContent = status.live
        ? "ao vivo"
        : status.ended
          ? "encerrada"
          : "snapshot";
      /* Vida */
      setNum(hpNum, hero.hp);
      setVars(hpBar, { "--p": hero.hp == null ? 0 : clamp(hero.hp / 100) });
      hpBar.dataset.low = hero.hp != null && hero.hp <= 30 ? "1" : "0";
      /* Nível */
      lvlNum.textContent = hero.level ?? "—";
      const xp = hero.xp,
        cost = plan?.panel?.level?.cost,
        next = plan?.panel?.level?.go;
      setVars(lvlRing, { "--p": xp ? clamp(xp.have / (xp.total || 1)) : 0 });
      lvlRing.dataset.go = next ? "1" : "0";
      xpText.textContent = xp
        ? `${xp.have}/${xp.total} XP${cost != null ? ` · ${cost}g` : ""}`
        : "XP não lido";
      lvlWrap.title = `Nível ${hero.level ?? "?"} (${hero.levelSource})`;
      /* Ouro */
      setNum(goldNum, hero.gold);
      setVars(goldGauge, {
        "--p": hero.gold == null ? 0 : clamp(hero.gold / INTEREST_CAP),
      });
      const keep = plan?.panel?.economy?.keep;
      if (keep != null && keep <= INTEREST_CAP) {
        const p = polar(
          32,
          32,
          R,
          GAUGE_START + GAUGE_SWEEP * clamp(keep / INTEREST_CAP),
        );
        floor.setAttribute("cx", p.x);
        floor.setAttribute("cy", p.y);
        floor.style.display = "";
      } else floor.style.display = "none";
      const gain = plan?.panel?.economy?.interest;
      interest.textContent = gain != null ? `+${gain} juros` : "";
      interest.hidden = gain == null;
      goldWrap.title = keep != null ? `Piso desta decisão: ${keep}g` : "Ouro";
      /* Meta */
      const g = plan?.progress;
      setVars(goalRing, { "--p": g?.total ? clamp(g.have / g.total) : 0 });
      goalText.textContent = g ? `${g.have}/${g.total}` : "—";
      goalSub.textContent = plan?.carry ? `carry ${plan.carry}` : "";
      goalWrap.title = plan?.title ?? "";
    },
  };
}
