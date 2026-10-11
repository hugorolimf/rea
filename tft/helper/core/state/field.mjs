// `Field<T>`: um valor do estado do jogo com a sua origem. null é "desconhecido"; um palpite nunca é um valor sem a
// confiança "estimated". ESM puro (o tempo entra como argumento: `now`).

/** Origens possíveis de um campo. "gamefile"/"sentry"/"lcu" são os arquivos e o cliente do jogo; "gep", os eventos do
 * Overwolf gravados pelo TFTAcademy. Não há leitura de tela. */
export const FIELD_SOURCES = [
  "gamefile",
  "sentry",
  "lcu",
  "gep",
  "manual",
  "derived",
  "estimated",
];

/** Quanto confiar: observado pelo jogo (GEP, arquivos) > derivado de regra > informado > estimado. */
export const FIELD_CONFIDENCE = ["observed", "derived", "manual", "estimated"];

/** Campo desconhecido: sem valor, sem origem. */
export const unknownField = () => ({
  value: null,
  source: null,
  confidence: null,
  at: null,
  ageMs: null,
  stale: false,
});

/**
 * Monta um campo. `ageMs` é a idade da observação (não da regravação do arquivo); com `now` calcula `at` (epoch ms).
 * Valor ausente (undefined) vira null e anula a origem: um campo sem valor não afirma nada.
 */
export function field(
  value,
  source,
  confidence,
  { ageMs = null, now = null, stale = false, ...extra } = {},
) {
  if (value === undefined || value === null) return unknownField();
  return {
    value,
    source,
    confidence,
    at: Number.isFinite(now) && Number.isFinite(ageMs) ? now - ageMs : null,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    stale: stale === true,
    ...extra,
  };
}

/** Confiança de uma origem do estado: o GEP e os arquivos do jogo são observados; o piso é derivado. */
export function confidenceOf(source) {
  switch (source) {
    case "gep":
    case "gamefile":
    case "sentry":
    case "lcu":
      return "observed";
    case "derived":
      return "derived";
    case "manual":
      return "manual";
    case "estimated":
      return "estimated";
    default:
      return null;
  }
}
