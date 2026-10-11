// Frescor e origem dos dados de meta (MetaTFT offline, ver meta-store.mjs): o servidor manda `freshness` junto da lista de
// comps e do tier de itens; aqui vira uma nota curta ao lado da fonte que a tela já mostra. Em dia e vindo da rede não há nota.

/** "menos de 1 min", "12 min", "5 h", "3 d" a partir de milissegundos. */
export function metaAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "idade desconhecida";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/**
 * Nota sobre a origem/idade dos dados de meta: `{text, tone}` ou `null` quando estão em dia e vieram da rede.
 * `fetchedAt` (ISO) é a data da cópia em uso; `now` em ms (injetável nos testes).
 */
export function metaNote(freshness, fetchedAt, now = Date.now()) {
  if (!freshness) return null;
  if (freshness.origin === "ausente")
    return { text: "sem dados de meta (offline e sem cópia)", tone: "danger" };
  const at = Date.parse(fetchedAt ?? freshness.fetchedAt);
  const age = Number.isFinite(at) ? metaAge(now - at) : "idade desconhecida";
  const via =
    freshness.origin === "repositorio" ? " · snapshot do repositório" : "";
  if (freshness.mode === "offline")
    return { text: `offline · dados de ${age}${via}`, tone: "amber" };
  if (freshness.mode === "desatualizado")
    return { text: `desatualizada · dados de ${age}${via}`, tone: "amber" };
  if (freshness.origin === "repositorio")
    return { text: "snapshot do repositório", tone: null };
  if (freshness.recovered)
    return { text: "recuperada de uma cópia anterior", tone: null };
  return null;
}
