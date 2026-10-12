// Decisão da rodada (`turn`): o que fazer AGORA com o ouro de agora, numa conta só e em ordem — comprar da loja, subir de
// nível, rolar e guardar. Puro e sem I/O. Não decide nada novo: junta o que a estratégia (strategy.mjs: ação, gasto, piso,
// XP), a Formação (compras da loja) e a caça (core/roll/hunt.mjs: por quem rolar) já decidiram, desconta o ouro passo a
// passo e diz quando é o próximo nível. Todas as telas (interface, overlay, selos) leem este objeto em vez de juntar
// painéis por conta própria. Plano: planos/em-andamento/decisao-da-rodada.md.
import { POLICY } from "../economy/policy.mjs";

/** Custo de uma rolagem da loja (ouro). */
export const REROLL_COST = 2;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rollsText = (n) => `${n} ${n === 1 ? "vez" : "vezes"}`;

/**
 * Próximo ponto da curva padrão (`POLICY.curve`: `[estágio, rodada, nível]`) em que o nível passa de `level`, depois de
 * `stage` quando lido. `{ stage, round, text: "4-1" }` ou null (já no fim da curva).
 */
export function nextCurveStage(level, stage = null, curve = POLICY.curve) {
  const lv = num(level);
  if (lv === null) return null;
  const after = (s, r) =>
    !stage || s > stage.stage || (s === stage.stage && r > stage.round);
  for (const [s, r, l] of curve)
    if (l >= lv + 1 && after(s, r))
      return { stage: s, round: r, text: `${s}-${r}` };
  return null;
}

/**
 * Monta a decisão da rodada.
 *  - `gold`, `level`, `stage` (`{stage, round}` ou null): o estado lido;
 *  - `d`: a decisão de strategy.mjs depois de settle/withoutTarget (`action`, `spend`, `keep`, `cash`, `levelCost`,
 *    `levelUp`, `passiveLevel`, `finalLevel`, `headline`, `steps`);
 *  - `buys`: as cartas da loja que o plano manda comprar (`plan.stage.shop` com `action: "comprar"`);
 *  - `rollFor`: o "por quem rolar" de core/roll/hunt.mjs (null sem caça);
 *  - `target`: o nível-alvo do motor (`level.target`), o mesmo que escolheu o tamanho da comp; sem ele vale `d.finalLevel`;
 *  - `comp`: `{ id, title }` da comp do plano.
 * Devolve `{ comp, gold, steps, level, headline, ok }`; `ok` = a soma dos passos cabe no ouro (nunca gasta o que um passo
 * anterior já usou). Sem ouro lido, só as compras (sem conta) e `gold.now` null.
 */
export function buildTurn({
  gold = null,
  level = null,
  stage = null,
  d = {},
  buys = [],
  rollFor = null,
  target = null,
  comp = null,
} = {}) {
  const steps = [];
  let left = num(gold);
  const pay = (cost) => {
    if (left !== null && num(cost) !== null) left -= cost;
  };
  for (const b of buys ?? []) {
    steps.push({
      kind: "buy",
      id: b.id ?? null,
      name: b.name ?? b.id ?? "?",
      slot:
        num(b.slot) ?? (Array.isArray(b.slots) ? (b.slots[0] ?? null) : null),
      cost: num(b.cost) ?? 0,
      why: b.reason ?? b.why ?? "",
    });
    pay(num(b.cost) ?? 0);
  }
  // Venda do banco (all-in crítico): entra no ouro antes da rolagem.
  const sold = num(d.sold) ?? 0;
  if (sold > 0) {
    steps.push({ kind: "sell", gold: sold, why: "venda do banco para rolar" });
    if (left !== null) left += sold;
  }
  // Na ação "SUBIR NÍVEL", `spend` é o XP; junto da rolagem (perigo), o XP vem em `levelUp` e `spend` é só a rolagem.
  const lv = num(level),
    levelCost = num(d.levelCost),
    xpNow =
      (d.action === "SUBIR NÍVEL" && (num(d.spend) ?? 0) > 0) ||
      (num(d.levelUp) ?? 0) > 0;
  if (xpNow && lv !== null) {
    const cost =
      d.action === "SUBIR NÍVEL"
        ? (num(d.spend) ?? levelCost ?? 0)
        : (num(d.levelUp) ?? levelCost ?? 0);
    steps.push({
      kind: "level",
      from: lv,
      to: lv + 1,
      cost,
      why:
        d.action === "SUBIR NÍVEL"
          ? (d.headline ?? "")
          : "subir junto da rolagem",
    });
    pay(cost);
  }
  const rolling = d.action === "ROLAR" && (num(d.spend) ?? 0) >= REROLL_COST;
  if (rolling) {
    const times = Math.floor(num(d.spend) / REROLL_COST);
    steps.push({
      kind: "roll",
      times,
      gold: times * REROLL_COST,
      targets: (rollFor?.targets ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        goal: t.goal ?? null,
        have: t.have ?? null,
        chance: num(t.chance),
        carry: !!t.carry,
      })),
      stopAt: num(d.keep),
      why: rollFor?.text ?? d.headline ?? "",
    });
    pay(times * REROLL_COST);
  }
  const ended = d.action === "ENCERRADA";
  const keep = ended
    ? null
    : (num(d.keep) ?? (left !== null ? Math.max(0, left) : null));
  if (keep !== null)
    steps.push({ kind: "keep", gold: keep, why: keepWhy(d, keep) });

  // `target`: o nível que o motor usou agora para o tamanho da comp; `final`: o nível em que a comp é jogada (estilo).
  // A comp só está "pronta de nível" no maior dos dois.
  const targetNow = num(target) ?? num(d.finalLevel),
    finalLevel =
      num(d.finalLevel) === null
        ? targetNow
        : Math.max(num(d.finalLevel), targetNow ?? 0);
  const nextLevel =
    lv === null || xpNow || (finalLevel !== null && lv >= finalLevel)
      ? null
      : d.passiveLevel
        ? {
            when: "próxima rodada",
            why: "o XP passivo da próxima rodada completa o nível de graça",
          }
        : levelCost !== null && num(gold) !== null && levelCost > (left ?? 0)
          ? {
              when: `com ${levelCost}g`,
              gold: levelCost,
              why: `subir para o nível ${lv + 1} custa ${levelCost}g; depois desta rodada sobram ${Math.max(0, left ?? 0)}g`,
            }
          : (() => {
              const at = nextCurveStage(lv, stage);
              // O porquê é o da decisão quando ela já fala do nível ("Economize para o nível 9"); senão, a curva.
              const said = /nível/i.test(d.headline ?? "") ? d.headline : null;
              return at
                ? {
                    when: at.text,
                    stage: at.stage,
                    round: at.round,
                    why:
                      said ??
                      `na curva padrão o nível ${lv + 1} vem em ${at.text}`,
                  }
                : said
                  ? { when: "economizando", why: said }
                  : null;
            })();
  const spent = steps
    .filter((s) => s.kind !== "keep" && s.kind !== "sell")
    .reduce((n, s) => n + (s.cost ?? s.gold ?? 0), 0);
  const have = num(gold) === null ? null : num(gold) + sold;
  return {
    comp: comp ? { id: comp.id ?? null, title: comp.title ?? null } : null,
    gold: {
      now: num(gold),
      sold,
      spent,
      after: have === null ? null : have - spent,
      keep,
    },
    steps,
    level: {
      now: lv,
      target: targetNow,
      final: finalLevel,
      up: xpNow,
      cost: levelCost,
      next: nextLevel,
      done: lv !== null && finalLevel !== null && lv >= finalLevel,
    },
    // Sem passos (partida encerrada, ouro sem fonte): a frase da própria decisão.
    headline: (ended ? "" : headlineOf(steps)) || (d.headline ?? ""),
    ok: have === null || spent <= have,
  };
}

function keepWhy(d, keep) {
  if (d.pressure === "danger" || d.pressure === "critical")
    return d.stabilized
      ? "tabuleiro estabilizado: o ouro volta para juros e nível"
      : "piso da faixa de vida";
  return keep >= 50
    ? "juros no máximo (+5)"
    : `juros de +${Math.floor(keep / 10)} e o próximo nível`;
}

/** "Kayle 3★", ou "Elder Dragon (nova)" para a peça que ainda falta. */
const targetText = (t) =>
  t.goal === "falta"
    ? `${t.name} (nova)`
    : `${t.name}${t.goal ? ` ${t.goal}` : ""}`;

/** "Compre Aphelios → suba para 8 → role 6 vezes por Kayle 3★ → guarde 30g". */
export function headlineOf(steps) {
  const parts = steps.map((s) => {
    if (s.kind === "buy") return `compre ${s.name}`;
    if (s.kind === "level") return `suba para ${s.to}`;
    if (s.kind === "sell") return `venda do banco (+${s.gold}g)`;
    if (s.kind === "roll")
      return `role ${rollsText(s.times)}${s.targets.length ? ` por ${s.targets.slice(0, 2).map(targetText).join(", ")}` : ""}`;
    return `guarde ${s.gold}g`;
  });
  const text = parts.join(" → ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}
