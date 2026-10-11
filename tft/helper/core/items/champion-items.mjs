// Itens recomendados de um campeão com a situação de cada um segundo o seu inventário: a lista completa (até 3 itens
// ideais), não só o próximo. É a mesma conta da janela de itens da Formação (`buildStates` em `holdings.mjs`); aqui só
// se acrescenta o rótulo curto que a interface e o overlay desenham (ícone + marca + palavra). Função pura.
import { buildStates } from "./holdings.mjs";

/**
 * Vocabulário curto de cada situação de `locateItem`: `label` (uma palavra ou duas, para ficar ao lado do ícone),
 * `mark` (símbolo do sprite) e `tone` (`done` = já resolvido, `go` = dá para fazer agora, `wait` = falta algo).
 * `ready` cobre "pronto no banco" e "monta agora" (o texto de `state.text` diz qual).
 */
export function stateBrief(state) {
  const text = state?.text ?? "";
  switch (state?.kind) {
    case "on":
      return { label: "equipado", mark: "check", tone: "done" };
    case "ready":
      return text.startsWith('monta')
        ? { label: "monta agora", mark: "up", tone: "go" }
        : { label: "no banco", mark: "bank", tone: "go" };
    case "move":
      return { label: "mover", mark: "swap", tone: "go" };
    case "taken":
      return { label: "em uso", mark: "pause", tone: "wait" };
    case "half":
      return {
        label: `falta ${state.missing ?? ""}`.trim(),
        mark: "plus",
        tone: "wait",
      };
    default:
      return {
        label:
          Number.isInteger(state?.missing) && state.missing > 0
            ? `falta ${state.missing}`
            : "falta",
        mark: "plus",
        tone: "wait",
      };
  }
}

/**
 * Itens ideais do campeão `cell` (da Formação: `{ id, build: { ideal, equipped, owners, moves } }`) na ordem da build,
 * cada um com `{ item, kind, text, label, mark, tone, from, missing, next }`:
 * - `from`: dono de quem o item vem (`{ id, name }`) quando `kind` é `move` ou `taken`;
 * - `next`: o primeiro item que ainda não está equipado (o destaque "próximo item").
 * `bank`: ids do banco lido ([] se vazio ou desconhecido).
 */
export function championItems(cell, bank = []) {
  let marked = false;
  return buildStates(cell, bank).map(({ item, state }) => {
    // Emblema que a peça não pode usar (já tem a sinergia) e item sem receita que você não tem (artefato): ficam na
    // build publicada, mas não há o que montar.
    const brief = item.blocked
        ? { label: "não equipa", mark: "pause", tone: "wait" }
        : state.kind === "need" && !(item.components ?? []).length
          ? { label: "sem receita", mark: "plus", tone: "wait" }
          : stateBrief(state),
      next = !marked && state.kind !== "on" && !item.blocked;
    if (next) marked = true;
    return {
      item: { id: item.id, name: item.name },
      kind: state.kind,
      text: state.text ?? "",
      blocked: item.blocked === true,
      ...brief,
      from: state.from
        ? { id: state.from.unitId ?? null, name: state.from.name ?? "" }
        : null,
      missing: Number.isInteger(state.missing) ? state.missing : null,
      next,
    };
  });
}
