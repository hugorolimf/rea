export function teamCode(ids, entries) {
  if (ids.length > 10)
    return {
      code: null,
      error: "O código do planejador aceita até dez campeões.",
    };
  const map = new Map(
    entries.map((c) => [c.character_id, c.team_planner_code]),
  );
  const codes = [];
  for (const id of ids) {
    const code = map.get(id);
    if (!Number.isInteger(code) || code <= 0 || code > 4095)
      return {
        code: null,
        error: "Campeão sem ID de importação confirmado: " + id,
      };
    if (codes.includes(code))
      return {
        code: null,
        error: "A equipe tem IDs de importação duplicados.",
      };
    codes.push(code);
  }
  return {
    code:
      "02" +
      [...codes, ...Array(10 - codes.length).fill(0)]
        .map((n) => n.toString(16).padStart(3, "0"))
        .join("") +
      "TFTSet18",
    error: null,
  };
}
