/**
 * Aprimoramentos: o caminho escolhido na partida (2-1, 3-2, 4-2) e o registro local das escolhas.
 * O jogo não publica no arquivo do tabuleiro qual carta você pegou; a escolha é marcada na interface.
 */
export const AUG_STAGES = ["2-1", "3-2", "4-2"];

/** Posição da escolha na trilha pelo estágio lido (2-x, 3-x, 4-x); null quando o estágio é desconhecido. */
export const slotOfStage = (stage) => {
  const n = Number(/^(\d)-\d$/.exec(stage ?? "")?.[1]);
  return n >= 2 && n <= 4 ? n - 2 : null;
};

/**
 * Trilha de 3 posições. `records` são as escolhas na ordem em que foram marcadas ({id, stage});
 * `known` é Map id→aprimoramento do servidor. Escolha sem estágio ocupa a primeira posição livre.
 * Devolve [{stage, aug|null, record|null}].
 */
export function augPath(records, known = new Map()) {
  const slots = AUG_STAGES.map((stage) => ({ stage, aug: null, record: null }));
  const later = [];
  for (const r of records) {
    const i = slotOfStage(r.stage);
    if (i !== null && !slots[i].record)
      slots[i] = { ...slots[i], record: r, aug: known.get(r.id) ?? null };
    else later.push(r);
  }
  for (const r of later) {
    const free = slots.find((s) => !s.record);
    if (!free) break;
    Object.assign(free, { record: r, aug: known.get(r.id) ?? null });
  }
  return slots;
}

/** Posição da próxima escolha: a do estágio atual, se livre; senão a primeira livre. */
export function nextSlot(slots, stage) {
  const i = slotOfStage(stage);
  if (i !== null && !slots[i].record) return i;
  const free = slots.findIndex((s) => !s.record);
  return free < 0 ? null : free;
}

/**
 * Escolhas por partida, no formato de localStorage. Só valem dentro da partida em que foram marcadas;
 * fora de partida ("lobby") não há escolha a guardar.
 */
export function augStore(storage, name = "tft-compass-augments") {
  const read = () => {
    try {
      const v = JSON.parse(storage.getItem(name) ?? "null");
      return v && typeof v.match === "string" && Array.isArray(v.picks)
        ? {
            match: v.match,
            picks: v.picks.filter((p) => p && typeof p.id === "string"),
          }
        : null;
    } catch {
      return null;
    }
  };
  const write = (v) => {
    try {
      if (v) storage.setItem(name, JSON.stringify(v));
      else storage.removeItem(name);
    } catch {}
  };
  return {
    get(matchKey) {
      const v = read();
      return v && v.match === matchKey ? v.picks : [];
    },
    /** Há registro desta partida (mesmo vazio, depois de remover): a lista enviada ao servidor vale como está. */
    has(matchKey) {
      return matchKey !== "lobby" && read()?.match === matchKey;
    },
    add(matchKey, id, stage, name) {
      if (matchKey === "lobby") return;
      const picks = this.get(matchKey).filter((p) => p.id !== id);
      write({
        match: matchKey,
        picks: [
          ...picks,
          { id, stage: stage ?? null, name: name ?? null },
        ].slice(-8),
      });
    },
    remove(matchKey, id) {
      write({
        match: matchKey,
        picks: this.get(matchKey).filter((p) => p.id !== id),
      });
    },
  };
}
