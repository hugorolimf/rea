// Rodar com: node --test tft/helper/tests/recommend-validate.test.mjs
// Validação da entrada do POST de recomendação (app/recommend.mjs). Regressão: a interface ao vivo só manda decisões, sem
// `gold` (nem `level`); o servidor decide pelo próprio estado. Antes, `gold` ausente virava NaN e a tela mostrava
// "Sem leitura do jogo: Ouro inválido." mesmo com o ouro lido normalmente.
import test from "node:test";
import assert from "node:assert/strict";
import { createRecommender } from "../app/recommend.mjs";

const SENTINEL = "validou: chegou ao estado";
const recommender = createRecommender({
  catalog: { champions: [], items: [] },
  current: async () => {
    throw Error(SENTINEL);
  },
});

const messageOf = async (input) => {
  try {
    await recommender.run(input);
  } catch (e) {
    return e.message;
  }
  return null;
};

test("ouro ausente, nulo ou vazio passa na validação (o servidor usa o próprio estado)", async () => {
  for (const input of [{}, { gold: null }, { gold: "" }, { gold: undefined }])
    assert.equal(await messageOf(input), SENTINEL, JSON.stringify(input));
});

test("ouro informado (partida revista) continua validado", async () => {
  assert.equal(await messageOf({ gold: 30 }), SENTINEL);
  for (const gold of [-1, 1000, 2.5, "abc"])
    assert.equal(await messageOf({ gold }), "Ouro inválido.", String(gold));
});
