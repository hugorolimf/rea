# Decisão da rodada: comprar, subir de nível, rolar e guardar numa conta só

Pedido do usuário (2026-10-11): "o rolar, o comprar nível e a meta não conversam entre si, parece que cada coisa é um
motor diferente." Executor: o orquestrador, direto (sem agentes em paralelo nesta área).

## 1. Como é hoje (verificado no código)

| Decisão                  | Onde                                                        | O que lê                                                | Problema                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qual comp (meta)         | `engine.mjs` (colocação esperada E, `core/comps/reach.mjs`) | estado, pool, rivais, itens                             | usa o nível-alvo de `level.target` (`target-level.mjs`) para o tamanho do tabuleiro                                                                                                               |
| Comprar                  | `stage.mjs` + `core/board/interim.mjs` (`buyNow`, `slots`)  | loja, ouro, reserva                                     | decide as compras com o ouro inteiro, sem saber se a rodada também vai subir de nível ou rolar                                                                                                    |
| Subir / rolar / guardar  | `strategy.mjs` `decide()` → `settle()` → `withoutTarget()`  | plano, ouro, XP, vida                                   | devolve **uma** ação (`ROLAR`, `SUBIR NÍVEL`, `ECONOMIZAR`); só no perigo junta nível + rolagem (`levelUp`). O nível final vem do estilo da meta (`finalLevelOf`), não do `level.target` do motor |
| Por quem rolar           | `core/roll/hunt.mjs` (`rollFor`, `hunt`)                    | time, orçamento da decisão                              | calculado depois da decisão; pode divergir dela (`hunt` informativo)                                                                                                                              |
| Selo de XP no overlay    | `overlay/hud/badges.mjs` `levelBadge`                       | `panels.leveling` **e** a curva padrão (`POLICY.curve`) | **regra própria**: "espere 4-1" e "não suba" são calculados no overlay, não pela decisão                                                                                                          |
| Selo de rolar no overlay | `badges.mjs` `rollBadge`                                    | `rolling.rollFor` → `call.targets` → `rolling.targets`  | três fontes em cascata                                                                                                                                                                            |
| Selo do ouro             | `badges.mjs` `goldBadge`                                    | `economy.keep` ou `economy.floor`                       | ok, mas o `keep` não desconta as compras da loja                                                                                                                                                  |
| Painel da interface      | `v2/js/model.js` (painel de decisão)                        | `panels.leveling/rolling/economy`                       | mostra os três painéis lado a lado, sem a ordem do que fazer                                                                                                                                      |

Consequências que o usuário vê: "suba" e "role" ao mesmo tempo sem o ouro para os dois; o selo de XP dizendo "espere"
enquanto a decisão manda subir (ou o contrário); compras da loja que o ouro da rolagem já gastou; o ranking escolhendo uma
comp de nível 9 enquanto a estratégia sobe só até o nível final do estilo da meta.

## 2. Desenho: um objeto `turn` por análise

`strategy()` passa a devolver, além dos painéis atuais, **`turn`**: a sequência do que fazer AGORA com o ouro de agora,
para a comp do plano (a fixada ou a recomendada), com o ouro descontado passo a passo.

```js
turn = {
  comp: { id, title }, // a mesma do plano exibido
  gold: { now, after, keep }, // ouro de agora, depois da sequência, e o piso que ela respeita
  steps: [
    // em ordem; cada passo já desconta o ouro dos anteriores
    { kind: "buy", id, name, slot, cost, why }, // cartas da loja (peça da comp, cópia que fecha estrela, temporário)
    { kind: "level", from, to, cost, why }, // XP comprado nesta rodada
    { kind: "roll", times, gold, targets, stopAt, why }, // rolagens, por quem (hunt) e onde parar
    { kind: "keep", gold, why }, // o que guardar (juros, nível da próxima rodada, vida)
  ],
  level: { now, target, next: { when, why } | null }, // o mesmo alvo do motor (level.target) e quando subir
  headline, // uma linha: "Compre Aphelios → suba para 8 → role 6× por Kayle 3★ → guarde 30g"
};
```

Regras:

1. **Uma conta de ouro só:** compras da loja primeiro (`stage.buyNow` / `slots` com `buy`), depois XP, depois rolagens;
   o piso (`keep`) vale para o total. Nenhum passo pode gastar ouro que um passo anterior já usou.
2. **O nível-alvo é um só:** `turn.level.target` = o `level.target` que o motor usou para escolher a comp; a estratégia
   decide **quando** subir até ele (curva, rolagem no nível certo, vida), não um alvo próprio.
3. **Combinações permitidas** (hoje só no perigo): subir e rolar na mesma rodada quando o nível de rolagem é exatamente o
   próximo nível (ex.: 4-1 → nível 8 e role o que passar do piso).
4. **Rolar só com alvo:** o passo `roll` sai do `hunt` (core/roll/hunt.mjs) já com o orçamento final; sem alvo viável não há
   passo `roll` (o `rollFor`, o `call` e o `turn` dizem a mesma coisa).
5. **As telas só apresentam `turn`:** overlay (selos de XP, rolar e ouro; marca de compra na loja), interface (painel de
   decisão em ordem) e o "Foco agora". O selo de XP deixa de calcular a curva por conta própria: "espere 4-1" vem de
   `turn.level.next`.

## 3. Passos

| #   | O que                                                                                                                          | Arquivos                                  | Pronto quando                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------- |
| D1  | Teste de caracterização: dado o estado, os painéis atuais (ação, gasto, compras, nível)                                        | `tests/turn.test.mjs`                     | trava o comportamento antes de mudar                                    |
| D2  | `core/turn/turn.mjs` (puro): monta `turn` a partir da decisão (`d`), das compras do estágio e do `hunt`, com o ouro descontado | novo módulo + `strategy.mjs` (encaixe)    | `turn` sai em todo `strategy()`; teste: a soma dos passos ≤ ouro − piso |
| D3  | Nível-alvo único: `strategy()` recebe o `level.target` do motor e o usa no lugar do `finalLevelOf` quando os dois existem      | `strategy.mjs`, `app/recommend-facts.mjs` | teste: comp escolhida pelo nível 9 → a estratégia mira o 9              |
| D4  | Combinação subir + rolar fora do perigo no nível de rolagem                                                                    | `strategy.mjs` (`decide`)                 | teste: nível 7 no 4-1, rollAt 8, 60 g → passos level + roll             |
| D5  | Overlay só lê `turn`: `levelBadge`, `rollBadge`, `goldBadge` e a marca de compra; sai a regra própria da curva                 | `overlay/hud/badges.mjs`, `view.mjs`      | teste: selo de XP igual ao passo `level` / `turn.level.next`            |
| D6  | Interface: painel de decisão mostra `turn.steps` em ordem; "Foco agora" usa `turn.headline`                                    | `v2/js/model.js`, `ui/*`, `focus.js`      | teste de modelo                                                         |
| D7  | Replay das partidas gravadas (GEP) checando coerência: passos que gastam mais que o ouro, "role" sem alvo, XP contra a decisão | `scripts/`                                | zero incoerências nas partidas gravadas                                 |

Dependências: `tft-nivel` está mexendo em `target-level.mjs`, `strategy.mjs`, `app/auto-refresh.mjs` e na chave de
análise (atraso do "suba"): começar D2 depois que ele entregar. Tudo é do servidor e vale depois que o usuário reiniciar;
o overlay e a interface recarregam sozinhos fora da partida.
