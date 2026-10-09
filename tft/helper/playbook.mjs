import { isContested, rollLevelOf } from "./economy.mjs";
export function playbook(plan, analysis, options, metadata) {
  const carry =
    plan.board.find((u) => u.name === plan.carry) ||
    plan.board.find((u) => u.range >= 3) ||
    plan.board[0];
  if (!carry) return null;
  const pool = analysis.pool.find((p) => p.name === carry.name);
  const currentLevel = options.level,
    gold = options.gold,
    hp = analysis.self.health;
  const targetLevel = plan.board.length,
    rollLevel = rollLevelOf({ carryCost: carry.cost });
  const owned = pool?.own ?? 0,
    enemy = pool?.enemy ?? 0,
    needed = Math.max(0, 9 - owned),
    possible = (pool?.remainingUpper ?? 0) >= needed;
  const reroll = carry.cost <= 2 || (carry.cost === 3 && owned >= 4);
  const style = reroll
    ? "Slow roll"
    : carry.cost >= 5
      ? "Fast 9"
      : carry.cost >= 4
        ? "Fast 8"
        : "Flex e estabilização";
  const actions = [],
    canAct = metadata.actionable && hp > 0;
  let headline = "Economize e preserve seu tabuleiro";
  if (!canAct) {
    headline =
      hp <= 0
        ? "Hero está eliminado: análise de planejamento"
        : "Aguarde uma leitura válida da partida";
    actions.push(
      "Não execute decisões de gasto com base em um snapshot antigo ou de outra sessão.",
    );
  } else if (hp <= 35) {
    headline = "Estabilize antes de insistir na comp";
    actions.push(
      "Priorize upgrades 2★ de tanque e carry, use itens úteis e complete uma frontline funcional.",
    );
    if (gold !== null)
      actions.push(
        `Com ${gold}g informado, considere gastar para estabilizar; não espere 50g se estiver perdendo lutas por margem grande.`,
      );
  } else if (currentLevel < Math.min(targetLevel, rollLevel)) {
    headline = `Prepare o nível ${Math.min(targetLevel, rollLevel)}`;
    actions.push(
      `Não role repetidamente no nível ${currentLevel} por um carry de custo ${carry.cost}. Preserve unidades temporárias fortes até poder acessar a meta.`,
    );
    if (gold !== null && gold < 50)
      actions.push(
        `Acumule a partir dos ${gold}g informados. Preserve o próximo patamar de 10g quando sua vida permitir.`,
      );
    else
      actions.push(
        "Com economia confortável, invista em experiência gradualmente sem desmontar a frontline.",
      );
  } else if (reroll && (!possible || isContested(pool))) {
    headline = "Evite forçar 3★ nesta disputa";
    actions.push(
      `${enemy} cópias nominais de ${carry.name} estão com rivais; faltam ${needed} para 3★ e o teto livre é ${pool?.remainingUpper ?? 0}. Considere 2★ e um carry alternativo dentro da meta.`,
    );
  } else if (reroll && gold !== null && gold >= 50 && hp > 45) {
    headline = `Slow roll por ${carry.name}`;
    actions.push(
      `Role somente o excedente acima de 50g no nível ${rollLevel}; reserve ouro também para comprar as unidades que aparecerem.`,
    );
    actions.push(
      `Progresso nominal de ${carry.name}: ${owned}/9 cópias para 3★. Pare para reavaliar se a disputa ou sua vida piorar.`,
    );
  } else if (!reroll && owned < 3 && currentLevel >= rollLevel) {
    headline = `Busque ${carry.name} 2★ e a frontline`;
    actions.push(
      `No nível ${currentLevel}, role para estabilizar o núcleo da meta; não persiga 3★ de custo alto.`,
    );
    if (gold !== null)
      actions.push(
        `Ouro informado: ${gold}g. Use um orçamento definido e preserve uma reserva quando sua vida permitir.`,
      );
  } else if (gold !== null && gold < 50) {
    headline = "Acumule antes do próximo gasto";
    actions.push(
      `Você informou ${gold}g. Segure a economia se o tabuleiro estiver vencendo ou perdendo pouco; priorize compras que completem upgrades.`,
    );
  } else {
    actions.push(
      `Mantenha ${carry.name} como direção; compre o núcleo, preserve frontline 2★ e prepare nível ${targetLevel}.`,
    );
  }
  if (gold === null)
    actions.push(
      "Informe seu ouro para definir um orçamento. Não foi encontrada uma leitura automática confiável de ouro.",
    );
  const reserves = plan.transitions
    .filter((t) => t.source === "reserve")
    .map((t) => t.enter.name);
  if (reserves.length)
    actions.push(
      "Já na sua reserva informada: " +
        reserves.join(", ") +
        ". Prepare essas unidades para entrar.",
    );
  const buys = plan.transitions
    .filter((t) => t.source !== "reserve")
    .map((t) => t.enter.name);
  if (buys.length)
    actions.push(
      "Comprar se aparecer: " +
        buys.slice(0, 5).join(", ") +
        ". Prepare a substituta antes de reservar a unidade que sai.",
    );
  const freeItems = plan.itemPlans.filter((p) => p.slotsFree > 0).slice(0, 2);
  for (const p of freeItems)
    if (p.additions.length)
      actions.push(
        `Itens para ${p.name}: ${p.additions.map((i) => i.name).join(", ")}. Confira os componentes livres antes de combinar.`,
      );
  return {
    style,
    headline,
    actions,
    targetLevel,
    rollLevel,
    carry: carry.name,
    gold,
    currentLevel,
    levelEstimated: options.levelEstimated,
    alive: hp > 0,
    actionable: canAct,
    progress: {
      owned,
      target: reroll ? 9 : 3,
      enemy,
      remainingUpper: pool?.remainingUpper ?? 0,
    },
    odds: analysis.odds,
    note: "Plano heurístico usando HP/cópias observados e nível/ouro informados ou estimados. Não simula dano por rodada, streak, experiência restante ou augments de economia.",
  };
}
