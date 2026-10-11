# TFT Helper Bridge (ponte GEP própria)

App **ow-electron** mínimo e isolado: recebe do Overwolf GEP os eventos de TFT **do próprio jogador**, filtra e grava num
SQLite local com o mesmo esquema que o `gep-reader.mjs` do helper já lê. Com ele o helper depende só do Overwolf, não do TFTAcademy.

Estado: **esqueleto pronto, ainda não executado contra o Overwolf** (falta app ID/credenciais, ver abaixo). O que está
testado sem o Overwolf: filtro de privacidade, gravação, leitura pelo helper e precedência (`node --test test/bridge.test.mjs`).

## Arquitetura

```
Overwolf GEP (pacote "gep") ──> src/gep-service.cjs ──> src/sanitize.cjs (lista de permissão, só jogador local)
                                                          └──> src/recorder.cjs ──> %APPDATA%\TFT Helper Bridge\tft-events.db
                                                                                     └──> gep-reader.mjs (helper, origem "proprio")
main.cjs: janela visível (ui/), bandeja, GET http://127.0.0.1:18795/status (contadores, nunca o conteúdo dos eventos)
```

- **Features pedidas** (`src/features.cjs`): `gep_internal`, `me`, `match_info`, `roster`, `store`, `bench`, `carousel`.
  Fora de propósito: `augments` (a Riot proíbe dados de aprimoramentos em apps de terceiros; o Overwolf avisa na página de TFT),
  `board` (traz `opponent_board_pieces`), `match_stats` (`board_players` de todos) e `live_client_data` (`all_players`).
- **Só o jogador local**: `roster.player_status` e `bench.item_bench` chegam com todos os jogadores; o filtro mantém só a
  linha `localplayer` e descarta o resto antes de gravar. Chave fora da lista de permissão é descartada.
- **Sem injeção, sem leitura de memória, sem rede externa.** O servidor de status só escuta em `127.0.0.1`.
  `BRIDGE_FORWARD_URL` (opcional, desligado) encaminha os registros já filtrados para um receptor local; recusa qualquer destino não local.
- IDs de jogo: `21570` (TFT) e `28164` (TFT cliente UE5). O GEP pode reportar com sufixo (`215701`): ver `matchesGameId`.

## Variáveis

| Variável             | Efeito                                                                |
| -------------------- | --------------------------------------------------------------------- |
| `TFT_BRIDGE_DB`      | troca o arquivo do banco (o helper usa a mesma variável para achá-lo) |
| `BRIDGE_PORT`        | porta do status em 127.0.0.1 (padrão 18795)                           |
| `BRIDGE_FORWARD_URL` | receptor local opcional (`http://127.0.0.1:...`)                      |
| `OW_DEV_KEY`         | chave de desenvolvedor do Overwolf (modo dev, ver abaixo)             |

## Como rodar em modo de desenvolvimento (antes da aprovação)

Segundo a documentação pública do Overwolf (dev mode, Windows, `ow-electron` >= 39.8.10, `ow-electron-builder` >= 26.9.0):

1. Enviar a ideia do app em dev.overwolf.com e aguardar a aprovação da DevRel (status do perfil de _Pending_ para _Approved_).
   Sem isso o pacote `@overwolf/ow-electron` e os pacotes de jogo não são liberados. **Esta etapa é do usuário.**
2. Em dev.overwolf.com, perfil, _Developer Key_, **Generate key**. Definir na mesma janela do PowerShell:
   `$env:OW_DEV_KEY = '<chave>'`.
3. Em `overwolf-bridge/`: `npm install` (instala `@overwolf/ow-electron` e `@overwolf/ow-electron-builder`) e `npm start`.
   No Windows, abrir o terminal como administrador se o jogo estiver como administrador.
4. Com o app aberto, abrir o TFT. A janela mostra _Pacote GEP: pronto_, _Jogo: detectado_ e os contadores subindo.
5. No helper, nada a configurar: `gepReader` procura primeiro `%APPDATA%\TFT Helper Bridge\tft-events.db` e só então o do TFTAcademy.

Sem `OW_DEV_KEY` o app abre, mas os pacotes de jogo não carregam (a janela explica).

## Do dev mode à publicação

- O nome do app e o autor definem o **App UID** (`package.json`: `productName` e `author.name`; o nome não pode conter "bot").
  Mudar esses campos muda o UID: decida o nome final **antes** de submeter.
- Produção: o executável precisa de assinatura de código própria e a integridade do pacote é assinada pelo Overwolf (App Signing,
  `OW_BUILD_KEY`, App UID do Overwolf Console). Sem isso os pacotes GEP não carregam em build distribuído.
- Antes do lançamento a primeira versão passa pela QA da DevRel.
- Requisitos de aprovação informados pelo usuário e respeitados no esqueleto: uma janela de desktop visível (`ui/`), identidade
  própria, aviso de que não é endossado pela Riot (sem logo da Riot), só dados do próprio jogador, sem taxas de vitória/colocação de
  Augments ou Legends. **Pendências antes de submeter**: ícone/logo definitivos (o `ui/icon.png` é um marcador), política de
  privacidade, tela de preferências e revisão de nome para não sugerir vínculo com a Riot.

## Limites conhecidos

- O formato exato dos argumentos dos eventos (`(e, gameId, info)` com `info.feature/category/key/value`) e do `game-detected`
  (`gameInfo.commandLine` para o `match_id`) vem da análise estática do TFTAcademy e da documentação; **não foi observado ao vivo**.
  Sem `commandLine` o `match_id` fica nulo e o helper liga a partida por recência.
- `set_number` não é gravado (nulo); o helper não depende dele.
