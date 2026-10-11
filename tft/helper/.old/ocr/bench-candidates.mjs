import path from "node:path";

/**
 * Ícones que o leitor de tela compara com cada espaço do banco de itens: [{id, file}]. Só itens que ficam no banco (fora
 * aprimoramentos de item, encantos e conversores) e um id por arquivo: ícones idênticos zeram a folga entre o 1º e o 2º
 * candidato e o espaço viraria "?". Em empate de ícone fica o item base, não a variação radiante (a ordem põe os
 * radiantes por último). `icons` é o manifesto id → arquivo relativo a `root`.
 */
export function benchCandidates(catalog, icons, root) {
  const seen = new Set(),
    out = [];
  const usable = catalog.items
    .filter(
      (i) =>
        icons[i.apiName] &&
        !i.isAugment &&
        // Mecânicas do set (Charm, Upgrade, Radiantize...) não têm ícone próprio: usam o ícone genérico "mechanicicon" (um
        // quadrado branco no manifesto) e não ocupam o banco. Como candidato, o quadrado branco só sujaria a comparação.
        !/mechanicicon/.test(i.icon ?? "") &&
        // Melhoria do Mestre-Artesão (Masterwork) é item de banco, apesar do "Upgrade" no id.
        !/(?<!Masterwork)Upgrade|Charm|Radiantize|Artifactinate|Potioncraft/.test(
          i.apiName,
        ),
    )
    .sort((a, b) => /Radiant/.test(a.apiName) - /Radiant/.test(b.apiName));
  for (const i of usable) {
    if (seen.has(icons[i.apiName])) continue;
    seen.add(icons[i.apiName]);
    out.push({ id: i.apiName, file: path.join(root, icons[i.apiName]) });
  }
  return out;
}
