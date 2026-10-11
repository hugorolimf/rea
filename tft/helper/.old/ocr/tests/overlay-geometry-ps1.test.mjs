// ARQUIVO HISTÓRICO (não roda na suíte). Veio de tests/overlay-geometry.test.mjs, seção "(a) guarda contra divergência com
// o leitor de tela", quando o leitor de tela (screen-reader.ps1) foi removido do helper e arquivado em .old/ocr/.
// Comparava HUD_REGIONS de overlay/hud/geometry.mjs com as tabelas $GOLD $LEVEL $XP $STAGE $SLOT $SHOP e com a tolerância
// de 16:9 da função Hud-Rect do .ps1. Hoje o teste ativo fixa os valores literais de HUD_REGIONS; este arquivo só guarda a
// verificação original, com o caminho ajustado para o .ps1 arquivado.
// Rodar à mão (a partir de tft/helper): node --test .old/ocr/tests/overlay-geometry-ps1.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HUD_REGIONS } from "../../../overlay/hud/geometry.mjs";

const ps1 = fs.readFileSync(
  new URL("../screen-reader.ps1", import.meta.url),
  "utf8",
);

/** Tabela `$NOME = @{ X = 0.1; Y = ... }` do leitor, com as chaves em minúsculas (tolerante a espaços e a comentários). */
function psTable(name) {
  const m = new RegExp(`^\\$${name}\\s*=\\s*@\\{([^}]*)\\}`, "m").exec(ps1);
  assert.ok(m, `$${name} não encontrada em screen-reader.ps1`);
  const table = {};
  for (const part of m[1].split(";")) {
    if (!part.trim()) continue;
    const kv = /^\s*(\w+)\s*=\s*(-?[0-9]*\.?[0-9]+)\s*$/.exec(part);
    assert.ok(kv, `$${name}: trecho ilegível "${part}"`);
    table[kv[1].toLowerCase()] = Number(kv[2]);
  }
  return table;
}

test("geometria: HUD_REGIONS bate com os números do leitor (screen-reader.ps1 arquivado)", () => {
  const pairs = [
    ["GOLD", HUD_REGIONS.gold],
    ["LEVEL", HUD_REGIONS.level],
    ["XP", HUD_REGIONS.xp],
    ["STAGE", HUD_REGIONS.stage],
    ["SLOT", HUD_REGIONS.bankSlot],
    ["SHOP", HUD_REGIONS.shopName],
  ];
  for (const [name, region] of pairs) {
    const table = psTable(name);
    assert.deepEqual(
      Object.keys(table).sort(),
      Object.keys(region).sort(),
      `$${name}: o leitor e HUD_REGIONS têm chaves diferentes`,
    );
    for (const [key, value] of Object.entries(table))
      assert.equal(
        region[key],
        value,
        `$${name}.${key}: leitor ${value}, geometry.mjs ${region[key]}`,
      );
  }
  assert.equal(HUD_REGIONS.bankSlot.count, 10);
  assert.equal(HUD_REGIONS.shopName.count, 5);
});

test("geometria: a tolerância de 16:9 do Hud-Rect do leitor era 1%", () => {
  // Hud-Rect do leitor: a diferença |w*9 - h*16| tolerada é 1% de h*16.
  assert.match(
    ps1,
    /\[Math\]::Abs\(\$w \* 9 - \$h \* 16\) -le \$h \* 16 \* 0\.01/,
  );
});
