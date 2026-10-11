// Regras de bolso desta ferramenta (não do jogo): todos os limiares de ouro e de vida moram aqui (M5b). Sem imports nem
// I/O: carrega igual no servidor e no navegador. `economy.mjs` reexporta o MESMO objeto (testes e o golden perturbam
// `POLICY.floor.*` e `POLICY.hp.*` por ele).

/** Regras de bolso desta ferramenta (não do jogo). Nenhum outro módulo escreve um limiar de ouro ou de vida. */
export const POLICY = {
  // Nível esperado ao fim de cada estágio-rodada numa curva padrão: [estágio, rodada, nível].
  curve: [
    [2, 1, 4],
    [2, 5, 5],
    [3, 2, 6],
    [4, 1, 7],
    [4, 5, 8],
    [5, 5, 9],
  ],
  // Faixas de vida. Perigo: HP ≤ danger, ou ≤ dangerLate a partir do estágio lateStage, ou ≤ weak com board fraca.
  // `fastReroll`: reroll rápido (piso fastReroll) com a vida até aqui; é o ÚNICO piso de reroll rápido (D4).
  // `low`/`comfortable`: nível-alvo (target-level.mjs) estabiliza com HP ≤ low e mira mais alto com HP ≥ comfortable.
  // `shaky`: aprimoramento de economia rende pouco com HP abaixo disto (augment-advice.mjs).
  hp: {
    critical: 20,
    danger: 30,
    dangerLate: 45,
    weak: 50,
    hurt: 60,
    fastReroll: 50,
    low: 35,
    comfortable: 70,
    shaky: 40,
  },
  lateStage: 4,
  // Tendência da vida (streak.mjs mede, pressureOf decide): a média das últimas `drops` quedas e as perdas na janela
  // `windowMs` (~4 rodadas). No ritmo da média, chegar a `floorHp` de vida em `rounds` rodadas é perigo; `losses` ou mais
  // perdas recentes com vida ≤ `lossesHp` também (o tabuleiro não segura o lobby: estabilizar antes da vida acabar).
  trend: {
    drops: 3,
    windowMs: 5 * 60 * 1000,
    rounds: 3,
    floorHp: 15,
    losses: 3,
    lossesHp: 65,
  },
  // Ouro que fica guardado depois de gastar, por faixa; no reroll lento o piso é 50 e no rápido, fastReroll. A árvore de
  // estratégia também lê estes pisos como colchão depois de comprar XP: perigo `danger`, reroll antes do nível `healthy`,
  // 3★ inviável e comp de nível `hurt` (nunca exige mais que `hurt` para subir).
  floor: { healthy: 50, hurt: 30, danger: 10, critical: 0, fastReroll: 20 },
  // Peso do ouro futuro frente à força agora: 1 = cada ouro precisa render a média do plano; 0 = gaste tudo.
  urgency: { healthy: 1, hurt: 0.6, danger: 0.25, critical: 0 },
  // Rodadas de juros em jogo quando o gasto derruba o patamar.
  horizon: { healthy: 3, hurt: 2, danger: 1, critical: 0 },
  // Board abaixo da maioria do lobby: rola por upgrades antes do nível de rolagem se sobrar pelo menos este ouro.
  weakLobbySpare: 6,
  // Lojas ao alcance do motor de comps: `base` lojas mais as que o ouro de agora e a renda (base + juros, sem sequência) das
  // próximas `rounds` rodadas pagam guardando `reserve` g. Ouro não lido conta como `assumedGold` (D14: decisão visível).
  shopsAhead: { base: 3, rounds: 4, reserve: 10, assumedGold: 30 },
  // 3★ disputado: desista com tantas cópias com rivais ou acima desta fração da pool.
  contested: { copies: 6, share: 0.35 },
  // Força de uma unidade = custo × fator da estrela (+ itens); a mesma régua do lobby.
  star: [0, 1, 1.8, 3.2],
  itemMight: 0.6,
  // Valor de um upgrade no ganho esperado: carry pesa mais, cada item equipado soma 25%; unidade nova vale metade.
  carryWeight: 2,
  itemWeight: 0.25,
  newUnitWeight: 0.5,
  // Simulação de rolagem: corridas, semente fixa (resultado determinístico) e teto de ouro simulado.
  simulation: { runs: 500, seed: 0x7f4a7c15, maxGold: 120 },
  // Rolar pelo time inteiro (roll.mjs): vale rolar com pelo menos `chance` de evoluir alguma peça que valha a
  // evolução (`minValue` de força: um 2★ de custo 1 da comp não vale rolar sozinho); o carry pesa `carryWeight`,
  // os demais cores `coreWeight` e a peça fora da comp `offPlanWeight`; a espera pelo nível de rolagem só é
  // sugerida se a chance subir `waitMargin`; `rows` limita a lista enviada e `simTargets` os alvos da simulação conjunta.
  roll: {
    chance: 0.5,
    minValue: 1,
    coreWeight: 1.5,
    offPlanWeight: 0.6,
    waitMargin: 0.15,
    rows: 14,
    simTargets: 10,
  },
  // Fração do ganho máximo que ainda conta como "tão bom quanto" ao escolher quanto rolar.
  spendTolerance: 0.04,
};
