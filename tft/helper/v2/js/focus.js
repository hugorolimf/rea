/**
 * "Foco agora": o resumo de uma linha do que fazer na rodada, em ordem de urgência, para ler de relance antes de
 * descer para os detalhes. Puro: só reordena e rotula o que `buildModel` (model.js) já calculou; não decide nada.
 *
 * Ordem: comprar o que está na loja agora → subir de nível → rolar (ou não) → comprar o que falta → trocar → equipar.
 * Cada item: `{ id, tone, icon, label, detail }` (`tone`: go | amber | danger | wait; `icon`: símbolo do sprite).
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {{ status?: { live?: boolean }, plan?: object | null } | null} model resultado de `buildModel`
 * @returns {{ items: Array<{ id: string, tone: string, icon: string, label: string, detail: string }>, idle: boolean } | null}
 *   `null` fora de uma partida ao vivo (nada a decidir agora)
 */
export function focusView(model) {
  const plan = model?.plan;
  if (!plan || !model.status?.live) return null;
  const steps = new Map((plan.steps ?? []).map((s) => [s.id, s])),
    panel = plan.panel ?? null,
    items = [];

  // Carrossel aberto (a trilha "Carrossel agora" do modelo): é o que se decide agora, antes de qualquer outra coisa.
  const car = steps.get("carousel");
  if (car?.note?.state === "now" || car?.note?.state === "priority")
    items.push({
      id: "carousel",
      tone: "go",
      icon: "flag",
      label: "Carrossel",
      detail:
        car.note.state === "now"
          ? plural(car.rows.length, "peça lida", "peças lidas")
          : `prioridade · ${plural(car.rows.length, "componente", "componentes")}`,
    });

  const buyRows = steps.get("buy")?.rows ?? [],
    inShop = buyRows.filter((r) => r.shop && !r.broke),
    broke = buyRows.filter((r) => r.shop && r.broke);
  if (inShop.length)
    items.push({
      id: "shop",
      tone: "go",
      icon: "coin",
      label: "Comprar na loja",
      detail: plural(inShop.length, "peça do plano", "peças do plano"),
    });
  else if (broke.length)
    items.push({
      id: "shop",
      tone: "danger",
      icon: "no",
      label: "Na loja, sem ouro",
      detail: plural(broke.length, "peça do plano", "peças do plano"),
    });

  const lv = panel?.level;
  if (lv?.go)
    items.push({
      id: "level",
      tone: "go",
      icon: "up",
      label: "Subir de nível",
      detail: `para ${lv.level + 1}${lv.cost != null ? ` · ${lv.cost}g` : ""}`,
    });
  else if (lv?.passive)
    items.push({
      id: "level",
      tone: "wait",
      icon: "up",
      label: "Não compre XP",
      detail: "o XP passivo completa o nível",
    });

  const ro = panel?.roll,
    kind = ro?.call?.kind;
  if (kind === "go")
    items.push({
      id: "roll",
      tone: "go",
      icon: "roll",
      label: "Rolar",
      detail: `${ro.spend ?? "?"}g${ro.shops != null ? ` · até ${plural(ro.shops, "loja", "lojas")}` : ""}`,
    });
  else if (kind === "danger")
    items.push({
      id: "roll",
      tone: "danger",
      icon: "warn",
      label: "Estabilizar",
      detail: "vida em perigo: upgrades do plano",
    });
  else if (kind === "hold")
    items.push({
      id: "roll",
      tone: "wait",
      icon: "pause",
      label: "Não role",
      detail: "economize",
    });
  else if (kind === "wait")
    items.push({
      id: "roll",
      tone: "wait",
      icon: "clock",
      label: "Role depois",
      detail: `no nível ${ro.call?.at?.level ?? ro.at ?? "?"}`,
    });

  if (!inShop.length && !broke.length && buyRows.length)
    items.push({
      id: "buy",
      tone: "amber",
      icon: "coin",
      label: "Buscar peças",
      detail: plural(buyRows.length, "peça", "peças"),
    });

  const swaps = steps.get("swap")?.rows.length ?? 0;
  if (swaps)
    items.push({
      id: "swap",
      tone: "go",
      icon: "swap",
      label: "Trocar",
      detail: plural(swaps, "peça", "peças"),
    });
  const equips = steps.get("equip")?.rows.length ?? 0;
  if (equips)
    items.push({
      id: "equip",
      tone: "go",
      icon: "check",
      label: "Equipar",
      detail: plural(equips, "item", "itens"),
    });

  return { items, idle: items.length === 0 };
}
