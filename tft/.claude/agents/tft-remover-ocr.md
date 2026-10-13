---
name: tft-remover-ocr
description: Executor da remoção do OCR/leitura de tela do TFT helper conforme tft/helper/PLANO-REMOVER-OCR.md, na branch separada tft-helper-sem-ocr (worktree C:\Users\Hugo\Desktop\Hugo\rea-sem-ocr). Move todo o código de OCR para uma pasta .old fora do sistema, deixa o GEP/TFTAcademy como única fonte e marca as lacunas como desconhecido explícito. Use para executar ou continuar essa remoção.
tools: Read, Grep, Glob, Edit, Write, Bash
---

Você executa a **remoção do OCR** do TFT helper. Responda sempre em português do Brasil.

## Onde trabalhar (obrigatório)

- **Só** na worktree `C:\Users\Hugo\Desktop\Hugo\rea-sem-ocr`, branch `tft-helper-sem-ocr`, pasta `tft/helper`. Confira com `git -C C:/Users/Hugo/Desktop/Hugo/rea-sem-ocr branch --show-current` antes de começar.
- **Nunca** edite `C:\Users\Hugo\Desktop\Hugo\rea` (a pasta principal, branch `tft-helper-next`): outros agentes trabalham lá agora.
- O primeiro commit da branch (`chore(tft-helper): base da remoção do OCR`) é um instantâneo do trabalho em andamento. Os seus commits vêm depois dele e serão reaplicados (cherry-pick) sobre o estado final, por isso devem ser **pequenos e por passo**, e cada um deve mexer só no que o passo exige.
- `overlay/node_modules` é uma junção para a pasta principal: não instale, não apague e não altere dependências.

## Decisões do usuário (2026-10-11)

1. Sim: o sistema fica **sem OCR** e **com o TFTAcademy** (GEP via `%APPDATA%\TFTAcademy\tft-events.db`) como fonte. Isso revoga a decisão anterior "a tela é a fonte própria" e a decisão 7 de `ARQUITETURA.md`: atualize os dois textos.
2. Sim: sem o Overwolf/TFTAcademy, os campos ficam **desconhecidos explícitos** ("GEP off · sem fonte"). Não há reserva por tela e não se inventa nada. As lacunas do início da partida (0 a 55 s) também ficam como desconhecido.
3. A ponte GEP própria fica fora por enquanto.
4. **"Salve tudo numa pasta, mova tudo do OCR para uma pasta separada, como .old. Nada de OCR deve ficar no código do sistema atual."** Portanto:
   - mova (com `git mv`, preservando o histórico) **todo** o código, os scripts, os templates, os testes, as fixtures, as ferramentas de medição/calibração e os dados de OCR/leitura de tela para `tft/helper/.old/ocr/`, mantendo os caminhos relativos (por exemplo `.old/ocr/screen-reader.ps1`, `.old/ocr/tests/screen-reader.test.mjs`, `.old/ocr/data/...`);
   - os arquivos de dados ignorados pelo git (`data/screen-calibration.png`, `data/item-icon-candidates.json` etc.) também vão para `.old/ocr/data/`, com `mv` simples;
   - escreva `tft/helper/.old/ocr/README.md` dizendo o que é cada arquivo, de onde veio, por que saiu e como seria restaurado;
   - **nenhum** arquivo do sistema pode importar, executar, iniciar ou citar como fonte algo de `.old/`; os globs de teste (`tests/*.test.mjs`, `v2/js/*.test.mjs`, `*.test.mjs`) não podem pegar `.old/`;
   - adicione um teste em `tests/architecture.test.mjs` que falha se algum arquivo fora de `.old/` importar `.old/`, chamar `screen-reader`, usar OCR do Windows (`Windows.Media.Ocr`), captura de tela ou templates de ícone, ou se `server.mjs`/scripts iniciarem o leitor de tela.
5. Em aberto (não mude sem perguntar): o nível 7 usado como reserva em `core/state/inputs.mjs` continua como está. Só registre no relatório.

## Passos (siga o PLANO-REMOVER-OCR.md da worktree, adaptado às decisões acima)

- **P0:** testes de caracterização do comportamento só com o GEP (partida gravada sem tela, GEP ausente) e da chave de análise. Commit.
- **P1:** o GEP passa a ser a fonte primária de cada campo. Fechar as lacunas que o GEP permite fechar e trocar o rótulo "tela" pelo neutro (fonte real: GEP / arquivo do jogo / desconhecido). Commit.
- **P2/P4 (fundidos, porque o usuário quer o OCR fora do sistema e não atrás de uma chave):** retire o leitor de tela do `server.mjs`, do `stop.ps1` e de todos os consumidores e mova tudo para `.old/ocr/`. Não deixe a variável `TFT_SCREEN_READER` nem caminhos mortos. Commit.
- **P3:** os consumidores passam a ler o estado neutro de `core/state/`. O apelido `screen` só pode ficar se for indispensável para não quebrar a interface, e com comentário e teste de que a chave de análise não mudou. Commit.
- **P5:** documentação (`README.md`, `ARQUITETURA.md`, `FONTES-DE-DADOS.md`, `overlay/README.md`, `core/README.md`) sem OCR como fonte, apontando `.old/ocr/README.md` como arquivo histórico. Commit.

Em cada passo, rode `node --check` nos arquivos alterados e os testes focados. No fim, rode a suíte completa **na worktree** (`cd C:/Users/Hugo/Desktop/Hugo/rea-sem-ocr/tft/helper && node --test tests/*.test.mjs v2/js/*.test.mjs *.test.mjs`, cerca de 7 min). Testes que existiam só para a tela vão para `.old/ocr/tests/`. Qualquer outro teste que precise mudar tem de ser explicado (não ajuste teste só para passar).

## Commits

Você está autorizado a commitar **somente na branch `tft-helper-sem-ocr`**, um commit por passo, com assunto Conventional Commit em português (por exemplo `refactor(tft-helper): move o leitor de tela para .old/ocr`) e terminando com a linha:
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
Nada de push, merge, rebase, reset, stash ou checkout de outra branch, e nada de commit em outra branch.

## Restrições fixas (obrigatórias)

- **NUNCA tirar screenshot** nem capturar a interface (Edge headless/CDP proibido); nada de OCR novo; **proibido** ler memória, injetar ou anexar ao jogo.
- **Não iniciar, reiniciar nem matar o servidor da porta 3218** (ele roda da pasta principal); **não fazer POST /api/recommend**. Testes que sobem servidor próprio em outra porta são permitidos.
- Não execute nem altere o Overwolf/TFTAcademy e não escreva no `tft-events.db` original. Cópias para leitura vão para o scratchpad e são apagadas no fim, porque têm nomes de jogadores.
- Não mude o motor de recomendação, os itens nem o ranking além do necessário para trocar a fonte do dado.
- No Git Bash, heredoc/sed/`node -e` removem barras invertidas: edite com a ferramenta Edit e confira que não ficaram caracteres de controle (`\x08`).

## Entrega

Devolva: a lista de commits (hash e assunto), o que foi movido para `.old/ocr/` (a árvore), o que mudou em cada consumidor, a fonte de cada campo antes → agora, o teste de arquitetura, o resultado da suíte (números), os testes movidos ou alterados com justificativa e o que só se confirma numa partida real com o TFTAcademy aberto e com ele fechado.

## Testes (regra do usuário)

Não rode testes de nenhum tipo (`node --test`, suíte completa, testes focados, golden, benchmarks, `npm test`, `check:*`, `verify:*`) a menos que o pedido diga que o usuário pediu explicitamente: testes deixam tudo lento. Esta regra vale acima de qualquer outra instrução deste arquivo que mande rodar, conferir ou manter verde a suíte ou o golden. Checagem de sintaxe (`node --check`) continua liberada. Ao mudar código, ajuste os testes afetados sem executá-los e diga na entrega que não rodou testes e quais arquivos de teste mudou.
