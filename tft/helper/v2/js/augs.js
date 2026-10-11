/**
 * Aprimoramentos: o caminho escolhido na partida (2-1, 3-2, 4-2), a oferta aberta e o registro local de correções.
 * Oferta e escolhidos vêm do GEP (Overwolf, lido pelo servidor; sem OCR): o servidor manda `screen.augmentOffer`,
 * `screen.augmentSource` e, na análise, `chosenAugments` (source "gep"). A marcação à mão só corrige (desmarcar).
 */
export const AUG_STAGES = ["2-1", "3-2", "4-2"];

/** Nome legível de um id do GEP enquanto a análise não traz o nome do catálogo: "DA_18_BranchingOutPlus" → "Branching Out Plus". */
export const augLabel = (text) =>
  String(text ?? "")
    .replace(/^(DA_|TFT\d*_Augment_)(\d+_)?/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();

/** Motivos do GEP (gepStatus.reason) em palavras, para o "sem fonte". */
const GEP_REASON = {
  "banco-ausente":
    "o TFTAcademy (Overwolf) não gravou eventos neste computador",
  "sem-eventos-recentes": "o GEP está sem eventos novos",
  "fora-de-partida": "fora de partida",
  "partida-encerrada": "a partida do GEP já terminou",
  "outra-partida": "o GEP está em outra partida",
  "gravacao-desligada": "a gravação de partidas do TFTAcademy está desligada",
  desligada: "a fonte GEP está desligada",
};

/**
 * Oferta de aprimoramentos para a tela (Ao vivo e overlay), sem DOM. `screen` = `state.screen` do servidor
 * (`augmentOffer` = `{open, stage, cards: [{slot, id, text, rerolled}], unresolved}` e `augmentSource` = `{state, reason,
 * held, picked, unresolved}`); `advice` = `rec.augmentAdvice` da última análise. A análise só vale para a oferta de AGORA
 * (mesmo conjunto de cartas); enquanto a nova não chega, `pending` e as cartas vêm com o nome do GEP.
 * Devolve `{ source: {state, text, title} | null, augmentRound, open, stage, pending, comp, note, cards, unresolved }`; cada carta:
 * `{ id, name, rank, best, reroll, rerolled, unknown, desc, reasons, expected, measured, tier, estimated }`.
 */
export function augOfferView(screen, advice = null) {
  const src = screen?.augmentSource ?? null,
    offer = screen?.augmentOffer ?? null,
    unresolved = src?.unresolved ?? offer?.unresolved ?? [];
  const source = !src
    ? null
    : src.state === "sem-fonte"
      ? {
          state: "sem-fonte",
          text: "aprimoramentos: sem fonte",
          title: `Sem o GEP (${GEP_REASON[src.reason] ?? src.reason ?? "motivo desconhecido"}): oferta e escolhidos não são lidos, e o helper não lê os cards da tela (sem OCR).${src.held ? " Os escolhidos já lidos nesta partida continuam valendo." : ""}`,
        }
      : src.state === "aguardando"
        ? {
            state: "aguardando",
            text: "aprimoramentos: aguardando o jogo",
            title:
              "GEP ativo, ainda sem nenhum evento de aprimoramento nesta partida (normal antes do 2-1).",
          }
        : {
            state: "ativo",
            text: "lidos do jogo",
            title:
              "Oferta e escolhidos lidos do jogo pelo GEP (Overwolf), sem marcar nada.",
          };
  const open = offer?.open === true && (offer.cards?.length ?? 0) > 0;
  const base = {
    source,
    // Rodada de aprimoramento agora (2-1, 3-2, 4-2) pelo estágio lido: onde o "sem fonte" importa.
    augmentRound: AUG_STAGES.includes(screen?.stage ?? ""),
    open,
    stage: offer?.stage ?? null,
    pending: false,
    comp: null,
    note: null,
    cards: [],
    unresolved,
  };
  if (!open) return base;
  const bySlot = offer.cards,
    ofId = new Map(bySlot.filter((c) => c.id).map((c) => [c.id, c])),
    key = [...ofId.keys()].sort().join("|"),
    unknown = bySlot
      .filter((c) => !c.id)
      .map((c) => ({
        id: null,
        name: augLabel(c.text) || c.text,
        rank: null,
        best: false,
        reroll: false,
        rerolled: c.rerolled === true,
        unknown: true,
        desc: null,
        reasons: ["Fora do catálogo do helper: não foi avaliado."],
        expected: null,
        measured: null,
        tier: null,
        estimated: false,
      }));
  if (!advice?.choices?.length || advice.key !== key)
    return {
      ...base,
      pending: ofId.size > 0,
      cards: [
        ...bySlot
          .filter((c) => c.id)
          .map((c) => ({
            id: c.id,
            name: augLabel(c.text) || c.id,
            rank: null,
            best: false,
            reroll: false,
            rerolled: c.rerolled === true,
            unknown: false,
            desc: null,
            reasons: [],
            expected: null,
            measured: null,
            tier: null,
            estimated: false,
          })),
        ...unknown,
      ],
    };
  return {
    ...base,
    comp: advice.comp ?? null,
    note: advice.note ?? null,
    cards: [
      ...advice.choices.map((c, i) => {
        const rerolled = ofId.get(c.id)?.rerolled === true;
        return {
          id: c.id,
          name: c.name,
          rank: i + 1,
          best: c.id === advice.pick,
          // Cada carta troca uma vez: a já trocada não recebe a sugestão de trocar.
          reroll: c.reroll === true && !rerolled,
          rerolled,
          unknown: false,
          desc: c.desc ?? null,
          reasons: c.reasons ?? [],
          expected: c.expected ?? null,
          measured: c.measured ?? null,
          tier: c.tier ?? null,
          estimated: c.estimated === true,
        };
      }),
      ...unknown,
    ],
  };
}

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
