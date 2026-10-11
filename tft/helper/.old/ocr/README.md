# Arquivo histórico: leitura de tela (OCR) do TFT helper

Esta pasta guarda a leitura de tela que o helper usava até 2026-10-11. Ela **não faz parte do sistema**:

- nada fora de `.old/` importa, executa, inicia ou cita como fonte algo daqui;
- os globs da suíte (`tests/*.test.mjs`, `v2/js/*.test.mjs`, `*.test.mjs`) não entram aqui;
- `tests/architecture.test.mjs` falha se isso mudar: import ou citação de `.old/`, `screen-reader`, OCR do Windows
  (`Windows.Media.Ocr`), captura de tela, glifos, templates de ícone ou calibração em qualquer arquivo do sistema, ou o
  servidor e os scripts iniciando um leitor.

Os arquivos foram movidos com `git mv`, mantendo os caminhos relativos ao `tft/helper/`. O histórico de cada um continua
no git (`git log --follow .old/ocr/<arquivo>`). Os imports relativos deles **ficaram quebrados de propósito**: eles
apontavam para módulos do sistema que mudaram ou saíram (por exemplo `reconcileLevel` em `rules.mjs` e `mergeSources` em
`game-log.mjs`). Nada aqui roda como está.

## Por que saiu

Decisão do usuário em 2026-10-11, executada na branch `tft-helper-sem-ocr`:

1. O sistema fica **sem OCR** e com o **TFTAcademy** como fonte. O GEP do Overwolf, gravado em
   `%APPDATA%\TFTAcademy\tft-events.db`, já entrega tudo o que a tela lia: ouro, nível, XP, loja, banco de itens,
   removedores, Wisps e aprimoramentos. Isso revoga a decisão anterior de que "a tela é a fonte própria"
   (`FONTES-DE-DADOS.md`) e a decisão 7 de `ARQUITETURA.md`, que tratava a tela como verificação cruzada do GEP.
2. Sem o Overwolf e o TFTAcademy, esses campos ficam **desconhecidos explícitos** ("GEP off · sem fonte"). Não há
   reserva por tela e nada é inventado. As lacunas do início da partida (0 a 55 s, antes do primeiro evento do GEP)
   também ficam como desconhecido.
3. A ponte GEP própria (`overwolf-bridge/`) fica fora por enquanto.
4. Todo o código, os scripts, os templates, os testes, as fixtures, as ferramentas de medição e calibração e os dados de
   OCR ou leitura de tela vêm para esta pasta.

O plano da remoção está em `PLANO-REMOVER-OCR.md`.

## O que é cada arquivo

| Arquivo                                                                                                                            | Origem                                                            | O que fazia                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screen-reader.ps1`                                                                                                                | `screen-reader.ps1`                                               | Processo PowerShell 5.1 que recortava a janela "TFT" com `CopyFromScreen` e emitia uma linha JSON por mudança. Lia ouro, nível, XP e estágio por glifo, os nomes da loja e as cartas de aprimoramento pelo OCR do Windows (`Windows.Media.Ocr`) e o banco de itens e os removedores por ícone. Também tinha os modos `-FullPng` (calibração), `-TestImage` e `-TestManifest` |
| `screen-reader.mjs`                                                                                                                | `screen-reader.mjs`                                               | Controlava o processo (`screenReader(...)`: `sync`, `status`, `capture`, `stop`) e interpretava a saída: retenção de 15 s, espera de 3 s do banco, nome da loja → campeão e OCR → aprimoramento. Gravava `../data/item-icon-candidates.json` a cada início                                                                                                                   |
| `screen-glyphs.json`                                                                                                               | `screen-glyphs.json`                                              | Gabaritos de glifo do ouro, do nível, do XP, do estágio e do selo                                                                                                                                                                                                                                                                                                            |
| `bench-candidates.mjs`                                                                                                             | `bench-candidates.mjs`                                            | Lista de ícones `[{id, file}]` que o leitor comparava com cada espaço do banco de itens                                                                                                                                                                                                                                                                                      |
| `screen-accuracy.mjs`                                                                                                              | `screen-accuracy.mjs`                                             | Mede a leitura de tela contra o GEP como gabarito                                                                                                                                                                                                                                                                                                                            |
| `core/state/reconcile-level.mjs`                                                                                                   | `core/state/level.mjs` (funções `reconcileLevel` e `levelFromXp`) | Juntava o número do nível lido com o total do XP lido. Foi extraído do núcleo porque só o leitor o usava                                                                                                                                                                                                                                                                     |
| `scripts/screen-accuracy.mjs`, `scripts/screen-glyphs.mjs`, `scripts/screen-fixtures.mjs`                                          | `scripts/`                                                        | Ferramentas de medição, treino de glifos e geração de fixtures de tela                                                                                                                                                                                                                                                                                                       |
| `scripts/lib/glyph-train.mjs`, `scripts/lib/screen-corpus.mjs`                                                                     | `scripts/lib/`                                                    | Treino de glifos e corpus de quadros (ffmpeg sobre os vídeos do TFTAcademy)                                                                                                                                                                                                                                                                                                  |
| `tests/screen-reader.test.mjs`, `screen-fixtures`, `screen-accuracy`, `screen-glyphs`, `screen-independence`, `item-bank.test.mjs` | `tests/`                                                          | Testes que só existiam para a tela (33 casos)                                                                                                                                                                                                                                                                                                                                |
| `tests/core-state-screen.test.mjs`                                                                                                 | trechos de `tests/core-state.test.mjs`                            | Precedência, histerese e divergência GEP × tela; descarte de nível do OCR; montador com leitor falso                                                                                                                                                                                                                                                                         |
| `tests/level-ocr.test.mjs`                                                                                                         | trechos de `tests/level.test.mjs`                                 | `reconcileLevel`, nível lido velho ou inverossímil e geometria `Hud-Rect` do `.ps1`                                                                                                                                                                                                                                                                                          |
| `tests/gep-reader-screen.test.mjs`                                                                                                 | trechos de `tests/gep-reader.test.mjs`                            | A tela como reserva do GEP (GEP obsoleto ou ausente, identidade local, loja escondida)                                                                                                                                                                                                                                                                                       |
| `tests/item-holdings-screen.test.mjs`                                                                                              | caso (f) de `tests/item-holdings.test.mjs`                        | O banco lido da tela chegando ao motor                                                                                                                                                                                                                                                                                                                                       |
| `tests/v2-model-screen.test.mjs`, `tests/v2-shop-match-screen.test.mjs`                                                            | trechos de `v2/js/model.test.mjs` e `v2/js/shop-match.test.mjs`   | Chip "GEP off · tela", "Lendo da tela", leitura velha do nível/ouro e a loja "provável" lida da tela                                                                                                                                                                                                                                                                         |
| `tests/overlay-geometry-ps1.test.mjs`                                                                                              | trechos de `tests/overlay-geometry.test.mjs`                      | Conferia que `HUD_REGIONS` do overlay batia com os números do `.ps1`. Hoje o teste do sistema fixa os valores literais                                                                                                                                                                                                                                                       |
| `tests/fixtures/screen/` (24 PNG + `index.json`)                                                                                   | `tests/fixtures/screen/`                                          | Quadros reais anotados para medir a leitura                                                                                                                                                                                                                                                                                                                                  |
| `tests/fixtures/item-bank-*.png`, `classify-bank.ps1`, `make-canvas.ps1`                                                           | `tests/fixtures/`                                                 | Fixtures e auxiliares do reconhecimento do banco de itens                                                                                                                                                                                                                                                                                                                    |

Os casos copiados de testes do sistema (`*-screen.test.mjs`, `level-ocr.test.mjs`, `overlay-geometry-ps1.test.mjs`)
estão como eram antes da remoção. Cada um diz no cabeçalho de onde veio.

### Dados fora do git

O leitor gravava dois arquivos em `tft/data/`, que o git ignora:

- `data/screen-calibration.png` (3,1 MB): a captura de calibração do `POST /api/screen-capture`;
- `data/item-icon-candidates.json`: os candidatos de ícone, regravados a cada início.

A decisão 4 manda movê-los com `mv` simples para `.old/ocr/data/`. A worktree da remoção não tem `tft/data/`, e a pasta
principal não podia ser editada durante a remoção, então **esse `mv` fica para quando a branch for aplicada**:

```sh
mkdir -p tft/helper/.old/ocr/data
mv tft/data/screen-calibration.png tft/data/item-icon-candidates.json tft/helper/.old/ocr/data/
```

## O que mudou no sistema quando a tela saiu

- `server.mjs` não cria mais o leitor, não tem `POST /api/screen-capture` nem `screenReader` em `/api/health`, e o aviso
  da loja diz que ela vem do GEP. `stop.ps1` não procura mais `screen-reader.ps1`. O laço automático
  (`app/auto-refresh.mjs`) não liga nem desliga leitor nenhum.
- `app/state.mjs` monta o estado com os arquivos do jogo (`gameFilesState` em `game-log.mjs`: estágio e fase do Sentry),
  aplica o GEP por cima (`mergeGep`) e calcula o nível por último (`core/state/level.mjs`). O nível é o observado pelo
  GEP; sem ele, o piso derivado do XP passivo a partir do último nível observado.
- `noSource` (`gep-reader.mjs`, `noSourceOf`) dá o motivo de cada campo do jogador sem valor: o motivo do GEP fora
  (`banco-ausente`, `sem-eventos-recentes`...), `aguardando-gep`, `loja-escondida`, `identidade-<estado>` ou `nivel-maximo`.
- `core/state/precedence.mjs` só disputa o estágio (arquivo do jogo × GEP). A divergência registrada é GEP × arquivo do
  jogo. Ouro, nível, XP, loja e itens têm só o GEP.
- O estado visto no corpo de `/api/state` se chama `seen` (antes `screen`, nome de quando a tela era a fonte). A chave de
  análise continua a mesma, e o Ao vivo congelado da versão 1 (`app/live-snapshot.mjs`) é lido com o nome novo.
- A interface e o overlay mostram "GEP off · sem fonte" e a lista do que ficou desconhecido. Não existe mais o rótulo
  "tela": o nível é `lido`, `derivado` ou `estimado`.

## Como restaurar (se um dia for preciso)

A restauração é o caminho inverso, e o jeito mais seguro é reverter os commits da branch `tft-helper-sem-ocr`, do mais
novo para o mais antigo:

1. o da documentação;
2. o dos consumidores;
3. o da remoção (`refactor(tft-helper): move o leitor de tela para .old/ocr`);
4. se quiser também o rótulo "tela" e a reserva antiga, o do P1.

O `git revert` do commit da remoção devolve os arquivos para os caminhos de origem. Ele também devolve:

- `reconcileLevel` e `levelFromXp` ao núcleo e a reexportação deles em `rules.mjs`;
- `mergeSources` a `game-log.mjs`;
- o leitor ao `server.mjs`, ao `stop.ps1` e ao laço automático;
- a precedência GEP × tela.

Fazer à mão (`git mv` de volta) não basta, porque o núcleo, o servidor e os testes foram adaptados para viver sem a tela.
Ao restaurar, os dados da seção "Dados fora do git" voltam para `tft/data/`.
