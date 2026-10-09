// Rodar com: node --test tft/helper/augment-advice.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { augmentAdvice } from "./augment-advice.mjs";

const catalog = {
  traits: [
    { apiName: "T_Guard", name: "Guarda" },
    { apiName: "T_Mage", name: "Mago" },
  ],
};
const plan = {
  title: "Guardas",
  board: [{ id: "A", name: "Alfa" }],
  traits: [{ name: "Guarda", count: 4, active: true }],
  strategy: { rollAt: 7, finalLevel: 8 },
};
const analysis = {
  self: { health: 70, units: [] },
  currentPlan: { traits: [] },
};
const aug = (id, name, desc, traits = []) => ({ id, name, desc, traits });

test("rolagens grátis no nível de roll da comp ganham destaque (regex do nível corrigida)", () => {
  const r = augmentAdvice(
    [
      aug(
        "roll7",
        "Rolagens",
        "Ganha 5 atualizações da loja ao chegar ao nível 7.",
      ),
      aug(
        "roll9",
        "Rolagens tarde",
        "Ganha 5 atualizações da loja ao chegar ao nível 9.",
      ),
    ],
    plan,
    analysis,
    catalog,
    { gold: 30 },
  );
  assert.equal(r.choices[0].id, "roll7");
  assert.match(
    r.choices[0].reasons.join(" "),
    /nível 7, que é exatamente o nível de roll/,
  );
  assert.match(
    r.choices[1].reasons.join(" "),
    /nível 9; sua comp rola no nível 7/,
  );
});

test("oferta que segue a sinergia de um aprimoramento já escolhido sobe na ordem", () => {
  const choices = [
    aug("g", "Coroa da Guarda", "", ["T_Guard"]),
    aug("m", "Coroa do Mago", "", ["T_Mage"]),
  ];
  const without = augmentAdvice(choices, plan, analysis, catalog, {});
  const withPath = augmentAdvice(choices, plan, analysis, catalog, {
    chosenAugments: [aug("g0", "Coração da Guarda", "", ["T_Guard"])],
  });
  const score = (r, id) => r.choices.find((c) => c.id === id).score;
  assert.ok(score(withPath, "g") > score(without, "g"));
  assert.equal(score(withPath, "m"), score(without, "m"));
  assert.match(
    withPath.choices.find((c) => c.id === "g").reasons.join(" "),
    /Segue o seu caminho: Coração da Guarda já puxa Guarda/,
  );
});
