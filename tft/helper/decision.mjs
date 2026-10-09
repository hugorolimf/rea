// Veredito heurístico: evoluir a comp atual, ajustar parte dela ou trocar de direção.
// Usa só o que é observado (unidades em campo, itens equipados, HP, disputa) e o ouro quando informado.
// Não simula combate, streak nem experiência; os limiares são regras de bolso, não taxas de vitória.
export function decide(analysis, options) {
  const recs = analysis.recommendations ?? [];
  if (!recs.length) return null;
  const units = analysis.self.units,
    current = units.length,
    hp = analysis.self.health,
    gold = options.gold;
  const info = recs.map((r, i) => {
    const leaving = r.benchInstead.length;
    return {
      i,
      r,
      leaving,
      kept: current - leaving,
      share: current ? leaving / current : 0,
      itemsAtRisk: units
        .filter((u) => r.benchInstead.includes(u.name))
        .reduce((n, u) => n + (u.itemNames?.length ?? 0), 0),
      contested: r.targets.filter((t) => t.enemyCopies > 0).length,
      toBuy: r.targets.length,
      orphans: r.components?.orphanItems ?? 0,
    };
  });
  const best = info[0],
    gentle = [...info].sort((a, b) => a.leaving - b.leaving || a.i - b.i)[0],
    gain = Math.round((best.r.score - gentle.r.score) * 10) / 10;
  const out = (verdict, label, pick, reasons) => ({
    verdict,
    label,
    rank: pick.i,
    title: pick.r.title,
    carry: pick.r.carry,
    kept: pick.kept,
    leaving: pick.leaving,
    current,
    reasons: [
      ...reasons,
      pick.itemsAtRisk
        ? `${pick.itemsAtRisk} item(ns) estão em unidades que sairiam: só troque com a substituta pronta.`
        : "Nenhum item equipado fica em unidade que sai.",
      pick.toBuy
        ? `${pick.toBuy} campeão(ões) a comprar, ${pick.contested} com cópias em rivais.`
        : "Nenhuma compra nova necessária.",
      ...(pick.orphans > 0
        ? [
            `${Math.round(pick.orphans * 10) / 10} item(ns) ficariam sem portador compatível.`,
          ]
        : []),
    ],
    note: "Regra heurística sobre o snapshot; não simula combate.",
  });
  if (hp <= 0)
    return {
      verdict: "encerrado",
      label: "Partida encerrada",
      rank: best.i,
      title: best.r.title,
      carry: best.r.carry,
      kept: best.kept,
      leaving: best.leaving,
      current,
      reasons: [
        "Hero está eliminado neste snapshot; as rotas abaixo servem só para revisão.",
      ],
      note: "Aguardando a próxima partida.",
    };
  if (current < 3)
    return out("montar", "Montar comp", best, [
      current
        ? `Início de partida (${current} unidade(s) em campo): ainda não há comp para trocar. Esta é a melhor do meta para começar; ela se ajusta conforme você pega unidades e itens.`
        : "Nenhuma unidade conhecida em campo nesta leitura.",
    ]);
  if (best.share <= 0.25)
    return out("evoluir", "Evoluir a comp atual", best, [
      `A melhor rota mantém ${best.kept} de ${current} unidades suas${best.leaving ? `; só ${best.leaving} troca(s)` : ""}.`,
    ]);
  if (
    gentle.i !== best.i &&
    gentle.share <= 0.25 &&
    (hp <= 45 || gain < best.r.score * 0.06)
  )
    return out("evoluir", "Evoluir a comp atual", gentle, [
      hp <= 45
        ? `HP ${hp}: trocar ${best.leaving} de ${current} unidades agora custa rodadas que você não tem.`
        : `A rota de maior pontuação exigiria ${best.leaving} trocas por um ganho pequeno (${gain} pontos).`,
      `Esta rota mantém ${gentle.kept} de ${current} unidades.`,
    ]);
  if (best.share <= 0.5)
    return out("ajustar", "Ajustar a comp", best, [
      `Mantenha ${best.kept} de ${current} unidades e troque ${best.leaving}.`,
    ]);
  if (hp <= 40 && (gold === null || gold < 30))
    return out("estabilizar", "Estabilizar antes de trocar", gentle, [
      `HP ${hp}${gold === null ? "" : ` e ${gold}g`}: trocar ${best.leaving} de ${current} unidades é arriscado agora.`,
      `Reforce o que já tem; esta rota mantém ${gentle.kept} de ${current} unidades.`,
    ]);
  return out("trocar", "Trocar de comp", best, [
    `Só ${best.kept} de ${current} unidades suas servem na melhor rota${gentle.i !== best.i ? `; ela pontua ${gain} acima da rota que mais preserva seu campo` : ""}.`,
    `HP ${hp}${gold === null ? "" : ` e ${gold}g`} permitem a transição; troque aos poucos, frontline primeiro.`,
  ]);
}
