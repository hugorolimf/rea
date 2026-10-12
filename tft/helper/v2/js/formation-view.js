/**
 * Seletor da Formação ("Fixada"/"Recomendada"): qual comp o tabuleiro, as sinergias e o título mostram. O "Copiar
 * código" copia a comp fixada quando há uma (a escolha do usuário), mesmo vendo a outra; sem fixada, a que está à vista.
 * Estado só de interface (não fixa nem desfixa nada, não chama API, não persiste). Puro, sem DOM.
 */

/** Nome da vista no chip do cabeçalho. */
const VIEW_LABEL = {
  fixada: "Fixada",
  recomendada: "Recomendada",
  sugerida: "1ª sugerida",
};

/**
 * O que a Formação mostra de `model.plan` (`plan.formation`, model.js `formationChoice`). Com `wantAlt` e uma
 * `formation.alt`, mostra a outra comp; sem `alt`, sempre a padrão. `missing` não vazio = a análise não trouxe o que
 * desenhar (sem casas). `note` é a nota de plano mantido, só quando a outra vista é a 1ª sugerida. `toggle` é o botão
 * que troca a vista (`pressed` quando a outra está à vista), ou null sem outra comp. Não altera `plan`.
 * Devolve `{ which, label, title, cells, traits, teamCode, teamCodeError, missing, note, toggle }` (null sem plano).
 */
export function formationShown(plan, wantAlt = false) {
  if (!plan) return null;
  const f = plan.formation ?? null,
    alt = f?.alt ?? null,
    shown = f?.shown ?? "recomendada",
    note = alt?.which === "sugerida" ? (f?.note ?? null) : null;
  if (wantAlt && alt) {
    const missing = alt.missing ?? [];
    return {
      which: alt.which,
      label: VIEW_LABEL[alt.which] ?? alt.which,
      title: alt.title ?? "",
      cells: missing.length ? [] : (alt.cells ?? []),
      traits: alt.traits ?? [],
      // Com uma comp fixada, "Copiar código" copia SEMPRE a fixada (a que o usuário escolheu), mesmo vendo a outra.
      teamCode:
        shown === "fixada" ? (plan.teamCode ?? null) : (alt.teamCode ?? null),
      teamCodeError:
        shown === "fixada"
          ? (plan.teamCodeError ?? null)
          : (alt.teamCodeError ?? null),
      missing,
      note,
      // "ver fixada" / "ver recomendada": o botão volta para a vista padrão.
      toggle: {
        label: `ver ${(f?.label ?? VIEW_LABEL[shown]).toLowerCase()}`,
        pressed: true,
      },
    };
  }
  return {
    which: shown,
    label: f?.label ?? VIEW_LABEL[shown],
    title: plan.title ?? "",
    cells: plan.cells ?? [],
    traits: plan.traits ?? [],
    teamCode: plan.teamCode ?? null,
    teamCodeError: plan.teamCodeError ?? null,
    missing: [],
    note,
    toggle: alt ? { label: alt.label, pressed: false } : null,
  };
}
